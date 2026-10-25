// node --test scripts/seo/ledger.test.mjs — the per-URL ledger (lib/ledger.mjs): audit and Search Console merges,
// owner requests, decisions, the summary, the CSV, the baseline it hands the next audit, and the weekly gate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toBaseline } from './lib/digest.mjs';
import { IX_IDS } from './audit.mjs';
import {
  applyAudit, applyDecisions, applyInspections, baselineFrom, emptyLedger, markRequested, summary, toCsv, weeklyStatus,
} from './lib/ledger.mjs';

const S = 'https://swishquest.com';
const H = `${S}/`;
const W = `${S}/wordle`;
const G = `${S}/grid`;
const A = `${S}/admin`;
const NOW = Date.parse('2026-10-26T06:30:00.000Z');

const failure = (id, url) => ({ id, url, evidence: `${id} on ${url}` });
const fullRun = () => ({
  runId: '20261026-0700-seo',
  site: S,
  only: null,
  urls: {
    [H]: { status: 200, failures: [] },
    [W]: { status: 200, failures: [failure('IX-04', W)] },
    [G]: { status: 200, failures: [] },
    [A]: { status: 200, failures: [] },
  },
  siteFailures: [failure('IX-01', H), failure('IX-11', G)],
  regressions: null,
  gaps: [],
  counts: { urls: 4, pass: 1, fail: 3 },
});
const inspection = (over = {}) => ({
  verdict: 'PASS', coverageState: 'Submitted and indexed', indexingState: 'INDEXING_ALLOWED', pageFetchState: 'SUCCESSFUL',
  robotsTxtState: 'ALLOWED', lastCrawlTime: '2026-10-20T10:00:00Z', googleCanonical: W, userCanonical: W, crawledAs: 'MOBILE',
  richResults: { verdict: 'PASS', items: 1, errors: 0 }, inspectedAt: '2026-10-26T06:10:00.000Z', link: 'https://search.google.com/x',
  ...over,
});

test('applyAudit records pass/fail ids per url and dataAsOf.audit', () => {
  const empty = emptyLedger();
  const l = applyAudit(empty, fullRun(), { expectNoindex: ['/admin'], now: NOW });
  assert.deepEqual(empty.urls, {}, 'pure: the input ledger is not changed');
  assert.equal(l.dataAsOf.audit, new Date(NOW).toISOString());
  assert.deepEqual(l.urls[W].audit, { runId: '20261026-0700-seo', pass: IX_IDS.filter((id) => id !== 'IX-04'), fail: ['IX-04'] });
  // site-wide failures land on the URL they name, exactly as toBaseline records them
  assert.deepEqual(l.urls[H].audit.fail, ['IX-01']);
  assert.deepEqual(l.urls[G].audit.fail, ['IX-11']);
  assert.deepEqual(baselineFrom(l), toBaseline(fullRun()));
  assert.equal(l.urls[A].expectNoindex, true);
  assert.equal(l.urls[A].inSitemap, false);
  assert.equal(l.urls[W].inSitemap, true);

  // a subset run touches only its `only` ids: IX-04 now passes on W, IX-01 on H stays failing
  const subset = { ...fullRun(), runId: '20261026-0800-seo', only: ['IX-04', 'IX-05'], urls: { [W]: { status: 200, failures: [failure('IX-05', W)] } }, siteFailures: [] };
  const s = applyAudit(l, subset, { expectNoindex: ['/admin'], now: NOW + 3_600_000 });
  assert.deepEqual(s.urls[W].audit.fail, ['IX-05']);
  assert.deepEqual(s.urls[W].audit.pass, IX_IDS.filter((id) => id !== 'IX-05'));
  assert.equal(s.urls[W].audit.runId, '20261026-0800-seo');
  assert.deepEqual(s.urls[H].audit, l.urls[H].audit);
  assert.equal(s.dataAsOf.audit, new Date(NOW + 3_600_000).toISOString());
  // a subset run on a page with no audit yet: pass = only minus its failures
  const fresh = applyAudit(emptyLedger(), subset, { now: NOW });
  assert.deepEqual(fresh.urls[W].audit, { runId: '20261026-0800-seo', pass: ['IX-04'], fail: ['IX-05'] });
});

