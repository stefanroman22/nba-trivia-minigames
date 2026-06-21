import type { FetchResult, GameData } from "../types/types";

// Game pools are served as static JSON from the same origin: the build copies
// backend/trivia/data into the deployment, served by the CDN at /data/. Override
// with VITE_DATA_BASE to point at an external CDN (e.g. a dedicated data domain).
const DATA_BASE = import.meta.env.VITE_DATA_BASE || "/data";

// In-memory pool cache keyed by "<gameKey>:<version>" (survives within a session).
const memCache = new Map<string, GameData[]>();
let cachedVersion: string | null = null;
let versionPromise: Promise<string> | null = null;

async function getVersion(): Promise<string> {
  if (cachedVersion) return cachedVersion;
  if (!versionPromise) {
    versionPromise = fetch(`${DATA_BASE}/manifest.json`)
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

// Return any cached pool for a game (we prune to at most one version). Used as a
// graceful-staleness fallback when the manifest can't be fetched.
function cachedPool(gameKey: string): GameData[] | null {
  const prefix = `pool:${gameKey}:`;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(prefix)) {
      try {
        return JSON.parse(localStorage.getItem(k) as string) as GameData[];
      } catch {
        localStorage.removeItem(k);
      }
    }
  }
  return null;
}

async function loadPool(gameKey: string): Promise<GameData[]> {
  let version: string;
  try {
    version = await getVersion();
  } catch (err) {
    // Manifest unreachable — serve the last cached pool for this game if we have one.
    const stale = cachedPool(gameKey);
    if (stale) return stale;
    throw err;
  }
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

  const res = await fetch(`${DATA_BASE}/${gameKey}.json`);
  if (!res.ok) throw new Error(`pool ${gameKey} ${res.status}`);
  // Static files are a raw array; the Django /trivia/pool/ endpoint wraps it as { pool }.
  const body = (await res.json()) as GameData[] | { pool?: GameData[] };
  const pool = Array.isArray(body) ? body : body.pool ?? [];
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
 * data version from the static /data/manifest.json) and sample `rounds` items locally.
 * The pool is served from the CDN, so each play needs no network round-trip.
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
