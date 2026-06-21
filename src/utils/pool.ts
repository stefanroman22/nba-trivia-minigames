import { BACKEND_ORIGIN } from "../configurations/backend";
import type { FetchResult, GameData } from "../types/types";

const TRIVIA_BASE = `${BACKEND_ORIGIN}/trivia`;

// In-memory pool cache keyed by "<gameKey>:<version>" (survives within a session).
const memCache = new Map<string, GameData[]>();
let cachedVersion: string | null = null;
let versionPromise: Promise<string> | null = null;

async function getVersion(): Promise<string> {
  if (cachedVersion) return cachedVersion;
  if (!versionPromise) {
    versionPromise = fetch(`${TRIVIA_BASE}/manifest/`)
      .then((r) => {
        if (!r.ok) throw new Error(`manifest ${r.status}`);
        return r.json();
      })
      .then((m: { version: string }) => {
        cachedVersion = m.version;
        return m.version;
      })
      .finally(() => {
        versionPromise = null;
      });
  }
  return versionPromise;
}

// Drop any cached pools for this game whose version != the current one, so
// localStorage doesn't grow unbounded as the data is refreshed weekly.
function pruneOldVersions(gameKey: string, keep: string): void {
  const prefix = `pool:${gameKey}:`;
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k && k.startsWith(prefix) && k !== `${prefix}${keep}`) {
      localStorage.removeItem(k);
    }
  }
}

async function loadPool(gameKey: string): Promise<GameData[]> {
  const version = await getVersion();
  const cacheKey = `${gameKey}:${version}`;

  const inMem = memCache.get(cacheKey);
  if (inMem) return inMem;

  const lsKey = `pool:${cacheKey}`;
  const stored = localStorage.getItem(lsKey);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as GameData[];
      memCache.set(cacheKey, parsed);
      return parsed;
    } catch {
      localStorage.removeItem(lsKey); // drop a corrupt entry and fall through to a refetch
    }
  }

  const res = await fetch(`${TRIVIA_BASE}/pool/${gameKey}/`);
  if (!res.ok) throw new Error(`pool ${gameKey} ${res.status}`);
  const body = (await res.json()) as { pool?: GameData[] };
  const pool = body.pool ?? [];
  memCache.set(cacheKey, pool);
  try {
    localStorage.setItem(lsKey, JSON.stringify(pool));
    pruneOldVersions(gameKey, version);
  } catch {
    // localStorage quota exceeded / unavailable — the in-memory cache still serves this session.
  }
  return pool;
}

// Fisher–Yates shuffle (in place).
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Pick `n` distinct random items from `pool` (whole shuffled pool if it has <= n). */
export function sampleN<T>(pool: T[], n: number): T[] {
  if (pool.length <= n) return shuffle([...pool]);
  const chosen = new Set<number>();
  while (chosen.size < n) chosen.add(Math.floor(Math.random() * pool.length));
  return [...chosen].map((i) => pool[i]);
}

/**
 * Fetch a game's whole pool once (cached in memory + localStorage, keyed by the
 * data version from /trivia/manifest/) and sample `rounds` items locally. Replaces
 * the per-request random API call so the pool is CDN/edge-cacheable and each play
 * needs no network round-trip.
 */
export async function fetchGamePool(
  gameKey: string,
  rounds: number,
): Promise<FetchResult> {
  try {
    const pool = await loadPool(gameKey);
    if (!pool.length) {
      return {
        success: false,
        error: { title: "No data available", message: "Please try again later." },
      };
    }
    return { success: true, data: sampleN(pool, rounds) };
  } catch {
    return {
      success: false,
      error: {
        title: "Unable to connect to the server",
        message: "Please check your internet connection or try again later.",
      },
    };
  }
}
