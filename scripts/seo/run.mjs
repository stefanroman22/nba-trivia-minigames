#!/usr/bin/env node
// The weekly SEO run, Mondays 06:00 Europe/Paris (spec docs/superpowers/specs/2026-10-25-seo-agent-design.md §5-§7).
// Cross-platform, as scripts/check-run.mjs: GitHub Actions runs it (.github/workflows/seo-weekly.yml, ubuntu) and so does
// the /seo skill locally. Order (runWeekly):
//   0. lock <home>/seo/run.lock (a live pid = another run: exit 0); the SEO lease seo/lease.json on the store (busy → exit 0)
//   1. pull the store: the ledger (saved as <runDir>/ledger-previous.json)
//   2. audit (audit.mjs runAudit) with the previous run's baseline (ledger baselineFrom) → digest.md, results.json, baseline.json
//   3. Search Console: inspections of the audited URLs, the sitemaps, Search Analytics → gsc.json, gsc-analytics.json,
//      gsc-summary.md (counts only). --gsc off or no credentials skips it; no credentials also files the owner action
//      "Set up Search Console access" in findings.json
//   4. ledger merge (audit + inspections) → ledger-summary.md
//   5. the seo agent: claude -p --model <--agent-model> (prompt on stdin, the process tree killed after
//      --agent-timeout-sec) writes findings.json, REPORT.md and docs/seo/owner-actions.md; that file, when it changed and
//      this is not --dry-run, is committed and pushed to dev. A failed / skipped agent → placeholder REPORT.md and the
//      Slack line says "judgement needed"; the run goes on. The agent's env holds no secret (SECRET_ENV)
//   6. notion-push (only with a findings.json) → decisions mirrored into the ledger
//   7. IndexNow for the URLs whose audit result changed → ledger.urls[url].indexnow
//   8. Drive export (ledger CSV, Search Analytics CSV, REPORT.md)
//   9. the history entry; push the store
//  10. one Slack line (config.json slackChannel; --dry-run / --slack off: printed as `dry: <line>`); release the lease
//   node scripts/seo/run.mjs [--dry-run] [--site <url>] [--gsc on|off] [--notion live|dry] [--slack on|off] [--agents on|off]
//        [--agent-model fable] [--agent-timeout-sec 1800] [--holder <id>] [--state-branch checks-state] [--no-state] [--home <dir>]
// --dry-run: everything is measured and written to the run dir, nothing leaves the machine (no lease or ledger push, no
// card, no ping, no upload, no commit, no Slack). --no-state: the home's ledger alone (no git). Run dir
// <home>/seo/runs/<runId>/, log <home>/seo/logs/run-<ts>.log. Nothing secret and no Search Analytics number reaches the
// console, the log or the Slack line. CHECKS_STATE_TOKEN (Actions) authenticates the store and the owner-actions push
// (as an http extraheader through git's env) and is removed from the env before any child starts.
// Exit 0 = the run did its job (findings are not failures) or was skipped; 1 = an infra failure; 2 = bad arguments.
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, uicHome } from '../check-core/lib/home.mjs';
import { DEFAULT_BRANCH } from '../check-core/lib/state-store.mjs';
import { newRunId, runAudit } from './audit.mjs';
import { cli as exportCli } from './export.mjs';
import { cli as indexnowCli } from './indexnow.mjs';
import { cliClient, pushFindings } from './notion-push.mjs';
import { loadConfig } from './lib/config.mjs';
import { allFailures, writeDigest } from './lib/digest.mjs';
import { DEFAULT_UA, fetcher as makeFetcher } from './lib/fetcher.mjs';
import { GSC_CHECK, findingsPath, fingerprintOf, readFindings, validateFindings } from './lib/findings.mjs';
import { credentialsFromEnv, tokenSource } from './lib/google-auth.mjs';
import { analyticsRange, gscClient } from './lib/gsc-client.mjs';
import { applyAudit, applyDecisions, applyInspections, baselineFrom, summary } from './lib/ledger.mjs';
import { postSeoLine, seoLine } from './lib/slack.mjs';
import { lease, pullLedger, pushLedger, readLocalLedger, readStoreState, seoStore, writeLocalLedger } from './lib/store.mjs';

