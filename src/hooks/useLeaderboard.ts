import { useCallback, useEffect, useState } from "react";
import { useSelector } from "react-redux";
import type { RootState } from "../store";
import { apiFetch } from "../utils/Api";
import { BACKEND_URL } from "../configurations/backend";
import { FALLBACK_LEADERS, FALLBACK_SELF, type LeaderRow, type SelfRow } from "../constants/leaderboard";

/** How long cached leaderboard data stays fresh before it auto-refreshes. */
export const LEADERBOARD_TTL_MS = 5 * 60 * 1000;
/** How often we tick to update the "refreshed x ago" label / check staleness. */
const TICK_MS = 30 * 1000;

interface LeaderboardData {
  loading: boolean;
  /** A refresh is running while we already have data on screen. */
  refreshing: boolean;
  /** True when showing dummy data because the backend was empty/unreachable. */
  isFallback: boolean;
  leaders: LeaderRow[];
  self: SelfRow;
  /** Epoch ms of the last completed load, or null before the first load. */
  lastUpdated: number | null;
  /** Current epoch ms, re-rendered on each tick so relative times stay live. */
  now: number;
  refresh: () => void;
}

interface CacheEntry {
  leaders: LeaderRow[];
  isFallback: boolean;
  userRank: number | null;
  numberUsers: number | null;
  /** Which signed-in user this data's rank belongs to (null = signed out). */
  userKey: string | null;
  fetchedAt: number;
}

// Module-level cache shared across every useLeaderboard() consumer (the home
// card + the modal), so the board is fetched once and reused until it goes
// stale — no loader flash on remount and no duplicate network calls.
let cache: CacheEntry | null = null;
let isFetching = false;
const subscribers = new Set<() => void>();
const notify = () => subscribers.forEach((fn) => fn());

async function fetchBoard(userKey: string | null): Promise<void> {
  if (isFetching) return;
  isFetching = true;
  notify();
  try {
    const response = await apiFetch(`${BACKEND_URL}/get-users/`);
    const data = await response.json();
    const live = Array.isArray(data?.top_100_users) ? data.top_100_users : [];

    if (data?.error || live.length === 0) {
      cache = { leaders: FALLBACK_LEADERS, isFallback: true, userRank: null, numberUsers: null, userKey, fetchedAt: Date.now() };
    } else {
      cache = {
        leaders: live.map((u: { username: string; points: number }, i: number) => ({
          rank: i + 1,
          name: u.username,
          points: u.points,
        })),
        isFallback: false,
        userRank: typeof data?.user_rank === "number" ? data.user_rank : null,
        numberUsers: typeof data?.number_users === "number" ? data.number_users : null,
        userKey,
        fetchedAt: Date.now(),
      };
    }
  } catch (err) {
    console.error("Failed to load leaderboard:", err);
    cache = { leaders: FALLBACK_LEADERS, isFallback: true, userRank: null, numberUsers: null, userKey, fetchedAt: Date.now() };
  } finally {
    isFetching = false;
    notify();
  }
}

/**
 * Loads the leaderboard from /get-users/, falling back to the design's dummy
 * players whenever the backend is unreachable or returns nothing. The signed-in
 * player's row uses live data; a signed-out visitor sees the illustrative self
 * row. Results are cached client-side and auto-refresh every 5 minutes.
 */
export function useLeaderboard(): LeaderboardData {
  const { user } = useSelector((state: RootState) => state.user);
  const userKey = user?.username ?? null;

  const [, forceRender] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  // Re-render this consumer whenever the shared cache changes.
  useEffect(() => {
    const cb = () => forceRender((n) => n + 1);
    subscribers.add(cb);
    return () => { subscribers.delete(cb); };
  }, []);

  // Initial load (or refetch when the signed-in user changes or data is stale).
  useEffect(() => {
    const stale = !cache || cache.userKey !== userKey || Date.now() - cache.fetchedAt >= LEADERBOARD_TTL_MS;
    if (stale) fetchBoard(userKey);
  }, [userKey]);

  // Tick: keep relative-time labels live and auto-refresh once data is stale.
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now());
      if (!cache || Date.now() - cache.fetchedAt >= LEADERBOARD_TTL_MS) fetchBoard(userKey);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [userKey]);

  const refresh = useCallback(() => { fetchBoard(userKey); }, [userKey]);

  const self: SelfRow = user
    ? {
        rank: cache?.userRank ?? (Number(user.rank) || FALLBACK_SELF.rank),
        name: user.username,
        points: user.points,
        total: cache?.numberUsers ?? FALLBACK_SELF.total,
      }
    : FALLBACK_SELF;

  return {
    loading: !cache,
    refreshing: isFetching && !!cache,
    isFallback: cache?.isFallback ?? false,
    leaders: cache?.leaders ?? FALLBACK_LEADERS,
    self,
    lastUpdated: cache?.fetchedAt ?? null,
    now,
    refresh,
  };
}
