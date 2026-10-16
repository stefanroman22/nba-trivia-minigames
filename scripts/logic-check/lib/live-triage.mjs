#!/usr/bin/env node
// Scripted triage of the live suite on GitHub Actions (.github/workflows/logic-live.yml) — no agent.
//   node scripts/logic-check/lib/live-triage.mjs state --exit <code> --file <state.json> --run <id> [--url <run url>]
//       Records this run's outcome in the consecutive-failure state (restored/saved by actions/cache) and prints
//       `outcome=… consecutive=<n> action=none|slack|cards ids=<failing ids>` (also to $GITHUB_OUTPUT, plus `line=` — the
//       one Slack line). exit 0 → pass (counter reset); exit 1 → fail (counter +1: first failure `slack`, second and
//       later `cards`); any other exit → infra (counter kept, `slack`: the probe could not run).
//   node scripts/logic-check/lib/live-triage.mjs triage --run <id>
//       Each failing LC-LIVE check of the run → one Logic finding (owner ci, suite live, acceptance { lc: <id> }) in
//       <runDir>/findings/logic.json → `report.mjs --run <id>` (schema, merge, ids; the non-validate path: --validate
//       needs a local stack, which CI has not) → findings whose lc checks FAILED in this run's results.json get
//       validatedAt/validatedHash/validatedMode 'prod' (the run itself reproduced them — the same verdict report.mjs's
//       reuse path reads from results.json) so `notion-push.mjs --run <id> --checker logic --target main` takes them.
//       Cards are deduped by notion-push on the fingerprint `lc-live|/|<id>` (Source), so later failures comment.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from '../../check-core/lib/home.mjs';
import { acceptanceHash, readFindingsDoc, runPath, writeJson } from '../../check-core/lib/findings.mjs';

const isFail = (r) => r.status === 'failed' || r.status === 'timedOut';
const one = (s, n = 200) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

/** Where a fixer starts per live check (the probe is always listed too). */
export const FILES = {
  'LC-LIVE-01': [['src/app/layout.tsx', 'the app shell every route renders'], ['next.config.ts', 'build/deploy config']],
  'LC-LIVE-02': [['backend/backend/health.py', '/api/health/']],
  'LC-LIVE-03': [['src/utils/gameData.ts', 'the client of the v3 data host'], ['backend/trivia/data_pipeline/publish_v3.py', 'publishes the v3 data']],
  'LC-LIVE-04': [['backend/users/leaderboard.py', 'the board rows, rank and total'], ['backend/users/views.py', 'get_users']],
  'LC-LIVE-05': [['src/components/LogInSignUp.tsx', 'GoogleOAuthProvider clientId']],
  'LC-LIVE-06': [['multiplayer_server/src/index.js', 'the relay (deployed on Railway — owner parks relay deploys)']],
  'LC-LIVE-07': [['next.config.ts', 'rendering/caching of the routes']],
};
const SEVERITY = { 'LC-LIVE-01': 'blocker', 'LC-LIVE-02': 'blocker' };

/** One failing live result → a Logic finding (judge-file form, before report.mjs assigns ids). */
export function findingOf(r) {
  const vs = r.violations || [];
  const lines = vs.length ? vs.slice(0, 5).map((v) => `${v.rule} ${v.selector} on ${v.route}: ${v.measured}`) : [one(String(r.error || r.status).split('\n')[0])];
  const more = vs.length > 5 ? ` (+${vs.length - 5} more)` : '';
  const expected = [...new Set(vs.map((v) => v.expected))].slice(0, 5);
  return {
    checker: 'logic',
    rule: 'lc-live',
    title: one(`${r.checkId} fails on the live site: ${lines[0]}`, 140),
    severity: SEVERITY[r.checkId] || 'major',
    category: 'live',
    owner: 'ci',
    suite: 'live',
    persona: 'guest',
    where: { route: '/', viewports: ['api'], selector: r.checkId, env: ['live'] },
    current: one(`${lines.join(' | ')}${more}`, 1000),
    expected: one(expected.length ? expected.join(' | ') : `${r.checkId} passes (scripts/logic-check/CHECKS.md)`, 600),
    evidence: { checkId: r.checkId, metrics: (r.metrics || []).slice(0, 8).map((m) => `${m.label} ${m.value}${m.unit || ''}`), shots: [] },
    files: [
      ...(FILES[r.checkId] || []).map(([p, why]) => ({ path: p, why })),
      { path: 'scripts/logic-check/specs/live/live.spec.mjs', why: `the probe (${r.checkId}); the cause is the live deploy, its config or its data` },
    ],
    fix: { change: [`Find why the live site fails ${r.checkId} (deploy, config or published data), fix it on main, and confirm with \`node scripts/logic-check/run.mjs --suite live --only ${r.checkId}\` after the deploy.`] },
    acceptance: { criteria: [`${r.checkId} passes on the live site`], checks: [{ lc: r.checkId, projects: ['live'] }] },
  };
}

