// node --test scripts/check-core/notion-push.test.mjs — clusters parity with the ui-fix skill's former inline script,
// the card body snapshot, and notion-push's dedupe decisions against an injected fake Notion client.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planClusters, planLines, selectOpen, perfIdsFrom, isRunId } from './lib/clusters.mjs';
import { cardMeta, renderBody, fpKey, BODY_FULL } from './lib/card-body.mjs';
import { pushRun, seenText, sourceHasRun } from './notion-push.mjs';

const FIX = fileURLToPath(new URL('./fixtures/', import.meta.url));
const doc = JSON.parse(readFileSync(path.join(FIX, 'findings-20261014-1153x.json'), 'utf8'));
const RUN = '20261014-1153x';
const perfIds = perfIdsFrom(readFileSync(path.join(FIX, 'checks-perf.md'), 'utf8')); // pinned, not the live CHECKS.md
const lines = (f) => readFileSync(path.join(FIX, f), 'utf8').replace(/\r/g, '').trimEnd().split('\n');

for (const [label, severities, file, counts] of [
  ['default severities', ['blocker', 'major', 'minor'], 'ui-fix-plan-20261014-1153x.txt', '28 open finding(s) · 10 cluster(s)'],
  ['all severities', null, 'ui-fix-plan-20261014-1153x-all.txt', '29 open finding(s) · 11 cluster(s)'],
]) {
  test(`planClusters matches the ui-fix skill's script output (${label})`, () => {
    const open = selectOpen(doc.findings, { severities });
    const out = planLines({ run: RUN, runDir: 'RUNDIR', open, clusters: planClusters(open, { perfIds }), perfIds });
    assert.equal(out[0], `runDir RUNDIR · runId ${RUN} · ${counts}`);
    assert.deepEqual(out.slice(1), lines(file));
  });
}

const blockerCluster = () => planClusters(selectOpen(doc.findings, { severities: ['blocker'] }), { perfIds })[0];
const slash = (s) => s.replace(/\\/g, '/');

test('card meta: title, category, priority, difficulty, Source with fingerprint keys', () => {
  const m = cardMeta(blockerCluster(), { checker: 'ui', runId: RUN, target: 'main' });
  assert.equal(m.title, '[ui-check] Masked stranger "Player" still shows a permanent player ID (VS intro) (+1)');
  assert.deepEqual([m.category, m.priority, m.difficulty, m.target], ['backend', 'P0', 'hard', 'main']);
  const fps = ['teen-masking|/series-winner|.om-matchup .om-pc-tag', 'teen-masking|/series-winner|.om-stage--results .om-pc-tag'];
  assert.equal(m.source, `ui-check fp:${fps.map(fpKey).join(',')} ids:UIC-20261014-1153-001,UIC-20261014-1153-002 run:${RUN}`);
  assert.match(fpKey(fps[0]), /^[0-9a-f]{12}$/);
});

test('card body snapshot (blocker cluster, one contact sheet per finding)', () => {
  const runDir = path.join('/runs', RUN);
  const { markdown, images } = renderBody(blockerCluster(), { checker: 'ui', runId: RUN, runDir, meta: { mode: 'prod', head: 'c58db0322dcefd99' }, target: 'main', exists: (p) => slash(p).includes('/sheets/') });
  assert.equal(slash(markdown).replace(/\r/g, ''), readFileSync(path.join(FIX, 'card-body-blocker.md'), 'utf8').replace(/\r/g, ''));
  assert.equal(images.length, 2);
  assert.ok(markdown.split('\n').every((l) => l.length <= 1900));
});

// ---- dedupe with a fake client

function fakeClient({ cards = [], shipped = () => true } = {}) {
  const calls = { create: [], comment: [], find: [] };
  const comments = {};
  return {
    calls,
    findCards: (keys) => { calls.find.push(keys); return cards.filter((c) => keys.some((k) => c.source.includes(k))); },
    listComments: (id) => (comments[id] || []).map((text) => ({ text })),
    comment: (id, text) => { calls.comment.push([id, text]); (comments[id] ||= []).push(text); },
    createCard: (m, bodyFile, attach) => {
      calls.create.push({ m, body: readFileSync(bodyFile, 'utf8'), attach: JSON.parse(readFileSync(attach[0], 'utf8')) });
      const id = `new-${calls.create.length}`;
      cards.push({ id, title: m.title, source: m.source, status: 'To Do', commit: '', url: `https://notion.test/${id}` });
      return id;
    },
    isShipped: shipped,
  };
}
const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'notion-push-'));
const push = (client, extra = {}) => {
  const dir = tmp();
  const out = [];
  const results = pushRun({ doc, runId: RUN, severities: ['blocker'], client, runDir: '/runs/x', exists: () => false, log: (l) => out.push(l), ledgerFile: path.join(dir, 'notion-cards.json'), workDir: dir, perfIds, ...extra });
  return { results, out, dir };
};

