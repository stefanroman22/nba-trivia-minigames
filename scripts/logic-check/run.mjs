#!/usr/bin/env node
// Logic Check runner (spec §5): the suites as one Playwright invocation of scripts/logic-check, ui-check's digest
// reporter, run dir <uicHome>/runs/<id>-logic (UI_CHECK_RUN honoured — verify.mjs's `lc` criteria point it at a scratch
// run), run-meta.json `checker: 'logic'`.
//   node scripts/logic-check/run.mjs [--suite live,pages,auth,signup,profile,friends,game-data,rooms|all] [--only ID,ID]
//                                    [--mode prod|dev] [--ref main|dev|.|<sha>] [--repo <dir>] [--ports django=…,socket=…,web=…]
//                                    [--live [url]] [--keep-stack] [--skip-blocked] [--headed]
//   node scripts/logic-check/run.mjs --stop [--ports …]     stop a stack kept with --keep-stack
// Suites (lib/suites.mjs) are check-id prefixes: `live` targets the live site read-only (no stack, guest, GET/HEAD only:
// the api guard refuses anything else and counts every request — the run prints the counters and fails on a write);
// the others run on the local stack from a checkout of --ref (default main in prod mode, '.' = this checkout in dev
// mode), or --repo, on --ports (default the mode's checker ports). `all` = every suite, live included.
// --live [url]: the live site (default https://swishquest.com); with no --suite it means --suite live. The live suite
// reads the app catalogue/origins from --repo, else on GitHub Actions (which runs on main) this checkout, else the
// `main` checkout (not fetched).
// --only: check ids (`*` within an id); runs exactly those (their suites' projects), never skipped by a block.
// Blocks: Logic Check writes the channel's blocks and re-runs its blocked checks every run (that is how it sees a fix
// land), so by default it skips nothing. --skip-blocked (opt-in, never with --only): LC checks of the selected suites
// tagged with a blocked service are left out, deferred (channel.defer checker 'logic') and listed under Coverage gaps.
// (UI check's --skip-blocked is on by default: it only reads the blocks.)
// Local suites run on one worker (they share the logic.actor/peer accounts). Prints `logic-check: run <id>` and
// `logic-check: digest <path>`; exits 0 all passed, 1 a check failed (or the live guard saw a write), 2 infra
// (bad arguments, the checkout or the stack failed, nothing ran).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDir, runId } from '../ui-check/lib/run-id.mjs';
import { appRepo, codeState, ensureStack, stopStack } from '../ui-check/lib/stack.mjs';
import { grepFor, installEmergencyStop, playwright } from '../ui-check/lib/runner.mjs';
import { ensureCheckout } from '../check-core/lib/checkout.mjs';
import { ROOT } from '../check-core/lib/home.mjs';
import { PORT_SETS, activePorts, formatPorts, parsePorts } from '../check-core/lib/ports.mjs';
import { blockedChecks, grepInvertFor, inSelection, recordDeferrals } from '../check-core/lib/blocked.mjs';
import { SUITES, suiteOfId } from './lib/suites.mjs';

process.env.UI_CHECK_CHECKER = 'logic'; // run-id.mjs: never move the ui `latest` pointer; reporter: checker 'logic'
const LC = path.dirname(fileURLToPath(import.meta.url));
const LIVE_DEFAULT = 'https://swishquest.com';
const say = (m) => console.log(`logic-check: ${m}`);
const fail = (m) => console.error(`logic-check: ${m}`);
const list = (s) => String(s).split(',').map((x) => x.trim()).filter(Boolean);

