#!/usr/bin/env node
// The one Slack line of a weekly run (scripts/check-run.mjs, spec §7 token rules): cards created per checker, blocks
// written, blocks resolved, deferred checks pending, the run ids, the duration. check-run.mjs writes what it saw to a
// state JSON as it goes; this builds the line from it (plus the pending deferrals of <home>/channel.json) and posts it.
//   node scripts/check-core/lib/check-summary.mjs --state <state.json> [--home <dir>] [--post] [--dry-run]
// Prints the line. --post sends it to #pipeline (slack.mjs post-text general, never fails the caller); --dry-run with
// --post prints instead of posting.
// State (every field optional): { startedAt, endedAt, runs: { logicCatchUp, uiCatchUp, logic, ui, uiLive },
//   exits: { <same keys>: code }, cards: { logic: { new, regression, skipped, errors }, ui: { … }, checkBugs: { new, seen, errors } },
//   blocks: { new, kept }, resolved, unverified: { checks: [ids the judges / triage dropped as check bugs] }, notes: [ "…" ] }
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { uicHome } from './home.mjs';
import { channelPath, readChannel } from './channel.mjs';
import { oneLine, postLine } from './slack-line.mjs';

/** Seconds → `1h 42m` / `12m` / `40s`. */
export function duration(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

const cardsText = (c) => {
  if (!c) return 'no cards pushed';
  const made = (c.new || 0) + (c.regression || 0);
  return `${made} card(s) created${c.regression ? ` (${c.regression} regression)` : ''}${c.errors ? `, ${c.errors} push error(s)` : ''}`;
};
const runText = (id, exit) => (id ? `${id}${exit !== undefined && exit !== null ? ` exit ${exit}` : ''}` : 'not run');

/** The summary line of a nightly run. `deferred`: pending deferred checks in channel.json. Pure. */
export function summaryLine(state = {}, { deferred = 0 } = {}) {
  const runs = state.runs || {}, exits = state.exits || {}, cards = state.cards || {}, blocks = state.blocks || {};
  const sec = state.durationSec ?? ((Date.parse(state.endedAt) - Date.parse(state.startedAt)) / 1000);
  const parts = [`nba-checks ${Number.isFinite(sec) ? duration(sec) : '?'}`];
  if (runs.logicCatchUp || runs.uiCatchUp) parts.push(`catch-up logic ${runText(runs.logicCatchUp, exits.logicCatchUp)}, ui ${runText(runs.uiCatchUp, exits.uiCatchUp)}`);
  parts.push(`logic ${runText(runs.logic, exits.logic)}: ${cardsText(cards.logic)}, ${blocks.new || 0} block(s) written${blocks.kept ? ` (+${blocks.kept} kept)` : ''}`);
  parts.push(`ui ${runText(runs.ui, exits.ui)} + live ${runText(runs.uiLive, exits.uiLive)}: ${cardsText(cards.ui)}`);
  parts.push(`resolved ${state.resolved || 0}`, `deferred ${deferred}`);
  const un = state.unverified;
  if (un && (un.checks || []).length) {
    const c = cards.checkBugs || {};
    parts.push(`UNVERIFIED ${un.checks.length} check(s) (${un.checks.join(', ')}): ${c.new || 0} new check-bug card(s), ${c.seen || 0} still open${c.errors ? `, ${c.errors} push error(s)` : ''}`);
  }
  for (const n of state.notes || []) if (n) parts.push(String(n));
  return oneLine(parts.join(' · '));
}

function args(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--post') o.post = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--state' || a === '--home') { const v = argv[++i]; if (v === undefined) throw new Error(`${a} needs a value`); o[a.slice(2)] = v; }
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let o;
  try { o = args(process.argv.slice(2)); } catch (e) { console.error(`check-summary: ${e.message}`); process.exit(2); }
  if (!o.state) { console.error('usage: node scripts/check-core/lib/check-summary.mjs --state <state.json> [--home <dir>] [--post] [--dry-run]'); process.exit(2); }
  let state;
  try { state = JSON.parse(readFileSync(o.state, 'utf8').replace(/^﻿/, '')); } catch (e) { console.error(`check-summary: ${o.state}: ${e.message}`); process.exit(2); }
  const home = o.home ? path.resolve(o.home) : uicHome();
  const deferred = readChannel({ file: channelPath(home) }).deferred.filter((d) => !d.resolvedAt).length;
  const line = summaryLine(state, { deferred });
  console.log(line);
  if (o.post) postLine(line, { dryRun: !!o.dryRun });
}