const WIN = process.platform === 'win32';
const CI = process.env.GITHUB_ACTIONS === 'true';
const MODEL_RE = /^[\w.[\]-]+$/; // it reaches a shell command line on Windows
const HISTORY_MAX = 52;
const OWNER_ACTIONS_REL = 'docs/seo/owner-actions.md';
const REJECTED = 'owner actions: push rejected, file left in the run artifact';
export const SECRET_ENV = ['GOOGLE_SEO_CLIENT_ID', 'GOOGLE_SEO_CLIENT_SECRET', 'GOOGLE_SEO_REFRESH_TOKEN', 'NOTION_TOKEN', 'SLACK_BOT_TOKEN', 'CHECKS_STATE_TOKEN'];
export const SETUP_ACTION = { action: 'Set up Search Console access', clickPath: 'docs/seo/README.md → Owner setup' };

export function parseArgs(argv) {
  const o = {
    dryRun: false, site: null, gsc: true, notion: 'live', slack: true, agents: true, agentModel: 'fable', agentTimeoutSec: 1800,
    holder: null, stateBranch: process.env.CHECKS_STATE_BRANCH || DEFAULT_BRANCH, state: true, home: null,
  };
  const onOff = (a, v) => { if (v !== 'on' && v !== 'off') throw new Error(`${a} on|off`); return v === 'on'; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { const v = argv[++i]; if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`); return v; };
    if (a === '--dry-run') o.dryRun = true;
    else if (a === '--no-state') o.state = false;
    else if (a === '--site') o.site = val();
    else if (a === '--gsc') o.gsc = onOff(a, val());
    else if (a === '--notion') { o.notion = val(); if (!['live', 'dry'].includes(o.notion)) throw new Error('--notion live|dry'); }
    else if (a === '--slack') o.slack = onOff(a, val());
    else if (a === '--agents') o.agents = onOff(a, val());
    else if (a === '--agent-model') o.agentModel = val();
    else if (a === '--agent-timeout-sec') o.agentTimeoutSec = Number(val());
    else if (a === '--holder') o.holder = val();
    else if (a === '--state-branch') o.stateBranch = val();
    else if (a === '--home') o.home = path.resolve(val());
    else throw new Error(`unknown argument ${a}`);
  }
  if (o.site !== null) {
    let u;
    try { u = new URL(o.site); } catch { throw new Error(`--site ${o.site} is not a URL`); }
    if (!/^https?:$/.test(u.protocol)) throw new Error(`--site ${o.site} is not an http(s) URL`);
    o.site = o.site.replace(/\/+$/, '');
  }
  if (!MODEL_RE.test(o.agentModel)) throw new Error('--agent-model: a model name (letters, digits, . - _ [ ])');
  if (!Number.isFinite(o.agentTimeoutSec) || o.agentTimeoutSec < 60) throw new Error('--agent-timeout-sec must be ≥ 60');
  if (!/^[\w.\/-]+$/.test(o.stateBranch) || ['main', 'dev'].includes(o.stateBranch)) throw new Error('--state-branch: a branch name, never main or dev');
  o.holder ||= CI ? `cloud-${process.env.GITHUB_RUN_ID || 'run'}-${process.env.GITHUB_RUN_ATTEMPT || '1'}` : `${WIN ? 'windows' : 'local'}-${os.hostname()}-${process.pid}`;
  return o;
}

export const agentPrompt = (runDir, site) => `Load the seo skill, then the seo-indexing skill. Run dir: ${runDir}. Site: ${site}. Write ${runDir}/findings.json and docs/seo/owner-actions.md per the skill. Return ≤ 10 lines.`;

/** The agent's env: `env` without any secret (SECRET_ENV and every GOOGLE_SEO_*), plus claude -p's background-task ceiling. */
export function agentEnv(env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    const K = k.toUpperCase();
    if (!SECRET_ENV.includes(K) && !K.startsWith('GOOGLE_SEO_')) out[k] = v;
  }
  out.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS = '1800000'; // claude -p's 600 s background-task ceiling (as check-run.mjs)
  return out;
}

/** findings doc (or null) + the "Set up Search Console access" owner finding on the home page, once. → the doc */
export function withSetupAction(doc, { runId, site }) {
  const d = doc ?? { runId, findings: [] };
  if (d.findings.some((f) => f.decision === 'owner' && f.owner?.action === SETUP_ACTION.action)) return d;
  const n = 1 + Math.max(0, ...d.findings.map((f) => Number(/-(\d{3})$/.exec(String(f.id ?? ''))?.[1] ?? 0)));
  const f = {
    id: `SEO-${d.runId}-${String(n).padStart(3, '0')}`, check: GSC_CHECK, severity: 'major', urls: [`${site}/`],
    current: 'the weekly run has no Search Console access (no Google credentials): coverage and indexing are not measured',
    expected: 'the run reads URL Inspection and Search Analytics of the property every week',
    decision: 'owner', owner: { ...SETUP_ACTION },
  };
  f.fingerprint = fingerprintOf(f);
  d.findings.push(f);
  return d;
}

/** The ledger's current indexable URLs (audited, not expected-noindex, inspected) → { indexed: verdict PASS, notIndexed }. */
export function coverageCounts(ledger) {
  let indexed = 0, notIndexed = 0;
  for (const e of Object.values(ledger.urls)) {
    if (!e.audit || e.expectNoindex || !e.gsc?.verdict) continue;
    if (e.gsc.verdict === 'PASS') indexed += 1; else notIndexed += 1;
  }
  return { indexed, notIndexed };
}

const countBy = (items) => [...items.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map())].sort(([a], [b]) => String(a).localeCompare(String(b)))
  .map(([k, n]) => `${k} ${n}`).join(' · ') || 'none';

/** gsc-summary.md: counts by verdict and coverageState, the errors, the data age; never a Search Analytics value. */
export function gscSummary(inspections, { sitemaps = [], analyticsError = null, now = Date.now() } = {}) {
  const all = Object.values(inspections);
  const ok = all.filter((i) => !i.error);
  const newest = ok.map((i) => i.inspectedAt).filter(Boolean).sort().at(-1) ?? null;
  return [
    '# Search Console summary',
    `- inspected: ${all.length} url(s) · ${ok.length} ok · errors: ${countBy(all.filter((i) => i.error).map((i) => i.error))}`,
    `- verdict: ${countBy(ok.map((i) => i.verdict ?? 'none'))}`,
    `- coverage: ${countBy(ok.map((i) => i.coverageState ?? 'none'))}`,
    `- data as of: ${newest ?? 'never'}`,
    `- sitemaps: ${sitemaps.length} listed · errors ${sitemaps.reduce((n, s) => n + s.errors, 0)} · warnings ${sitemaps.reduce((n, s) => n + s.warnings, 0)} · pending ${sitemaps.filter((s) => s.isPending).length}`,
    `- analytics: ${analyticsError ? `failed (${analyticsError})` : `28 days to ${analyticsRange(28, new Date(now)).endDate} in gsc-analytics.json (Drive export only)`}`,
    '',
  ].join('\n');
}

const firstLine = (e) => String(e?.message ?? e).split('\n')[0];
const writeJson = (file, v) => writeFileSync(file, `${JSON.stringify(v, null, 2)}\n`);
const demote = (md) => md.replace(/^(#+) /gm, '#$1 ');

function placeholderReport({ runId, site, why, runDir }) {
  const part = (title, file) => (existsSync(path.join(runDir, file)) ? [`## ${title} (${file})`, '', demote(readFileSync(path.join(runDir, file), 'utf8').trim()), ''] : []);
  return [
    `# SEO run ${runId}`, '', `Site: ${site}`, '', '## Summary', '',
    `judgement needed: ${why}. The measurements are below and in the run dir; decide with the seo skill (/seo).`, '',
    ...part('Audit', 'digest.md'), ...part('Ledger', 'ledger-summary.md'), ...part('Search Console', 'gsc-summary.md'),
  ].join('\n');
}

/**
 * One weekly run (the order in the header). `o`: parseArgs() plus `home`. `deps` (all injectable): { now, log, toLog?,
 * env, config, credentials, ledgerStore: { acquire, pull, push, release }, audit, gsc, runAgent, ownerActionsFile,
 * ownerActionsChanged, commitOwnerActions, notionPush, indexnow, exportDrive, postLine }.
 * → { code, skipped, state, line } (code: 1 when any step could not do its job, else 0).
 */
export async function runWeekly(o, deps) {
  const d = deps;
  const { config, log } = d;
  const toLog = d.toLog ?? log;
  const site = (o.site ?? config.site).replace(/\/+$/, '');
  const dry = o.dryRun;
  const started = d.now();
  const runsRoot = path.join(o.home, 'seo', 'runs');
  const runId = newRunId({ now: new Date(started), root: runsRoot });
  const runDir = path.join(runsRoot, runId);
  const ledgerFile = path.join(runDir, 'ledger.json');
  const previousFile = path.join(runDir, 'ledger-previous.json');
  const reportFile = path.join(runDir, 'REPORT.md');
  const s = {
    runId, site, urls: 0, indexed: 0, notIndexed: 0, auditFails: 0, cards: { new: 0, seen: 0 }, ownerActions: 0, drive: 'skipped',
    durationMs: 0, judgementNeeded: false, failures: [],
  };
  const fail = (step, e) => { const m = `${step}: ${firstLine(e)}`; log(m); s.failures.push(m); };
  const soft = async (step, fn) => { try { return await fn(); } catch (e) { fail(step, e); return null; } };

  // 0. The lease: one SEO run at a time across the PC and the cloud.
  let leaseHeld = false;
  let ledger = null;
  let at = 'state store';
  try {
    if ((await d.ledgerStore.acquire()) === 'busy') {
      log('seo-run: skipped, another run holds the SEO lease (seo/lease.json)');
      return { code: 0, skipped: true, state: s, line: null };
    }
    leaseHeld = true;
    mkdirSync(runDir, { recursive: true });
    log(`seo-run: run ${runId} · site ${site} · ${runDir}${dry ? ' · DRY RUN' : ''}`);

    // 1. Pull the store.
    at = 'store pull';
    const previous = await d.ledgerStore.pull();
    writeJson(previousFile, previous);
    ledger = previous;

    // 2. Audit against the previous run's baseline.
    at = 'audit';
    const base = baselineFrom(previous);
    const result = await d.audit({ site, runId, runDir, baseline: Object.keys(base).length ? base : null });
    s.urls = result.counts.urls;
    s.auditFails = new Set(allFailures(result).map((f) => f.id)).size;
    log(`audit: ${s.urls} urls · ${s.auditFails} failing checks${result.regressions ? ` · ${result.regressions.length} regression(s)` : ' · no baseline'}`);

    // 3. Search Console.
    at = 'gsc';
    let creds = null;
    try { creds = d.credentials(); } catch (e) { log(`gsc: ${firstLine(e)}`); }
    let inspections = null;
    if (!creds) log('gsc: skipped (no Google credentials): owner action "Set up Search Console access" filed');
    else if (!o.gsc) log('gsc: skipped (--gsc off)');
    else if (new URL(site).host !== new URL(config.site).host) log(`gsc: skipped (${site} is not the property's site ${config.site})`);
    else {
      const r = await soft('gsc', () => d.gsc({ creds, urls: Object.keys(result.urls).sort(), runDir }));
      if (r?.error) fail('gsc', r.error);
      inspections = r?.inspections ?? null;
      if (inspections) log(`gsc: ${Object.keys(inspections).length} url(s) inspected`);
    }

    // 4. Ledger merge.
    at = 'ledger';
    ledger = applyAudit(previous, result, { expectNoindex: config.expectedNoindex ?? [], now: started });
    if (inspections) ledger = applyInspections(ledger, inspections);
    writeFileSync(path.join(runDir, 'ledger-summary.md'), summary(ledger, { now: started }));

    // 5. The agent, then its owner-actions file.
    at = 'agent';
    let why = await agentStep();
    if (!why && !existsSync(findingsPath(runDir))) why = 'the agent wrote no findings.json';
    if (!why && !existsSync(reportFile)) why = 'the agent wrote no REPORT.md';
    if (why) { s.judgementNeeded = true; log(`judgement needed: ${why}`); }
    if (!existsSync(reportFile)) writeFileSync(reportFile, placeholderReport({ runId, site, why, runDir }));
    await ownerActionsStep();

    // The findings: the setup action when there are no credentials; their decisions into the ledger.
    let doc = null, readable = true;
    try { doc = readFindings(runDir); } catch { readable = false; fail('findings', 'findings.json is not JSON'); }
    if (!creds && readable) { doc = withSetupAction(doc, { runId, site }); writeJson(findingsPath(runDir), doc); }
    if (doc && !validateFindings(doc).length) {
      ledger = applyDecisions(ledger, doc.findings, runId);
      s.ownerActions = doc.findings.filter((f) => f.decision === 'owner').length;
    }

    // 6. Notion cards.
    at = 'notion';
    if (existsSync(findingsPath(runDir))) {
      const r = await soft('notion', () => d.notionPush({ runId, runDir, dryRun: dry || o.notion === 'dry' }));
      if (r?.errors?.length) fail('notion', `findings.json invalid (${r.errors.length} error(s))`);
      const results = r?.results ?? [];
      s.cards.new = results.filter((x) => x.action === 'card' || x.action === 'regression').length;
      s.cards.seen = results.filter((x) => x.action === 'skip' && !String(x.why ?? '').startsWith('decision')).length;
      const errors = results.filter((x) => x.action === 'error').length;
      if (errors) fail('notion', `${errors} card error(s)`);
    } else log('notion: skipped (no findings.json)');

    // 7. IndexNow.
    at = 'indexnow';
    writeJson(ledgerFile, ledger);
    const ping = await soft('indexnow', () => d.indexnow({ runId, runDir, ledgerFile, previousFile, dryRun: dry }));
    if (ping?.code) fail('indexnow', `exit ${ping.code}`);
    const rec = ping?.record;
    if (rec && rec.status !== null && rec.status !== undefined && !rec.dryRun) {
      for (const u of rec.urls ?? []) if (ledger.urls[u]) ledger.urls[u].indexnow = { lastPingAt: rec.at, status: rec.status };
      ledger.dataAsOf.indexnow = rec.at;
    }

    // 8. Drive export.
    at = 'export';
    writeJson(ledgerFile, ledger);
    const ex = await soft('export', () => d.exportDrive({ runId, runDir, ledgerFile, dryRun: dry }));
    s.drive = ex?.drive ?? 'failed';
    if (ex?.code) fail('export', `exit ${ex.code}`);
  } catch (e) {
    fail(at, e);
  }

  // 9. The history entry, then the store.
  if (ledger) {
    ledger = structuredClone(ledger);
    Object.assign(s, coverageCounts(ledger));
    const entry = { runId, at: new Date(started).toISOString(), status: s.failures.length ? 'failed' : 'ok', indexed: s.indexed, notIndexed: s.notIndexed, failedChecks: s.auditFails, cards: s.cards.new };
    ledger.history = [...(ledger.history ?? []), entry].slice(-HISTORY_MAX);
    if (existsSync(runDir)) writeJson(ledgerFile, ledger);
    if (!dry) {
      const r = await soft('store push', () => d.ledgerStore.push(ledger, `seo: run ${runId}`));
      if (r) toLog(`store: ${r.pushed ? `pushed ${String(r.sha ?? '').slice(0, 7)}` : 'up to date'}`);
    }
  }

  // 10. One Slack line, then the lease goes.
  s.durationMs = d.now() - started;
  const line = seoLine(s);
  if (dry || !o.slack) log(`dry: ${line}`);
  else { const p = await d.postLine(line); if (p?.ok !== false) log(line); }
  if (leaseHeld) {
    try { await d.ledgerStore.release(); } catch (e) { toLog(`lease not released (it expires on its own): ${firstLine(e)}`); }
  }
  return { code: s.failures.length ? 1 : 0, skipped: false, state: s, line };

  /** The agent → null when it ran and exited 0, else why it did not judge. Never throws. */
  async function agentStep() {
    if (!o.agents) return 'the agent did not run (--agents off)';
    try {
      const r = await d.runAgent({ prompt: agentPrompt(runDir, site), model: o.agentModel, timeoutSec: o.agentTimeoutSec, env: agentEnv(d.env), runDir });
      if (r?.status === 'done' && r.code === 0) return null;
      if (r?.status === 'timeout') return `agent timed out after ${o.agentTimeoutSec} s`;
      if (r?.status === 'missing') return 'claude is not available';
      return `agent exit ${r?.code}`;
    } catch (e) {
      return `agent failed (${firstLine(e)})`;
    }
  }

  /** docs/seo/owner-actions.md → the run dir; committed and pushed to dev when it changed (never on --dry-run). */
  async function ownerActionsStep() {
    if (existsSync(d.ownerActionsFile)) copyFileSync(d.ownerActionsFile, path.join(runDir, 'owner-actions.md'));
    if (dry) return;
    let changed = false;
    try { changed = await d.ownerActionsChanged(); } catch (e) { log(`owner actions: ${firstLine(e)}`); }
    if (!changed) return;
    try {
      const r = await d.commitOwnerActions({ runId });
      if (r?.status === 'pushed') log('owner actions: committed and pushed to dev');
      else if (r?.status === 'skipped') log(`owner actions: ${r.why}, file left in the run artifact`);
      else log(REJECTED);
    } catch (e) {
      log(REJECTED);
      toLog(`  ${firstLine(e)}`);
    }
  }
}

// ---- The real deps -------------------------------------------------------------------------------------------------

/** The ledger store: the checks' store (the lease + pull/push), read-only under --dry-run, the home alone under --no-state. */
export function ledgerStoreFor(o, { git, home }) {
  if (!git) return { acquire: () => 'free', pull: () => readLocalLedger(home), push: (ledger) => writeLocalLedger(home, ledger), release: () => {} };
  if (o.dryRun) {
    return {
      acquire: () => { const l = readStoreState(git).lease; return l && Date.parse(l.until) > Date.now() && l.holder !== o.holder ? 'busy' : 'free'; },
      pull: () => readStoreState(git).ledger,
      push: () => {},
      release: () => {},
    };
  }
  return {
    acquire: () => lease(git, { holder: o.holder, action: 'acquire' }).status,
    pull: () => pullLedger(git, home),
    push: (ledger, message) => pushLedger(git, home, ledger, message),
    release: () => lease(git, { holder: o.holder, action: 'release' }),
  };
}

async function auditStep({ site, runId, runDir, baseline, config }) {
  const fetcher = makeFetcher({ ua: DEFAULT_UA, concurrency: 4, timeoutMs: 15000, redirect: 'manual' });
  const result = await runAudit({ site, config, fetcher, baseline, runId });
  writeDigest(result, runDir);
  return result;
}

/** Search Console → gsc.json (inspections by URL), gsc-analytics.json, gsc-summary.md. → { inspections, error } */
export async function searchConsoleStep({ creds, urls, runDir, config, client, now = Date.now }) {
  const c = client ?? gscClient({ token: tokenSource(creds), property: config.property, budget: config.inspectBudget });
  const sitemaps = await c.sitemaps();
  const inspections = {};
  for (const u of urls) inspections[u] = await c.inspect(u); // one at a time: well under the 600/min quota
  let analyticsError = null;
  try { writeJson(path.join(runDir, 'gsc-analytics.json'), await c.analytics({ days: 28 })); } catch (e) { analyticsError = firstLine(e); }
  writeJson(path.join(runDir, 'gsc.json'), inspections);
  writeFileSync(path.join(runDir, 'gsc-summary.md'), gscSummary(inspections, { sitemaps, analyticsError, now: now() }));
  return { inspections, error: analyticsError };
}

/** claude -p as check-run.mjs runs it: prompt on stdin, the process tree killed after timeoutSec. → { status, code? } */
function runClaude({ prompt, model, timeoutSec, env, claude, log, toLog }) {
  return new Promise((resolveP) => {
    if (!claude) { resolveP({ status: 'missing' }); return; }
    log(`> claude --model ${model} -p (seo judgement), watchdog ${timeoutSec} s`);
    const args = ['--dangerously-skip-permissions', '--model', model, '-p'];
    const child = WIN
      ? spawn(`claude ${args.join(' ')}`, { cwd: ROOT, env, shell: true, windowsHide: true })
      : spawn('claude', args, { cwd: ROOT, env, detached: true });
    child.stdout.on('data', (b) => toLog(String(b)));
    child.stderr.on('data', (b) => toLog(String(b)));
    child.stdin.end(prompt);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (WIN) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
        else process.kill(-child.pid, 'SIGKILL');
      } catch { /* already gone */ }
    }, timeoutSec * 1000);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) { log(`  agent timed out (process tree killed after ${timeoutSec} s)`); resolveP({ status: 'timeout' }); }
      else { log(`  claude exit ${code}`); resolveP({ status: 'done', code }); }
    });
    child.on('error', (e) => { clearTimeout(timer); log(`  claude failed to start: ${e.message}`); resolveP({ status: 'missing' }); });
  });
}

