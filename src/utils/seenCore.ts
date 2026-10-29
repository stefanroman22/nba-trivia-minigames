// Seen tracking, browser side (question factory spec §4.4): per game, the questions this browser
// (and, merged in, this account) has already been shown, so single-player pickers deal no repeats
// until the pool is exhausted. Picking reads localStorage synchronously and never waits on the
// network; utils/seen.ts fetches and sends the account's copy. No imports on purpose:
// scripts/check-seen.mjs transpiles this file on its own (npm run check:seen).
//
// Ids are the question ids the games log (pool.ts SEEN_POOLS, gameData.ts pickQuestion); the keys
// are MiniGame game ids. Dealt counts as shown: a round dealt but not reached is still seen.
//
// Reset: when fewer unseen remain than a game deals, every unseen one is dealt, the rest is filled
// from the seen ones, and the set restarts as just that deal. The account keeps its rows (a question
// shown again is not recorded again), so the ids seen before a reset go on the game's ignore list
// (`seen:<game>:base`): the account set merged on later page loads skips them, and only questions
// seen after the reset (new ones, or ones seen first on another device) still count.

export const SEEN_SYNC_TIMEOUT_MS = 1500;
/** The account endpoint takes at most this many ids per request. */
export const SEEN_BATCH = 200;

/** Single-player games that deal without repeats. contexto and wordle are daily games: not tracked. */
export const SEEN_GAMES = new Set([
  "series-winner", "name-logo", "guess-mvps", "starting-five", "fan-favorites", "who-would-win",
  "career-path", "who-are-ya", "tictactoe",
]);

const seenKey = (game: string) => `seen:${game}`;
const baseKey = (game: string) => `seen:${game}:base`;

// The copy used when localStorage is unavailable (private mode, blocked, quota): seen for this session.
const memory = new Map<string, string[]>();
const memoryOnly = new Set<string>(); // keys whose last write missed localStorage
const pending = new Map<string, Set<string>>(); // game -> ids shown but not yet sent to the account
const requests = new Map<string, Promise<void>>(); // game -> the account GET (in flight or done)
const synced = new Set<string>(); // games whose account set was merged this page load

const isId = (v: unknown): v is string => typeof v === "string" && v !== "";

function readIds(key: string): string[] {
  if (!memoryOnly.has(key)) {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return memory.get(key) ?? [];
      const value: unknown = JSON.parse(raw);
      return Array.isArray(value) ? value.filter(isId) : [];
    } catch {
      // unavailable or corrupt: the memory copy
    }
  }
  return memory.get(key) ?? [];
}

function writeIds(key: string, ids: string[]): void {
  memory.set(key, ids);
  try {
    if (ids.length) localStorage.setItem(key, JSON.stringify(ids));
    else localStorage.removeItem(key);
    memoryOnly.delete(key);
  } catch {
    memoryOnly.add(key);
  }
}

/** The ids of `game` already shown in this browser (account ids merged in once synced). */
export function loadSeen(game: string): Set<string> {
  return new Set(readIds(seenKey(game)));
}

/** Record ids as shown: into the browser set now, and queued for the account (flushSeenToServer). */
export function markSeen(game: string, ids: Iterable<string>): void {
  const set = loadSeen(game);
  const out = pending.get(game) ?? new Set<string>();
  for (const id of ids) {
    set.add(id);
    out.add(id);
  }
  writeIds(seenKey(game), [...set]);
  if (out.size) pending.set(game, out);
}

/** Keep only ids still in the pool (a retired question no longer counts); returns the pruned set. */
export function pruneSeen(game: string, validIds: Iterable<string>): Set<string> {
  const valid = new Set(validIds);
  const before = readIds(seenKey(game));
  const kept = before.filter((id) => valid.has(id));
  if (kept.length !== before.length) writeIds(seenKey(game), kept);
  const base = readIds(baseKey(game));
  const keptBase = base.filter((id) => valid.has(id));
  if (keptBase.length !== base.length) writeIds(baseKey(game), keptBase);
  return new Set(kept);
}

/** Start the set over (only `ids` of it when given); what it drops goes on the ignore list for the account's (older) copy. */
function resetSeen(game: string, ids?: ReadonlySet<string>): void {
  const old = readIds(seenKey(game));
  const dropped = ids ? old.filter((id) => ids.has(id)) : old;
  writeIds(baseKey(game), [...new Set([...readIds(baseKey(game)), ...dropped])]);
  writeIds(seenKey(game), ids ? old.filter((id) => !ids.has(id)) : []);
}

