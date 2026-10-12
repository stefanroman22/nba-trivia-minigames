#!/usr/bin/env node
// UI check runner: one stack, the suites as Playwright invocations, contact sheets, the digest.
//   node scripts/ui-check/run.mjs [--suite guest,account,games,multiplayer|all] [--vp ids|core|all]
//                                 [--only ID,ID] [--mode prod|dev] [--keep-stack] [--headed]
//   node scripts/ui-check/run.mjs --stop        stop a stack kept with --keep-stack (or left by a killed run)
// Ctrl+C / SIGTERM / an uncaught error stop the stack too (unless --keep-stack).
// --vp takes viewport ids (and/or mp pair names), `core` or `all` (default). --only takes check ids;
// `*` matches within an id (GM-wordle-*). Non-multiplayer suites run with 4 workers, multiplayer
// with 1 (its two accounts are shared). Exits 1 when any test failed.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { CORE, MP_PAIRS, VIEWPORTS } from './lib/viewports.mjs';
import { REPO_ROOT, UIC_ROOT, runDir, runId } from './lib/run-id.mjs';
import { ensureStack, stopStack } from './lib/stack.mjs';
import { JPEG } from './lib/evidence.mjs';

const SUITES = ['guest', 'account', 'games', 'multiplayer'];
const UIC = path.join(REPO_ROOT, 'scripts', 'ui-check');
const PW_CLI = path.join(REPO_ROOT, 'node_modules', '@playwright', 'test', 'cli.js');
const SHEET_MAX = 24;