function parseArgs(argv) {
  const o = { suite: null, only: null, mode: 'prod', ref: null, repo: null, ports: null, keepStack: false, skipBlocked: false, headed: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { const v = argv[++i]; if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`); return v; };
    if (a === '--suite') o.suite = val();
    else if (a === '--only') o.only = val();
    else if (a === '--mode') o.mode = val();
    else if (a === '--ref') o.ref = val();
    else if (a === '--repo') o.repo = val();
    else if (a === '--ports') o.ports = parsePorts(val());
    else if (a === '--keep-stack') o.keepStack = true;
    else if (a === '--skip-blocked') o.skipBlocked = true;
    else if (a === '--no-skip-blocked') o.skipBlocked = false;
    else if (a === '--headed') o.headed = true;
    else if (a === '--stop') o.stop = true;
    else if (a === '--live') { o.live = true; if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) o.liveUrl = argv[++i]; }
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

/** --suite / --only / --live → the suites to run. --only narrows to the suites its ids belong to. */
function selectSuites(o) {
  const names = Object.keys(SUITES);
  if (o.only) {
    const ids = list(o.only);
    const bad = ids.filter((id) => !suiteOfId(id));
    if (bad.length) throw new Error(`--only ${bad.join(', ')}: not a Logic Check id (prefixes ${Object.values(SUITES).map((s) => s.prefix).join(' ')})`);
    return [...new Set(ids.map(suiteOfId))];
  }
  const arg = o.suite || (o.live ? 'live' : 'all');
  const s = arg === 'all' ? names : list(arg);
  for (const x of s) if (!SUITES[x]) throw new Error(`unknown suite "${x}" (${names.join(', ')}, all)`);
  return s;
}

/** A project runs when it has a spec file. */
const hasSpecs = (project) => {
  const dir = path.join(LC, 'specs', project);
  try { return readdirSync(dir).some((n) => /\.spec\.m?js$/.test(n)); } catch { return false; }
};

function readResults() {
  try { return JSON.parse(readFileSync(path.join(runDir(), 'results.json'), 'utf8')); } catch { return []; }
}
const isFail = (r) => r.status === 'failed' || r.status === 'timedOut';
const gitHead = (repo) => spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8', windowsHide: true }).stdout.trim() || null;

/** The app under test: --repo, else (verify's stack already up) UI_CHECK_REPO, else a checkout of --ref. */
async function appFor(o, { local }) {
  if (o.repo) {
    const repo = path.resolve(o.repo);
    if (!existsSync(path.join(repo, 'package.json'))) throw new Error(`--repo ${repo} is not a checkout of the app`);
    return { repo, ref: null, head: gitHead(repo) };
  }
  if (!o.ref && process.env.UI_CHECK_STACK_READY === '1') return { repo: appRepo(), ref: null, head: gitHead(appRepo()) };
  if (!local) {
    // Live only: the catalogue and origins of what the live site runs (main). GitHub Actions runs on main already.
    if (!o.ref && process.env.GITHUB_ACTIONS === 'true') return { repo: ROOT, ref: '.', head: gitHead(ROOT) };
    return ensureCheckout(o.ref || 'main', { fetch: false });
  }
  return ensureCheckout(o.ref || (o.mode === 'dev' ? '.' : 'main'));
}

/** --skip-blocked (opt-in): the LC checks a block leaves out → their --grep-invert (null when none); blocked.json + deferrals. */
function applyBlocks(o, id, suites) {
  if (!o.skipBlocked || o.only) return null;
  let blocked;
  try { blocked = blockedChecks({ checker: 'logic' }); } catch (e) { fail(`channel not read (${e.message.split('\n')[0]}) — running every check`); return null; }
  blocked = inSelection(blocked, { prefixes: suites.map((s) => SUITES[s].prefix) });
  if (!blocked.length) return null;
  mkdirSync(runDir(), { recursive: true });
  writeFileSync(path.join(runDir(), 'blocked.json'), JSON.stringify(blocked, null, 2));
  const added = recordDeferrals(blocked, { checker: 'logic', runId: id });
  say(`${blocked.length} check(s) deferred (blocked service(s) ${[...new Set(blocked.map((b) => b.service))].join(', ')}; ${added} new in channel.json): ${blocked.map((b) => `${b.checkId} ← ${b.blockedBy}`).join(', ')}`);
  return grepInvertFor(blocked);
}

async function main() {
  let o, suites;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { fail(e.message); return 2; }
  if (o.help) {
    console.log('usage: node scripts/logic-check/run.mjs [--suite live,pages,auth,signup,profile,friends,game-data,rooms|all] [--only ID,ID] [--mode prod|dev] [--ref main|dev|.|<sha>] [--repo <dir>] [--ports django=…,socket=…,web=…] [--live [url]] [--keep-stack] [--skip-blocked] [--headed] [--stop]');
    return 0;
  }
  if (o.stop) {
    if (o.ports) await stopStack({ ports: o.ports });
    else for (const ports of Object.values(PORT_SETS)) await stopStack({ ports });
    return 0;
  }
  if (!['prod', 'dev'].includes(o.mode)) { fail('--mode must be prod or dev'); return 2; }
  try { suites = selectSuites(o); } catch (e) { fail(e.message); return 2; }
  let liveUrl;
  try { liveUrl = new URL(o.liveUrl || LIVE_DEFAULT); } catch { fail(`--live ${o.liveUrl} is not a URL`); return 2; }
  if (!/^https?:$/.test(liveUrl.protocol)) { fail(`--live needs an http(s) URL, got ${liveUrl.href}`); return 2; }

  const wanted = [...new Set(suites.flatMap((s) => SUITES[s].projects))].filter(hasSpecs);
  const liveProjects = wanted.filter((p) => p === 'live');
  const localProjects = wanted.filter((p) => p !== 'live');
  for (const s of suites) if (!SUITES[s].projects.some(hasSpecs)) say(`suite ${s} has no specs yet — skipped`);
  if (!wanted.length) { fail('nothing to run'); return 2; }

  process.env.UI_CHECK_MODE = o.mode;
  if (o.ports) process.env.UI_CHECK_PORTS = formatPorts(o.ports);
  const ports = activePorts(o.mode);
  const local = localProjects.length > 0;
  installEmergencyStop(o.keepStack || !local, null, () => (local ? stopStack({ ports }) : []));

  let app;
  try { app = await appFor(o, { local }); } catch (e) { fail(e.message); return 2; }
  process.env.UI_CHECK_REPO = app.repo;
  const id = runId('-logic');
  if (existsSync(path.join(runDir(), 'results.json'))) { fail(`run ${id} already has results (${runDir()}) — start again in a minute or set UI_CHECK_RUN to a new id`); return 2; }
  const t0 = Date.now();
  say(`run ${id} · mode ${o.mode} · suites ${suites.join(',')}${o.only ? ` · only ${o.only}` : ''}${liveProjects.length ? ` · LIVE ${liveUrl.origin} (read-only, GET/HEAD only)` : ''}`);
  say(`app ${app.repo} · ref ${app.ref ?? '(--repo)'} @ ${String(app.head).slice(0, 12)}${local ? ` · ports ${formatPorts(ports)}` : ''}`);

  const childEnv = { UI_CHECK_CHECKER: 'logic', UI_CHECK_MODE: o.mode, UI_CHECK_RUN: id, UI_CHECK_KEEP_STACK: '1', UI_CHECK_REPO: app.repo, UI_CHECK_PORTS: formatPorts(ports), UI_CHECK_LIVE_URL: liveUrl.origin };
  const grep = o.only ? grepFor(o.only) : `\\[(${suites.map((s) => SUITES[s].prefix).join('|')})[\\w.-]*\\]`;
  const invert = applyBlocks(o, id, suites) || undefined;
  let exit = 0, code = null;
  try {
    if (local) {
      if (process.env.UI_CHECK_STACK_READY !== '1') await ensureStack(o.mode, { repo: app.repo, ports, keepStack: o.keepStack });
      try { code = codeState(o.mode, { repo: app.repo, ports }); } catch (e) { fail(`code state not recorded: ${e.message.split('\n')[0]}`); }
      childEnv.UI_CHECK_STACK_READY = '1';
    }
    // Local suites share the logic.actor/peer accounts: one worker. Live alone: 4.
    exit = await playwright(wanted, { workers: local ? 1 : 4, grep, grepInvert: invert, headed: o.headed, env: childEnv, config: LC });
  } catch (e) {
    fail(e.message);
    exit = 2;
  } finally {
    if (local) {
      if (o.keepStack || process.env.UI_CHECK_STACK_READY === '1') say('stack kept running; stop it with `node scripts/logic-check/run.mjs --stop`');
      else await stopStack({ ports });
    }
  }

  const metaFile = path.join(runDir(), 'run-meta.json');
  if (existsSync(metaFile)) {
    const extra = { checker: 'logic', suites, ref: app.ref, head: app.head, repo: app.repo, mode: o.mode, ...(local ? { ports } : {}), ...(code ? { code } : {}), ...(liveProjects.length ? { liveUrl: liveUrl.origin } : {}) };
    try { writeFileSync(metaFile, JSON.stringify({ ...JSON.parse(readFileSync(metaFile, 'utf8')), ...extra }, null, 2)); } catch (e) { fail(`run-meta.json not updated: ${e.message}`); }
  }
  const all = readResults();
  const setup = all.find((r) => /^stack-/.test(r.project) && isFail(r));
  const results = all.filter((r) => !/^stack-/.test(r.project));
  if (setup) { fail(`${setup.project} failed: ${String(setup.error || '').split('\n')[0]}`); exit = 2; }
  else if (exit !== 2 && !results.length) { fail('nothing ran'); exit = 2; }
  else if (exit !== 2) exit = results.some(isFail) ? 1 : 0;
  if (liveProjects.length) {
    // The proof the live suite never wrote: the guard's counters of every live test that ran.
    const live = results.filter((r) => r.project === 'live');
    const ran = live.filter((r) => r.status !== 'skipped');
    const guarded = live.filter((r) => r.liveRequests);
    const reads = guarded.reduce((n, r) => n + r.liveRequests.read, 0);
    const writes = guarded.reduce((n, r) => n + r.liveRequests.write, 0);
    say(`live requests: ${reads} GET/HEAD · ${writes} refused write(s) · guard on ${guarded.length} of ${ran.length} live test(s)`);
    if (writes) exit = Math.max(exit, 1);
    if (guarded.length < ran.length) { fail(`only ${guarded.length} of ${ran.length} live test(s) carry the guard's counters — failing the live run`); exit = Math.max(exit, 1); }
  }
  const digest = path.join(runDir(), 'digest.md');
  console.log(`\nlogic-check: ${Math.round((Date.now() - t0) / 1000)}s · exit ${exit}`);
  say(`digest ${existsSync(digest) ? digest : '(none written)'}`);
  return exit;
}

process.exitCode = await main();
