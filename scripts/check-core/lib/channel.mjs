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
// No lock: every write is an atomic replace, but two concurrent read-modify-writes of one home can lose one update. That
// is fine because a weekly run (check-run.mjs) is sequential; add a lock (like stack.json's) before running checkers in
// parallel on one home. Across machines (the cloud run, the PC, the live probes) the homes merge through the state store
// (state-store.mjs, branch checks-state), which never loses a writer's change.
//   node scripts/check-core/lib/channel.mjs show    print the channel (blocks, pending deferred, resolved count)
//   node scripts/check-core/lib/channel.mjs block --service <s> --by <LC-id> --finding <id> --card <cardId> --run <runId>
//       one block (idempotent per service + LC id) → `block <s> by <LC> card <card> (new|kept)`
//   node scripts/check-core/lib/channel.mjs block-run --run <runId> [--dry-run]
//       every block a pushed Logic run implies (planBlocks): for each validated open finding of <runDir>/findings.json
//       that notion-push gave a card in this run (<home>/notion-cards.json), the services of its `lc` checks that FAILED
//       in the run's results.json (a violation note `service games.<id>` blocks that game instead of the row's
//       services); a card closed by hand (notion-push "done without commit", ledger decision skip:byHand) is never
//       re-blocked. Prints one `block …` / `skip …` line each and `block-run: N new · M kept · K skipped (closed by hand)`.
//   node scripts/check-core/lib/channel.mjs resolve [--fake <lookups.json>]
//       resolve() with Notion (`notion.mjs get-card <id>`: Status Done + its Commit) and git (`git fetch origin main`, then
//       `git merge-base --is-ancestor <Commit> origin/main`) → `resolved …` / `error card …` lines, then
//       `catchup-logic <LC ids|->` (catchUpLogicIds: the resolved services' local Logic checks, never LC-LIVE; a
//       games.<id> also LC-GAMEDATA-01 + the round-dealing rooms checks for an online game), `catchup-ui <ids|->` (the released deferred UI
//       checks, `--only` form) and `resolve: N resolved · M still blocking · E error(s)`. --fake replaces both lookups:
//       { "cards": { "<card>": { "done": true, "commit": "<sha>" } | { "error": "…" } }, "onMain": ["<sha>"] }.
// Every subcommand takes --home <dir> (default uicHome(), UI_CHECK_HOME).
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, uicHome } from './home.mjs';
import { checksForServices, loadServiceMaps, servicesOf } from './services.mjs';

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
  if (!card) throw new Error(`channel.block ${service} by ${by}: needs the finding's Notion card id (a block is written once its card exists; resolve() needs it)`);
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

const GAME_NOTE = /\bservice (games\.[a-z0-9][a-z0-9-]*)\b/;
const failedResult = (r) => r.status === 'failed' || r.status === 'timedOut';

/** Services to block for one failing Logic check: the `games.<id>` its violations name (note `service games.<id>`),
 *  plus the CHECKS.md row's services when any violation names no game (or there are none). */
export function servicesToBlock(checkId, failing, maps) {
  const row = servicesOf(checkId, maps) || [];
  const games = new Set();
  let unnoted = false;
  const vs = failing.flatMap((r) => r.violations || []);
  if (!vs.length) unnoted = true;
  for (const v of vs) { const m = GAME_NOTE.exec(String(v.note || '')); if (m) games.add(m[1]); else unnoted = true; }
  return [...new Set([...games, ...(unnoted || !games.size ? row : [])])];
}

/**
 * The blocks a pushed Logic run implies → { blocks: [{ service, by, finding, card, runId }], skipped: [{ finding, card, why }] }.
 * doc: the run's findings.json; results: its results.json; ledger: <home>/notion-cards.json; maps: the services maps.
 * Only validated open findings that notion-push recorded for THIS run with a real card; a card closed by hand
 * (decision skip:byHand) is skipped, never re-blocked. One block per (service, LC id), first finding wins.
 */
export function planBlocks({ doc, results = [], ledger = {}, runId, maps }) {
  const failing = new Map();
  for (const r of results) if (failedResult(r)) { if (!failing.has(r.checkId)) failing.set(r.checkId, []); failing.get(r.checkId).push(r); }
  const blocks = new Map();
  const skipped = [];
  for (const f of (doc && doc.findings) || []) {
    if (f.status === 'fixed' || !f.validatedAt) continue;
    const entry = [f.fingerprint, ...(f.mergedFingerprints || [])].filter(Boolean).map((fp) => ledger[fp])
      .find((e) => e && e.run === runId && e.card && e.card !== 'DRY');
    if (!entry) continue;
    if (entry.decision === 'skip:byHand') { skipped.push({ finding: f.id, card: entry.card, why: 'closed by hand' }); continue; }
    for (const c of (f.acceptance && f.acceptance.checks) || []) {
      if (!c || !c.lc || !failing.has(c.lc)) continue;
      for (const service of servicesToBlock(c.lc, failing.get(c.lc), maps)) {
        const key = `${service}|${c.lc}`;
        if (!blocks.has(key)) blocks.set(key, { service, by: c.lc, finding: f.id, card: entry.card, runId });
      }
    }
  }
  return { blocks: [...blocks.values()], skipped };
}