test('no hit → one card with Source, Target and the cluster findings attached; ledger mirrors it', () => {
  const client = fakeClient();
  const { results, out, dir } = push(client);
  assert.equal(client.calls.create.length, 1);
  const { m, attach } = client.calls.create[0];
  assert.ok(m.source.startsWith('ui-check fp:'));
  assert.equal(m.target, 'main');
  assert.deepEqual(attach.findings.map((f) => f.id), ['UIC-20261014-1153-001', 'UIC-20261014-1153-002']);
  assert.equal(results[0].action, 'create');
  assert.ok(out.some((l) => l.startsWith('card new-1 [ui-check] Masked stranger')));
  const ledger = JSON.parse(readFileSync(path.join(dir, 'notion-cards.json'), 'utf8'));
  assert.equal(ledger['teen-masking|/series-winner|.om-matchup .om-pc-tag'].card, 'new-1');
});

const K1 = fpKey('teen-masking|/series-winner|.om-matchup .om-pc-tag');

test('open hit → no card; no comment from the run that created it; one "seen again" per later run', () => {
  const client = fakeClient();
  push(client);
  push(client);
  assert.equal(client.calls.create.length, 1);
  assert.deepEqual(client.calls.comment, [], 'the card Source already says run:<this run>');
  const later = '20261016-0200';
  const { out } = push(client, { runId: later });
  push(client, { runId: later });
  assert.deepEqual(client.calls.comment, [['new-1', seenText(later)]]);
  assert.ok(out.some((l) => l.startsWith('skip ') && l.endsWith('already open card new-1')));
});

test('open hit in QA (shipped, awaiting main-sync) → skipped without a "seen again" comment', () => {
  const client = fakeClient({ cards: [{ id: 'qa-1', title: 't', source: `ui-check fp:${K1} ids:X run:r0`, status: 'QA', commit: 'abc1234' }] });
  push(client);
  assert.equal(client.calls.create.length, 0);
  assert.deepEqual(client.calls.comment, []);
});

test('run ids are matched anchored: run 20261014-1153 does not count as run 20261014-1153x', () => {
  assert.equal(sourceHasRun(`ui-check fp:${K1} ids:X run:20261014-1153`, '20261014-1153x'), false);
  assert.equal(sourceHasRun(`ui-check fp:${K1} ids:X run:20261014-1153x`, '20261014-1153'), false);
  assert.equal(sourceHasRun(`ui-check fp:${K1} ids:X run:20261014-1153x`, '20261014-1153x'), true);
  const client = fakeClient({ cards: [{ id: 'c1', title: 't', source: `ui-check fp:${K1} ids:X run:20261014-1153`, status: 'To Do', commit: '' }] });
  client.listComments = () => [{ text: seenText('20261014-1153') }];
  push(client);
  assert.deepEqual(client.calls.comment.map((c) => c[1].split(' · ')[0]), [seenText(RUN)]);
});

test('all hits Done and shipped → one Regression card linking the old one', () => {
  const client = fakeClient({ cards: [{ id: 'old-1', title: 'old', source: `ui-check fp:${K1} ids:X run:r0`, status: 'Done', commit: 'abc1234', url: 'https://notion.test/old-1' }] });
  const { results, out } = push(client);
  assert.equal(client.calls.create.length, 1);
  assert.ok(client.calls.create[0].m.title.startsWith('[ui-check] Regression: Masked stranger'));
  assert.ok(client.calls.create[0].body.includes('https://notion.test/old-1'));
  assert.equal(results[0].action, 'regression');
  assert.ok(out.includes('regression old-1 → new-1'));
  assert.equal(client.calls.comment.length, 0);
});

test('Done hit with an empty Commit (closed by hand) → skip, never a Regression card', () => {
  const client = fakeClient({ cards: [{ id: 'old-1', title: 'old', source: `ui-check fp:${K1} run:r0`, status: 'Done', commit: '' }] });
  const { results, out } = push(client);
  assert.equal(results[0].action, 'skip');
  assert.equal(client.calls.create.length + client.calls.comment.length, 0);
  assert.ok(out.some((l) => l.includes('done without commit (closed by hand) card old-1')));
});