/** Every failing LC-LIVE result of a run (one per check id) → findings. */
export function triageFindings(results) {
  const seen = new Set();
  return results.filter((r) => r.project === 'live' && /^LC-LIVE-/.test(r.checkId || '') && isFail(r) && !seen.has(r.checkId) && seen.add(r.checkId)).map(findingOf);
}

/** findings.json doc → the same doc with every finding whose lc checks all FAILED in `results` stamped as validated. */
export function stampValidation(doc, results, { now = new Date().toISOString() } = {}) {
  const failed = new Set(results.filter(isFail).map((r) => r.checkId));
  let stamped = 0;
  const findings = (doc.findings || []).map((f) => {
    const lcs = ((f.acceptance && f.acceptance.checks) || []).map((c) => c.lc).filter(Boolean);
    if (f.validatedAt || !lcs.length || !lcs.every((id) => failed.has(id))) return f;
    stamped++;
    return { ...f, validatedAt: now, validatedHash: acceptanceHash(f), validatedMode: 'prod' };
  });
  return { doc: { ...doc, findings }, stamped };
}

/** The consecutive-failure state after this run. prev: { consecutiveFailures } | null; exitCode of run.mjs. */
export function nextState(prev, exitCode) {
  const before = (prev && Number(prev.consecutiveFailures)) || 0;
  if (exitCode === 0) return { lastOutcome: 'pass', consecutiveFailures: 0, action: 'none' };
  if (exitCode === 1) { const n = before + 1; return { lastOutcome: 'fail', consecutiveFailures: n, action: n >= 2 ? 'cards' : 'slack' }; }
  return { lastOutcome: 'infra', consecutiveFailures: before, action: 'slack' };
}

/** The one Slack line of a run that did not pass. */
export function slackLine(state, ids, { url = null, site = 'https://swishquest.com' } = {}) {
  const tail = url ? ` — ${url}` : '';
  if (state.lastOutcome === 'infra') return `Logic live check could not run against ${site} (harness/infra error)${tail}`;
  const n = state.consecutiveFailures;
  return `Logic live check failing on ${site}: ${ids.join(', ') || '(no check id)'} — ${n === 1 ? 'first failure (no card yet)' : `${n} runs in a row, cards pushed`}${tail}`;
}

function readJson(file, fallback = null) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; }
}

function cli(argv) {
  const [cmd, ...rest] = argv;
  const o = {};
  for (let i = 0; i < rest.length; i += 2) o[rest[i].replace(/^--/, '')] = rest[i + 1];
  const dir = o.run ? runPath(o.run) : null;
  const results = dir ? readJson(path.join(dir, 'results.json'), []) : [];
  if (cmd === 'state') {
    if (o.exit === undefined || !o.file) { console.error('usage: live-triage.mjs state --exit <code> --file <state.json> --run <id> [--url <url>]'); return 2; }
    const prev = readJson(o.file);
    const state = { ...nextState(prev, Number(o.exit)), runId: o.run || null, at: new Date().toISOString() };
    mkdirSync(path.dirname(path.resolve(o.file)), { recursive: true });
    writeFileSync(o.file, JSON.stringify(state, null, 2));
    const ids = [...new Set(results.filter(isFail).map((r) => r.checkId).filter(Boolean))];
    const meta = readJson(dir ? path.join(dir, 'run-meta.json') : '', {}) || {};
    const line = slackLine(state, ids, { url: o.url || null, site: meta.liveUrl || 'https://swishquest.com' });
    const out = { outcome: state.lastOutcome, consecutive: state.consecutiveFailures, action: state.action, ids: ids.join(','), line };
    console.log(Object.entries(out).map(([k, v]) => `${k}=${v}`).join('\n'));
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(out).map(([k, v]) => `${k}=${String(v).replace(/\n/g, ' ')}\n`).join(''));
    return 0;
  }
  if (cmd === 'triage') {
    if (!dir || !existsSync(dir)) { console.error(`live-triage: no run directory for --run ${o.run}`); return 2; }
    const findings = triageFindings(results);
    mkdirSync(path.join(dir, 'findings'), { recursive: true });
    writeFileSync(path.join(dir, 'findings', 'logic.json'), JSON.stringify(findings, null, 2));
    console.log(`live-triage: ${findings.length} finding(s) → ${path.join(dir, 'findings', 'logic.json')}`);
    if (!findings.length) return 0;
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'ui-check', 'report.mjs'), '--run', o.run], { cwd: ROOT, stdio: 'inherit' });
    if (r.status !== 0) { console.error(`live-triage: report.mjs exited ${r.status}`); return 1; }
    const doc = readFindingsDoc(o.run);
    if (!doc) { console.error('live-triage: report.mjs wrote no findings.json'); return 1; }
    const { doc: next, stamped } = stampValidation(doc, results);
    writeJson(path.join(dir, 'findings.json'), next);
    console.log(`live-triage: ${stamped} finding(s) validated by this run's failing lc checks`);
    return 0;
  }
  console.error('usage: live-triage.mjs state --exit <code> --file <state.json> --run <id> [--url <url>] | triage --run <id>');
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = cli(process.argv.slice(2));