function parseArgs(argv) {
  const opts = { suite: 'all', vp: 'all', only: null, mode: 'prod', keepStack: false, headed: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { const v = argv[++i]; if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`); return v; };
    if (a === '--suite') opts.suite = val();
    else if (a === '--vp') opts.vp = val();
    else if (a === '--only') opts.only = val();
    else if (a === '--mode') opts.mode = val();
    else if (a === '--keep-stack') opts.keepStack = true;
    else if (a === '--headed') opts.headed = true;
    else if (a === '--stop') opts.stop = true;
    else if (a === '--where') opts.where = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return opts;
}

const list = (s) => String(s).split(',').map((x) => x.trim()).filter(Boolean);

function selectSuites(arg) {
  const s = arg === 'all' ? SUITES : list(arg);
  for (const x of s) if (!SUITES.includes(x)) throw new Error(`unknown suite "${x}" (${SUITES.join(', ')}, all)`);
  return s;
}

/** → { vps: viewport ids, pairs: mp pair names } */
function selectViewports(arg) {
  if (arg === 'all') return { vps: Object.keys(VIEWPORTS), pairs: Object.keys(MP_PAIRS) };
  const items = arg === 'core' ? CORE : list(arg);
  const vps = [], named = [];
  for (const x of items) {
    if (VIEWPORTS[x]) vps.push(x);
    else if (MP_PAIRS[x]) named.push(x);
    else throw new Error(`unknown viewport "${x}" (${Object.keys(VIEWPORTS).join(', ')}, core, all, or a pair: ${Object.keys(MP_PAIRS).join(', ')})`);
  }
  // A pair runs when named, or when both its viewports are selected; failing that, when it touches one.
  let pairs = Object.keys(MP_PAIRS).filter((p) => named.includes(p) || MP_PAIRS[p].every((v) => vps.includes(v)));
  if (!pairs.length) pairs = Object.keys(MP_PAIRS).filter((p) => MP_PAIRS[p].some((v) => vps.includes(v)));
  return { vps, pairs };
}

function grepFor(only) {
  if (!only) return null;
  const ids = list(only).map((id) => id.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[\\w.-]*'));
  return `\\[(${ids.join('|')})\\]`;
}

const PERF_TAG = '@perf';
/** Grep for the single-worker pass: @perf tests, narrowed by --only when given. */
function perfGrep(only) {
  const ids = grepFor(only);
  return ids ? `^(?=.*${PERF_TAG})(?=.*${ids})` : PERF_TAG;
}

// The running Playwright child, so an interrupt can take it down with the stack.
let child = null;

/** Run one Playwright invocation (async, so signal handlers can run meanwhile) → its exit code. */
function playwright(projects, { workers, grep, grepInvert, headed, env }) {
  const args = [PW_CLI, 'test', '-c', path.relative(REPO_ROOT, UIC), '--workers', String(workers), '--pass-with-no-tests'];
  for (const p of projects) args.push('--project', p);
  if (grep) args.push('--grep', grep);
  if (grepInvert) args.push('--grep-invert', grepInvert);
  if (headed) args.push('--headed');
  console.log(`\nui-check: playwright ${projects.length} project(s), ${workers} worker(s)${grep ? `, --grep ${grep}` : ''}${grepInvert ? `, --grep-invert ${grepInvert}` : ''}`);
  return new Promise((resolve) => {
    child = spawn(process.execPath, args, { cwd: REPO_ROOT, stdio: 'inherit', env: { ...process.env, ...env } });
    child.on('error', () => { child = null; resolve(1); });
    child.on('exit', (code) => { child = null; resolve(code ?? 1); });
  });
}

/**
 * Ctrl+C / SIGTERM / an uncaught error: kill the Playwright child and stop the stack (unless --keep-stack),
 * since main()'s `finally` never runs then. A hard kill (taskkill /F, SIGKILL) can't be caught: use --stop.
 */
function installEmergencyStop(keepStack) {
  let stopping = false;
  const bail = async (why, code) => {
    if (stopping) return;
    stopping = true;
    console.error(`\nui-check: ${why} — stopping${keepStack ? ' (stack kept: --keep-stack)' : ' the stack'}`);
    if (child?.pid) {
      try {
        if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
        else child.kill('SIGTERM');
      } catch { /* already gone */ }
    }
    if (!keepStack) await stopStack().catch((e) => console.error(`ui-check: stopStack failed: ${e.message}`));
    process.exit(code);
  };
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP', ...(process.platform === 'win32' ? ['SIGBREAK'] : [])];
  for (const sig of signals) process.on(sig, () => bail(`received ${sig}`, 130));
  process.on('uncaughtException', (e) => bail(`uncaught error: ${(e && e.stack) || e}`, 1));
  process.on('unhandledRejection', (e) => bail(`unhandled rejection: ${(e && e.stack) || e}`, 1));
}

function readResults() {
  try { return JSON.parse(readFileSync(path.join(runDir(), 'results.json'), 'utf8')); } catch { return []; }
}

const isFail = (r) => r.status === 'failed' || r.status === 'timedOut';
const vpRank = (r) => { const i = Object.keys(VIEWPORTS).indexOf(String(r.vp).split('+')[0]); return i < 0 ? 99 : i; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** One JPEG per failing check: its shots across viewports in a captioned grid. */
async function contactSheets(results) {
  const failing = [...new Set(results.filter(isFail).map((r) => r.checkId).filter(Boolean))];
  if (!failing.length) return [];
  const dir = path.join(runDir(), 'sheets');
  mkdirSync(dir, { recursive: true });
  const { pickChannel } = await import('./playwright.config.mjs');
  const browser = await chromium.launch({ channel: pickChannel() });
  const made = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 120 } }); // fullPage grows it to the grid
    for (const id of failing) {
      const shots = [];
      for (const r of results.filter((x) => x.checkId === id).sort((a, b) => vpRank(a) - vpRank(b))) {
        for (const rel of r.shots || []) if (!shots.some((s) => s.rel === rel)) shots.push({ rel, r });
      }
      const usable = shots.filter((s) => existsSync(path.join(runDir(), ...s.rel.split('/')))).slice(0, SHEET_MAX);
      if (!usable.length) continue;
      const cells = usable.map(({ rel, r }) => {
        const b64 = readFileSync(path.join(runDir(), ...rel.split('/'))).toString('base64');
        return `<figure class="${isFail(r) ? 'fail' : ''}"><img src="data:image/jpeg;base64,${b64}"><figcaption>${esc(path.posix.basename(rel, '.jpg'))}</figcaption></figure>`;
      });
      await page.setContent(`<!doctype html><style>
        body{margin:0;padding:12px;background:#111;color:#ddd;font:12px system-ui,sans-serif}
        h1{font-size:15px;margin:0 0 10px}
        .grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;align-items:start}
        figure{margin:0;background:#1c1c1c;border:2px solid #333;padding:4px}
        figure.fail{border-color:#c33}
        img{display:block;max-width:100%;max-height:520px;margin:auto}
        figcaption{padding-top:4px;word-break:break-all}
      </style><h1>${esc(id)} — ${usable.length} shot(s)${shots.length > usable.length ? ` of ${shots.length}` : ''}</h1><div class="grid">${cells.join('')}</div>`);
      await page.evaluate(() => Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; })))));
      const out = path.join(dir, `${id.replace(/[^\w.-]+/g, '-')}.jpg`);
      await page.screenshot({ path: out, fullPage: true, type: JPEG.type, quality: JPEG.quality });
      made.push(out);
    }
  } finally {
    await browser.close();
  }
  return made;
}

async function main() {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (e) { console.error(`ui-check: ${e.message}`); process.exit(2); }
  if (opts.help) {
    console.log('usage: node scripts/ui-check/run.mjs [--suite guest,account,games,multiplayer|all] [--vp ids|core|all] [--only ID,ID] [--mode prod|dev] [--keep-stack] [--headed] [--stop] [--where]');
    console.log('  --keep-stack  leave the local stack running after the run');
    console.log('  --where       print where runs and the stack file live (uicHome) and the latest run directory');
    console.log('  --stop        stop a stack kept with --keep-stack (or left behind by a killed run) and exit');
    return 0;
  }
  if (opts.where) {
    let latest = null;
    try { latest = readFileSync(path.join(UIC_ROOT, 'latest'), 'utf8').trim(); } catch { /* no run yet */ }
    console.log(`ui-check home: ${UIC_ROOT}`);
    console.log(`latest run:    ${latest ? path.join(UIC_ROOT, 'runs', latest) : '(none yet)'}`);
    return 0;
  }
  if (opts.stop) { await stopStack(); return 0; }
  if (!['prod', 'dev'].includes(opts.mode)) { console.error(`ui-check: --mode must be prod or dev`); return 2; }
  let suites, sel;
  try { suites = selectSuites(opts.suite); sel = selectViewports(opts.vp); } catch (e) { console.error(`ui-check: ${e.message}`); return 2; }

  installEmergencyStop(opts.keepStack);
  process.env.UI_CHECK_MODE = opts.mode;
  const id = runId();
  const t0 = Date.now();
  console.log(`ui-check: run ${id} · mode ${opts.mode} · suites ${suites.join(',')} · vps ${opts.vp}${opts.only ? ` · only ${opts.only}` : ''}`);

  const childEnv = { UI_CHECK_MODE: opts.mode, UI_CHECK_RUN: id, UI_CHECK_KEEP_STACK: '1' };
  const hasSpecs = (suite) => existsSync(path.join(UIC, 'specs', suite));
  const grep = grepFor(opts.only);
  let exit = 0;
  try {
    await ensureStack(opts.mode);
    childEnv.UI_CHECK_STACK_READY = '1'; // the Playwright stack-setup project only verifies health from here on
    const projects = suites.filter((s) => s !== 'multiplayer' && hasSpecs(s)).flatMap((s) => sel.vps.map((v) => `${s}@${v}`));
    const mpProjects = suites.includes('multiplayer') && hasSpecs('multiplayer') ? sel.pairs.map((p) => `mp@${p}`) : [];
    for (const s of suites) if (!hasSpecs(s)) console.log(`ui-check: suite ${s} has no specs yet — skipped`);
    let ran = false;
    if (projects.length) {
      // Timing-sensitive tests (title tag @perf) run last and alone, so parallel browsers cannot distort them.
      exit = Math.max(exit, await playwright(projects, { workers: 4, grep, grepInvert: PERF_TAG, headed: opts.headed, env: childEnv }));
      exit = Math.max(exit, await playwright(projects, { workers: 1, grep: perfGrep(opts.only), headed: opts.headed, env: { ...childEnv, UI_CHECK_APPEND: '1' } }));
      ran = true;
    }
    if (mpProjects.length) {
      exit = Math.max(exit, await playwright(mpProjects, { workers: 1, grep, headed: opts.headed, grepInvert: PERF_TAG, env: { ...childEnv, ...(ran ? { UI_CHECK_APPEND: '1' } : {}) } }));
      ran = true;
    }
    if (!ran) { console.error('ui-check: nothing to run'); exit = 2; }

    const results = readResults();
    if (results.some(isFail)) exit = Math.max(exit, 1);
    try {
      const sheets = await contactSheets(results);
      if (sheets.length) console.log(`ui-check: ${sheets.length} contact sheet(s) in ${path.join(runDir(), 'sheets')}`);
    } catch (e) {
      console.error(`ui-check: contact sheets failed: ${e.message.split('\n')[0]}`);
    }
  } catch (e) {
    console.error(`ui-check: ${e.message}`);
    exit = Math.max(exit, 1);
  } finally {
    if (opts.keepStack) console.log('ui-check: stack kept running (--keep-stack); stop it with `node scripts/ui-check/run.mjs --stop`');
    else await stopStack();
  }
  const digest = path.join(runDir(), 'digest.md');
  console.log(`\nui-check: ${Math.round((Date.now() - t0) / 1000)}s · exit ${exit}`);
  console.log(`ui-check: digest ${existsSync(digest) ? digest : '(none written)'}`);
  return exit;
}

process.exitCode = await main();