/** Rooms checks that deal a game's round (roundData): a resolved games.<id> of an online game re-runs them. */
export const ROOM_ROUND_CHECKS = ['LC-ROOMS-07', 'LC-ROOMS-10'];

/**
 * The Logic checks a catch-up re-runs for resolved `services` (logicMap: the logic CHECKS.md services map) → ids.
 * Every local LC check tagged with a resolved service; a `games.<id>` service also re-runs LC-GAMEDATA-01 (each game's
 * data sources) and, when isOnline(id), the rooms checks that deal a round. Never an LC-LIVE check: catch-up runs on
 * local main and the live site may not carry the fix yet (the live cron confirms it). A game block therefore always
 * yields a Logic re-run that gates UI check's catch-up of that game.
 */
export function catchUpLogicIds(services, logicMap, { isOnline = () => false } = {}) {
  if (!services.length || !logicMap) return [];
  const ids = new Set(checksForServices(services, [logicMap]));
  for (const s of services) {
    const m = /^games\.([a-z0-9][a-z0-9-]*)$/.exec(s);
    if (!m) continue;
    ids.add('LC-GAMEDATA-01');
    if (isOnline(m[1])) for (const id of ROOM_ROUND_CHECKS) ids.add(id);
  }
  return [...ids].filter((id) => id.startsWith('LC-') && !id.startsWith('LC-LIVE-'));
}

/** resolve() lookups from a --fake JSON: { cards: { card: { done, commit } | { error } }, onMain: [sha] }. */
export function fakeLookups(fake) {
  const cards = (fake && fake.cards) || {};
  const onMain = new Set((fake && fake.onMain) || []);
  return {
    isDone: (card) => {
      const c = cards[card];
      if (!c) return { done: false };
      if (c.error) throw new Error(c.error);
      return { done: !!c.done, commit: c.commit || null };
    },
    isOnMain: (sha) => onMain.has(sha),
  };
}

/** resolve() lookups against Notion (scripts/notion.mjs get-card) and git (origin/main, fetched once). */
export function realLookups({ root = ROOT } = {}) {
  let fetched = false;
  return {
    isDone: (card) => {
      const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'notion.mjs'), 'get-card', card], { cwd: root, encoding: 'utf8', timeout: 60_000 });
      if (r.status !== 0) throw new Error(`notion.mjs get-card ${card}: ${String(r.stderr || r.stdout || r.error?.message || `exit ${r.status}`).trim().split('\n').pop()}`);
      const c = JSON.parse(r.stdout);
      return { done: c.status === 'Done', commit: c.commit || null };
    },
    isOnMain: (sha) => {
      if (!fetched) {
        const f = spawnSync('git', ['fetch', '--quiet', 'origin', 'main'], { cwd: root, encoding: 'utf8', timeout: 120_000 });
        if (f.status !== 0) throw new Error(`git fetch origin main: ${String(f.stderr || '').trim().split('\n').pop()}`);
        fetched = true;
      }
      const r = spawnSync('git', ['merge-base', '--is-ancestor', sha, 'origin/main'], { cwd: root, encoding: 'utf8' });
      if (r.status === 0) return true;
      if (r.status === 1) return false;
      throw new Error(`git merge-base ${sha}: ${String(r.stderr || '').trim().split('\n').pop() || `exit ${r.status}`}`);
    },
  };
}

function cliArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') o.dryRun = true;
    else if (a.startsWith('--')) { const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`); o[a.slice(2)] = v; i++; }
    else o._.push(a);
  }
  return o;
}

const USAGE = [
  'usage: node scripts/check-core/lib/channel.mjs show [--home <dir>]',
  '       node scripts/check-core/lib/channel.mjs block --service <s> --by <LC-id> --finding <id> --card <cardId> --run <runId> [--home <dir>]',
  '       node scripts/check-core/lib/channel.mjs block-run --run <runId> [--dry-run] [--home <dir>]',
  '       node scripts/check-core/lib/channel.mjs resolve [--fake <lookups.json>] [--home <dir>]',
].join('\n');

/** The CLI → exit code. */
export async function cli(argv, { log = console.log, err = console.error } = {}) {
  let o;
  try { o = cliArgs(argv); } catch (e) { err(`channel: ${e.message}`); return 2; }
  const cmd = o._[0];
  const home = o.home ? path.resolve(o.home) : uicHome();
  const file = channelPath(home);
  if (cmd === 'show') {
    const c = readChannel({ file });
    log(`channel ${file}`);
    log(`blocks ${c.blocks.length}${c.blocks.map((b) => `\n  ${b.service} by ${b.by} (card ${b.card || '-'}, finding ${b.finding || '-'}, since ${b.since})`).join('')}`);
    const pend = c.deferred.filter((d) => !d.resolvedAt);
    log(`deferred ${pend.length} pending${pend.map((d) => `\n  ${d.checker} ${d.checkId}${d.project ? ` @ ${d.project}` : ''} blocked by ${d.blockedBy}`).join('')}`);
    log(`resolved ${c.resolved.length}`);
    return 0;
  }
  if (cmd === 'block') {
    if (!o.service || !o.by || !o.finding || !o.card) { err(`channel: block needs --service, --by, --finding and --card\n${USAGE}`); return 2; }
    try {
      const r = block({ service: o.service, by: o.by, finding: o.finding || null, card: o.card, runId: o.run || null }, { file });
      log(`block ${o.service} by ${o.by} card ${o.card} (${r.added ? 'new' : 'kept'})`);
      return 0;
    } catch (e) { err(`channel: ${e.message}`); return 2; }
  }
  if (cmd === 'block-run') {
    if (!o.run) { err(`channel: block-run needs --run <runId>\n${USAGE}`); return 2; }
    const read = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8').replace(/^﻿/, '')); } catch { return d; } };
    const dir = path.join(home, 'runs', o.run);
    const doc = read(path.join(dir, 'findings.json'), null);
    if (!doc) { log(`block-run: no findings.json in ${dir} — nothing to block`); return 0; }
    const plan = planBlocks({ doc, results: read(path.join(dir, 'results.json'), []), ledger: read(path.join(home, 'notion-cards.json'), {}), runId: o.run, maps: loadServiceMaps() });
    let added = 0, kept = 0;
    for (const b of plan.blocks) {
      if (o.dryRun) { log(`block ${b.service} by ${b.by} card ${b.card} finding ${b.finding} (dry run)`); continue; }
      const r = block(b, { file });
      if (r.added) added++; else kept++;
      log(`block ${b.service} by ${b.by} card ${b.card} finding ${b.finding} (${r.added ? 'new' : 'kept'})`);
    }
    for (const s of plan.skipped) log(`skip ${s.finding} card ${s.card}: ${s.why} (no block)`);
    log(`block-run: ${o.dryRun ? `${plan.blocks.length} planned (dry run)` : `${added} new · ${kept} kept`} · ${plan.skipped.length} skipped (closed by hand)`);
    return 0;
  }
  if (cmd === 'resolve') {
    let lookups;
    if (o.fake) {
      try { lookups = fakeLookups(JSON.parse(readFileSync(o.fake, 'utf8'))); } catch (e) { err(`channel: --fake ${o.fake}: ${e.message}`); return 2; }
    } else lookups = realLookups();
    const r = await resolve(lookups, { file });
    for (const b of r.resolved) log(`resolved ${b.service} by ${b.by} card ${b.card} (${b.how}${b.commit ? ` ${String(b.commit).slice(0, 7)}` : ''})`);
    for (const e of r.errors) log(`error card ${e.card}: ${e.error}`);
    const [, logicMap] = loadServiceMaps(); // [ui, logic]
    let online = () => false;
    if (r.catchUp.logic.some((sv) => sv.startsWith('games.'))) {
      try {
        const { visibleGames } = await import('../../ui-check/lib/games-catalog.mjs');
        const on = new Set(visibleGames().filter((g) => g.online).map((g) => g.id));
        online = (id) => on.has(id);
      } catch (e) { err(`channel: game catalogue not read (${String(e.message).split('\n')[0]}) — no rooms checks in the catch-up`); }
    }
    const logicIds = catchUpLogicIds(r.catchUp.logic, logicMap, { isOnline: online });
    log(`catchup-logic ${logicIds.join(',') || '-'}`);
    log(`catchup-ui ${r.catchUp.ui.join(',') || '-'}`);
    log(`resolve: ${r.resolved.length} resolved · ${readChannel({ file }).blocks.length} still blocking · ${r.errors.length} error(s)`);
    return 0;
  }
  err(USAGE);
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await cli(process.argv.slice(2));
