// node --test scripts/security/slot.test.mjs — Fridays 12:00 Europe/Amsterdam from UTC crons (lib/slot.mjs).
import assert from 'node:assert/strict';
import test from 'node:test';
import { fridaySlot, planStart, slotOn } from './lib/slot.mjs';

const T = (s) => Date.parse(s);
const iso = (t) => new Date(t).toISOString();

test('slot: 12:00 CEST = 10:00 UTC in summer, 12:00 CET = 11:00 UTC in winter', () => {
  assert.equal(iso(slotOn(2026, 10, 23)), '2026-10-23T10:00:00.000Z');
  assert.equal(iso(slotOn(2026, 10, 30)), '2026-10-30T11:00:00.000Z'); // the Friday after the October change
  assert.equal(iso(slotOn(2027, 3, 26)), '2027-03-26T11:00:00.000Z'); // the Friday before the March change
  assert.equal(iso(slotOn(2027, 4, 2)), '2027-04-02T10:00:00.000Z');
});

test('summer: 09:30 UTC waits 30 min; 10:30 and 11:30 UTC are backups', () => {
  const a = planStart({ event: 'schedule', now: T('2026-10-23T09:30:00Z') });
  assert.deepEqual([a.run, a.waitSec], [true, 1800]);
  assert.equal(planStart({ event: 'schedule', now: T('2026-10-23T10:30:00Z') }).run, true);
  assert.equal(planStart({ event: 'schedule', now: T('2026-10-23T11:30:00Z') }).run, true);
});

test('winter: 09:30 UTC is 90 min early → skip; 10:30 UTC waits 30 min', () => {
  assert.equal(planStart({ event: 'schedule', now: T('2026-10-30T09:30:00Z') }).run, false);
  const b = planStart({ event: 'schedule', now: T('2026-10-30T10:30:00Z') });
  assert.deepEqual([b.run, b.waitSec], [true, 1800]);
});

test('not a Friday, or hours late → skip; a manual or push event runs now', () => {
  assert.equal(fridaySlot(T('2026-10-24T10:00:00Z')), null);
  assert.equal(planStart({ event: 'schedule', now: T('2026-10-24T10:00:00Z') }).run, false);
  assert.equal(planStart({ event: 'schedule', now: T('2026-10-23T14:30:00Z') }).run, false);
  assert.deepEqual(planStart({ event: 'workflow_dispatch', now: T('2026-10-24T10:00:00Z') }), { run: true, waitSec: 0, slot: null, reason: 'workflow_dispatch: runs now' });
});
