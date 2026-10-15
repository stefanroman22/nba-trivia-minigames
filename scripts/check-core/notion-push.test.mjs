// node --test scripts/check-core/notion-push.test.mjs — clusters parity with the ui-fix skill's former inline script,
// the card body snapshot, and notion-push's dedupe decisions against an injected fake Notion client.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planClusters, planLines, selectOpen, perfIdsFrom, CHECKS_MD } from './lib/clusters.mjs';
import { cardMeta, renderBody, fpKey } from './lib/card-body.mjs';
import { pushRun, seenText } from './notion-push.mjs';

const FIX = fileURLToPath(new URL('./fixtures/', import.meta.url));
const doc = JSON.parse(readFileSync(path.join(FIX, 'findings-20261014-1153x.json'), 'utf8'));
const RUN = '20261014-1153x';
const perfIds = perfIdsFrom(readFileSync(CHECKS_MD, 'utf8'));
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
  const results = pushRun({ doc, runId: RUN, severities: ['blocker'], client, runDir: '/runs/x', exists: () => false, log: (l) => out.push(l), ledgerFile: path.join(dir, 'notion-cards.json'), workDir: dir, ...extra });
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

test('open hit → no card, one "seen again" comment per card per run, even on a second push', () => {
  const client = fakeClient();
  push(client);
  push(client);
  push(client);
  assert.equal(client.calls.create.length, 1);
  assert.deepEqual(client.calls.comment, [['new-1', seenText(RUN)]]);
  const { out } = push(client, { runId: '20261016-0200' });
  assert.equal(client.calls.comment.length, 2);
  assert.ok(out.some((l) => l.startsWith('skip ') && l.endsWith('already open card new-1')));
});

test('all hits Done and shipped → one Regression card linking the old one', () => {
  const k = fpKey('teen-masking|/series-winner|.om-matchup .om-pc-tag');
  const client = fakeClient({ cards: [{ id: 'old-1', title: 'old', source: `ui-check fp:${k} ids:X run:r0`, status: 'Done', commit: 'abc1234', url: 'https://notion.test/old-1' }] });
  const { results, out } = push(client);
  assert.equal(client.calls.create.length, 1);
  assert.ok(client.calls.create[0].m.title.startsWith('[ui-check] Regression: Masked stranger'));
  assert.ok(client.calls.create[0].body.includes('https://notion.test/old-1'));
  assert.equal(results[0].action, 'regression');
  assert.ok(out.includes('regression old-1 → new-1'));
  assert.equal(client.calls.comment.length, 0);
});

test('Done hit whose fix is not on origin/main yet → skip, no comment, no card', () => {
  const k = fpKey('teen-masking|/series-winner|.om-matchup .om-pc-tag');
  const client = fakeClient({ cards: [{ id: 'old-1', title: 'old', source: `ui-check fp:${k}`, status: 'Done', commit: 'abc1234' }] }, );
  client.isShipped = () => false;
  const { results } = push(client);
  assert.equal(results[0].action, 'skip');
  assert.equal(client.calls.create.length + client.calls.comment.length, 0);
});

test('--dry-run writes nothing: no card, no comment, no ledger', () => {
  const client = fakeClient();
  const { out, dir } = push(client, { dryRun: true });
  assert.equal(client.calls.create.length, 0);
  assert.ok(out.some((l) => l.startsWith('card DRY ')));
  assert.equal(existsSync(path.join(dir, 'notion-cards.json')), false);
  const open = fakeClient({ cards: [{ id: 'c1', title: 't', source: `ui-check fp:${fpKey('teen-masking|/series-winner|.om-matchup .om-pc-tag')}`, status: 'To Do', commit: '' }] });
  push(open, { dryRun: true });
  assert.equal(open.calls.comment.length, 0);
});
