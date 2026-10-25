#!/usr/bin/env node
// The security agent, two modes (docs/security/README.md):
//
//   weekly  full-repo scan (gitleaks over the full history, osv-scanner, Claude review) → state by fingerprint on the
//           branch security-state (new / still open / resolved) → ONE parent Notion ticket for the team pipeline with
//           the new findings (confidence ≥ 8, deduped, grouped by root cause and area, most severe first); none when
//           nothing is new.
//     node scripts/security/run.mjs weekly --run-id <id> [--run-url <url>] [--slot <iso>] [--notion live|backlog|dry]
//          [--state-branch security-state] [--llm on|off] [--model fable] [--force]
//
//   pr      diff-only scan of the checked-out branch against --base, in two phases so the agents never share a process
//           tree with a write token (security.yml runs them as separate steps):
//     scan    (env: the Claude token only) scan; high/critical with confidence ≥ 8 and trusted + --fix on → the team
//             pipeline's direct mode fixes the branch (`team-direct` skill), the fix is committed LOCALLY and re-scanned;
//             at most --max-rounds auto-fix rounds in a row per branch, then a human. Changes to the scan's own config or
//             tooling (PROTECTED) are reverted, never committed. Writes the outcome to --result.
//       node scripts/security/run.mjs pr --phase scan --base <ref> --branch <name> --result <file> [--pr <n>] [--trusted]
//            [--fix on|off] [--llm on|off] [--model opus] [--max-rounds 2]
//     report  (env: GH_TOKEN, PUSH_TOKEN, the state store token/key, NOTION_TOKEN for gate branches) push the local
//             auto-fix commits, set the commit status `security/pr-scan`, write the PR comment, record medium/low in the
//             state; a pipeline gate branch (security-gate/*) gets its blocking findings on its Notion card instead.
//       node scripts/security/run.mjs pr --phase report --result <file> --branch <name> [--pr <n>]
//            [--state-branch security-state] [--gate-card]
//   status  node scripts/security/run.mjs status --sha <sha> --state pending|success|failure|error --desc <text>
//
// In PR mode the scan's config (.security/ignore.json, .security/scan-instructions.md, .gitleaks.toml) is read from the
// merge base, so a PR cannot mute or re-scope its own findings. Console output is counts only (public repo, public
// logs); raw output and findings stay in $RUNNER_TEMP/security. Exit 0 = pass / weekly ok, 1 = blocked or failed, 2 = usage.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIN_CONFIDENCE, applyIgnore, blocking, bySeverity, dedupe, normalise } from './lib/finding.mjs';
import { claude, gitleaks, mergeBase, osv } from './lib/detect.mjs';
import { countText, counts, fixSpec, prComment, weeklyTicket, COMMENT_MARKER } from './lib/report.mjs';
import { STATE_BRANCH, addRun, markTicketed, openStore, readState, reconcile, recordPr, slotDone, writeState } from './lib/state.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WIN = process.platform === 'win32';
const REPO = process.env.GITHUB_REPOSITORY || 'stefanroman22/nba-trivia-minigames';
const CONTEXT = 'security/pr-scan';
// the scan's own config and tooling: an auto-fix may never change these (and a PR's change to them only counts after merge)
export const PROTECTED = ['.security/', '.gitleaks.toml', '.github/', 'scripts/security/', '.claude/'];
const isProtected = (f) => PROTECTED.some((p) => (p.endsWith('/') ? f.startsWith(p) : f === p));
const CONFIG_FILES = ['.security/ignore.json', '.security/scan-instructions.md', '.gitleaks.toml'];

const argv = process.argv.slice(2);
const cmd = argv[0];
const arg = (k, d = null) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const flag = (k) => argv.includes(k);
const log = (s) => console.log(`security: ${s}`);
const output = (o) => { if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(o).map(([k, v]) => `${k}=${v}`).join('\n') + '\n'); };

