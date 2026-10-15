#!/usr/bin/env node
// The block/unblock channel between the checkers (spec §7): <home>/channel.json = { blocks: [], deferred: [], resolved: [] }.
// - blocks[]: { service, by: 'LC-…', finding, card, runId, since } — Logic Check writes one per failed check's service
//   once its card exists (block(), idempotent per service + by).
// - deferred[]: { checker, checkId, project, blockedBy: 'LC-…', service, runId, since[, resolvedAt] } — UI check skips
//   every check tagged with a blocked service and records it (defer(), idempotent per checker + checkId + project + by).
// - resolved[]: blocks moved here by resolve() with { resolvedAt, commit, how }.
// resolve({ isDone, isOnMain }): a block is resolved when its card is Done and the card's commit is on origin/main
// (isOnMain(sha)); a Done card without a commit (closed by hand) resolves too (`how: 'closed without commit'`) so it never
// blocks forever — Logic re-blocks it on its next failure. The callers inject the lookups (Notion card status, git
// merge-base --is-ancestor), so this module needs neither. Every function takes { file } (default <home>/channel.json).
//   node scripts/check-core/lib/channel.mjs show    print the channel (blocks, pending deferred, resolved count)
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { uicHome } from './home.mjs';

export const channelPath = (home = uicHome()) => path.join(home, 'channel.json');
const empty = () => ({ blocks: [], deferred: [], resolved: [] });
const iso = (now) => (now instanceof Date ? now : new Date(now ?? Date.now())).toISOString();

export function readChannel({ file = channelPath() } = {}) {
  let c;
  try { c = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { return empty(); }
  return { ...empty(), ...c, blocks: c.blocks || [], deferred: c.deferred || [], resolved: c.resolved || [] };
}

/** Atomic write (tmp file + rename). */
export function writeChannel(c, { file = channelPath() } = {}) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ blocks: c.blocks || [], deferred: c.deferred || [], resolved: c.resolved || [] }, null, 2) + '\n');
  renameSync(tmp, file);
  return c;
}

/** Block `service` because Logic check `by` failed (finding id, Notion card id). Idempotent per (service, by): a repeat
 *  keeps `since` and updates finding/card/runId. → { added, block } */
export function block({ service, by, finding = null, card = null, runId = null }, { file = channelPath(), now } = {}) {
  if (!service || !by) throw new Error('channel.block needs { service, by }');
  const c = readChannel({ file });
  let b = c.blocks.find((x) => x.service === service && x.by === by);
  const added = !b;
  if (b) Object.assign(b, { finding: finding ?? b.finding, card: card ?? b.card, runId: runId ?? b.runId });
  else c.blocks.push(b = { service, by, finding, card, runId, since: iso(now) });
  writeChannel(c, { file });
  return { added, block: b };
}

/** Services blocked right now → Set. */
export function blockedServices({ file = channelPath() } = {}) {
  return new Set(readChannel({ file }).blocks.map((b) => b.service));
}

/** The active block that blocks `service` (first by `since`), or null — for the skip reason `blocked by LC-… (card …)`. */
export function blockFor(service, { file = channelPath() } = {}) {
  return readChannel({ file }).blocks.filter((b) => b.service === service).sort((a, b) => String(a.since).localeCompare(String(b.since)))[0] || null;
}

/** Record a check skipped because of a block. Idempotent per (checker, checkId, project, blockedBy) while pending. → { added, item } */
export function defer({ checker = 'ui', checkId, project = null, blockedBy, service = null, runId = null }, { file = channelPath(), now } = {}) {
  if (!checkId || !blockedBy) throw new Error('channel.defer needs { checkId, blockedBy }');
  const c = readChannel({ file });
  let d = c.deferred.find((x) => !x.resolvedAt && x.checker === checker && x.checkId === checkId && (x.project ?? null) === project && x.blockedBy === blockedBy);
  const added = !d;
  if (d) Object.assign(d, { runId: runId ?? d.runId, service: service ?? d.service });
  else c.deferred.push(d = { checker, checkId, project, blockedBy, service, runId, since: iso(now) });
  writeChannel(c, { file });
  return { added, item: d };
}

