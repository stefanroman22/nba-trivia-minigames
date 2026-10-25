// node --test scripts/seo/run.test.mjs — the weekly orchestrator: parseArgs, runWeekly's step order with a fake for every
// dep (no network, no git, no claude), the Search Console owner action, the lease, the agent's failure and env, the
// owner-actions commit and the Slack line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportFiles } from './export.mjs';
import { emptyLedger } from './lib/ledger.mjs';
import { validateFindings } from './lib/findings.mjs';
import { seoLine } from './lib/slack.mjs';
import { SECRET_ENV, agentPrompt, commitOwnerActions, onpageStep, parseArgs, runWeekly, searchConsoleStep } from './run.mjs';

const SITE = 'https://swishquest.com';
const NOW = Date.parse('2026-10-26T05:00:00Z');
const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'seo-run-'));
const ENV = {
  PATH: '/usr/bin', CLAUDE_CODE_OAUTH_TOKEN: 'keep-me',
  GOOGLE_SEO_CLIENT_ID: 'cid', GOOGLE_SEO_CLIENT_SECRET: 'csecret', GOOGLE_SEO_REFRESH_TOKEN: 'rtoken',
  NOTION_TOKEN: 'ntoken', SLACK_BOT_TOKEN: 'stoken', CHECKS_STATE_TOKEN: 'ctoken',
};
const CONFIG = { site: SITE, property: 'sc-domain:swishquest.com', expectedNoindex: ['/admin'], slackChannel: 'frontend', inspectBudget: 200 };

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