const sh = (c, a, opts = {}) => spawnSync(c, a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 << 20, windowsHide: true, ...opts });
const git = (a, opts) => {
  const r = sh('git', a, opts);
  if (r.status !== 0) throw new Error(`git ${a[0]} failed: ${String(r.stderr).trim().split('\n').pop()}`);
  return r.stdout.trim();
};
const node = (script, a, opts = {}) => sh(process.execPath, [path.join(ROOT, script), ...a], opts);
const gh = (a, input) => sh('gh', a, { input, shell: WIN });
const tmpDir = () => {
  const base = process.env.RUNNER_TEMP ? path.join(process.env.RUNNER_TEMP, 'security') : path.join(os.tmpdir(), 'security');
  mkdirSync(base, { recursive: true });
  return mkdtempSync(path.join(base, 'run-'));
};
const secret = process.env.SECURITY_STATE_KEY || null;
// agents (the review, the fix) never get a GitHub / Notion / state credential, even where the step has one
const AGENT_ENV = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(GH_TOKEN|GITHUB_TOKEN|NOTION_TOKEN|SLACK_BOT_TOKEN|SECURITY_STATE_TOKEN|SECURITY_STATE_KEY|PUSH_TOKEN|ACTIONS_RUNTIME_TOKEN|ACTIONS_ID_TOKEN_REQUEST_TOKEN)$/.test(k)));

/**
 * The config files the scan obeys → { dir, ignore, instructions, gitleaksConfig }. Weekly: the checkout's. PR: the merge
 * base's copies (written to tmp), so the PR under scan cannot change them; a file missing at the base (the tooling is
 * being introduced) falls back to the checkout's.
 */
function scanConfig({ mode, mb, tmp }) {
  const dir = path.join(tmp, 'config');
  for (const f of CONFIG_FILES) {
    const to = path.join(dir, f);
    mkdirSync(path.dirname(to), { recursive: true });
    const base = mode === 'pr' ? sh('git', ['show', `${mb}:${f}`], { encoding: 'buffer' }) : null;
    if (base && base.status === 0) writeFileSync(to, base.stdout);
    else if (existsSync(path.join(ROOT, f))) writeFileSync(to, readFileSync(path.join(ROOT, f)));
  }
  let ignore = [];
  try { ignore = JSON.parse(readFileSync(path.join(dir, '.security/ignore.json'), 'utf8')).ignore || []; } catch { /* none */ }
  return { ignore, instructions: path.join(dir, '.security/scan-instructions.md'), gitleaksConfig: path.join(dir, '.gitleaks.toml') };
}

/** All three detectors → { findings (deduped, ignore applied, confidence ≥ 8), dropped, failed: [tool] } */
function scan({ mode, base = null, llm, model, tmp, cfg }) {
  const runs = { gitleaks: gitleaks({ root: ROOT, mode, base, tmp, config: cfg.gitleaksConfig }), osv: osv({ root: ROOT, mode, base, tmp }) };
  if (llm) runs.claude = claude({ root: ROOT, mode, base, tmp, model, instructions: cfg.instructions, maxTurns: mode === 'weekly' ? 400 : 120, timeoutMin: mode === 'weekly' ? 150 : 40 });
  const failed = Object.entries(runs).filter(([, r]) => !r.ok).map(([k]) => k);
  const all = applyIgnore(dedupe(Object.values(runs).flatMap((r) => r.findings)), cfg.ignore);
  const findings = all.filter((f) => f.confidence >= MIN_CONFIDENCE).sort(bySeverity);
  for (const [k, r] of Object.entries(runs)) log(`${k}: ${r.ok ? `${r.findings.length} raw finding(s)` : 'FAILED'}${r.note ? ` (${r.note})` : ''}`);
  writeFileSync(path.join(tmp, 'findings.json'), JSON.stringify({ mode, base, findings, dropped: all.length - findings.length }, null, 2));
  return { findings, dropped: all.length - findings.length, failed };
}

/** An open claude finding the model did not re-report: present while its file still holds its sink line (reconcile
 *  caps that at MISSED_TO_RESOLVE runs). gitleaks and osv re-find what is there, so not re-found = gone. */
const stillPresent = (entry, details) => {
  if (entry.tool !== 'claude') return false;
  if (!details) return true; // no key to read the details: never resolve blind (reconcile still resolves after N misses)
  const p = path.join(ROOT, details.file || '');
  if (!details.file || !existsSync(p)) return false;
  const want = normalise(details.snippet);
  return !!want && readFileSync(p, 'utf8').split(/\r?\n/).some((l) => normalise(l) === want);
};

function notion(args) {
  const r = node('scripts/notion.mjs', args);
  if (r.status !== 0) throw new Error(`notion ${args[0]} failed: ${String(r.stderr).trim().split('\n').pop()}`);
  return r.stdout.trim();
}

// ---------------------------------------------------------------- weekly

