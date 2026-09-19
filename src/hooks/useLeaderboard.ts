import { useCallback, useEffect, useState } from "react";
import { useSelector } from "react-redux";
import type { RootState } from "../store";
import { apiFetch } from "../utils/Api";
import { BACKEND_URL } from "../configurations/backend";
import type { LeaderRow, SelfRow } from "../constants/leaderboard";

export type LeaderboardScope = "global" | "friends";

/** How long cached leaderboard data stays fresh before it auto-refreshes. */
export const LEADERBOARD_TTL_MS = 5 * 60 * 1000;
/** How often we tick to update the "refreshed x ago" label / check staleness. */
const TICK_MS = 30 * 1000;

interface LeaderboardData {
  loading: boolean;
  /** A refresh is running while we already have data on screen. */
  refreshing: boolean;
  /** True when the last fetch errored (leaders reflects the last good data, if any). */
  error: boolean;
  leaders: LeaderRow[];
  self: SelfRow | null;
  /** Epoch ms of the last completed load, or null before the first load. */
  lastUpdated: number | null;
  /** Current epoch ms, re-rendered on each tick so relative times stay live. */
  now: number;
  refresh: () => void;
}

interface CacheEntry {
  leaders: LeaderRow[];
  error: boolean;
  userRank: number | null;
  numberUsers: number | null;
  /** Which signed-in user this data's rank belongs to (null = signed out). */
  userKey: string | null;
  fetchedAt: number;
}

// Module-level cache shared across every useLeaderboard() consumer (the home
// card + the modal), so the board is fetched once and reused until it goes
// stale — no loader flash on remount and no duplicate network calls. Kept
// per-scope so switching the Global/Friends toggle never shows stale rows
// from the other scope while its own fetch is in flight.
const caches: Record<LeaderboardScope, CacheEntry | null> = { global: null, friends: null };
const fetching: Record<LeaderboardScope, boolean> = { global: false, friends: false };
const subscribers = new Set<() => void>();
const notify = () => subscribers.forEach((fn) => fn());

async function fetchBoard(userKey: string | null, scope: LeaderboardScope): Promise<void> {
  if (fetching[scope]) return;
  fetching[scope] = true;
  notify();
  try {
    const qs = scope === "friends" ? "?scope=friends" : "";
    const response = await apiFetch(`${BACKEND_URL}/get-users/${qs}`);
    const data = await response.json();
    const live = Array.isArray(data?.top_100_users) ? data.top_100_users : [];

    if (data?.error) {
      caches[scope] = { leaders: [], error: true, userRank: null, numberUsers: null, userKey, fetchedAt: Date.now() };
    } else {
      caches[scope] = {
        leaders: live.map((u: { username: string; id?: string; points: number }, i: number) => ({
          rank: i + 1,
          name: u.username,
          id: u.id ?? null,
          points: u.points,
        })),
        error: false,
        userRank: typeof data?.user_rank === "number" ? data.user_rank : null,
        numberUsers: typeof data?.number_users === "number" ? data.number_users : null,
        userKey,
        fetchedAt: Date.now(),
      };
    }
  } catch (err) {
    console.error("Failed to load leaderboard:", err);
    caches[scope] = { leaders: [], error: true, userRank: null, numberUsers: null, userKey, fetchedAt: Date.now() };
  } finally {
    fetching[scope] = false;
    notify();
  }
}

/**
 * Loads a leaderboard scope from /get-users/ (global, or friends when
 * `scope: "friends"`). Results are cached client-side per scope and
 * auto-refresh every 5 minutes.
 */
export function useLeaderboard(scope: LeaderboardScope = "global"): LeaderboardData {
  const { user } = useSelector((state: RootState) => state.user);
  const userKey = user?.id ?? user?.username ?? null;

  const [, forceRender] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  // Re-render this consumer whenever the shared cache changes.
  useEffect(() => {
    const cb = () => forceRender((n) => n + 1);
    subscribers.add(cb);
    return () => { subscribers.delete(cb); };
  }, []);

  // Initial load (or refetch when the signed-in user/scope changes or data is stale).
  useEffect(() => {
    const cache = caches[scope];
    const stale = !cache || cache.userKey !== userKey || Date.now() - cache.fetchedAt >= LEADERBOARD_TTL_MS;
    if (stale) fetchBoard(userKey, scope);
  }, [userKey, scope]);

  // Tick: keep relative-time labels live and auto-refresh once data is stale.
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now());
      const cache = caches[scope];
      if (!cache || Date.now() - cache.fetchedAt >= LEADERBOARD_TTL_MS) fetchBoard(userKey, scope);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [userKey, scope]);

  const refresh = useCallback(() => { fetchBoard(userKey, scope); }, [userKey, scope]);

  const cache = caches[scope];
  const self: SelfRow | null = user
    ? {
        rank: cache?.userRank ?? (Number(user.rank) || 0),
        name: user.username,
        id: user.id ?? null,
        points: user.points,
        total: cache?.numberUsers ?? 0,
      }
    : null;

  return {
    loading: !cache,
    refreshing: fetching[scope] && !!cache,
    error: cache?.error ?? false,
    leaders: cache?.leaders ?? [],
    self,
    lastUpdated: cache?.fetchedAt ?? null,
    now,
    refresh,
  };
}
