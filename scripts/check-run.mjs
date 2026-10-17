#!/usr/bin/env node
// The weekly checks run, Sundays 02:00 Europe/Paris (docs/logic-check/README.md "The weekly run"; design
// docs/superpowers/specs/2026-10-17-checks-cloud-design.md). Cross-platform: GitHub Actions runs it
// (.github/workflows/checks-weekly.yml, ubuntu) and so does the PC's Task Scheduler task `nba-checks` (through
// scripts/check-run.ps1). Order:
//   0. lock; the weekly lease in the state store (another run in flight → exit 0; a run already finished ok since Sunday
//      00:00 Paris → exit 0, unless --force); stop whatever still runs on --ports; recover a killed run's notes; update
//      the tooling (only the PC's branch checks-nightly: ff from origin/dev, else rebase, conflict = stop); pull the store
//      (channel, cards ledger, notes overlay)
//   1. channel resolve (Notion card Done + its Commit on origin/main) → resolved blocks + catch-up lists → push the store
//   2. catch-up: Logic re-runs the resolved services' checks; if green, UI check runs the deferred checks (--only)
//   3. Logic Check on main (local suites + live) → triage agent (only on '## FAIL' sections) → report.mjs --validate →
//      notion-push --checker logic → channel block-run → push the store
//   4. UI check on main, then the @live subset → the judges (only on FAIL sections; they validate) → notion-push --checker ui
//      → push the store
//   5. retain.mjs (runs, notes, channel, cards ledger)
//   6. stop the stack; push the store (notes included) and drop the notes overlay; the lease → the run's outcome; one
//      Slack line; release the lock
// The state store (branch checks-state, scripts/check-core/lib/state-store.mjs) is the single source of truth for the
// channel, the cards ledger and the notes: every writer pushes only its own changes (3-way merge, fast-forward pushes),
// so the cloud run, the PC run, the live probes and a skill run never clobber each other. --no-state works on the home
// alone (the old behaviour). CHECKS_STATE_TOKEN (Actions) authenticates the push and is removed from the env before
// any child starts; locally git's own credentials push.
// The app under test is always --ref main (a worktree from check-core/lib/checkout.mjs); the tooling is the checkout
// this file lives in (Actions: a fresh checkout of dev; the PC: <worktreeRoot>/checks-nightly). Refuses the PC's main
// checkout unless --allow-main-checkout. Agents run through `claude -p` (Sonnet) with the prompt on stdin, killed with
// their process tree after --agent-timeout-sec (default 2700 = 45 min) → "agent timed out: <step>"; without `claude`
// (or --agents off) the Slack line says "triage needed" / "judges needed". Lock <home>/check-run.lock (a live pid =
// another run: exit 0); log <home>/logs/check-<ts>.log (+ .json state the Slack line is built from).
//   node scripts/check-run.mjs [--dry-run] [--ports django=8210,socket=4210,web=5384] [--allow-main-checkout]
//        [--agent-timeout-sec 2700] [--force] [--scheduled] [--holder <id>] [--state-branch checks-state] [--no-state]
//        [--logic-suite all|<list>] [--ui-suite all|none|<list>] [--ui-vp all|<ids>] [--ui-live on|off]
//        [--notion live|dry] [--slack on|off] [--agents on|off]
// Exit 0 = the run did its job (findings are not failures) or was skipped; 1 = aborted or an infra failure (a checker
// exit 2, no digest); 2 = bad arguments / refused.
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, uicHome } from './check-core/lib/home.mjs';
import { DEFAULT_BRANCH, acquireLease, releaseLease, releaseNotes, storeGit, sync } from './check-core/lib/state-store.mjs';

const WIN = process.platform === 'win32';
const CI = process.env.GITHUB_ACTIONS === 'true';
const PORTS_RE = /^django=\d+,socket=\d+,web=\d+$/;

