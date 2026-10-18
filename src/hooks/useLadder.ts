import { useCallback, useEffect, useState } from "react";
import { useSelector } from "react-redux";
import type { RootState } from "../store";
import { apiFetch } from "../utils/Api";
import { BACKEND_URL } from "../configurations/backend";
import { ladderCacheFresh, type LadderData } from "../utils/ladder";

/** The ladder changes slowly (the backend caches it for 10 min); match that here. */
export const LADDER_TTL_MS = 10 * 60 * 1000;
/** A failed load is retried sooner than a good one goes stale. */
export const LADDER_ERROR_TTL_MS = 30 * 1000;

interface CacheEntry { data: LadderData | null; error: boolean; unavailable?: boolean; userKey: string | null; fetchedAt: number }

// One module-level cache shared by every consumer (the modal can open from three places).
let cache: CacheEntry | null = null;
let fetching = false;
// The identity most recently asked for: a request that lands while another fetch is in flight is
// fetched right after it instead of being dropped.
let latestKey: string | null = null;
const subscribers = new Set<() => void>();
const notify = () => subscribers.forEach((fn) => fn());

async function fetchLadder(userKey: string | null): Promise<void> {
  latestKey = userKey;
  if (fetching) return;
  fetching = true;
  notify();
  try {
    const res = await apiFetch(`${BACKEND_URL}/ranks/ladder/`);
    if (res.status === 404) {
      // An older backend without the endpoint (the dev site talks to the production backend until it is promoted).
      cache = { data: null, error: true, unavailable: true, userKey, fetchedAt: Date.now() };
      return;
    }
    const body = await res.json();
    cache = body?.error || !Array.isArray(body?.ladder)
      ? { data: null, error: true, userKey, fetchedAt: Date.now() }
      : { data: body as LadderData, error: false, userKey, fetchedAt: Date.now() };
  } catch (err) {
    console.error("Failed to load the ladder:", err);
    cache = { data: null, error: true, userKey, fetchedAt: Date.now() };
  } finally {
    fetching = false;
    if (latestKey !== userKey) fetchLadder(latestKey);
    else notify();
  }
}

/** Loads GET /ranks/ladder/ once per 10 minutes, or as soon as the signed-in user, their points or their
 *  rank change, and shares it. A ladder fetched for another identity is never returned. */
export function useLadder(): { loading: boolean; error: boolean; unavailable: boolean; data: LadderData | null; refresh: () => void } {
  const { user } = useSelector((state: RootState) => state.user);
  // A game or a rank-up changes the `you` block; the backend's distribution is cached, so a refetch is cheap.
  const userKey = user ? `${user.id}:${user.points}:${user.rank}` : null;
  const [, force] = useState(0);

  useEffect(() => {
    const cb = () => force((n) => n + 1);
    subscribers.add(cb);
    return () => { subscribers.delete(cb); };
  }, []);

  useEffect(() => {
    if (!ladderCacheFresh(cache, userKey, Date.now(), LADDER_TTL_MS, LADDER_ERROR_TTL_MS)) fetchLadder(userKey);
  }, [userKey]);

  const refresh = useCallback(() => { fetchLadder(userKey); }, [userKey]);
  const mine = cache && cache.userKey === userKey ? cache : null;
  return { loading: !mine || (fetching && !mine.data), error: mine?.error ?? false, unavailable: mine?.unavailable ?? false, data: mine?.data ?? null, refresh };
}