test('applyInspections: an error inspection keeps the previous gsc block and sets gsc.error', () => {
  const l = applyInspections(emptyLedger(), { [W]: { ...inspection(), clicks: 12, impressions: 300 } });
  assert.equal(l.urls[W].gsc.verdict, 'PASS');
  assert.equal(l.urls[W].gsc.inspectedAt, '2026-10-26T06:10:00.000Z');
  assert.equal('clicks' in l.urls[W].gsc, false, 'no Search Analytics field enters the ledger');
  assert.equal('impressions' in l.urls[W].gsc, false);
  assert.equal(l.dataAsOf.gsc, '2026-10-26T06:10:00.000Z');

  const e = applyInspections(l, { [W]: { error: '429', inspectedAt: '2026-10-27T06:00:00.000Z' }, [G]: { error: 'budget' } });
  assert.equal(e.urls[W].gsc.verdict, 'PASS');
  assert.equal(e.urls[W].gsc.coverageState, 'Submitted and indexed');
  assert.equal(e.urls[W].gsc.inspectedAt, '2026-10-26T06:10:00.000Z');
  assert.equal(e.urls[W].gsc.error, '429');
  assert.equal(e.urls[W].gsc.errorAt, '2026-10-27T06:00:00.000Z');
  assert.equal(e.urls[G].gsc.error, 'budget');
  assert.equal(e.dataAsOf.gsc, '2026-10-26T06:10:00.000Z', 'an error is no fresh data');

  // the next good inspection clears the error and remembers the previous verdict
  const ok = applyInspections(e, { [W]: inspection({ verdict: 'NEUTRAL', inspectedAt: '2026-10-28T06:00:00.000Z' }) });
  assert.equal(ok.urls[W].gsc.error, undefined);
  assert.equal(ok.urls[W].gsc.previous.verdict, 'PASS');
});

test('markRequested appends and the same note twice in one day is appended once', () => {
  const day1 = Date.parse('2026-10-26T08:00:00.000Z');
  let l = markRequested(emptyLedger(), W, 'URL Inspection → Request indexing', { now: day1 });
  l = markRequested(l, W, 'URL Inspection → Request indexing', { now: day1 + 3_600_000 });
  assert.equal(l.urls[W].requests.length, 1);
  assert.deepEqual(l.urls[W].requests[0], { at: new Date(day1).toISOString(), by: 'owner', note: 'URL Inspection → Request indexing' });
  l = markRequested(l, W, 'Sitemaps → resubmit', { now: day1 + 7_200_000 });
  l = markRequested(l, W, 'URL Inspection → Request indexing', { now: day1 + 86_400_000 });
  assert.equal(l.urls[W].requests.length, 3);
});

test('summary names urls whose verdict changed and the data ages', () => {
  let l = applyAudit(emptyLedger(), fullRun(), { expectNoindex: ['/admin'], now: Date.parse('2026-10-24T06:30:00.000Z') });
  l = applyInspections(l, { [W]: inspection(), [G]: inspection({ googleCanonical: G, userCanonical: G }) });
  l = applyInspections(l, {
    [W]: inspection({ verdict: 'NEUTRAL', coverageState: 'Crawled - currently not indexed', inspectedAt: '2026-10-26T06:20:00.000Z' }),
    [G]: inspection({ googleCanonical: G, userCanonical: G, inspectedAt: '2026-10-26T06:20:00.000Z' }),
  });
  const md = summary(l, { now: NOW });
  assert.match(md, /audit: 2026-10-24T06:30:00\.000Z \(2 d ago\)/);
  assert.match(md, /gsc: 2026-10-26T06:20:00\.000Z \(0 h ago\)/);
  assert.match(md, /indexnow: never/);
  assert.match(md, /Crawled - currently not indexed: 1/);
  assert.match(md, /Submitted and indexed: 1/);
  const changed = md.split('## ').find((s) => s.startsWith('Changed'));
  assert.match(changed, /https:\/\/swishquest\.com\/wordle: PASS → NEUTRAL/);
  assert.doesNotMatch(changed, /\/grid/);
  const failing = md.split('## ').find((s) => s.startsWith('Failing IX checks'));
  assert.match(failing, /https:\/\/swishquest\.com\/wordle: IX-04/);
  assert.match(failing, /https:\/\/swishquest\.com\/: IX-01/);
});