/** An OnpageResult (onpage.json): OP-02 on the home page, OP-02 and OP-05 on /wordle → 2 failing checks. */
const onpageResult = (runId) => ({
  runId, site: SITE, gaps: [],
  urls: {
    [`${SITE}/`]: { status: 200, path: '/', kind: 'home', failures: [{ id: 'OP-02', url: `${SITE}/`, evidence: 'title 12 characters' }] },
    [`${SITE}/wordle`]: { status: 200, path: '/wordle', kind: 'game', failures: [
      { id: 'OP-02', url: `${SITE}/wordle`, evidence: 'no brand suffix' }, { id: 'OP-05', url: `${SITE}/wordle`, evidence: '10 unique words' }] },
  },
  counts: { urls: 2, pass: 0, fail: 2 },
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
    onpage: rec('onpage', ({ runId, runDir }) => {
      writeFileSync(path.join(runDir, 'onpage-summary.md'), `# seo-onpage: run ${runId} · site ${SITE} · 2 urls · 2 failing checks\n\n## FAIL OP-05 content\n- ${SITE}/wordle: 10 unique words\n`);
      return onpageResult(runId);
    }),
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

/** A fake git for commitOwnerActions: HEAD `head`, FETCH_HEAD bbb; the checkout resets `file` to HEAD's content. */
function fakeGit(file, { head = 'aaa', ffOk = true } = {}) {
  const calls = [];
  const seen = {};
  const ok = (stdout = '') => ({ status: 0, stdout, stderr: '' });
  const git = (args) => {
    calls.push(args.join(' '));
    if (args[0] === 'rev-parse') return ok(`${args[1] === 'HEAD' ? head : 'bbb'}\n`);
    if (args[0] === 'checkout') { writeFileSync(file, 'old\n'); return ok(); }
    if (args[0] === 'merge') {
      seen.fileAtMerge = readFileSync(file, 'utf8');
      if (!ffOk) return { status: 128, stdout: '', stderr: 'fatal: Not possible to fast-forward, aborting.' };
      head = 'bbb';
      return ok();
    }
    if (args[0] === 'merge-base') return { status: head === 'bbb' ? 0 : 1, stdout: '', stderr: '' };
    return ok();
  };
  return { git, calls, seen };
}

test('commitOwnerActions: dev moved during the run → fast-forward with the file kept, then commit and a plain push to dev', () => {
  const file = path.join(tmp(), 'owner-actions.md');
  writeFileSync(file, 'new\n');
  const { git, calls, seen } = fakeGit(file);
  const r = commitOwnerActions({ runId: 'r1', toLog: () => {}, git, file });
  assert.deepEqual(r, { status: 'pushed' });
  assert.deepEqual(calls, [
    'fetch --quiet origin dev', 'rev-parse HEAD', 'rev-parse FETCH_HEAD', 'checkout --quiet HEAD -- docs/seo/owner-actions.md',
    'merge --ff-only --quiet FETCH_HEAD', 'merge-base --is-ancestor HEAD FETCH_HEAD', 'add -- docs/seo/owner-actions.md',
    'commit --quiet -m seo: owner actions r1 -- docs/seo/owner-actions.md', 'push --porcelain origin HEAD:dev',
  ]);
  assert.equal(seen.fileAtMerge, 'old\n', 'the tree is clean for the fast-forward');
  assert.equal(readFileSync(file, 'utf8'), 'new\n', 'the run\'s content survives it');
  assert.ok(!calls.some((c) => /force|stash/.test(c)));

  // HEAD already at origin/dev: no merge, straight to the commit.
  const same = fakeGit(file, { head: 'bbb' });
  assert.deepEqual(commitOwnerActions({ runId: 'r1', toLog: () => {}, git: same.git, file }), { status: 'pushed' });
  assert.ok(!same.calls.some((c) => c.startsWith('merge ') || c.startsWith('checkout')));
});

test('commitOwnerActions: the fast-forward fails → skipped and logged, nothing committed, the file kept', async () => {
  const file = path.join(tmp(), 'owner-actions.md');
  writeFileSync(file, 'new\n');
  const { git, calls } = fakeGit(file, { ffOk: false });
  const logged = [];
  const r = commitOwnerActions({ runId: 'r1', toLog: (m) => logged.push(m), git, file });
  assert.deepEqual(r, { status: 'skipped', why: 'the fast-forward to origin/dev failed, not committed' });
  assert.deepEqual(logged, ['fatal: Not possible to fast-forward, aborting.']);
  assert.ok(!calls.some((c) => /^(add|commit|push)\b/.test(c)), calls.join('\n'));
  assert.equal(readFileSync(file, 'utf8'), 'new\n');

  // Through the run: one log line, the run goes on.
  const f = fakes({ ownerActionsChanged: () => true, commitOwnerActions: ({ runId }) => commitOwnerActions({ runId, toLog: () => {}, git: fakeGit(file, { ffOk: false }).git, file }) });
  const run = await runWeekly(opts(), f.deps);
  assert.equal(run.code, 0);
  assert.ok(f.lines.includes('owner actions: the fast-forward to origin/dev failed, not committed, file left in the run artifact'), f.lines.join('\n'));

  // HEAD ahead of origin/dev (another branch): the ff is a no-op, HEAD is no ancestor of FETCH_HEAD → skipped.
  const ahead = fakeGit(file, { head: 'ccc' });
  const aheadGit = (args) => (args[0] === 'merge' ? { status: 0, stdout: 'Already up to date.', stderr: '' } : ahead.git(args));
  assert.deepEqual(commitOwnerActions({ runId: 'r1', toLog: () => {}, git: aheadGit, file }),
    { status: 'skipped', why: 'the tooling checkout is not at origin/dev, not committed' });
});

test('a --site of another host than the configured site: the store is not pushed, the run goes on', async () => {
  const { deps, calls, lines } = fakes({ audit: async ({ runId }) => { calls.push('audit'); return { ...auditResult(runId), site: 'http://localhost:5173' }; } });
  const r = await runWeekly(opts(['--site', 'http://localhost:5173']), deps);
  assert.equal(r.code, 0);
  assert.ok(!calls.includes('push'), calls.join(' '));
  assert.ok(calls.includes('slack') && calls.includes('release'));
  assert.ok(lines.includes('ledger: not recorded (site localhost:5173 is not the configured swishquest.com)'), lines.join('\n'));
});

test('an audit infra failure: exit 1, the store still gets a failed history entry, the lease is released', async () => {
  const { deps, calls, seen } = fakes({ audit: async () => { calls.push('audit'); throw new Error('every page request failed (ECONNREFUSED)'); } });
  const r = await runWeekly(opts(), deps);
  assert.equal(r.code, 1);
  assert.deepEqual(calls, ['lease', 'pull', 'audit', 'push', 'slack', 'release']);
  assert.equal(seen.push.history.at(-1).status, 'failed');
  assert.match(r.line, /failed: audit: every page request failed/);
});

test('the Slack post throws: exit 1 and the lease is still released', async () => {
  const { deps, calls } = fakes({ postLine: async () => { calls.push('slack'); throw new Error('slack.mjs crashed'); } });
  const r = await runWeekly(opts(), deps);
  assert.equal(r.code, 1);
  assert.deepEqual(calls.slice(-2), ['slack', 'release']);
  assert.deepEqual(r.state.failures, ['slack: slack.mjs crashed']);
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
  assert.equal(seoLine({ ...s, onpageFails: 4 }),
    'seo: run 20261026-0600-seo · 17 urls · indexed 14 · not indexed 1 · audit fails 0 · onpage fails 4 · cards 1 new/2 seen · owner actions 1 · drive ok · 7 min');
  assert.equal(seoLine({ ...s, onpageFails: 0 }), seoLine(s).replace(' · cards', ' · onpage fails 0 · cards'));
  assert.equal(seoLine({ ...s, onpageFails: null }), seoLine(s), 'no on-page step, no on-page part');
});

// ---- Phase 2 (on-page): opt-in through --areas

const OLD_PROMPT = (runDir, site) => `Load the seo skill, then the seo-indexing skill. Run dir: ${runDir}. Site: ${site}. Write ${runDir}/findings.json and docs/seo/owner-actions.md per the skill. Return ≤ 10 lines.`;

test('parseArgs --areas: default indexing; indexing,onpage in any order, deduped; onpage alone or an unknown area is an error', () => {
  assert.deepEqual(parseArgs([]).areas, ['indexing']);
  assert.deepEqual(parseArgs(['--areas', 'indexing']).areas, ['indexing']);
  for (const v of ['indexing,onpage', 'onpage,indexing', 'onpage, indexing,onpage', 'indexing,indexing,onpage']) {
    assert.deepEqual(parseArgs(['--areas', v]).areas, ['indexing', 'onpage'], v);
  }
  assert.throws(() => parseArgs(['--areas', 'onpage']), /--areas onpage needs indexing/);
  for (const bad of [['--areas', 'queries'], ['--areas', 'indexing,perf'], ['--areas', ','], ['--areas']]) {
    assert.throws(() => parseArgs(bad), Error, bad.join(' '));
  }
});

test('run.mjs --areas onpage exits 2 with a clear message before any step', () => {
  const runMjs = fileURLToPath(new URL('./run.mjs', import.meta.url));
  const home = tmp();
  const r = spawnSync(process.execPath, [runMjs, '--areas', 'onpage', '--home', home], { encoding: 'utf8', env: { ...process.env, CHECKS_STATE_TOKEN: '' } });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stdout, /^seo-run: --areas onpage needs indexing/m);
  assert.ok(!existsSync(path.join(home, 'seo')), 'nothing written');
});

test('agentPrompt: the default is byte-for-byte the phase 1 prompt; with onpage the three-skill prompt', () => {
  const runDir = path.join('C:', 'h', 'seo', 'runs', '20261026-0600-seo');
  assert.equal(agentPrompt(runDir, SITE), OLD_PROMPT(runDir, SITE));
  assert.equal(agentPrompt(runDir, SITE, { onpage: false }), OLD_PROMPT(runDir, SITE));
  assert.equal(agentPrompt(runDir, SITE, { onpage: true }),
    `Load the seo skill, then the seo-indexing skill, then the seo-onpage skill. Run dir: ${runDir}. Site: ${SITE}. Write ${runDir}/findings.json and docs/seo/owner-actions.md per the skills. Return ≤ 10 lines.`);
});

test('the default run (no --areas) is phase 1 exactly: no on-page step, no page × query pull, the old prompt and line', async () => {
  const { deps, calls, seen } = fakes();
  const o = opts();
  const r = await runWeekly(o, deps);
  const runDir = path.join(o.home, 'seo', 'runs', r.state.runId);
  assert.ok(!calls.includes('onpage'));
  assert.deepEqual(Object.keys(seen.gsc).sort(), ['creds', 'runDir', 'urls']);
  assert.equal(seen.agent.prompt, OLD_PROMPT(runDir, SITE));
  assert.ok(!/onpage/.test(r.line));
  assert.ok(!existsSync(path.join(runDir, 'onpage-summary.md')));
});

test('--areas indexing,onpage: audit, gsc with the page × query pull, then the on-page step; the new prompt; onpage fails on the line', async () => {
  const { deps, calls, seen, lines } = fakes({
    gsc: async (a) => {
      calls.push('gsc'); seen.gsc = a;
      if (a.pageQuery) writeFileSync(path.join(a.runDir, 'gsc-analytics-pq.json'), '[]\n');
      return { inspections: Object.fromEntries(a.urls.map((u) => [u, { verdict: 'PASS', coverageState: 'Submitted and indexed', inspectedAt: '2026-10-26T05:00:00.000Z' }])) };
    },
  });
  const o = opts(['--areas', 'indexing,onpage']);
  const r = await runWeekly(o, deps);
  const runDir = path.join(o.home, 'seo', 'runs', r.state.runId);
  assert.equal(r.code, 0, r.state.failures.join('\n'));
  assert.deepEqual(calls, ['lease', 'pull', 'audit', 'gsc', 'onpage', 'agent', 'notion', 'indexnow', 'export', 'push', 'slack', 'release']);
  assert.equal(seen.gsc.pageQuery, true);
  assert.deepEqual(seen.onpage, { site: SITE, runId: r.state.runId, runDir, analyticsFile: path.join(runDir, 'gsc-analytics-pq.json') });
  assert.equal(seen.agent.prompt, agentPrompt(runDir, SITE, { onpage: true }));
  assert.ok(lines.includes('onpage: 2 urls · 2 failing checks'), lines.join('\n'));
  assert.match(r.line, / · audit fails 1 · onpage fails 2 · cards /);
  assert.equal(r.state.onpageFails, 2);
});

test('--areas indexing,onpage with --gsc off and no agent: the on-page step runs without analytics; REPORT.md placeholder carries its summary', async () => {
  const { deps, calls, seen } = fakes();
  const o = opts(['--areas', 'indexing,onpage', '--gsc', 'off', '--agents', 'off']);
  const r = await runWeekly(o, deps);
  const runDir = path.join(o.home, 'seo', 'runs', r.state.runId);
  assert.deepEqual(calls.slice(0, 4), ['lease', 'pull', 'audit', 'onpage']);
  assert.equal(seen.onpage.analyticsFile, null);
  const report = readFileSync(path.join(runDir, 'REPORT.md'), 'utf8');
  assert.match(report, /## On-page \(onpage-summary\.md\)\n\n## seo-onpage: run /);
  assert.ok(!report.includes('queries-summary'), 'the private file never reaches REPORT.md');
});

test('the on-page step throws: failed: onpage on the line, no onpage fails part, the run goes on', async () => {
  const { deps, calls } = fakes({ onpage: async () => { calls.push('onpage'); throw new Error('every page request failed (ECONNREFUSED)'); } });
  const r = await runWeekly(opts(['--areas', 'indexing,onpage']), deps);
  assert.equal(r.code, 1);
  assert.ok(calls.includes('agent') && calls.includes('push') && calls.includes('release'));
  assert.ok(!/onpage fails/.test(r.line));
  assert.match(r.line, /failed: onpage: every page request failed/);
});

test('searchConsoleStep with pageQuery: gsc-analytics-pq.json (page × query); the summary has neither values nor query strings', async () => {
  const runDir = tmp();
  const asked = [];
  const client = {
    sitemaps: async () => [],
    inspect: async () => ({ verdict: 'PASS', coverageState: 'Submitted and indexed', inspectedAt: '2026-10-26T05:00:00.000Z' }),
    analytics: async (a) => {
      asked.push(a);
      return a.dimensions ? [{ keys: [`${SITE}/wordle`, 'secret nba query'], clicks: 31337, impressions: 4242, ctr: 0.0731, position: 9.25 }]
        : [{ keys: [`${SITE}/`], clicks: 98765, impressions: 43210, ctr: 0.0123, position: 7.5 }];
    },
  };
  const r = await searchConsoleStep({ creds: null, urls: [`${SITE}/`], runDir, config: CONFIG, client, now: () => NOW, pageQuery: true });
  assert.equal(r.error, null);
  assert.deepEqual(asked, [{ days: 28 }, { days: 28, dimensions: ['page', 'query'] }]);
  assert.equal(read(path.join(runDir, 'gsc-analytics-pq.json'))[0].keys[1], 'secret nba query');
  assert.equal(read(path.join(runDir, 'gsc-analytics.json'))[0].clicks, 98765);
  const md = readFileSync(path.join(runDir, 'gsc-summary.md'), 'utf8');
  assert.match(md, /page × query: 28 days in gsc-analytics-pq\.json \(private: never uploaded\)/);
  for (const v of ['31337', '4242', '0.0731', '9.25', 'secret nba query']) assert.ok(!md.includes(v), `${v} in the summary`);
  // The Drive export never picks the page × query file up.
  writeFileSync(path.join(runDir, 'REPORT.md'), '# r\n');
  const names = exportFiles({ runDir, ledger: emptyLedger(), date: '2026-10-26' }).map((f) => f.name);
  assert.deepEqual(names, ['ledger-2026-10-26.csv', 'gsc-analytics-2026-10-26.csv', 'REPORT-2026-10-26.md']);
  assert.ok(!exportFiles({ runDir, ledger: emptyLedger(), date: '2026-10-26' }).some((f) => f.body.includes('secret nba query')));

  // Without pageQuery: one analytics call, as phase 1, and no page × query file or line.
  const plain = tmp();
  asked.length = 0;
  await searchConsoleStep({ creds: null, urls: [`${SITE}/`], runDir: plain, config: CONFIG, client, now: () => NOW });
  assert.deepEqual(asked, [{ days: 28 }]);
  assert.ok(!existsSync(path.join(plain, 'gsc-analytics-pq.json')));
  assert.ok(!readFileSync(path.join(plain, 'gsc-summary.md'), 'utf8').includes('page × query'));

  // A failed page × query pull is the step's error (and a summary line), never a crash.
  const failing = { ...client, analytics: async (a) => { if (a.dimensions) throw new Error('analytics: 403'); return []; } };
  const bad = await searchConsoleStep({ creds: null, urls: [`${SITE}/`], runDir: tmp(), config: CONFIG, client: failing, now: () => NOW, pageQuery: true });
  assert.equal(bad.error, 'page × query analytics: analytics: 403');
});

test('onpageStep runs onpage.mjs in the run dir: onpage.json back, queries-summary.md only with analytics, PSI only with a key, no query in the log', async () => {
  const page = (title) => `<!doctype html><html><head><title>${title}</title></head><body><main><h1>${title}</h1></main></body></html>`;
  const bodies = {
    '/sitemap.xml': `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${SITE}/</loc></url><url><loc>${SITE}/wordle</loc></url><url><loc>${SITE}/contexto</loc></url></urlset>`,
    '/': page('Swish Quest'), '/wordle': page('Wordle'), '/contexto': page('Contexto'),
  };
  const fetcher = { get: async (u) => { const b = bodies[new URL(u).pathname]; return b ? { status: 200, headers: {}, body: b, location: null } : { status: 404, headers: {}, body: '', location: null }; } };
  const runId = '20261026-0600-seo';
  const run = async ({ analytics = false, env = {}, fetch } = {}) => {
    const runDir = path.join(tmp(), runId);
    let analyticsFile = null;
    if (analytics) {
      analyticsFile = path.join(runDir, 'gsc-analytics-pq.json');
      mkdirSync(runDir, { recursive: true });
      writeFileSync(analyticsFile, JSON.stringify([{ keys: [`${SITE}/wordle`, 'secret nba query'], clicks: 31337, impressions: 4242, ctr: 0.0731, position: 9.25 }]));
    }
    const logged = [];
    const result = await onpageStep({ site: SITE, runId, runDir, analyticsFile, env, fetcher, fetch, log: (m) => logged.push(m), toLog: (m) => logged.push(m) });
    return { runDir, result, logged };
  };
  const plain = await run();
  assert.equal(plain.result.runId, runId);
  assert.ok(plain.result.counts.urls >= 3);
  assert.ok(existsSync(path.join(plain.runDir, 'onpage.json')) && existsSync(path.join(plain.runDir, 'onpage-summary.md')));
  assert.ok(!existsSync(path.join(plain.runDir, 'queries-summary.md')));
  assert.match(readFileSync(path.join(plain.runDir, 'onpage-summary.md'), 'utf8'), /run with --psi and env PSI_API_KEY/);

  const withData = await run({ analytics: true });
  assert.ok(existsSync(path.join(withData.runDir, 'queries-summary.md')));
  for (const v of ['secret nba query', '31337', '4242']) assert.ok(!withData.logged.join('\n').includes(v), `${v} logged`);

  let psiCalls = 0;
  const keyed = await run({ env: { PSI_API_KEY: 'K-123' }, fetch: async () => { psiCalls += 1; return new Response('{}', { status: 429 }); } });
  assert.equal(psiCalls, 1);
  assert.ok(!keyed.logged.join('\n').includes('K-123'));

  await assert.rejects(onpageStep({ site: SITE, runId, runDir: path.join(tmp(), runId), analyticsFile: null, env: {}, fetcher: { get: async () => ({ status: 500, headers: {}, body: '' }) }, log: () => {}, toLog: () => {} }),
    /sitemap\.xml answered 500/);
});

test('the agent never gets PSI_API_KEY', () => {
  assert.ok(SECRET_ENV.includes('PSI_API_KEY'));
});