async function weekly() {
  const runId = arg('--run-id') || `local-${Date.now()}`;
  const slot = arg('--slot') || '';
  const notionMode = arg('--notion', 'live');
  const llm = arg('--llm', 'on') === 'on';
  const store = openStore({ branch: arg('--state-branch', STATE_BRANCH) });
  const prev = readState(store);
  if (slot && slotDone(prev, slot) && !flag('--force')) { log(`slot ${slot} already ran ok: nothing to do`); output({ result: 'skipped' }); return 0; }
  if (!secret) log('WARNING: SECURITY_STATE_KEY is not set: the state keeps fingerprints only (no details)');

  const tmp = tmpDir();
  const s = scan({ mode: 'weekly', llm, model: arg('--model', 'fable'), tmp, cfg: scanConfig({ mode: 'weekly', tmp }) });
  // Tickets that are Done while their finding is re-reported get re-ticketed (not fixed, or regressed).
  const doneTickets = new Set();
  if (notionMode !== 'dry' && process.env.NOTION_TOKEN) {
    for (const t of new Set(Object.values(prev.entries).filter((e) => e.status === 'open' && e.ticket).map((e) => e.ticket))) {
      try { if (JSON.parse(notion(['get-card', t])).status === 'Done') doneTickets.add(t); } catch { /* archived or unreadable: treat as still open */ }
    }
  }
  const now = Date.now();
  const rec = reconcile(prev, s.findings, { now, secret, doneTickets, stillPresent, failedTools: [...s.failed, ...(llm ? [] : ['claude'])] });
  log(`kept ${s.findings.length} (confidence ≥ ${MIN_CONFIDENCE}; ${s.dropped} dropped) → new ${rec.fresh.length} · still open ${rec.still.length} · resolved ${rec.resolved.length}`);

  let ticket = null;
  let state = rec.state;
  if (rec.fresh.length) {
    const t = weeklyTicket(rec.fresh, { date: new Date(now).toISOString().slice(0, 10), runUrl: arg('--run-url', ''), runId });
    const bodyFile = path.join(tmp, 'ticket.md');
    const attach = path.join(tmp, 'findings.json');
    writeFileSync(bodyFile, t.body);
    writeFileSync(attach, JSON.stringify({ runId, findings: rec.fresh }, null, 2));
    if (notionMode === 'dry') {
      log(`DRY: would create "${t.title}" (${t.priority}, ${t.category}); body ${bodyFile}`);
    } else {
      ticket = notion(['create-card', t.title, '--priority', t.priority, '--category', t.category, '--source', t.source, '--target', 'dev', '--body-file', bodyFile, '--attach', attach]).split('\n').pop();
      if (notionMode === 'backlog') notion(['set-status', ticket, 'Backlog']);
      log(`ticket ${ticket} (${countText(counts(rec.fresh))})${notionMode === 'backlog' ? ' in Backlog (test run)' : ''}`);
      state = markTicketed(state, rec.fresh.map((f) => f.fingerprint), ticket, now);
    }
  } else log('nothing new: no ticket');

  const status = s.failed.length ? 'partial' : 'ok';
  const run = { id: runId, mode: 'weekly', at: new Date(now).toISOString(), slot: slot || null, status, failed: s.failed, new: rec.fresh.length, open: rec.still.length + rec.fresh.length, resolved: rec.resolved.length, ticket };
  if (notionMode !== 'dry') {
    // re-apply on top of whatever a PR run wrote meanwhile: this run's entries win for the fingerprints it touched
    const touched = new Set(Object.keys(state.entries).filter((fp) => state.entries[fp] !== prev.entries[fp]));
    writeState(store, (cur) => {
      const entries = { ...cur.entries };
      for (const fp of touched) entries[fp] = state.entries[fp];
      return addRun({ ...cur, entries }, run);
    }, `security-state: weekly ${runId} (${rec.fresh.length} new, ${rec.resolved.length} resolved)`);
  }
  output({ result: status, ticket: ticket || '', new: rec.fresh.length });
  if (s.failed.length) { log(`detector(s) failed: ${s.failed.join(', ')}: run marked partial (a backup trigger retries)`); return 1; }
  return 0;
}

// ---------------------------------------------------------------- pr: scan phase

/** Auto-fix rounds already spent in a row: the auto-fix commits on top of the branch since its last human commit. */
function priorRounds(mb) {
  let n = 0;
  for (const s of git(['log', '--format=%s', `${mb}..HEAD`]).split('\n').filter(Boolean)) { if (/^security: auto-fix round \d+/.test(s)) n++; else break; }
  return n;
}