test('toCsv has one row per url with the columns url,inSitemap,auditFail,verdict,coverageState,lastCrawlTime,googleCanonical,requestedAt,decision', () => {
  let l = applyAudit(emptyLedger(), fullRun(), { expectNoindex: ['/admin'], now: NOW });
  l = applyInspections(l, { [W]: inspection({ coverageState: 'Excluded, by "noindex"' }) });
  l = markRequested(l, W, 'URL Inspection → Request indexing', { now: NOW });
  l = applyDecisions(l, [{ id: 'SEO-r-001', check: 'IX-04', urls: [W], decision: 'card' }], '20261026-0700-seo');
  const lines = toCsv(l).trimEnd().split('\n');
  assert.equal(lines[0], 'url,inSitemap,auditFail,verdict,coverageState,lastCrawlTime,googleCanonical,requestedAt,decision');
  assert.equal(lines.length, 1 + Object.keys(l.urls).length);
  const w = lines.find((x) => x.startsWith(`${W},`));
  assert.equal(w, `${W},true,IX-04,PASS,"Excluded, by ""noindex""",2026-10-20T10:00:00Z,${W},${new Date(NOW).toISOString()},card`);
  assert.equal(l.urls[W].decision.runId, '20261026-0700-seo');
  assert.equal(l.urls[W].decision.ref, 'SEO-r-001');
});

test('weeklyStatus: done when history has an ok run since Monday 00:00 Paris, busy on a live lease, else free', () => {
  // 2026-10-25 is the October DST change: Monday 26 00:00 Paris is 2026-10-25T23:00Z (CET)
  const mon = Date.parse('2026-10-26T10:00:00.000Z');
  const run = (at, status = 'ok') => ({ ...emptyLedger(), history: [{ runId: 'r', at, status }] });
  assert.equal(weeklyStatus(run('2026-10-25T23:30:00.000Z'), null, { now: mon }), 'done');
  assert.equal(weeklyStatus(run('2026-10-25T22:30:00.000Z'), null, { now: mon }), 'free', 'Sunday 23:30 Paris is last week');
  assert.equal(weeklyStatus(run('2026-10-25T23:30:00.000Z', 'failed'), null, { now: mon }), 'free');
  assert.equal(weeklyStatus(emptyLedger(), { holder: 'cloud-1', until: '2026-10-26T11:00:00.000Z' }, { now: mon }), 'busy');
  assert.equal(weeklyStatus(emptyLedger(), { holder: 'cloud-1', until: '2026-10-26T09:00:00.000Z' }, { now: mon }), 'free');
  // summer (CEST): Monday 29 June 00:00 Paris is 2026-06-28T22:00Z; on the Sunday after, the same Monday counts
  const wed = Date.parse('2026-07-01T10:00:00.000Z');
  assert.equal(weeklyStatus(run('2026-06-28T22:30:00.000Z'), null, { now: wed }), 'done');
  assert.equal(weeklyStatus(run('2026-06-28T21:30:00.000Z'), null, { now: wed }), 'free');
  assert.equal(weeklyStatus(run('2026-06-29T08:00:00.000Z'), null, { now: Date.parse('2026-07-05T12:00:00.000Z') }), 'done');
});

test('baseline from a ledger: { url: fail[] } for every url with an audit block', () => {
  assert.deepEqual(baselineFrom(emptyLedger()), {});
  let l = applyAudit(emptyLedger(), fullRun(), { now: NOW });
  l = applyInspections(l, { [`${S}/connections`]: inspection() }); // gsc only: no audit block
  assert.deepEqual(baselineFrom(l), { [H]: ['IX-01'], [W]: ['IX-04'], [G]: ['IX-11'], [A]: [] });
});
