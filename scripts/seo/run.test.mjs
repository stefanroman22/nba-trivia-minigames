// node --test scripts/seo/run.test.mjs — the weekly orchestrator: parseArgs, runWeekly's step order with a fake for every
// dep (no network, no git, no claude), the Search Console owner action, the lease, the agent's failure and env, the
// owner-actions commit and the Slack line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { emptyLedger } from './lib/ledger.mjs';
import { validateFindings } from './lib/findings.mjs';
import { seoLine } from './lib/slack.mjs';
import { SECRET_ENV, agentPrompt, parseArgs, runWeekly, searchConsoleStep } from './run.mjs';

const SITE = 'https://swishquest.com';
const NOW = Date.parse('2026-10-26T05:00:00Z');
const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'seo-run-'));
const ENV = {
  PATH: '/usr/bin', CLAUDE_CODE_OAUTH_TOKEN: 'keep-me',
  GOOGLE_SEO_CLIENT_ID: 'cid', GOOGLE_SEO_CLIENT_SECRET: 'csecret', GOOGLE_SEO_REFRESH_TOKEN: 'rtoken',
  NOTION_TOKEN: 'ntoken', SLACK_BOT_TOKEN: 'stoken', CHECKS_STATE_TOKEN: 'ctoken',
};
const CONFIG = { site: SITE, property: 'sc-domain:swishquest.com', expectedNoindex: ['/admin'], slackChannel: 'agent-frontend', inspectBudget: 200 };

/** An AuditResult: the home page and /wordle clean, /trivia failing IX-03, /admin the expected-noindex page. */
const auditResult = (runId) => ({
  runId, site: SITE, only: null, gaps: [], siteFailures: [], regressions: null,
  urls: {
    [`${SITE}/`]: { status: 200, failures: [] },
    [`${SITE}/wordle`]: { status: 200, failures: [] },
    [`${SITE}/trivia`]: { status: 200, failures: [{ id: 'IX-03', url: `${SITE}/trivia`, evidence: 'no title' }] },
    [`${SITE}/admin`]: { status: 200, failures: [] },
  },
  counts: { urls: 4, pass: 3, fail: 1 },
});

/** Every dep faked; `calls` records the step order. `over` replaces deps (ledgerStore fields merge). */
function fakes(over = {}) {
  const calls = [];
  const lines = [];
  const seen = {};
  const rec = (name, fn = () => undefined) => async (arg, ...rest) => { calls.push(name); seen[name] = arg; return fn(arg, ...rest); };
  const ownerFile = path.join(tmp(), 'owner-actions.md');
  const deps = {
    now: () => NOW,
    log: (m) => lines.push(m),
    env: { ...ENV },
    config: CONFIG,
    credentials: () => ({ clientId: 'a', clientSecret: 'b', refreshToken: 'c' }),
    ownerActionsFile: ownerFile,
    ownerActionsChanged: () => false,
    commitOwnerActions: rec('commitOwnerActions', () => ({ status: 'pushed' })),
    audit: rec('audit', ({ runId }) => auditResult(runId)),
    gsc: rec('gsc', ({ urls }) => ({
      inspections: Object.fromEntries(urls.map((u) => [u, u.endsWith('/trivia')
        ? { verdict: 'NEUTRAL', coverageState: 'Crawled - currently not indexed', inspectedAt: '2026-10-26T05:00:00.000Z' }
        : { verdict: 'PASS', coverageState: 'Submitted and indexed', inspectedAt: '2026-10-26T05:00:00.000Z' }])),
    })),
    runAgent: rec('agent', ({ runDir }) => {
      const id = path.basename(runDir);
      writeFileSync(path.join(runDir, 'findings.json'), JSON.stringify({ runId: id, findings: [{
        id: `SEO-${id}-001`, check: 'IX-03', severity: 'major', urls: [`${SITE}/trivia`], current: 'no title', expected: 'a title',
        files: ['src/app/trivia/page.tsx'], howToFix: 'add metadata', acceptance: { audit: 'IX-03 passes', qa: [] },
        fingerprint: `IX-03|${SITE}/trivia`, decision: 'card' }] }));
      writeFileSync(path.join(runDir, 'REPORT.md'), '# Report\n\n## Summary\n\nok\n');
      return { status: 'done', code: 0 };
    }),
    notionPush: rec('notion', () => ({ results: [{ action: 'card', id: 'x', cardId: 'c1' }, { action: 'skip', id: 'y', cardId: 'c2', why: 'open' }] })),
    indexnow: rec('indexnow', () => ({ code: 0, record: { at: '2026-10-26T05:01:00.000Z', status: 202, count: 1, urls: [`${SITE}/trivia`], dryRun: false } })),
    exportDrive: rec('export', () => ({ code: 0, drive: 'ok' })),
    postLine: rec('slack', () => ({ ok: true })),
    ...over,
    ledgerStore: {
      acquire: rec('lease', () => 'free'),
      pull: rec('pull', () => emptyLedger()),
      push: rec('push', () => ({ pushed: true })),
      release: rec('release'),
      ...over.ledgerStore,
    },
  };
  return { deps, calls, lines, seen };
}

