// Seen tracking, account side (question factory spec §4.4): the browser set lives in utils/seenCore.ts
// (re-exported here); this module syncs it with GET/POST /trivia/seen/ for signed-in players.
// Single-player only (MiniGame): online rooms deal one shared question and are not tracked.
import { BACKEND_ORIGIN } from "../configurations/backend";
import { apiFetch, getAccessToken } from "./Api";
import { SEEN_BATCH, SEEN_GAMES, pendingGames, requeueSeen, syncSeen, takePending } from "./seenCore";

export { loadSeen, markSeen, pruneSeen } from "./seenCore";

// The backend refuses a whole batch with an empty, over-long or NUL-carrying id (trivia.views._seen_key).
const sendable = (id: string) => id !== "" && id.length <= 60 && !id.includes("\0");

function hasToken(): boolean {
  try {
    return !!getAccessToken();
  } catch {
    return false;
  }
}

/**
 * At a game start, merge the account's seen set for `game` into the browser set: one GET per game
 * per page load, and never more than 1.5 s of waiting (a slow answer merges in the background for
 * the next game; a failure leaves the browser set alone). Guests and untracked games return at once.
 */
export function syncSeenFromServer(game: string): Promise<void> {
  if (!SEEN_GAMES.has(game) || !hasToken()) return Promise.resolve();
  return syncSeen(game, async () => {
    const res = await apiFetch(`${BACKEND_ORIGIN}/trivia/seen/${encodeURIComponent(game)}/`);
    if (!res.ok) throw new Error(`seen ${res.status}`);
    const body = (await res.json()) as { qids?: unknown };
    if (!Array.isArray(body.qids)) throw new Error("seen: no qids");
    return body.qids.filter((q): q is string => typeof q === "string");
  });
}

/**
 * Send the ids of `game` shown since the last flush, in batches of 200, with keepalive so a flush on
 * pagehide outlives the page. Called at game end and on pagehide, never per round. A batch that fails
 * on the network or the server is queued again for the next flush; guests send nothing.
 */
export function flushSeenToServer(game: string): void {
  const ids = takePending(game).filter(sendable);
  if (!ids.length || !hasToken()) return;
  for (let i = 0; i < ids.length; i += SEEN_BATCH) {
    const batch = ids.slice(i, i + SEEN_BATCH);
    apiFetch(`${BACKEND_ORIGIN}/trivia/seen/`, {
      method: "POST",
      body: JSON.stringify({ game, qids: batch }),
      keepalive: true,
    })
      .then((res) => {
        if (res.status === 429 || res.status >= 500) requeueSeen(game, batch);
      })
      .catch(() => requeueSeen(game, batch));
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    for (const game of pendingGames()) flushSeenToServer(game);
  });
}
