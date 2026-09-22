import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../utils/Api";
import { BACKEND_URL } from "../configurations/backend";

export interface FriendUser {
  id: string;
  username: string;
  points: number;
  rank: string;
  /** Always null in list rows — the bytes only travel inline in /me/. */
  profile_photo: string | null;
  /** 0 = no photo; otherwise the cache key for friendPhotoUrl(). Bumped by every upload. */
  photo_version: number;
}

export interface FriendRequestRow extends FriendUser {
  request_id: number;
}

export type SearchRelationship = "friend" | "pending_outgoing" | "pending_incoming" | "none";

export interface FriendSearchResult extends FriendUser {
  relationship: SearchRelationship;
  request_id: number | null;
}

interface FriendsState {
  incoming: FriendRequestRow[];
  outgoing: FriendRequestRow[];
  blocked: FriendUser[];
  loading: boolean;
  error: string | null;
}

const EMPTY: FriendsState = { incoming: [], outgoing: [], blocked: [], loading: true, error: null };

export interface FriendsPage {
  results: FriendUser[];
  total: number;
}

/** The cacheable photo URL for a list row, or null when the player has no photo.
 * The version is part of the URL, so the browser keeps a hit for a year and a
 * re-upload (new version) is simply a new URL — no per-row byte loads, no
 * invalidation. `version > 0` is also false for undefined, so a backend that
 * predates the field just yields initials. */
export function friendPhotoUrl(id: string, version: number): string | null {
  return version > 0 ? `${BACKEND_URL}/users/${encodeURIComponent(id)}/photo/?v=${version}` : null;
}

async function postAction(path: string, body: Record<string, unknown>): Promise<void> {
  const res = await apiFetch(`${BACKEND_URL}/${path}/`, { method: "POST", body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || "Something went wrong.");
}

/** Live user search for the "Find" tab — not part of the shared state below,
 * since results are transient and shouldn't linger once you stop typing. */
export async function searchUsers(q: string): Promise<FriendSearchResult[]> {
  const res = await apiFetch(`${BACKEND_URL}/search-users/?q=${encodeURIComponent(q)}`);
  const data = await res.json().catch(() => ({}));
  return Array.isArray(data.results) ? data.results : [];
}

/** One page of the caller's own friends, optionally filtered by name/ID —
 * server-paginated so a large friend list is never fetched in one shot. */
export async function searchFriends(q: string, limit: number, offset: number): Promise<FriendsPage> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (q) params.set("q", q);
  const res = await apiFetch(`${BACKEND_URL}/search-friends/?${params.toString()}`);
  const data = await res.json().catch(() => ({}));
  return {
    results: Array.isArray(data.results) ? data.results : [],
    total: typeof data.total === "number" ? data.total : 0,
  };
}

/** Pending requests (both directions) and blocked players for the signed-in
 * account. Fetched fresh each time a consumer mounts — this data is only
 * ever viewed inside the Friends modal, so there's no case for the always-on
 * shared cache the leaderboard uses. The friend list itself is paginated
 * separately via `searchFriends`, not held here. */
export function useFriends() {
  const [state, setState] = useState<FriendsState>(EMPTY);
  // Only the very first load should blank the view with a spinner — every
  // later refresh (after accepting/blocking/etc.) updates the lists quietly,
  // so the modal never unmounts its tabs mid-action (that was wiping out
  // whatever was typed in the Find tab's search box on every single click).
  const hasLoadedOnce = useRef(false);

  const refresh = useCallback(async () => {
    const firstLoad = !hasLoadedOnce.current;
    setState((s) => ({ ...s, loading: firstLoad, error: firstLoad ? null : s.error }));
    try {
      const res = await apiFetch(`${BACKEND_URL}/friends-overview/`);
      const data = await res.json().catch(() => ({}));
      hasLoadedOnce.current = true;
      if (!res.ok || data.error) {
        // Only a failed FIRST load blanks the view — a refresh after an
        // action that fails just leaves the last-known lists on screen.
        if (firstLoad) setState({ ...EMPTY, loading: false, error: data.error || "Could not load your friends." });
        else setState((s) => ({ ...s, loading: false }));
        return;
      }
      setState({
        incoming: data.incoming_requests ?? [],
        outgoing: data.outgoing_requests ?? [],
        blocked: data.blocked_users ?? [],
        loading: false,
        error: null,
      });
    } catch {
      hasLoadedOnce.current = true;
      if (firstLoad) setState((s) => ({ ...s, loading: false, error: "Could not reach the server." }));
      else setState((s) => ({ ...s, loading: false }));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const sendRequest = useCallback(async (publicId: string) => {
    await postAction("send-friend-request", { public_id: publicId });
    await refresh();
  }, [refresh]);

  const acceptRequest = useCallback(async (requestId: number) => {
    await postAction("accept-friend-request", { request_id: requestId });
    await refresh();
  }, [refresh]);

  const declineRequest = useCallback(async (requestId: number) => {
    await postAction("decline-friend-request", { request_id: requestId });
    await refresh();
  }, [refresh]);

  const cancelRequest = useCallback(async (requestId: number) => {
    await postAction("cancel-friend-request", { request_id: requestId });
    await refresh();
  }, [refresh]);

  const removeFriend = useCallback(async (publicId: string) => {
    await postAction("remove-friend", { public_id: publicId });
    await refresh();
  }, [refresh]);

  const blockUser = useCallback(async (publicId: string) => {
    await postAction("block-user", { public_id: publicId });
    await refresh();
  }, [refresh]);

  const unblockUser = useCallback(async (publicId: string) => {
    await postAction("unblock-user", { public_id: publicId });
    await refresh();
  }, [refresh]);

  return {
    ...state,
    refresh,
    sendRequest,
    acceptRequest,
    declineRequest,
    cancelRequest,
    removeFriend,
    blockUser,
    unblockUser,
  };
}
