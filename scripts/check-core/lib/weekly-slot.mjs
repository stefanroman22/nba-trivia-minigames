#!/usr/bin/env node
// The weekly checks slot: Sundays 02:00 Europe/Paris wall-clock time, DST-correct (CET in winter, CEST in summer).
// GitHub's cron is UTC and fires late (minutes, sometimes an hour or more, at the start of an hour under load) or not at
// all, so .github/workflows/checks-weekly.yml schedules three UTC crons ahead of the slot and lets planStart() decide:
//   wait  the slot is 0-45 min ahead: set up, then sleep until it (the run starts on the minute)
//   now   the slot passed less than 3 h ago (a late trigger, or the backup cron 30 min after the slot); the store's
//         "already ran since Sunday 00:00" check (state.mjs weekly-status, then the run's lease) skips a duplicate
//   skip  more than 45 min ahead (the other DST variant's cron) or more than 3 h late, or not a weekend
// The slot of a DST-change Sunday: the first instant whose Paris wall clock reads ≥ 02:00 — 02:00 CEST (00:00 UTC) on
// the last Sunday of October (02:00 happens twice), 03:00 CEST (01:00 UTC) on the last Sunday of March (02:00 never
// happens).
//   node scripts/check-core/lib/weekly-slot.mjs plan --event <schedule|workflow_dispatch|push> [--now <iso>]
//       prints `run=true|false`, `wait=<seconds>`, `slot=<iso>`, `reason=<text>` (also to $GITHUB_OUTPUT)
//   node scripts/check-core/lib/weekly-slot.mjs wait --until <iso>   sleeps until then (no-op when past)
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TZ = 'Europe/Paris';
const MIN = 60_000;
export const EARLY_MAX_MIN = 45;
export const LATE_MAX_MIN = 180;

const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' });

/** Paris wall clock of an instant → { y, m, d, hh, mm, wd } (wd: 0 = Sunday). */
export function parisParts(t) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour, mm: +p.minute, wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}

/** The slot of the Paris calendar date y-m-d (a Sunday): the first instant at or after 02:00 Paris time on that date. */
export function slotOn(y, m, d) {
  // Paris is UTC+1 or UTC+2: 02:00 Paris is 00:00 or 01:00 UTC of the same date. Scan the quarter hours from 23:00 UTC
  // the day before to 02:00 UTC, the first whose Paris time is that date ≥ 02:00.
  for (let t = Date.UTC(y, m - 1, d) - 60 * MIN; t <= Date.UTC(y, m - 1, d, 2); t += 15 * MIN) {
    const p = parisParts(t);
    if (p.y === y && p.m === m && p.d === d && p.hh >= 2) return t;
  }
  throw new Error(`weekly-slot: no 02:00 slot on ${y}-${m}-${d}`);
}

/** The slot of the weekend `now` falls in (Saturday or Sunday, Paris dates), else null. */
export function weekendSlot(now) {
  const p = parisParts(now);
  if (p.wd !== 0 && p.wd !== 6) return null;
  // The Sunday: today, or tomorrow on a Saturday (noon UTC + 1 day keeps the date arithmetic off the DST edges).
  const sunday = p.wd === 0 ? p : parisParts(Date.UTC(p.y, p.m - 1, p.d, 12) + 1440 * MIN);
  return slotOn(sunday.y, sunday.m, sunday.d);
}

/** The most recent Sunday 00:00 Paris time at or before `now` (the start of the week the store's dedupe counts). */
export function lastSundayMidnight(now) {
  const p = parisParts(now);
  const noon = Date.UTC(p.y, p.m - 1, p.d, 12) - p.wd * 1440 * MIN;
  const s = parisParts(noon);
  for (let t = Date.UTC(s.y, s.m - 1, s.d) - 180 * MIN; t <= Date.UTC(s.y, s.m - 1, s.d, 3); t += 15 * MIN) {
    const q = parisParts(t);
    if (q.y === s.y && q.m === s.m && q.d === s.d) return t;
  }
  throw new Error('weekly-slot: no Sunday midnight');
}

/** → { run, waitSec, slot (ms|null), reason }. Only a `schedule` event is gated; any other event runs now. */
export function planStart({ event, now = Date.now() }) {
  if (event !== 'schedule') return { run: true, waitSec: 0, slot: null, reason: `${event}: runs now` };
  const slot = weekendSlot(now);
  if (slot === null) return { run: false, waitSec: 0, slot: null, reason: 'not a weekend in Paris' };
  const ahead = slot - now;
  if (ahead > EARLY_MAX_MIN * MIN) return { run: false, waitSec: 0, slot, reason: `slot ${Math.round(ahead / MIN)} min ahead: the cron nearer to it runs it` };
  if (ahead >= 0) return { run: true, waitSec: Math.ceil(ahead / 1000), slot, reason: `slot in ${Math.round(ahead / MIN)} min` };
  if (-ahead <= LATE_MAX_MIN * MIN) return { run: true, waitSec: 0, slot, reason: `slot passed ${Math.round(-ahead / MIN)} min ago (late trigger or backup cron)` };
  return { run: false, waitSec: 0, slot, reason: `slot passed ${Math.round(-ahead / MIN)} min ago: too late` };
}

function arg(argv, name) { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv[0] === 'plan') {
    const now = arg(argv, '--now') ? Date.parse(arg(argv, '--now')) : Date.now();
    const p = planStart({ event: arg(argv, '--event') || 'workflow_dispatch', now });
    const lines = [`run=${p.run}`, `wait=${p.waitSec}`, `slot=${p.slot === null ? '' : new Date(p.slot).toISOString()}`, `until=${new Date(now + p.waitSec * 1000).toISOString()}`, `reason=${p.reason}`];
    for (const l of lines) console.log(l);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines.join('\n') + '\n');
  } else if (argv[0] === 'wait') {
    const until = Date.parse(arg(argv, '--until') || '');
    if (!Number.isFinite(until)) { console.error('weekly-slot: wait --until <iso>'); process.exit(2); }
    const ms = until - Date.now();
    console.log(ms > 0 ? `weekly-slot: sleeping ${Math.round(ms / 1000)} s until ${new Date(until).toISOString()}` : 'weekly-slot: slot reached, starting now');
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
    console.log(`weekly-slot: start ${new Date().toISOString()}`);
  } else {
    console.error('usage: weekly-slot.mjs plan --event <name> [--now <iso>] | wait --until <iso>');
    process.exit(2);
  }
}