/**
 * Resolve blocks whose card is Done with its commit on main.
 *   isDone(card) → { done, commit } (or a boolean; true = done without a known commit); may be async or throw.
 *   isOnMain(sha) → boolean (may be async).
 * Resolved blocks move to resolved[]; deferred items of an LC id with no block left get resolvedAt.
 * → { resolved: [block + { resolvedAt, commit, how }], catchUp: { ui: [checkIds], logic: [services] }, errors: [{ card, error }] }
 * catchUp.logic: the resolved services (Logic re-runs their checks first); catchUp.ui: the deferred UI checks released
 * now that have no other pending deferral (UI check runs them with --only once Logic is green).
 */
export async function resolve({ isDone, isOnMain }, { file = channelPath(), now } = {}) {
  const c = readChannel({ file });
  const at = iso(now);
  const status = new Map(); // card → { done, commit, how } | { error }
  for (const card of [...new Set(c.blocks.map((b) => b.card).filter(Boolean))]) {
    try {
      const d = await isDone(card);
      const done = typeof d === 'object' && d !== null ? !!d.done : !!d;
      const commit = typeof d === 'object' && d !== null ? d.commit || null : null;
      if (!done) { status.set(card, { done: false }); continue; }
      if (!commit) { status.set(card, { done: true, commit: null, how: 'closed without commit' }); continue; }
      status.set(card, (await isOnMain(commit)) ? { done: true, commit, how: 'fix on main' } : { done: false });
    } catch (e) {
      status.set(card, { error: String(e.message || e).split('\n')[0] });
    }
  }
  const resolved = [];
  const keep = [];
  for (const b of c.blocks) {
    const s = status.get(b.card);
    if (s && s.done) resolved.push({ ...b, resolvedAt: at, commit: s.commit, how: s.how });
    else keep.push(b);
  }
  const stillBlocking = new Set(keep.map((b) => b.by));
  const releasedBy = new Set(resolved.map((b) => b.by).filter((by) => !stillBlocking.has(by)));
  const released = [];
  for (const d of c.deferred) if (!d.resolvedAt && releasedBy.has(d.blockedBy)) { d.resolvedAt = at; released.push(d); }
  const pending = new Set(c.deferred.filter((d) => !d.resolvedAt).map((d) => `${d.checker}|${d.checkId}`));
  const ui = [...new Set(released.filter((d) => d.checker === 'ui' && !pending.has(`ui|${d.checkId}`)).map((d) => d.checkId))];
  const logic = [...new Set(resolved.map((b) => b.service))];
  c.blocks = keep;
  c.resolved.push(...resolved);
  writeChannel(c, { file });
  const errors = [...status].filter(([, s]) => s.error).map(([card, s]) => ({ card, error: s.error }));
  return { resolved, catchUp: { ui, logic }, errors };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2];
  if (cmd !== 'show') { console.error('usage: node scripts/check-core/lib/channel.mjs show'); process.exit(2); }
  const c = readChannel();
  console.log(`channel ${channelPath()}`);
  console.log(`blocks ${c.blocks.length}${c.blocks.map((b) => `\n  ${b.service} by ${b.by} (card ${b.card || '-'}, finding ${b.finding || '-'}, since ${b.since})`).join('')}`);
  const pend = c.deferred.filter((d) => !d.resolvedAt);
  console.log(`deferred ${pend.length} pending${pend.map((d) => `\n  ${d.checker} ${d.checkId}${d.project ? ` @ ${d.project}` : ''} blocked by ${d.blockedBy}`).join('')}`);
  console.log(`resolved ${c.resolved.length}`);
}
