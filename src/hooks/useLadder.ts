import { useCallback, useEffect, useState } from "react";
import { useSelector } from "react-redux";
import type { RootState } from "../store";
import { apiFetch } from "../utils/Api";
import { BACKEND_URL } from "../configurations/backend";
import type { LadderData } from "../utils/ladder";

/** The ladder changes slowly (the backend caches it for 10 min); match that here. */
export const LADDER_TTL_MS = 10 * 60 * 1000;

interface CacheEntry { data: LadderData | null; error: boolean; userKey: string | null; fetchedAt: number }

// One module-level cache shared by every consumer (the modal can open from three places).
let cache: CacheEntry | null = null;
let fetching = false;
const subscribers = new Set<() => void>();
const notify = () => subscribers.forEach((fn) => fn());

async function fetchLadder(userKey: string | null): Promise<void> {
  if (fetching) return;
  fetching = true;
  notify();
  try {
    const res = await apiFetch(`${BACKEND_URL}/ranks/ladder/`);
    const body = await res.json();
    cache = body?.error || !Array.isArray(body?.ladder)
      ? { data: null, error: true, userKey, fetchedAt: Date.now() }
      : { data: body as LadderData, error: false, userKey, fetchedAt: Date.now() };
  } catch (err) {
    console.error("Failed to load the ladder:", err);
    cache = { data: null, error: true, userKey, fetchedAt: Date.now() };
  } finally {
    fetching = false;
    notify();
  }
}

/** Loads GET /ranks/ladder/ once per 10 minutes (or when the signed-in user changes) and shares it. */
export function useLadder(): { loading: boolean; error: boolean; data: LadderData | null; refresh: () => void } {
  const { user } = useSelector((state: RootState) => state.user);
  const userKey = user?.id ?? null;
  const [, force] = useState(0);

  useEffect(() => {
    const cb = () => force((n) => n + 1);
    subscribers.add(cb);
    return () => { subscribers.delete(cb); };
  }, []);

  useEffect(() => {
    const stale = !cache || cache.userKey !== userKey || Date.now() - cache.fetchedAt >= LADDER_TTL_MS;
    if (stale) fetchLadder(userKey);
  }, [userKey]);

  const refresh = useCallback(() => { fetchLadder(userKey); }, [userKey]);
  return { loading: !cache || (fetching && !cache.data), error: cache?.error ?? false, data: cache?.data ?? null, refresh };
}