/** Prepare node_modules and the backend venv once, for verify.mjs (Linux runner). */
let depsReady = false;
function ensureDeps() {
  if (depsReady || WIN) return;
  if (!existsSync(path.join(ROOT, 'node_modules'))) sh('npm', ['ci', '--no-audit', '--no-fund'], { stdio: 'ignore' });
  if (!existsSync(path.join(ROOT, 'backend', '.venv'))) {
    sh('python3', ['-m', 'venv', 'backend/.venv'], { stdio: 'ignore' });
    sh(path.join(ROOT, 'backend/.venv/bin/pip'), ['install', '-q', '-r', 'backend/requirements.txt'], { stdio: 'ignore' });
  }
  depsReady = true;
}

const changedFiles = () => git(['status', '--porcelain', '--untracked-files=all', '--', '.', ':!.team']).split('\n').filter(Boolean).map((l) => l.slice(3).replace(/^.* -> /, '').replace(/^"|"$/g, ''));

/** One auto-fix round through the team pipeline's direct mode → { changed, reverted, result } (changes committed locally) */
function autofix({ findings, branch, pr, round, mb, tmp }) {
  ensureDeps();
  const slug = `sec-${pr ? `pr${pr}` : 'gate'}-r${round}`;
  const specFile = path.join(tmp, `${slug}.md`);
  writeFileSync(specFile, fixSpec(findings, { branch, pr, round }));
  const files = [...new Set(findings.map((f) => f.file).filter(Boolean))].join(',');
  const prep = node('scripts/team/direct.mjs', [slug, '--spec-file', specFile, '--title', `Security auto-fix${pr ? ` PR #${pr}` : ''} round ${round}`, '--base', mb, '--branch', branch, '--repo', ROOT, '--files', files]);
  if (prep.status !== 0) return { changed: false, reverted: [], result: `DIRECT-FAIL prepare failed: ${String(prep.stderr).trim().split('\n').pop()}` };
  const r = sh('claude', ['--dangerously-skip-permissions', '--model', 'sonnet', '-p'], { input: `/team-direct ${slug}`, env: AGENT_ENV(), shell: WIN, timeout: 50 * 60_000 });
  writeFileSync(path.join(tmp, `${slug}.log`), `${r.stdout || ''}\n${r.stderr || ''}`);
  const result = (String(r.stdout || '').trim().split('\n').reverse().find((l) => /^DIRECT-(DONE|FAIL)/.test(l.trim())) || `DIRECT-FAIL no result line (exit ${r.status ?? r.error?.code})`).trim();
  // the scan's own config and tooling are off limits: revert whatever the agents changed there
  const reverted = changedFiles().filter(isProtected);
  if (reverted.length) {
    const tracked = reverted.filter((f) => sh('git', ['cat-file', '-e', `HEAD:${f}`]).status === 0);
    if (tracked.length) sh('git', ['checkout', 'HEAD', '--', ...tracked]);
    sh('git', ['clean', '-fdq', '--', ...reverted]);
  }
  const changed = changedFiles().length > 0;
  if (changed) {
    git(['add', '-A', '--', '.', ':!.team']);
    const msg = `security: auto-fix round ${round} (${findings.length} finding(s))\n\nFingerprints: ${findings.map((f) => f.fingerprint).join(', ')}\nBy the team pipeline's direct mode (team-direct), from the security gate.`;
    git(['-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com', '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '--no-verify', '-F', '-'], { input: msg });
  }
  return { changed, reverted, result };
}

async function prScan() {
  const base = arg('--base');
  const branch = arg('--branch');
  const resultFile = arg('--result');
  if (!base || !branch || !resultFile) { console.error('pr --phase scan: --base <ref> --branch <name> --result <file> required'); return 2; }
  const pr = arg('--pr');
  const trusted = flag('--trusted');
  const fix = arg('--fix', 'on') === 'on' && trusted;
  const llm = arg('--llm', 'on') === 'on';
  const maxRounds = Number(arg('--max-rounds', '2'));
  const out = { phase: 'scan', branch, pr, trusted, fix, origSha: null, sha: null, result: 'error', failed: [], block: [], other: [], firstBlock: [], rounds: 0, note: '' };
  try {
    const tmp = tmpDir();
    const mb = mergeBase(ROOT, base);
    out.origSha = out.sha = git(['rev-parse', 'HEAD']);
    const cfg = scanConfig({ mode: 'pr', mb, tmp });
    let rounds = priorRounds(mb);
    const start = rounds;
    let s;
    for (;;) {
      s = scan({ mode: 'pr', base, llm, model: arg('--model', 'opus'), tmp, cfg });
      out.block = s.findings.filter(blocking);
      out.other = s.findings.filter((f) => !blocking(f));
      if (!out.firstBlock.length) out.firstBlock = out.block;
      log(`diff findings (confidence ≥ ${MIN_CONFIDENCE}): ${out.block.length} blocking, ${out.other.length} not blocking`);
      if (s.failed.length || !out.block.length || !fix || rounds >= maxRounds) break;
      rounds++;
      const r = autofix({ findings: out.block, branch, pr, round: rounds, mb, tmp });
      log(`auto-fix round ${rounds}: ${r.result.split(' ')[0]}${r.changed ? ', committed locally' : ', no change'}${r.reverted.length ? ` (${r.reverted.length} change(s) to the scan's config/tooling reverted)` : ''}`);
      if (!r.changed) { out.note = `auto-fix round ${rounds} made no change (${r.result.slice(0, 120)})`; break; }
      out.sha = git(['rev-parse', 'HEAD']);
    }
    out.rounds = rounds - start;
    out.failed = s.failed;
    out.result = s.failed.length ? 'error' : out.block.length ? 'fail' : 'pass';
    if (fix && out.block.length && rounds >= maxRounds && !out.note) out.note = `${maxRounds} auto-fix rounds in a row reached`;
  } catch (e) {
    out.result = 'error';
    out.note = `scan crashed: ${String(e.message).split('\n')[0].slice(0, 200)}`;
    log(out.note);
  }
  writeFileSync(resultFile, JSON.stringify(out, null, 2));
  log(`scan result ${out.result}${out.rounds ? ` after ${out.rounds} auto-fix round(s)` : ''}`);
  return 0; // the report phase sets the verdict
}

// ---------------------------------------------------------------- pr: report phase

function setStatus(sha, state, description) {
  const r = gh(['api', '-X', 'POST', `repos/${REPO}/statuses/${sha}`, '-f', `state=${state}`, '-f', `context=${CONTEXT}`, '-f', `description=${description.slice(0, 140)}`,
    ...(process.env.RUN_URL ? ['-f', `target_url=${process.env.RUN_URL}`] : [])]);
  if (r.status !== 0) log(`could not set the commit status (${String(r.stderr).trim().split('\n').pop()})`);
  return r.status === 0;
}

function upsertComment(pr, body) {
  if (!pr) return;
  const list = gh(['api', `repos/${REPO}/issues/${pr}/comments`, '--paginate', '--jq', `.[] | select(.body | startswith("${COMMENT_MARKER}")) | .id`]);
  const id = String(list.stdout || '').trim().split('\n').filter(Boolean).pop();
  const r = id
    ? gh(['api', '-X', 'PATCH', `repos/${REPO}/issues/comments/${id}`, '-F', 'body=@-'], body)
    : gh(['api', '-X', 'POST', `repos/${REPO}/issues/${pr}/comments`, '-F', 'body=@-'], body);
  if (r.status !== 0) log(`could not write the PR comment (${String(r.stderr).trim().split('\n').pop()})`);
}

function push(sha, branch) {
  const token = process.env.PUSH_TOKEN;
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', ...(token ? { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader', GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}` } : {}) };
  const r = sh('git', ['-c', 'core.hooksPath=/dev/null', 'push', '--no-verify', 'origin', `${sha}:refs/heads/${branch}`], { env });
  if (r.status !== 0) throw new Error(`push to ${branch} rejected (${String(r.stderr).trim().split('\n').pop()}); a new push re-runs the scan`);
}

/** The Notion card a pipeline commit names (`Notion: <url>` in the ship skill's commit body) → page id or null. */
export function cardOf(body) {
  const m = /Notion:\s*\S*?(?<![0-9a-f])([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?![0-9a-f])/i.exec(String(body));
  return m ? m[1] : null;
}

async function prReport() {
  const resultFile = arg('--result');
  const branch = arg('--branch');
  const pr = arg('--pr');
  // --repo: the scanned checkout. This script itself runs from a fresh tooling checkout made after the scan step
  // (security.yml), so nothing the fix agents changed in the scanned checkout runs with this step's tokens.
  // Its git config is not trusted either (a repo-local config can run commands), so the scanned commits are fetched into
  // this tooling checkout and every git read and the push happen here.
  const target = path.resolve(arg('--repo', ROOT));
  if (target !== ROOT) git(['fetch', '--quiet', '--no-tags', `file://${target.split(path.sep).join('/')}`, '+HEAD:refs/security/scanned']);
  const scanned = target !== ROOT ? 'refs/security/scanned' : 'HEAD';
  const tgit = git;
  let res;
  try { res = JSON.parse(readFileSync(resultFile, 'utf8')); } catch { res = null; }
  const head = tgit(['rev-parse', scanned]);
  if (!res) {
    setStatus(head, 'error', 'security scan step crashed before writing a result: re-run the job');
    upsertComment(pr, prComment({ result: 'fail', note: 'The scan step crashed before it wrote a result, so the check stays red. Re-run the workflow.' }));
    output({ result: 'error', sha: head, blocking: 0, rounds: 0 });
    return 1;
  }
  let { result, sha, note } = res;
  // the auto-fix commits: re-check they leave the scan's config and tooling alone (the scan phase reverted such edits)
  if (sha && res.origSha && sha !== res.origSha) {
    const touched = tgit(['diff', '--name-only', `${res.origSha}..${sha}`]).split('\n').filter(Boolean);
    if (head !== sha || touched.some(isProtected)) { result = 'fail'; note = `auto-fix commits do not match the scan result or touch the scan's own config/tooling (${touched.filter(isProtected).join(', ') || 'HEAD moved'}): not pushed, a human has to look`; sha = res.origSha; }
    else {
      try { push(sha, branch); log(`pushed ${sha.slice(0, 7)} (${res.rounds} auto-fix round(s)) to ${branch}`); }
      catch (e) { result = 'error'; note = e.message; sha = res.origSha; }
    }
  }
  const block = res.block || [], other = res.other || [];
  const desc = result === 'error' ? `scan incomplete${res.failed?.length ? ` (${res.failed.join(', ')} failed)` : ''}: ${note || 're-run the job'}`
    : result === 'fail' ? `${block.length} high/critical finding(s): needs a human${note ? ` (${note})` : ''}`
    : `no high/critical findings${res.rounds ? ` (fixed in ${res.rounds} auto-fix round(s))` : ''}`;
  setStatus(sha, result === 'pass' ? 'success' : result === 'error' ? 'error' : 'failure', desc);
  upsertComment(pr, prComment({
    blockingFindings: result === 'fail' ? block : result === 'pass' && res.rounds ? res.firstBlock : [], otherFindings: other,
    result: result === 'pass' ? 'pass' : 'fail', rounds: res.rounds, maxRounds: 2, autofix: res.fix,
    note: result === 'error' ? `The scan did not complete (${note || res.failed?.join(', ') || 'unknown'}), so the check stays red. Re-run the workflow.` : note || '',
  }));
  // medium/low (and secrets only in the PR's commits) → state, so the weekly ticket carries them
  if (other.length && process.env.SECURITY_STATE_TOKEN) {
    try {
      writeState(openStore({ branch: arg('--state-branch', STATE_BRANCH) }), (cur) => addRun(recordPr(cur, other, { secret, pr }), { id: `pr-${pr || branch}-${sha.slice(0, 7)}`, mode: 'pr', at: new Date().toISOString(), status: result, pr, new: other.length }), `security-state: PR ${pr || branch} (${other.length} not blocking)`);
    } catch (e) { log(`state not written: ${e.message}`); }
  }
  // a pipeline gate branch: blocking findings go to its Notion card (private), so the next attempt can fix them
  if (flag('--gate-card') && result === 'fail' && process.env.NOTION_TOKEN) {
    const card = cardOf(tgit(['log', '-1', '--format=%B', head]));
    if (card) {
      try { notion(['comment', card, `🔒 security gate blocked the push to main (${block.length} high/critical). Fix these first:\n\n${fixSpec(block, { branch, round: 0 })}`.slice(0, 1900)]); log(`findings commented on card ${card}`); } catch (e) { log(`card comment failed: ${e.message}`); }
    } else log('gate branch: no Notion card named in the head commit');
  }
  output({ result, sha, blocking: block.length, rounds: res.rounds });
  log(`result ${result}: ${desc}`);
  return result === 'pass' ? 0 : 1;
}

async function status() {
  const ok = setStatus(arg('--sha') || git(['rev-parse', 'HEAD']), arg('--state', 'pending'), arg('--desc', 'security scan running'));
  return ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const phase = arg('--phase', 'scan');
  const code = cmd === 'weekly' ? await weekly()
    : cmd === 'pr' ? await (phase === 'report' ? prReport() : prScan())
      : cmd === 'status' ? await status()
        : (console.error('usage: run.mjs weekly … | pr --phase scan|report … | status …'), 2);
  process.exit(code);
}
