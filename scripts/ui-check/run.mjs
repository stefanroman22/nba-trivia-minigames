#!/usr/bin/env node
// UI check runner: one stack, the suites as Playwright invocations, contact sheets, the digest.
//   node scripts/ui-check/run.mjs [--suite guest,account,games,multiplayer|all] [--vp ids|core|all]
//                                 [--only ID,ID] [--mode prod|dev] [--keep-stack] [--headed]
//   node scripts/ui-check/run.mjs --stop        stop a stack kept with --keep-stack
// --vp takes viewport ids (and/or mp pair names), `core` or `all` (default). --only takes check ids;
// `*` matches within an id (GM-wordle-*). Non-multiplayer suites run with 4 workers, multiplayer
// with 1 (its two accounts are shared). Exits 1 when any test failed.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { CORE, MP_PAIRS, VIEWPORTS } from './lib/viewports.mjs';
import { REPO_ROOT, runDir, runId } from './lib/run-id.mjs';
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

function playwright(projects, { workers, grep, headed, env }) {
  const args = [PW_CLI, 'test', '-c', path.relative(REPO_ROOT, UIC), '--workers', String(workers), '--pass-with-no-tests'];
  for (const p of projects) args.push('--project', p);
  if (grep) args.push('--grep', grep);
  if (headed) args.push('--headed');
  console.log(`\nui-check: playwright ${projects.length} project(s), ${workers} worker(s)${grep ? `, --grep ${grep}` : ''}`);
  const r = spawnSync(process.execPath, args, { cwd: REPO_ROOT, stdio: 'inherit', env: { ...process.env, ...env } });
  return r.status ?? 1;
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
    console.log('usage: node scripts/ui-check/run.mjs [--suite guest,account,games,multiplayer|all] [--vp ids|core|all] [--only ID,ID] [--mode prod|dev] [--keep-stack] [--headed]');
    console.log('       node scripts/ui-check/run.mjs --stop   (stop a stack kept with --keep-stack)');
    return 0;
  }
  if (opts.stop) { await stopStack(); return 0; }
  if (!['prod', 'dev'].includes(opts.mode)) { console.error(`ui-check: --mode must be prod or dev`); return 2; }
  let suites, sel;
  try { suites = selectSuites(opts.suite); sel = selectViewports(opts.vp); } catch (e) { console.error(`ui-check: ${e.message}`); return 2; }

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
    const projects = suites.filter((s) => s !== 'multiplayer' && hasSpecs(s)).flatMap((s) => sel.vps.map((v) => `${s}@${v}`));
    const mpProjects = suites.includes('multiplayer') && hasSpecs('multiplayer') ? sel.pairs.map((p) => `mp@${p}`) : [];
    for (const s of suites) if (!hasSpecs(s)) console.log(`ui-check: suite ${s} has no specs yet — skipped`);
    let ran = false;
    if (projects.length) {
      exit = Math.max(exit, playwright(projects, { workers: 4, grep, headed: opts.headed, env: childEnv }));
      ran = true;
    }
    if (mpProjects.length) {
      exit = Math.max(exit, playwright(mpProjects, { workers: 1, grep, headed: opts.headed, env: { ...childEnv, ...(ran ? { UI_CHECK_APPEND: '1' } : {}) } }));
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