test('Done hit whose fix is not on origin/main yet → skip, no comment, no card', () => {
  const client = fakeClient({ cards: [{ id: 'old-1', title: 'old', source: `ui-check fp:${K1}`, status: 'Done', commit: 'abc1234' }] });
  client.isShipped = () => false;
  const { results } = push(client);
  assert.equal(results[0].action, 'skip');
  assert.equal(client.calls.create.length + client.calls.comment.length, 0);
});

test('a merged fingerprint is a lookup key and part of Source', () => {
  const merged = 'teen-masking|/series-winner|.om-old-tag';
  const f = { ...doc.findings[0], mergedFingerprints: [merged] };
  const cluster = { engine: 'backend-engine', prod: false, items: [f], keys: [] };
  const m = cardMeta(cluster, { runId: RUN });
  assert.deepEqual(m.keys, [K1, fpKey(merged)]);
  assert.ok(m.source.includes(fpKey(merged)));
  const client = fakeClient({ cards: [{ id: 'c9', title: 't', source: `ui-check fp:${fpKey(merged)} run:r0`, status: 'To Do', commit: '' }] });
  const { results } = push(client, { doc: { findings: [f] } });
  assert.equal(results[0].action, 'skip');
  assert.ok(client.calls.find[0].includes(fpKey(merged)));
});

test('one failing cluster logs an error and the others still push; the ledger is written per card', () => {
  const client = fakeClient();
  let n = 0;
  const create = client.createCard;
  client.createCard = (...a) => { if (++n === 1) throw new Error('Notion 400: body.children.length should be ≤ 100'); return create(...a); };
  const { results, out, dir } = push(client, { severities: ['blocker', 'major'] });
  assert.equal(results[0].action, 'error');
  assert.ok(out.some((l) => l.startsWith('error ') && l.includes('Notion 400')));
  assert.ok(results.slice(1).every((r) => r.action === 'create'));
  const ledger = JSON.parse(readFileSync(path.join(dir, 'notion-cards.json'), 'utf8'));
  const pushed = new Set(results.slice(1).flatMap((r) => r.ids));
  assert.deepEqual(new Set(Object.values(ledger).map((e) => e.id)), pushed);
  assert.ok(Object.values(ledger).every((e) => e.decision === 'create' && e.card.startsWith('new-')));
});

test('a big cluster body shows the top findings in full and lists the rest by id', () => {
  const big = planClusters(selectOpen(doc.findings, { severities: ['blocker', 'major', 'minor'] }), { perfIds }).find((c) => c.items.length > BODY_FULL);
  const { markdown } = renderBody(big, { runId: RUN, runDir: '/r', exists: () => false });
  assert.equal(markdown.split('\n').filter((l) => l.startsWith('### ')).length, BODY_FULL);
  assert.ok(markdown.includes(`Also in this cluster (${big.items.length - BODY_FULL} more;`));
});

test('the relay-parked line appears only when a finding touches multiplayer_server/', () => {
  const relay = renderBody(blockerCluster(), { runId: RUN, runDir: '/r' }).markdown;
  assert.match(relay, /Relay \(multiplayer_server\/\) deploys are parked/);
  const fe = planClusters(selectOpen(doc.findings, { ids: ['UIC-20261014-1153-003'] }), { perfIds })[0];
  assert.doesNotMatch(renderBody(fe, { runId: RUN, runDir: '/r' }).markdown, /Relay/);
});

test('--dry-run writes nothing: no card, no comment, no ledger', () => {
  const client = fakeClient();
  const { out, dir } = push(client, { dryRun: true });
  assert.equal(client.calls.create.length, 0);
  assert.ok(out.some((l) => l.startsWith('card DRY ')));
  assert.equal(existsSync(path.join(dir, 'notion-cards.json')), false);
  const open = fakeClient({ cards: [{ id: 'c1', title: 't', source: `ui-check fp:${K1} run:r0`, status: 'To Do', commit: '' }] });
  push(open, { dryRun: true });
  assert.equal(open.calls.comment.length, 0);
});

test('run ids: plain, copied (x) and live (-live) runs are recognised; other names are not', () => {
  for (const r of ['20261014-1153', '20261014-1153x', '20261015-2210-live']) assert.ok(isRunId(r), r);
  for (const r of ['adhoc', '20261014-1153-x', '20261014-1153live', '2026101-1153', '20261014-1153-live2']) assert.equal(isRunId(r), false, r);
});
