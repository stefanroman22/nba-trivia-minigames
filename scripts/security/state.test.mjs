// node --test scripts/security/state.test.mjs — new / still open / resolved by fingerprint (lib/state.mjs).
import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyState, markTicketed, parseState, reconcile, recordPr, seal, slotDone, unseal, addRun } from './lib/state.mjs';

const KEY = 'test-key';
const f = (fp, extra = {}) => ({ fingerprint: fp, tool: 'claude', rule: 'idor', category: 'idor', severity: 'high', confidence: 9, file: 'backend/x.py', snippet: 'Room.objects.get(pk=pk)', title: 't', ...extra });

test('seal/unseal: round trip; a wrong or missing key reads nothing', () => {
  const s = seal({ file: 'backend/x.py' }, KEY);
  assert.match(s, /^v1:/);
  assert.ok(!s.includes('backend'));
  assert.deepEqual(unseal(s, KEY), { file: 'backend/x.py' });
  assert.equal(unseal(s, 'other'), null);
  assert.equal(seal({ a: 1 }, null), null);
});

test('reconcile: first sight is new, a ticketed one is still open, a vanished one is resolved', () => {
  const r1 = reconcile(emptyState(), [f('a'), f('b')], { secret: KEY });
  assert.deepEqual(r1.fresh.map((x) => x.fingerprint), ['a', 'b']);
  const s1 = markTicketed(r1.state, ['a', 'b'], 'card-1');
  const r2 = reconcile(s1, [f('a')], { secret: KEY });
  assert.deepEqual(r2.fresh, []);
  assert.deepEqual(r2.still, ['a']);
  assert.deepEqual(r2.resolved, ['b']);
  assert.equal(r2.state.entries.b.status, 'resolved');
  // it comes back: new again (reopened), ticketed again
  const r3 = reconcile(r2.state, [f('b')], { secret: KEY });
  assert.deepEqual(r3.fresh.map((x) => x.fingerprint), ['b']);
  assert.equal(r3.state.entries.b.reopened, true);
});

test('reconcile: never re-tickets an open ticketed finding; re-tickets when that ticket is Done', () => {
  const s = markTicketed(reconcile(emptyState(), [f('a')], { secret: KEY }).state, ['a'], 'card-1');
  assert.equal(reconcile(s, [f('a')], { secret: KEY }).fresh.length, 0);
  assert.equal(reconcile(s, [f('a')], { secret: KEY, doneTickets: new Set(['card-1']) }).fresh.length, 1);
});

test('reconcile: an unreported finding whose code is still there stays open, but only for 3 runs, and is never re-ticketed from there', () => {
  let s = markTicketed(reconcile(emptyState(), [f('a')], { secret: KEY }).state, ['a'], 'card-1');
  const present = (e, d) => d.snippet === 'Room.objects.get(pk=pk)';
  const r1 = reconcile(s, [], { secret: KEY, stillPresent: present, doneTickets: new Set(['card-1']) });
  assert.deepEqual([r1.still, r1.fresh], [['a'], []], 'Done ticket + not re-reported: fixed with the sink line unchanged, no re-ticket');
  const r2 = reconcile(r1.state, [], { secret: KEY, stillPresent: present });
  assert.equal(r2.state.entries.a.status, 'open');
  const r3 = reconcile(r2.state, [], { secret: KEY, stillPresent: present });
  assert.deepEqual(r3.resolved, ['a']);
  // re-reported in between resets the count
  s = reconcile(r1.state, [f('a')], { secret: KEY }).state;
  assert.equal(s.entries.a.missed, 0);
});

test('reconcile: a history secret whose ticket is Done is closed by the owner (not re-ticketed every week)', () => {
  const g = f('g', { tool: 'gitleaks', category: 'secret', commit: 'abc123' });
  const s = markTicketed(reconcile(emptyState(), [g], { secret: KEY }).state, ['g'], 'card-9');
  const r = reconcile(s, [g], { secret: KEY, doneTickets: new Set(['card-9']) });
  assert.deepEqual(r.fresh, []);
  assert.equal(r.state.entries.g.status, 'closed');
  assert.deepEqual(reconcile(r.state, [g], { secret: KEY }).fresh, []);
});

test('reconcile: entries of a detector that failed this run are left alone', () => {
  const s = markTicketed(reconcile(emptyState(), [f('a')], { secret: KEY }).state, ['a'], 'c');
  const r = reconcile(s, [], { secret: KEY, failedTools: ['claude'] });
  assert.deepEqual([r.resolved, r.state.entries.a.missed], [[], 0]);
});

test('PR-recorded medium/low: the weekly run tickets it from its sealed details even when it is not re-reported', () => {
  const s = recordPr(emptyState(), [f('m', { severity: 'medium' })], { secret: KEY, pr: '7' });
  assert.equal(s.entries.m.source, 'pr');
  assert.equal(s.entries.m.ticket, null);
  const r = reconcile(s, [], { secret: KEY, stillPresent: () => true });
  assert.deepEqual(r.fresh.map((x) => x.fingerprint), ['m']);
  const r2 = reconcile(s, [f('m', { severity: 'medium' })], { secret: KEY });
  assert.deepEqual(r2.fresh.map((x) => x.fingerprint), ['m']);
});

test('entries carry nothing about the vulnerability in clear (no path, title, rule, category, severity)', () => {
  const s = reconcile(emptyState(), [f('a', { title: 'secret-title', file: 'backend/hidden.py' })], { secret: KEY }).state;
  const text = JSON.stringify(s);
  for (const w of ['secret-title', 'hidden.py', 'idor', '"high"']) assert.ok(!text.includes(w), w);
  const p = JSON.stringify(recordPr(emptyState(), [f('b', { severity: 'medium' })], { secret: KEY }));
  assert.ok(!p.includes('idor') && !p.includes('medium'));
});

test('slotDone, runs kept, parseState tolerates garbage', () => {
  const s = addRun(emptyState(), { id: 'r1', mode: 'weekly', slot: '2026-10-30T11:00:00.000Z', status: 'ok' });
  assert.equal(slotDone(s, '2026-10-30T11:00:00.000Z'), true);
  assert.equal(slotDone(addRun(emptyState(), { id: 'r1', mode: 'weekly', slot: 'x', status: 'partial' }), 'x'), false);
  assert.deepEqual(parseState('not json'), emptyState());
});
