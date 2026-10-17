// node --test scripts/check-core/state-merge.test.mjs — the store's 3-way merges (lib/state-merge.mjs).
import assert from 'node:assert/strict';
import test from 'node:test';
import { merge3List, merge3Map, merge3Value, mergeChannel, mergeLedger, publicLedger } from './lib/state-merge.mjs';

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
