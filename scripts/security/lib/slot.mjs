#!/usr/bin/env node
// The weekly security slot: Fridays 12:00 Europe/Amsterdam wall-clock time, DST-correct (10:00 UTC in summer, 11:00 UTC
// in winter). The same shape as the checks' Sunday slot (scripts/check-core/lib/weekly-slot.mjs): GitHub's cron is UTC
// and fires late or not at all, so .github/workflows/security.yml schedules three crons and planStart() decides:
//   wait  the slot is 0-45 min ahead: set up, then sleep until it
//   now   the slot passed less than 3 h ago (a late trigger, or the backup cron); the state store's "this slot already
//         ran ok" check (state.mjs slotDone) skips a duplicate
//   skip  more than 45 min ahead (the other DST variant's cron), more than 3 h late, or not a Friday
//   Fri 09:30 UTC  summer primary (11:30 CEST, waits 30 min)   · winter: 90 min early → skipped
//   Fri 10:30 UTC  winter primary (11:30 CET, waits 30 min)    · summer: backup (12:30 CEST)
//   Fri 11:30 UTC  winter backup (12:30 CET)                   · summer: backup (13:30 CEST)
//   node scripts/security/lib/slot.mjs plan --event <schedule|workflow_dispatch|push> [--now <iso>]
//       prints `run=`, `wait=`, `slot=`, `until=`, `reason=` (also to $GITHUB_OUTPUT)
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TZ = 'Europe/Amsterdam';
const MIN = 60_000;
export const EARLY_MAX_MIN = 45;
export const LATE_MAX_MIN = 180;
const SLOT_HOUR = 12;

const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' });

/** Amsterdam wall clock of an instant → { y, m, d, hh, mm, wd } (wd: 5 = Friday). */
export function localParts(t) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour, mm: +p.minute, wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}

/** The slot of the Amsterdam date y-m-d: the first instant at or after 12:00 local time (10:00 or 11:00 UTC). */
export function slotOn(y, m, d) {
  for (let t = Date.UTC(y, m - 1, d, 9); t <= Date.UTC(y, m - 1, d, 12); t += 15 * MIN) {
    const p = localParts(t);
    if (p.y === y && p.m === m && p.d === d && p.hh >= SLOT_HOUR) return t;
  }
  throw new Error(`security slot: no 12:00 on ${y}-${m}-${d}`);
}

/** The slot of the Friday `now` falls on (Amsterdam date), else null. */
export function fridaySlot(now) {
  const p = localParts(now);
  return p.wd === 5 ? slotOn(p.y, p.m, p.d) : null;
}

/** → { run, waitSec, slot (ms|null), reason }. Only a `schedule` event is gated; any other event runs now. */
export function planStart({ event, now = Date.now() }) {
  if (event !== 'schedule') return { run: true, waitSec: 0, slot: null, reason: `${event}: runs now` };
  const slot = fridaySlot(now);
  if (slot === null) return { run: false, waitSec: 0, slot: null, reason: 'not a Friday in Amsterdam' };
  const ahead = slot - now;
  if (ahead > EARLY_MAX_MIN * MIN) return { run: false, waitSec: 0, slot, reason: `slot ${Math.round(ahead / MIN)} min ahead: the cron nearer to it runs it` };
  if (ahead >= 0) return { run: true, waitSec: Math.ceil(ahead / 1000), slot, reason: `slot in ${Math.round(ahead / MIN)} min` };
  if (-ahead <= LATE_MAX_MIN * MIN) return { run: true, waitSec: 0, slot, reason: `slot passed ${Math.round(-ahead / MIN)} min ago (late trigger or backup cron)` };
  return { run: false, waitSec: 0, slot, reason: `slot passed ${Math.round(-ahead / MIN)} min ago: too late` };
}

function arg(argv, name) { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv[0] !== 'plan') { console.error('usage: slot.mjs plan --event <name> [--now <iso>]'); process.exit(2); }
  const now = arg(argv, '--now') ? Date.parse(arg(argv, '--now')) : Date.now();
  const p = planStart({ event: arg(argv, '--event') || 'workflow_dispatch', now });
  const lines = [`run=${p.run}`, `wait=${p.waitSec}`, `slot=${p.slot === null ? '' : new Date(p.slot).toISOString()}`, `until=${new Date(now + p.waitSec * 1000).toISOString()}`, `reason=${p.reason}`];
  for (const l of lines) console.log(l);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines.join('\n') + '\n');
}