const opts = (argv = []) => ({ ...parseArgs(argv), home: tmp() });
const read = (f) => JSON.parse(readFileSync(f, 'utf8'));

test('parseArgs: defaults, --gsc off and the bad values', () => {
  const o = parseArgs([]);
  assert.equal(o.dryRun, false);
  assert.equal(o.site, null);
  assert.equal(o.gsc, true);
  assert.equal(o.notion, 'live');
  assert.equal(o.slack, true);
  assert.equal(o.agents, true);
  assert.equal(o.agentModel, 'fable');
  assert.equal(o.agentTimeoutSec, 1800);
  assert.equal(o.state, true);
  assert.equal(o.home, null);
  assert.equal(o.stateBranch, process.env.CHECKS_STATE_BRANCH || 'checks-state');
  assert.ok(o.holder);
  assert.equal(parseArgs(['--gsc', 'off']).gsc, false);
  const all = parseArgs(['--dry-run', '--site', 'http://localhost:5173/', '--notion', 'dry', '--slack', 'off', '--agents', 'off',
    '--agent-model', 'sonnet', '--agent-timeout-sec', '600', '--holder', 'me', '--state-branch', 'seo-test', '--no-state', '--home', 'h']);
  assert.equal(all.dryRun, true);
  assert.equal(all.site, 'http://localhost:5173');
  assert.equal(all.notion, 'dry');
  assert.equal(all.slack, false);
  assert.equal(all.agents, false);
  assert.equal(all.agentModel, 'sonnet');
  assert.equal(all.agentTimeoutSec, 600);
  assert.equal(all.holder, 'me');
  assert.equal(all.stateBranch, 'seo-test');
  assert.equal(all.state, false);
  assert.equal(all.home, path.resolve('h'));
  for (const bad of [['--gsc', 'maybe'], ['--notion', 'live2'], ['--agent-timeout-sec', '5'], ['--state-branch', 'dev'], ['--site', 'ftp://x'],
    ['--agent-model', 'fable && calc'], ['--wat'], ['--holder']]) {
    assert.throws(() => parseArgs(bad), Error, bad.join(' '));
  }
});