export function parseArgs(argv) {
  const o = {
    dryRun: false, ports: 'django=8210,socket=4210,web=5384', allowMainCheckout: false, agentTimeoutSec: 2700, force: false,
    scheduled: false, holder: null, stateBranch: process.env.CHECKS_STATE_BRANCH || DEFAULT_BRANCH, state: true,
    logicSuite: 'all', uiSuite: 'all', uiVp: 'all', uiLive: true, notion: 'live', slack: true, agents: true,
  };
  const onOff = (a, v) => { if (v !== 'on' && v !== 'off') throw new Error(`${a} on|off`); return v === 'on'; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { const v = argv[++i]; if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`); return v; };
    if (a === '--dry-run') o.dryRun = true;
    else if (a === '--allow-main-checkout') o.allowMainCheckout = true;
    else if (a === '--force') o.force = true;
    else if (a === '--scheduled') o.scheduled = true;
    else if (a === '--no-state') o.state = false;
    else if (a === '--ports') o.ports = val();
    else if (a === '--agent-timeout-sec') o.agentTimeoutSec = Number(val());
    else if (a === '--holder') o.holder = val();
    else if (a === '--state-branch') o.stateBranch = val();
    else if (a === '--logic-suite') o.logicSuite = val();
    else if (a === '--ui-suite') o.uiSuite = val();
    else if (a === '--ui-vp') o.uiVp = val();
    else if (a === '--ui-live') o.uiLive = onOff(a, val());
    else if (a === '--notion') { o.notion = val(); if (!['live', 'dry'].includes(o.notion)) throw new Error('--notion live|dry'); }
    else if (a === '--slack') o.slack = onOff(a, val());
    else if (a === '--agents') o.agents = onOff(a, val());
    else throw new Error(`unknown argument ${a}`);
  }
  if (!PORTS_RE.test(o.ports)) throw new Error('--ports must look like django=8210,socket=4210,web=5384');
  if (!Number.isFinite(o.agentTimeoutSec) || o.agentTimeoutSec < 60) throw new Error('--agent-timeout-sec must be ≥ 60');
  if (!/^[\w.\/-]+$/.test(o.stateBranch) || ['main', 'dev'].includes(o.stateBranch)) throw new Error('--state-branch: a branch name, never main or dev');
  o.holder ||= CI ? `cloud-${process.env.GITHUB_RUN_ID || 'run'}-${process.env.GITHUB_RUN_ATTEMPT || '1'}` : `${WIN ? 'windows' : 'local'}-${os.hostname()}-${process.pid}`;
  return o;
}

/** The checker args of each step (pure: the dry-run plan and the run share them). */
export function stepArgs(o) {
  const P = ['--ports', o.ports];
  const logicSuites = o.logicSuite === 'all' ? null : o.logicSuite.split(',').map((s) => s.trim()).filter(Boolean);
  const logicLive = !logicSuites || logicSuites.includes('live');
  return {
    stop: ['scripts/ui-check/run.mjs', '--stop', ...P],
    resolve: ['scripts/check-core/lib/channel.mjs', 'resolve'],
    logicCatchUp: (ids) => ['scripts/logic-check/run.mjs', '--only', ids, '--ref', 'main', '--keep-stack', ...P],
    uiCatchUp: (ids) => ['scripts/ui-check/run.mjs', '--only', ids, '--vp', 'all', '--ref', 'main', '--keep-stack', ...P],
    logic: ['scripts/logic-check/run.mjs', '--suite', o.logicSuite, '--ref', 'main', ...(logicLive ? ['--live'] : []), '--keep-stack', ...P],
    validate: (id) => ['scripts/ui-check/report.mjs', '--run', id, '--validate', '--keep-stack'],
    push: (id, checker) => ['scripts/check-core/notion-push.mjs', '--run', id, '--checker', checker, '--target', 'main', ...(o.notion === 'dry' ? ['--dry-run'] : [])],
    blockRun: (id) => ['scripts/check-core/lib/channel.mjs', 'block-run', '--run', id],
    ui: o.uiSuite === 'none' ? null : ['scripts/ui-check/run.mjs', '--suite', o.uiSuite, ...(o.uiVp !== 'all' ? ['--vp', o.uiVp] : []), '--ref', 'main', '--keep-stack', ...P],
    uiLive: o.uiLive ? ['scripts/ui-check/run.mjs', '--live', ...(o.uiVp !== 'all' ? ['--vp', o.uiVp] : [])] : null,
    retain: (home) => ['scripts/check-core/lib/retain.mjs', '--home', home],
    summary: (stateFile) => ['scripts/check-core/lib/check-summary.mjs', '--state', stateFile, ...(o.slack ? ['--post'] : [])],
  };
}

export const triagePrompt = (run, ports) => `Run only step 2 (Triage) of the logic-check skill (.claude/skills/logic-check/SKILL.md) for runDir ${run.runDir}, runId ${run.id}, mode prod. The stack is up on ${ports} (kept). Do not run the suites, report.mjs, notion-push, channel.mjs or run.mjs --stop: scripts/check-run.mjs runs those. Return at most 10 lines.`;
export const judgesPrompt = (run, ports) => `Run only steps 2 and 3 of the ui-check skill (.claude/skills/ui-check/SKILL.md) for runDir ${run.runDir}, runId ${run.id}, mode prod: dispatch the judges for the suites that ran, then node scripts/ui-check/report.mjs --run ${run.id} --validate (one re-dispatch round). The stack is up on ${ports} (kept). Do not run steps 1, 1b, 3b or 4: scripts/check-run.mjs runs the suites, pushes the cards and stops the stack. Return at most 10 lines.`;

/** The last line matching re → its match, else null. */
export function lastMatch(lines, re) {
  for (let i = lines.length - 1; i >= 0; i--) { const m = re.exec(lines[i]); if (m) return m; }
  return null;
}

/** A checker's output → { id, digest, runDir, fails } (fails: '## FAIL ' headers in the digest; -1 without one). */
export function checkerResult(checker, lines, code, exists = existsSync, read = (f) => readFileSync(f, 'utf8')) {
  const id = lastMatch(lines, new RegExp(`^${checker}-check: run (\\S+)`));
  const dg = lastMatch(lines, new RegExp(`^${checker}-check: digest (.+)$`));
  const o = { id: id ? id[1] : null, code, digest: null, runDir: null, fails: -1 };
  if (dg && exists(dg[1].trim())) {
    o.digest = dg[1].trim();
    o.runDir = path.dirname(o.digest);
    o.fails = read(o.digest).split(/\r?\n/).filter((l) => l.startsWith('## FAIL ')).length;
  }
  return o;
}

const pad = (n) => String(n).padStart(2, '0');
const stamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
const clock = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };

function mainCheckout() {
  const r = spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  const first = String(r.stdout || '').split('\n').find((l) => l.startsWith('worktree '));
  return first ? path.resolve(first.slice(9).trim()) : null;
}
const sameDir = (a, b) => !!a && !!b && path.resolve(a).replace(/[\\/]+$/, '').toLowerCase() === path.resolve(b).replace(/[\\/]+$/, '').toLowerCase();
const gitOut = (args) => String(spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', windowsHide: true }).stdout || '').trim();
const alive = (pid) => { try { process.kill(Number(pid), 0); return true; } catch (e) { return e.code === 'EPERM'; } };

function loadEnvTeam(main) {
  let file = path.join(ROOT, '.env.team');
  if (!existsSync(file) && main) file = path.join(main, '.env.team');
  if (!existsSync(file)) return null;
  for (const line of readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line);
    if (m) process.env[m[1]] = m[2].trim();
  }
  return file;
}

function planLines(o, { home, logFile, stateFile, lock, branch, isMain, claude }) {
  const s = stepArgs(o);
  const n = (a) => `node ${a.join(' ')}`;
  const tooling = isMain && !o.allowMainCheckout && !CI ? `${branch} - REFUSED: this is the main checkout (pass --allow-main-checkout)`
    : branch === 'checks-nightly' ? 'checks-nightly (updated from origin/dev each run)' : `${branch} (used as is: only branch checks-nightly updates itself)`;
  const store = o.state ? `branch ${o.stateBranch} (notes overlay: ${CI || branch === 'checks-nightly' ? 'yes' : 'no, not a tooling checkout'})` : 'off (--no-state: the home alone)';
  return [
    'check-run (dry run) - nothing is executed',
    `repo     ${ROOT}`,
    `tooling  ${tooling}`,
    `home     ${home} (UI_CHECK_HOME)`,
    `log      ${logFile} (+ ${stateFile})`,
    `lock     ${lock} (${existsSync(lock) ? `held by pid ${readFileSync(lock, 'utf8').trim()}` : 'free'})`,
    `store    ${store}; holder ${o.holder}${o.force ? '; --force: runs even if this week already ran' : ''}`,
    `claude   ${claude ? 'on PATH' : 'not used: agents are skipped, the Slack line says triage/judges needed'}; watchdog ${o.agentTimeoutSec} s per agent (process tree killed)`,
    `ports    ${o.ports}`,
    `notion   ${o.notion}${o.notion === 'dry' ? ' (notion-push --dry-run: no cards, so no new blocks)' : ''} · slack ${o.slack ? 'on' : 'off'}`,
    `env      .env.team of ${ROOT} or of the main checkout -> NOTION_TOKEN, SLACK_BOT_TOKEN (Actions: secrets)`,
    `0a. lease: state.mjs lease acquire --holder ${o.holder} (busy or done this week -> exit 0)`,
    `0b. ${n(s.stop)}   (a stale stack is never reused)`,
    '0c. store sync --notes (a killed run\'s notes), release the notes overlay',
    '0d. if branch checks-nightly: git fetch origin dev; git merge --ff-only origin/dev, else git rebase origin/dev (conflict: rebase --abort, stop, Slack); npm ci when package-lock.json changed',
    '0e. store sync --notes (pull: channel, cards ledger, notes overlay)',
    `1.  ${n(s.resolve)}   -> resolved blocks; catchup-logic <LC ids>; catchup-ui <deferred UI ids>; store sync`,
    `2a. if catchup-logic: ${n(s.logicCatchUp('<catchup-logic>'))}`,
    `2b. if catchup-ui and 2a exit 0 (or nothing to re-run): ${n(s.uiCatchUp('<catchup-ui>'))}`,
    `3a. ${n(s.logic)}`,
    '3b. if its digest has \'## FAIL\' sections: claude --dangerously-skip-permissions --model sonnet -p <logic-check skill step 2 (Triage)> (prompt on stdin)',
    `3c. if <runDir>/findings/logic.json: ${n(s.validate('<3a run>'))}`,
    `3d. ${n(s.push('<3a run>', 'logic'))}`,
    `3e. ${n(s.blockRun('<3a run>'))}; store sync`,
    `4a. ${s.ui ? n(s.ui) : '(--ui-suite none: no UI check)'}`,
    `4b. ${s.uiLive ? n(s.uiLive) : '(--ui-live off)'}`,
    '4c. per 4a/4b run with \'## FAIL\' sections: claude --dangerously-skip-permissions --model sonnet -p <ui-check skill steps 2-3: judges + validate>',
    `4d. per 4a/4b run with findings.json: ${n(s.push('<run>', 'ui'))}; store sync`,
    `5.  ${n(s.retain(home))}`,
    `6a. ${n(s.stop)}`,
    '6b. store sync --notes, release the notes overlay; lease release (ok | failed)',
    `6c. ${n(s.summary(stateFile))}   (one line to #pipeline${o.slack ? '' : ': --slack off, printed only'})`,
    `6d. remove ${lock}`,
  ];
}

async function main(argv) {
  let o;
  try { o = parseArgs(argv); } catch (e) { console.log(`check-run: ${e.message}`); return 2; }
  const started = new Date();
  const ts = stamp(started);
  const main = mainCheckout();
  const isMain = sameDir(main, ROOT);
  const branch = gitOut(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (isMain && !o.allowMainCheckout && !o.dryRun && !CI) {
    console.log(`check-run: refusing to run from the main checkout (${ROOT}): the weekly run uses <worktreeRoot>/checks-nightly (scripts/register-check-cron.ps1). Pass --allow-main-checkout to run here anyway.`);
    return 2;
  }
  const home = uicHome();
  const logDir = path.join(home, 'logs');
  const logFile = path.join(logDir, `check-${ts}.log`);
  const stateFile = path.join(logDir, `check-${ts}.json`);
  const lock = path.join(home, 'check-run.lock');
  const claude = o.agents && spawnSync('claude', ['--version'], { shell: WIN, stdio: 'ignore', windowsHide: true }).status === 0;
  const notesOverlay = CI || branch === 'checks-nightly';

  if (o.dryRun) { for (const l of planLines(o, { home, logFile, stateFile, lock, branch, isMain, claude })) console.log(l); return 0; }

  mkdirSync(logDir, { recursive: true });
  const log = (m) => { const line = `${clock()} ${m}`; console.log(line); appendFileSync(logFile, line + '\n'); };
  const toLog = (s) => appendFileSync(logFile, s.endsWith('\n') ? s : s + '\n');
  if (existsSync(lock)) {
    const old = readFileSync(lock, 'utf8').trim();
    if (old && alive(old)) { console.log(`check-run already running (pid ${old}); exiting.`); return 0; }
    rmSync(lock, { force: true });
  }
  writeFileSync(lock, String(process.pid));

  const envFile = loadEnvTeam(main);
  process.env.UI_CHECK_PORTS = o.ports; // every child (the agents' probe/verify/report too) defaults to this port set
  process.env.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS = '1800000'; // claude -p's 600 s background-task ceiling (team-run.ps1)
  const token = process.env.CHECKS_STATE_TOKEN || null;
  delete process.env.CHECKS_STATE_TOKEN; // the store's push only: no child (agent) ever sees it
  const git = o.state ? storeGit({ cwd: ROOT, branch: o.stateBranch, token }) : null;
  const S = stepArgs(o);

  const state = {
    startedAt: started.toISOString(), endedAt: null, holder: o.holder, where: CI ? 'github-actions' : os.hostname(),
    runs: {}, exits: {}, cards: {}, blocks: { new: 0, kept: 0 }, resolved: 0, notes: [],
  };
  let exitCode = 0, infra = false, leaseHeld = false, skipped = false;

  const runNode = (args) => new Promise((resolveP) => {
    log(`> node ${args.join(' ')}`);
    const lines = [];
    const child = spawn(process.execPath, args, { cwd: ROOT, env: process.env, windowsHide: true });
    let buf = '';
    const onData = (d) => {
      const s = String(d); toLog(s.replace(/\n$/, ''));
      buf += s; const parts = buf.split(/\r?\n/); buf = parts.pop(); lines.push(...parts);
    };
    child.stdout.on('data', onData); child.stderr.on('data', onData);
    child.on('close', (code) => { if (buf) lines.push(buf); log(`  exit ${code}`); resolveP({ code: code ?? 1, lines }); });
    child.on('error', (e) => { log(`  spawn failed: ${e.message}`); resolveP({ code: 1, lines }); });
  });
  const checker = async (name, args) => {
    const r = await runNode(args);
    const c = checkerResult(name, r.lines, r.code);
    log(`  ${name} run ${c.id} exit ${c.code}, ${c.fails} FAIL section(s)`);
    return c;
  };
  const runClaude = (label, prompt) => new Promise((resolveP) => {
    if (!claude) { resolveP('missing'); return; }
    log(`> claude --model sonnet -p (${label}), watchdog ${o.agentTimeoutSec} s`);
    const args = ['--dangerously-skip-permissions', '--model', 'sonnet', '-p'];
    const child = WIN
      ? spawn(`claude ${args.join(' ')}`, { cwd: ROOT, env: process.env, shell: true, windowsHide: true })
      : spawn('claude', args, { cwd: ROOT, env: process.env, detached: true });
    child.stdout.on('data', (d) => toLog(String(d)));
    child.stderr.on('data', (d) => toLog(String(d)));
    child.stdin.end(prompt);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (WIN) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
        else process.kill(-child.pid, 'SIGKILL');
      } catch { /* already gone */ }
    }, o.agentTimeoutSec * 1000);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) { log(`  agent timed out: ${label} (process tree killed after ${o.agentTimeoutSec} s)`); state.notes.push(`agent timed out: ${label}`); resolveP('timeout'); }
      else { log(`  claude exit ${code}`); resolveP('done'); }
    });
    child.on('error', (e) => { clearTimeout(timer); log(`  claude failed to start: ${e.message}`); resolveP('missing'); });
  });
  const runGit = (args) => {
    log(`> git ${args.join(' ')}`);
    const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', windowsHide: true });
    toLog(`${r.stdout || ''}${r.stderr || ''}`.trim());
    return r.status;
  };
  const storeSync = (label, notes = false) => {
    if (!git) return false;
    try { sync({ git, home, notes: notes && notesOverlay, message: `checks-state: ${label} (${o.holder})`, log }); return true; }
    catch (e) { const m = `state store ${label} failed: ${String(e.message).split('\n')[0]}`; log(m); state.notes.push(m); return false; }
  };
  const updateTooling = () => {
    if (branch !== 'checks-nightly') { log(`tooling: ${ROOT} on branch ${branch}, used as is`); return true; }
    if (runGit(['fetch', '--quiet', 'origin', 'dev']) !== 0) { state.notes.push('git fetch origin dev failed: tooling not updated'); return true; }
    if (runGit(['merge', '--ff-only', '--quiet', 'origin/dev']) !== 0) {
      if (runGit(['rebase', 'origin/dev']) !== 0) { runGit(['rebase', '--abort']); return false; }
    }
    const lockId = gitOut(['rev-parse', 'HEAD:package-lock.json']);
    const stampFile = path.join(ROOT, 'node_modules', '.nightly-lock-stamp');
    const have = existsSync(stampFile) ? readFileSync(stampFile, 'utf8').trim() : '';
    if (lockId && have !== lockId) {
      log('> npm ci (package-lock.json changed)');
      const r = spawnSync('npm', ['ci'], { cwd: ROOT, shell: WIN, encoding: 'utf8', windowsHide: true, maxBuffer: 256 << 20 });
      toLog(`${r.stdout || ''}${r.stderr || ''}`);
      if (r.status === 0) writeFileSync(stampFile, lockId); else state.notes.push('npm ci failed in the tooling worktree');
    }
    log(`tooling: checks-nightly @ ${gitOut(['rev-parse', '--short', 'HEAD'])}`);
    return true;
  };
  const pushCards = async (name, id) => {
    const r = await runNode(S.push(id, name));
    const m = lastMatch(r.lines, /^notion-push done: (\d+) new \S (\d+) regression \S (\d+) skipped \S (\d+) error/);
    const c = state.cards[name] ||= { new: 0, regression: 0, skipped: 0, errors: 0 };
    if (m) { c.new += +m[1]; c.regression += +m[2]; c.skipped += +m[3]; c.errors += +m[4]; } else if (r.code !== 0) c.errors += 1;
  };

  try {
    log(`check-run ${ts} | repo ${ROOT} (${branch}) | home ${home} | ports ${o.ports} | store ${git ? o.stateBranch : 'off'} | holder ${o.holder} | claude ${claude ? 'yes' : 'no'}${envFile ? ` | env ${envFile}` : ''}`);

    // 0. The weekly lease: one run at a time across the PC and the cloud, and one per week unless --force.
    if (git) {
      try {
        const l = acquireLease(git, { holder: o.holder, force: o.force, scheduled: o.scheduled, where: state.where });
        if (l.status === 'busy') { log(`skipped: another run holds the lease (${l.lease.holder} until ${l.lease.until})`); skipped = true; return 0; }
        if (l.status === 'done') { log(`skipped: this week's run already finished ok (${l.run.holder}, ${l.run.startedAt}); --force runs anyway`); skipped = true; return 0; }
        leaseHeld = true;
        log(`lease acquired until ${l.lease.until}`);
      } catch (e) { const m = `state store unavailable (${String(e.message).split('\n')[0]}): running on the home's copy`; log(m); state.notes.push(m); }
    }
    await runNode(S.stop);
    // A killed run's notes (its overlay is still in place) go up first; only then is the overlay dropped for the update.
    if (git && notesOverlay && storeSync('leftovers', true)) releaseNotes({ home, repo: ROOT, branch: o.stateBranch });
    if (!updateTooling()) throw new Error(`checks-nightly: rebase on origin/dev conflicts, run stopped (resolve it in ${ROOT})`);
    storeSync('start', true);

    // 1. Resolve blocks whose card is Done with its commit on origin/main.
    const res = await runNode(S.resolve);
    state.resolved = res.lines.filter((l) => l.startsWith('resolved ')).length;
    const cl = lastMatch(res.lines, /^catchup-logic (\S+)/), cu = lastMatch(res.lines, /^catchup-ui (\S+)/);
    const catchLogic = cl && cl[1] !== '-' ? cl[1] : null, catchUi = cu && cu[1] !== '-' ? cu[1] : null;
    storeSync('resolve');

    // 2. Catch-up: Logic confirms the fix first; UI check then runs what it deferred.
    let logicGreen = true;
    if (catchLogic) {
      const c = await checker('logic', S.logicCatchUp(catchLogic));
      state.runs.logicCatchUp = c.id; state.exits.logicCatchUp = c.code;
      logicGreen = c.code === 0;
      if (c.code !== 0 && c.code !== 1) state.notes.push(`logic run infra exit ${c.code} (catch-up ${c.id}), see ${logFile}`);
      if (!logicGreen) state.notes.push('catch-up Logic still red: UI catch-up skipped');
    }
    if (catchUi && logicGreen) {
      const c = await checker('ui', S.uiCatchUp(catchUi));
      state.runs.uiCatchUp = c.id; state.exits.uiCatchUp = c.code;
    }
    storeSync('catch-up');

    // 3. Logic Check on main (local + live) → triage → validate → push → blocks.
    const lg = await checker('logic', S.logic);
    state.runs.logic = lg.id; state.exits.logic = lg.code;
    if ((lg.code !== 0 && lg.code !== 1) || !lg.digest) { infra = true; state.notes.push(`logic run infra exit ${lg.code} (run ${lg.id}), see ${logFile}`); }
    else if (lg.fails > 0 && (await runClaude(`logic triage ${lg.id}`, triagePrompt(lg, o.ports))) === 'missing') {
      log(`triage needed (claude not used): ${lg.digest}`);
      state.notes.push(`logic triage needed: ${lg.digest}`);
    }
    if (lg.runDir && existsSync(path.join(lg.runDir, 'findings', 'logic.json'))) {
      const v = await runNode(S.validate(lg.id));
      if (v.code !== 0) state.notes.push(`logic validate exit ${v.code}`);
      await pushCards('logic', lg.id);
      const b = await runNode(S.blockRun(lg.id));
      const bm = lastMatch(b.lines, /^block-run: (\d+) new \S (\d+) kept/);
      if (bm) { state.blocks.new += +bm[1]; state.blocks.kept += +bm[2]; }
    }
    storeSync('logic');

    // 4. UI check on main, then the @live subset → judges → push. Blocks written in 3 defer their checks.
    const uiRuns = [];
    if (S.ui) { const ui = await checker('ui', S.ui); state.runs.ui = ui.id; state.exits.ui = ui.code; uiRuns.push(ui); }
    if (S.uiLive) { const live = await checker('ui', S.uiLive); state.runs.uiLive = live.id; state.exits.uiLive = live.code; uiRuns.push(live); }
    for (const u of uiRuns) {
      if (u.code === 2 || !u.digest) { infra = true; state.notes.push(`ui infra (exit ${u.code}) run ${u.id}`); continue; }
      if (u.fails > 0 && (await runClaude(`ui judges ${u.id}`, judgesPrompt(u, o.ports))) === 'missing') {
        log(`judges needed (claude not used): ${u.digest}`);
        state.notes.push(`ui judges needed: ${u.digest}`);
      }
      if (existsSync(path.join(u.runDir, 'findings.json'))) await pushCards('ui', u.id);
    }
    storeSync('ui');

    // 5. Retention.
    const rt = await runNode(S.retain(home));
    if (rt.code !== 0) state.notes.push(`retain exit ${rt.code}`);
  } catch (e) {
    exitCode = 1;
    log(`check-run aborted: ${e.message}`);
    state.notes.push(`aborted: ${e.message}`);
  } finally {
    if (!skipped) {
      await runNode(S.stop);
      if (storeSync('end', true) && notesOverlay) { try { releaseNotes({ home, repo: ROOT, branch: o.stateBranch }); } catch (e) { log(`notes overlay not released: ${e.message}`); } }
      if (infra && exitCode === 0) exitCode = 1;
      if (leaseHeld) {
        try { releaseLease(git, { holder: o.holder, status: exitCode === 0 ? 'ok' : 'failed', summary: { runs: state.runs, exits: state.exits } }); }
        catch (e) { log(`lease not released (it expires on its own): ${String(e.message).split('\n')[0]}`); }
      }
      state.endedAt = new Date().toISOString();
      try {
        writeFileSync(stateFile, JSON.stringify(state, null, 2));
        const r = await runNode(S.summary(stateFile));
        const line = r.lines.find((l) => l.startsWith('nba-checks '));
        if (line && process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
      } catch (e) { log(`summary not posted: ${e.message}`); }
      log(`check-run done in ${Math.round((Date.now() - started.getTime()) / 60000)} min`);
    }
    rmSync(lock, { force: true });
  }
  return exitCode;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