function shuffle<T>(arr: T[], rand: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * `n` distinct items of `pool`, unseen ones first: n random unseen when there are enough, else every
 * unseen one plus random seen ones to fill (the whole pool, shuffled, when it holds fewer than n).
 */
export function sampleUnseen<T>(
  pool: readonly T[],
  n: number,
  idOf: (item: T) => string,
  seen: ReadonlySet<string>,
  rand: () => number = Math.random,
): T[] {
  const unseen: T[] = [];
  const rest: T[] = [];
  for (const item of pool) {
    if (seen.has(idOf(item))) rest.push(item);
    else unseen.push(item);
  }
  if (unseen.length >= n) return shuffle(unseen, rand).slice(0, n);
  return shuffle([...unseen, ...shuffle(rest, rand).slice(0, n - unseen.length)], rand);
}

/**
 * Deal `n` items of a pool game with no repeats: sampleUnseen over the stored set, a reset when fewer
 * than n unseen remain, and the deal marked seen. `complete` = `pool` is the whole pool (then ids no
 * longer in it are pruned first); a partial pool must hold at least n unseen (gameData.ts loads chunks
 * until it does or the pool is complete).
 */
export function dealUnseen<T>(
  game: string,
  pool: readonly T[],
  n: number,
  idOf: (item: T) => string,
  complete = true,
  rand: () => number = Math.random,
): T[] {
  const seen = complete ? pruneSeen(game, pool.map(idOf)) : loadSeen(game);
  let unseen = 0;
  for (const item of pool) if (!seen.has(idOf(item))) unseen++;
  const picked = sampleUnseen(pool, n, idOf, seen, rand);
  if (unseen < n) resetSeen(game);
  markSeen(game, picked.map(idOf));
  return picked;
}

/**
 * For a question game with its own picker (one question a game): the index items not seen yet, or,
 * once every one has been seen, the set reset and every item. The caller marks its pick seen.
 * `items` may be one slice of the game's whole `pool` (a difficulty band): ids are pruned against the
 * pool, and an exhausted slice resets only its own ids, so the other slices keep what they have seen.
 */
export function unseenOrAll<T>(game: string, items: readonly T[], idOf: (item: T) => string, pool: readonly T[] = items): T[] {
  const seen = pruneSeen(game, pool.map(idOf));
  const unseen = items.filter((item) => !seen.has(idOf(item)));
  if (unseen.length) return unseen;
  resetSeen(game, pool === items ? undefined : new Set(items.map(idOf)));
  return [...items];
}

/** Merge the account's ids into the browser set, minus the ignore list of earlier resets. */
function mergeServerSeen(game: string, qids: string[]): void {
  synced.add(game);
  const base = new Set(readIds(baseKey(game)));
  const fresh = qids.filter((id) => isId(id) && !base.has(id));
  if (!fresh.length) return;
  const set = loadSeen(game);
  const size = set.size;
  for (const id of fresh) set.add(id);
  if (set.size !== size) writeIds(seenKey(game), [...set]);
}

/**
 * Fetch the account's set for `game` once per page load (`get`) and merge it. Resolves when it is
 * merged, when it fails, or after `timeoutMs`, whichever is first: a game start never waits longer.
 * A slow answer still merges in the background (for the next game); a failed one is retried at the
 * next start.
 */
export function syncSeen(
  game: string,
  get: () => Promise<string[]>,
  timeoutMs: number = SEEN_SYNC_TIMEOUT_MS,
): Promise<void> {
  if (synced.has(game)) return Promise.resolve();
  let request = requests.get(game);
  if (!request) {
    request = Promise.resolve()
      .then(get)
      .then((qids) => mergeServerSeen(game, Array.isArray(qids) ? qids : []))
      .catch(() => {
        requests.delete(game);
      });
    requests.set(game, request);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  return Promise.race([request, timeout]).finally(() => clearTimeout(timer));
}

/** The ids of `game` waiting for the account, removed from the queue (requeueSeen puts back a failed batch). */
export function takePending(game: string): string[] {
  const ids = [...(pending.get(game) ?? [])];
  pending.delete(game);
  return ids;
}

export function requeueSeen(game: string, ids: Iterable<string>): void {
  const out = pending.get(game) ?? new Set<string>();
  for (const id of ids) out.add(id);
  if (out.size) pending.set(game, out);
}

/** Games with ids waiting for the account (flushed together on pagehide). */
export function pendingGames(): string[] {
  return [...pending.keys()];
}