test('runWeekly runs the steps in order, merges the ledger and appends the history', async () => {
  const { deps, calls, seen } = fakes();
  const o = opts();
  const r = await runWeekly(o, deps);
  assert.equal(r.code, 0);
  assert.deepEqual(calls, ['lease', 'pull', 'audit', 'gsc', 'agent', 'notion', 'indexnow', 'export', 'push', 'slack', 'release']);
  const runDir = path.join(o.home, 'seo', 'runs', r.state.runId);
  assert.ok(existsSync(path.join(runDir, 'ledger-previous.json')));
  assert.match(readFileSync(path.join(runDir, 'ledger-summary.md'), 'utf8'), /# Ledger summary/);
  assert.equal(seen.audit.baseline, null, 'an empty ledger is no baseline');
  assert.deepEqual(seen.gsc.urls.sort(), [`${SITE}/`, `${SITE}/admin`, `${SITE}/trivia`, `${SITE}/wordle`]);
  const ledger = seen.push;
  assert.equal(ledger.urls[`${SITE}/trivia`].gsc.verdict, 'NEUTRAL');
  assert.deepEqual(ledger.urls[`${SITE}/trivia`].audit.fail, ['IX-03']);
  assert.equal(ledger.urls[`${SITE}/trivia`].decision.kind, 'card');
  assert.deepEqual(ledger.urls[`${SITE}/trivia`].indexnow, { lastPingAt: '2026-10-26T05:01:00.000Z', status: 202 });
  assert.equal(ledger.dataAsOf.indexnow, '2026-10-26T05:01:00.000Z');
  assert.equal(ledger.history.length, 1);
  assert.deepEqual(ledger.history[0], { runId: r.state.runId, at: new Date(NOW).toISOString(), status: 'ok', indexed: 2, notIndexed: 1, failedChecks: 1, cards: 1 });
  assert.equal(r.line, `seo: run ${r.state.runId} · 4 urls · indexed 2 · not indexed 1 · audit fails 1 · cards 1 new/1 seen · owner actions 0 · drive ok · 0 s`);
  assert.deepEqual(seen.slack, r.line);
});

test('runWeekly hands the previous ledger to the audit as its baseline and caps the history at 52', async () => {
  const prev = emptyLedger();
  prev.urls[`${SITE}/wordle`] = { audit: { runId: 'old', pass: [], fail: ['IX-05'] } };
  prev.history = Array.from({ length: 52 }, (_, i) => ({ runId: `r${i}`, at: '2026-01-01T00:00:00.000Z', status: 'ok' }));
  const { deps, seen } = fakes({ ledgerStore: { pull: async () => structuredClone(prev) } });
  const r = await runWeekly(opts(), deps);
  assert.deepEqual(seen.audit.baseline, { [`${SITE}/wordle`]: ['IX-05'] });
  assert.equal(seen.push.history.length, 52);
  assert.equal(seen.push.history.at(-1).runId, r.state.runId);
  assert.equal(seen.push.history[0].runId, 'r1');
});

test('--gsc off without credentials: no gsc step, the Search Console owner action lands in findings.json', async () => {
  const { deps, calls } = fakes({ credentials: () => null });
  const o = opts(['--gsc', 'off', '--agents', 'off']);
  const r = await runWeekly(o, deps);
  assert.equal(r.code, 0);
  assert.ok(!calls.includes('gsc'));
  assert.ok(!calls.includes('agent'));
  const runDir = path.join(o.home, 'seo', 'runs', r.state.runId);
  const doc = read(path.join(runDir, 'findings.json'));
  assert.deepEqual(validateFindings(doc), []);
  assert.equal(doc.findings.length, 1);
  const f = doc.findings[0];
  assert.equal(f.check, 'GSC');
  assert.equal(f.decision, 'owner');
  assert.deepEqual(f.owner, { action: 'Set up Search Console access', clickPath: 'docs/seo/README.md → Owner setup' });
  assert.deepEqual(f.urls, [`${SITE}/`]);
  assert.ok(calls.includes('notion'), 'findings.json exists, so the push runs');
  assert.match(r.line, /owner actions 1/);
  assert.match(r.line, / · judgement needed$/);
});

test('no credentials with the agent on: the owner action is appended to the agent\'s findings with the next id', async () => {
  const { deps } = fakes({ credentials: () => null });
  const o = opts();
  const r = await runWeekly(o, deps);
  const doc = read(path.join(o.home, 'seo', 'runs', r.state.runId, 'findings.json'));
  assert.deepEqual(validateFindings(doc), []);
  assert.deepEqual(doc.findings.map((f) => f.id), [`SEO-${r.state.runId}-001`, `SEO-${r.state.runId}-002`]);
  assert.equal(doc.findings[1].check, 'GSC');
});

test('--gsc off with credentials: no gsc step and no owner action', async () => {
  const { deps, calls } = fakes();
  const o = opts(['--gsc', 'off', '--agents', 'off']);
  const r = await runWeekly(o, deps);
  assert.ok(!calls.includes('gsc'));
  assert.ok(!existsSync(path.join(o.home, 'seo', 'runs', r.state.runId, 'findings.json')));
  assert.ok(!calls.includes('notion'), 'no findings.json, no push');
});

test('the lease is busy: exit 0 and no step runs', async () => {
  const { deps, calls } = fakes({ ledgerStore: { acquire: async () => { calls.push('lease'); return 'busy'; } } });
  const r = await runWeekly(opts(), deps);
  assert.equal(r.code, 0);
  assert.equal(r.skipped, true);
  assert.deepEqual(calls, ['lease']);
  assert.equal(r.line, null);
});

test('the agent throws: the run goes on, REPORT.md is the placeholder and the line says judgement needed', async () => {
  const { deps, calls } = fakes({ runAgent: async () => { calls.push('agent'); throw new Error('claude crashed'); } });
  const o = opts();
  const r = await runWeekly(o, deps);
  assert.equal(r.code, 0);
  assert.deepEqual(calls, ['lease', 'pull', 'audit', 'gsc', 'agent', 'indexnow', 'export', 'push', 'slack', 'release']);
  assert.match(r.line, / · judgement needed$/);
  const report = readFileSync(path.join(o.home, 'seo', 'runs', r.state.runId, 'REPORT.md'), 'utf8');
  assert.match(report, /## Summary\n+judgement needed/);
});

test('the agent gets the binding prompt, the model, the watchdog and an env without any secret', async () => {
  const { deps, seen } = fakes();
  const o = opts(['--agent-model', 'opus', '--agent-timeout-sec', '900']);
  const r = await runWeekly(o, deps);
  const runDir = path.join(o.home, 'seo', 'runs', r.state.runId);
  const a = seen.agent;
  assert.equal(a.prompt, `Load the seo skill, then the seo-indexing skill. Run dir: ${runDir}. Site: ${SITE}. Write ${runDir}/findings.json and docs/seo/owner-actions.md per the skill. Return ≤ 10 lines.`);
  assert.equal(a.prompt, agentPrompt(runDir, SITE));
  assert.equal(a.model, 'opus');
  assert.equal(a.timeoutSec, 900);
  for (const k of ['GOOGLE_SEO_CLIENT_ID', 'GOOGLE_SEO_CLIENT_SECRET', 'GOOGLE_SEO_REFRESH_TOKEN', 'NOTION_TOKEN', 'SLACK_BOT_TOKEN', 'CHECKS_STATE_TOKEN']) {
    assert.ok(SECRET_ENV.includes(k), k);
    assert.ok(!(k in a.env), `${k} reached the agent`);
  }
  assert.equal(a.env.CLAUDE_CODE_OAUTH_TOKEN, 'keep-me');
  assert.equal(a.env.PATH, '/usr/bin');
});

test('commitOwnerActions: only when the file changed and not on --dry-run; a rejection does not fail the run', async () => {
  let f = fakes({ ownerActionsChanged: () => true });
  writeFileSync(f.deps.ownerActionsFile, '- [ ] something\n');
  let r = await runWeekly(opts(), f.deps);
  assert.ok(f.calls.includes('commitOwnerActions'));
  assert.deepEqual(f.seen.commitOwnerActions, { runId: r.state.runId });
  assert.equal(f.calls.indexOf('commitOwnerActions'), f.calls.indexOf('agent') + 1);

  f = fakes({ ownerActionsChanged: () => false });
  await runWeekly(opts(), f.deps);
  assert.ok(!f.calls.includes('commitOwnerActions'));

  f = fakes({ ownerActionsChanged: () => true });
  r = await runWeekly(opts(['--dry-run']), f.deps);
  assert.ok(!f.calls.includes('commitOwnerActions'));
  assert.ok(!f.calls.includes('push'), 'a dry run pushes nothing');
  assert.ok(!f.calls.includes('slack'), 'a dry run posts nothing');
  assert.equal(f.lines.at(-1), `dry: ${r.line}`);

  for (const reject of [async () => { f.calls.push('commitOwnerActions'); return { status: 'rejected' }; },
    async () => { f.calls.push('commitOwnerActions'); throw new Error('push rejected'); }]) {
    f = fakes({ ownerActionsChanged: () => true, commitOwnerActions: reject });
    writeFileSync(f.deps.ownerActionsFile, '- [ ] something\n');
    const o = opts();
    r = await runWeekly(o, f.deps);
    assert.equal(r.code, 0);
    assert.ok(f.lines.includes('owner actions: push rejected, file left in the run artifact'), f.lines.join('\n'));
    assert.ok(existsSync(path.join(o.home, 'seo', 'runs', r.state.runId, 'owner-actions.md')));
    assert.ok(f.calls.includes('push'));
  }
});

test('an audit infra failure: exit 1, the store still gets a failed history entry, the lease is released', async () => {
  const { deps, calls, seen } = fakes({ audit: async () => { calls.push('audit'); throw new Error('every page request failed (ECONNREFUSED)'); } });
  const r = await runWeekly(opts(), deps);
  assert.equal(r.code, 1);
  assert.deepEqual(calls, ['lease', 'pull', 'audit', 'push', 'slack', 'release']);
  assert.equal(seen.push.history.at(-1).status, 'failed');
  assert.match(r.line, /failed: audit: every page request failed/);
});

test('searchConsoleStep writes gsc.json, gsc-analytics.json and a short summary without any Search Analytics value', async () => {
  const runDir = tmp();
  const client = {
    sitemaps: async () => [{ path: `${SITE}/sitemap.xml`, errors: 0, warnings: 1, isPending: false }],
    inspect: async (u) => (u.endsWith('/x') ? { error: 'budget' } : { verdict: 'PASS', coverageState: 'Submitted and indexed', inspectedAt: '2026-10-26T05:00:00.000Z' }),
    analytics: async () => [{ keys: [`${SITE}/`], clicks: 98765, impressions: 43210, ctr: 0.0123, position: 7.5 }],
  };
  const r = await searchConsoleStep({ creds: null, urls: [`${SITE}/`, `${SITE}/x`], runDir, config: CONFIG, client, now: () => NOW });
  assert.equal(r.error, null);
  assert.deepEqual(Object.keys(read(path.join(runDir, 'gsc.json'))), [`${SITE}/`, `${SITE}/x`]);
  assert.equal(read(path.join(runDir, 'gsc-analytics.json'))[0].clicks, 98765);
  const md = readFileSync(path.join(runDir, 'gsc-summary.md'), 'utf8');
  assert.ok(md.trimEnd().split('\n').length <= 10);
  assert.match(md, /verdict: PASS 1/);
  assert.match(md, /errors: budget 1/);
  for (const v of ['98765', '43210', '0.0123', '7.5']) assert.ok(!md.includes(v), `${v} in the summary`);
});

test('seoLine: the one Slack line', () => {
  const s = { runId: '20261026-0600-seo', urls: 17, indexed: 14, notIndexed: 1, auditFails: 0, cards: { new: 1, seen: 2 }, ownerActions: 1,
    drive: 'ok', durationMs: 7 * 60_000 + 10_000, judgementNeeded: false, failures: [] };
  assert.equal(seoLine(s), 'seo: run 20261026-0600-seo · 17 urls · indexed 14 · not indexed 1 · audit fails 0 · cards 1 new/2 seen · owner actions 1 · drive ok · 7 min');
  assert.equal(seoLine({ ...s, drive: 'skipped', durationMs: 42_000, judgementNeeded: true }),
    'seo: run 20261026-0600-seo · 17 urls · indexed 14 · not indexed 1 · audit fails 0 · cards 1 new/2 seen · owner actions 1 · drive skipped · 42 s · judgement needed');
});
