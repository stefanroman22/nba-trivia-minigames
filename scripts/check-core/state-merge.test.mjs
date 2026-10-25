// node --test scripts/check-core/state-merge.test.mjs — the store's 3-way merges (lib/state-merge.mjs).
import assert from 'node:assert/strict';
import test from 'node:test';
import { merge3List, merge3Map, merge3Value, mergeChannel, mergeLedger, mergeSeoLedger, publicLedger } from './lib/state-merge.mjs';

const k = (x) => x.id;

test('merge3List: local add, remote add, both kept', () => {
  const out = merge3List([{ id: 'a' }], [{ id: 'a' }, { id: 'l' }], [{ id: 'a' }, { id: 'r' }], k);
  assert.deepEqual(out.map(k), ['a', 'r', 'l']);
});

test('merge3List: local delete wins over an unchanged remote, loses to a remote change', () => {
  assert.deepEqual(merge3List([{ id: 'a', v: 1 }], [], [{ id: 'a', v: 1 }], k), []);
  assert.deepEqual(merge3List([{ id: 'a', v: 1 }], [], [{ id: 'a', v: 2 }], k), [{ id: 'a', v: 2 }]);
});

test('merge3List: remote delete wins over an unchanged local, loses to a local change', () => {
  assert.deepEqual(merge3List([{ id: 'a', v: 1 }], [{ id: 'a', v: 1 }], [], k), []);
  assert.deepEqual(merge3List([{ id: 'a', v: 1 }], [{ id: 'a', v: 3 }], [], k), [{ id: 'a', v: 3 }]);
});

test('merge3List: no local copy means no local change', () => {
  assert.deepEqual(merge3List(undefined, undefined, [{ id: 'r' }], k), [{ id: 'r' }]);
  assert.deepEqual(merge3List([{ id: 'a' }], undefined, [{ id: 'a' }, { id: 'r' }], k), [{ id: 'a' }, { id: 'r' }]);
});

test('merge3Map and merge3Value', () => {
  assert.deepEqual(merge3Map({ a: 1 }, { a: 1, b: 2 }, { a: 5 }), { a: 5, b: 2 });
  assert.deepEqual(merge3Value({ x: 1 }, { x: 1 }, { x: 2 }), { x: 2 });
  assert.deepEqual(merge3Value({ x: 1 }, { x: 3 }, { x: 2 }), { x: 3 });
  assert.deepEqual(merge3Value(undefined, undefined, { x: 2 }), { x: 2 });
});

const blk = (service, by, extra = {}) => ({ service, by, finding: 'F', card: 'C', runId: 'R', since: '2026-10-18T00:00:00.000Z', ...extra });

test('mergeChannel: a resolve on one side and a new block on the other both survive', () => {
  const base = { blocks: [blk('signup', 'LC-SIGNUP-03')], deferred: [], resolved: [] };
  const local = { blocks: [], deferred: [], resolved: [{ ...blk('signup', 'LC-SIGNUP-03'), resolvedAt: 't1', how: 'fix on main' }] };
  const remote = { blocks: [blk('signup', 'LC-SIGNUP-03'), blk('pages', 'LC-LIVE-01')], deferred: [], resolved: [] };
  const m = mergeChannel(base, local, remote);
  assert.deepEqual(m.blocks.map((b) => b.service), ['pages']);
  assert.equal(m.resolved.length, 1);
});

test('mergeChannel: deferrals of two writers union; a resolvedAt set locally is kept', () => {
  const d = (id, extra = {}) => ({ checker: 'ui', checkId: id, project: null, blockedBy: 'LC-X', service: 's', runId: 'r', since: 'S', ...extra });
  const base = { deferred: [d('A')] };
  const m = mergeChannel(base, { deferred: [d('A', { resolvedAt: 'T' }), d('B')] }, { deferred: [d('A'), d('C')] });
  assert.deepEqual(m.deferred.map((x) => `${x.checkId}${x.resolvedAt ? '*' : ''}`), ['A*', 'C', 'B']);
});

test('mergeLedger: the store never holds a title or url; the local copy keeps its own', () => {
  const e = { key: 'k1', card: 'c1', status: 'To Do', run: 'r1', title: 'secret title', url: 'https://www.notion.so/secret-title-c1' };
  const r = mergeLedger(undefined, { fp1: e }, {});
  assert.deepEqual(r.store, { fp1: { key: 'k1', card: 'c1', status: 'To Do', run: 'r1' } });
  assert.equal(r.local.fp1.title, 'secret title');
  assert.equal(JSON.stringify(publicLedger({ fp1: e })).includes('secret'), false);
});

