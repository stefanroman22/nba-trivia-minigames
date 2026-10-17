// node --test scripts/check-core/weekly-slot.test.mjs — Sundays 02:00 Europe/Paris from UTC crons (lib/weekly-slot.mjs).
import assert from 'node:assert/strict';
import test from 'node:test';
import { lastSundayMidnight, planStart, slotOn, weekendSlot } from './lib/weekly-slot.mjs';

const T = (s) => Date.parse(s);
const iso = (t) => new Date(t).toISOString();

test('slot: 02:00 CEST in summer (00:00 UTC), 02:00 CET in winter (01:00 UTC)', () => {
  assert.equal(iso(slotOn(2026, 10, 18)), '2026-10-18T00:00:00.000Z');
  assert.equal(iso(slotOn(2026, 11, 1)), '2026-11-01T01:00:00.000Z');
  assert.equal(iso(slotOn(2027, 1, 10)), '2027-01-10T01:00:00.000Z');
});

test('slot on the DST Sundays: the first 02:00 in October, 03:00 CEST in March (02:00 does not exist)', () => {
  assert.equal(iso(slotOn(2026, 10, 25)), '2026-10-25T00:00:00.000Z');
  assert.equal(iso(slotOn(2027, 3, 28)), '2027-03-28T01:00:00.000Z');
});

test('weekendSlot: a Saturday-evening UTC instant belongs to the next Sunday', () => {
  assert.equal(iso(weekendSlot(T('2026-10-17T23:30:00Z'))), '2026-10-18T00:00:00.000Z');
  assert.equal(weekendSlot(T('2026-10-21T12:00:00Z')), null);
});

test('planStart, summer: the 23:30 UTC cron waits 30 min; the 00:30 and 01:30 crons are late backups', () => {
  assert.deepEqual(planStart({ event: 'schedule', now: T('2026-10-17T23:30:00Z') }).waitSec, 1800);
  const late = planStart({ event: 'schedule', now: T('2026-10-18T00:30:00Z') });
  assert.equal(late.run, true); assert.equal(late.waitSec, 0);
  assert.equal(planStart({ event: 'schedule', now: T('2026-10-18T01:30:00Z') }).run, true);
});

test('planStart, winter: the 23:30 UTC cron is 90 min early (skips), 00:30 waits 30 min, 01:30 is the backup', () => {
  assert.equal(planStart({ event: 'schedule', now: T('2026-11-07T23:30:00Z') }).run, false);
  assert.equal(planStart({ event: 'schedule', now: T('2026-11-08T00:30:00Z') }).waitSec, 1800);
  const b = planStart({ event: 'schedule', now: T('2026-11-08T01:30:00Z') });
  assert.equal(b.run, true); assert.equal(b.waitSec, 0);
});

test('planStart: a trigger delayed 20 min still starts on the slot; one delayed past 3 h skips', () => {
  assert.equal(planStart({ event: 'schedule', now: T('2026-10-17T23:50:00Z') }).waitSec, 600);
  assert.equal(planStart({ event: 'schedule', now: T('2026-10-18T03:30:00Z') }).run, false);
});

test('planStart: dispatch and push run at once', () => {
  assert.deepEqual(planStart({ event: 'workflow_dispatch', now: T('2026-10-21T12:00:00Z') }).run, true);
  assert.deepEqual(planStart({ event: 'push', now: T('2026-10-21T12:00:00Z') }).waitSec, 0);
});

test('lastSundayMidnight: the week the dedupe counts starts Sunday 00:00 Paris time', () => {
  assert.equal(iso(lastSundayMidnight(T('2026-10-18T00:05:00Z'))), '2026-10-17T22:00:00.000Z');
  assert.equal(iso(lastSundayMidnight(T('2026-10-21T12:00:00Z'))), '2026-10-17T22:00:00.000Z');
  assert.equal(iso(lastSundayMidnight(T('2026-11-10T12:00:00Z'))), '2026-11-07T23:00:00.000Z');
  assert.equal(iso(lastSundayMidnight(T('2026-10-17T21:00:00Z'))), '2026-10-10T22:00:00.000Z');
});