/** git in the tooling checkout; the token (CI) as an http extraheader through git's env, as state-store.mjs storeGit. */
function toolingGit(token) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  if (token) {
    Object.assign(env, {
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
      GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`,
    });
  }
  if (CI) Object.assign(env, { GIT_AUTHOR_NAME: 'nba-checks', GIT_AUTHOR_EMAIL: 'nba-checks@users.noreply.github.com', GIT_COMMITTER_NAME: 'nba-checks', GIT_COMMITTER_EMAIL: 'nba-checks@users.noreply.github.com' });
  return (args) => spawnSync('git', args, { cwd: ROOT, env, encoding: 'utf8', windowsHide: true });
}

/**
 * Commits docs/seo/owner-actions.md and pushes HEAD to dev (plain push, never force). Only from a checkout whose HEAD
 * is origin/dev (the workflow's fresh dev checkout): pushing another branch's HEAD to dev would ship its commits.
 */
function commitOwnerActions({ runId, token, toLog }) {
  const git = toolingGit(token);
  const fetched = git(['fetch', '--quiet', 'origin', 'dev']);
  if (fetched.status !== 0) return { status: 'skipped', why: 'git fetch origin dev failed' };
  const rev = (ref) => String(git(['rev-parse', ref]).stdout || '').trim();
  if (!rev('HEAD') || rev('HEAD') !== rev('FETCH_HEAD')) {
    return { status: 'skipped', why: 'the tooling checkout is not at origin/dev, not committed' };
  }
  for (const args of [['add', '--', OWNER_ACTIONS_REL], ['commit', '--quiet', '-m', `seo: owner actions ${runId}`, '--', OWNER_ACTIONS_REL]]) {
    const r = git(args);
    if (r.status !== 0) throw new Error(`git ${args[0]} failed: ${String(r.stderr || r.stdout).trim().split('\n').pop()}`);
  }
  const p = git(['push', '--porcelain', 'origin', 'HEAD:dev']);
  toLog(`${p.stdout || ''}${p.stderr || ''}`.trim());
  return { status: p.status === 0 ? 'pushed' : 'rejected' };
}

/** findings.json → notion-push's pushFindings (validated first, as the CLI). → { results } | { errors } */
function notionStep({ runDir, dryRun, log }) {
  let doc;
  try { doc = readFindings(runDir); } catch { return { errors: ['findings.json is not JSON'] }; }
  const errors = validateFindings(doc);
  if (errors.length) { for (const e of errors) log(`notion-push: invalid findings.json: ${e}`); return { errors }; }
  return { results: pushFindings(doc, cliClient(), { dryRun, log }) };
}

async function indexnowStep({ runId, runDir, ledgerFile, previousFile, dryRun, home, log }) {
  const code = await indexnowCli(['--run', runId, '--run-dir', runDir, '--ledger', ledgerFile, '--previous', previousFile, '--home', home, ...(dryRun ? ['--dry-run'] : [])], { log, err: log });
  const file = path.join(runDir, 'indexnow.json');
  return { code, record: existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null };
}

async function exportStep({ runId, runDir, ledgerFile, dryRun, home, log }) {
  const lines = [];
  const say = (m) => { lines.push(m); log(m); };
  const code = await exportCli(['--run', runId, '--run-dir', runDir, '--ledger', ledgerFile, '--home', home, ...(dryRun ? ['--dry-run'] : [])], { log: say, err: say });
  return { code, drive: code !== 0 ? 'failed' : lines.some((l) => /^export: \d+ files → /.test(l)) ? 'ok' : 'skipped' };
}

export function defaultDeps(o, { home, log, toLog, token }) {
  const config = loadConfig();
  const claude = o.agents && spawnSync('claude', ['--version'], { shell: WIN, stdio: 'ignore', windowsHide: true }).status === 0;
  const git = o.state ? seoStore({ token, branch: o.stateBranch }) : null;
  return {
    now: Date.now, log, toLog, env: process.env, config,
    credentials: () => credentialsFromEnv(),
    ledgerStore: ledgerStoreFor(o, { git, home }),
    audit: (a) => auditStep({ ...a, config }),
    gsc: (a) => searchConsoleStep({ ...a, config }),
    runAgent: (a) => runClaude({ ...a, claude, log, toLog }),
    ownerActionsFile: path.join(ROOT, ...OWNER_ACTIONS_REL.split('/')),
    ownerActionsChanged: () => String(spawnSync('git', ['status', '--porcelain', '--', OWNER_ACTIONS_REL], { cwd: ROOT, encoding: 'utf8', windowsHide: true }).stdout || '').trim() !== '',
    commitOwnerActions: ({ runId }) => commitOwnerActions({ runId, token, toLog }),
    notionPush: (a) => notionStep({ ...a, log }),
    indexnow: (a) => indexnowStep({ ...a, home, log }),
    exportDrive: (a) => exportStep({ ...a, home, log }),
    postLine: (line) => postSeoLine(line, { channel: config.slackChannel, log }),
  };
}

const pad = (n) => String(n).padStart(2, '0');
const stamp = (t) => `${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}-${pad(t.getHours())}${pad(t.getMinutes())}${pad(t.getSeconds())}`;
const clock = () => { const t = new Date(); return `${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`; };
const alive = (pid) => { try { process.kill(Number(pid), 0); return true; } catch (e) { return e.code === 'EPERM'; } };

async function main(argv) {
  let o;
  try { o = parseArgs(argv); } catch (e) { console.log(`seo-run: ${e.message}`); return 2; }
  if (o.home) process.env.UI_CHECK_HOME = o.home; // every module's uicHome() agrees with --home
  o.home ??= uicHome();
  const seoHome = path.join(o.home, 'seo');
  const logFile = path.join(seoHome, 'logs', `run-${stamp(new Date())}.log`);
  const lock = path.join(seoHome, 'run.lock');
  mkdirSync(path.dirname(logFile), { recursive: true });
  const toLog = (m) => appendFileSync(logFile, m.endsWith('\n') ? m : `${m}\n`);
  const log = (m) => { console.log(m); toLog(`${clock()} ${m}`); };
  if (existsSync(lock)) {
    const old = readFileSync(lock, 'utf8').trim();
    if (old && alive(old)) { console.log(`seo-run already running (pid ${old}); exiting.`); return 0; }
    rmSync(lock, { force: true });
  }
  writeFileSync(lock, String(process.pid));
  const token = process.env.CHECKS_STATE_TOKEN || null;
  delete process.env.CHECKS_STATE_TOKEN; // the store's and the owner-actions push only: no child ever sees it
  try {
    log(`seo-run | repo ${ROOT} | home ${o.home} | store ${o.state ? o.stateBranch : 'off (--no-state)'} | holder ${o.holder} | gsc ${o.gsc ? 'on' : 'off'} · notion ${o.notion} · slack ${o.slack ? 'on' : 'off'} · agents ${o.agents ? o.agentModel : 'off'} | log ${logFile}`);
    const r = await runWeekly(o, defaultDeps(o, { home: o.home, log, toLog, token }));
    if (r.line && process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${r.line}\n`);
    return r.code;
  } catch (e) {
    log(`seo-run aborted: ${firstLine(e)}`);
    return 1;
  } finally {
    rmSync(lock, { force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