test('mergeLedger: a remote status change reaches the local copy; an unchanged local entry with a title is no change', () => {
  const pub = { key: 'k1', card: 'c1', status: 'To Do', run: 'r1' };
  const r = mergeLedger({ fp1: pub }, { fp1: { ...pub, title: 'T' } }, { fp1: { ...pub, status: 'Done' } });
  assert.equal(r.store.fp1.status, 'Done');
  assert.equal(r.local.fp1.status, 'Done');
});

test('mergeSeoLedger: different urls from two writers both survive; same url → newer inspectedAt wins; history union by runId', () => {
  const u = (p) => `https://swishquest.com/${p}`;
  const entry = (inspectedAt, extra = {}) => ({ inSitemap: true, audit: { runId: '20261019-0600-seo', pass: [], fail: [] }, gsc: { verdict: 'PASS', inspectedAt }, requests: [], ...extra });
  const run = (runId, at) => ({ runId, at, status: 'ok' });
  const base = { dataAsOf: { audit: '2026-10-19T06:00:00.000Z', gsc: '2026-10-19T06:00:00.000Z', indexnow: null }, urls: { [u('wordle')]: entry('2026-10-19T06:00:00.000Z'), [u('grid')]: entry('2026-10-19T06:00:00.000Z') }, history: [run('r1', '2026-10-19T06:00:00.000Z')] };
  const local = { dataAsOf: { ...base.dataAsOf, gsc: '2026-10-26T06:10:00.000Z' }, history: [...base.history, run('r2', '2026-10-26T06:00:00.000Z')],
    urls: { ...base.urls, [u('local-only')]: entry(null), [u('wordle')]: entry('2026-10-26T06:10:00.000Z', { gsc: { verdict: 'NEUTRAL', inspectedAt: '2026-10-26T06:10:00.000Z' } }),
      [u('grid')]: entry('2026-10-19T06:00:00.000Z', { requests: [{ at: '2026-10-26T09:00:00.000Z', by: 'owner', note: 'n' }] }) } };
  const remote = { dataAsOf: { ...base.dataAsOf, audit: '2026-10-26T07:00:00.000Z' }, history: [...base.history, run('r3', '2026-10-26T07:00:00.000Z')],
    urls: { ...base.urls, [u('remote-only')]: entry(null), [u('wordle')]: entry('2026-10-26T06:05:00.000Z', { gsc: { verdict: 'FAIL', inspectedAt: '2026-10-26T06:05:00.000Z' } }),
      [u('grid')]: entry('2026-10-26T06:05:00.000Z', { gsc: { verdict: 'FAIL', inspectedAt: '2026-10-26T06:05:00.000Z' } }) } };
  const m = mergeSeoLedger(base, local, remote);
  assert.deepEqual(Object.keys(m.urls).sort(), [u('grid'), u('local-only'), u('remote-only'), u('wordle')]);
  assert.equal(m.urls[u('wordle')].gsc.verdict, 'NEUTRAL', 'local inspected later');
  assert.equal(mergeSeoLedger(base, remote, local).urls[u('wordle')].gsc.verdict, 'NEUTRAL', 'whichever side is newer');
  // one writer's request and the other's inspection of the same url: both kept
  assert.equal(m.urls[u('grid')].gsc.verdict, 'FAIL');
  assert.equal(m.urls[u('grid')].requests.length, 1);
  assert.deepEqual(m.history.map((h) => h.runId), ['r1', 'r2', 'r3']);
  assert.deepEqual(m.dataAsOf, { audit: '2026-10-26T07:00:00.000Z', gsc: '2026-10-26T06:10:00.000Z', indexnow: null });
  // no base: same url on both sides with an equal inspectedAt → the newer audit runId; history capped at 52
  const a = { urls: { [u('x')]: { audit: { runId: '20261026-0700-seo' }, gsc: { inspectedAt: 't' } } }, history: Array.from({ length: 60 }, (_, i) => run(`a${i}`, `2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z`)) };
  const b = { urls: { [u('x')]: { audit: { runId: '20261026-0800-seo' }, gsc: { inspectedAt: 't' } } }, history: [] };
  const n = mergeSeoLedger(undefined, a, b);
  assert.equal(n.urls[u('x')].audit.runId, '20261026-0800-seo');
  assert.equal(n.history.length, 52);
  assert.equal(n.history.at(-1).runId, 'a59');
  assert.equal(mergeSeoLedger(undefined, undefined, undefined), undefined);
});
