// multiplayer_server/src/auth.js
//
// Proves who a socket is. The browser sends its Django access token with `identify`;
// we ask the backend's /me/ endpoint who that token belongs to, so signature checks,
// expiry, blacklisting and disabled accounts stay decided in one place (Django) and no
// signing secret ever lives on this host. The user object the backend returns — not
// anything the client claims — becomes the player's identity, name and points.

const DEFAULT_TTL_MS = 30000; // reuse a verdict briefly so reconnect storms don't hammer Django
const MAX_CACHE = 5000;
const TIMEOUT_MS = 5000;

/** `API_BASE_URL` is the backend root, with or without the trailing `/api`. */
function meUrlFrom(apiBaseUrl) {
  const base = String(apiBaseUrl || "").replace(/\/+$/, "").replace(/\/api$/, "");
  return `${base}/api/me/`;
}

/**
 * @returns {(token: string) => Promise<{ok: true, user: object} | {ok: false, reason: "invalid"|"unavailable"}>}
 *   "invalid"     — the backend rejected the token (bad, expired, revoked): the client should
 *                   refresh its session and identify again.
 *   "unavailable" — the backend couldn't be reached or erred: nothing is known about the token.
 */
function createVerifier({ apiBaseUrl, fetchImpl = globalThis.fetch, ttlMs = DEFAULT_TTL_MS, now = Date.now } = {}) {
  const url = meUrlFrom(apiBaseUrl);
  const cache = new Map(); // token -> { user, until }

  return async function verify(token) {
    if (typeof token !== "string" || token.length < 20 || token.length > 4096) {
      return { ok: false, reason: "invalid" };
    }

    const hit = cache.get(token);
    if (hit && hit.until > now()) return { ok: true, user: hit.user };
    cache.delete(token);

    let res;
    try {
      res = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      return { ok: false, reason: "unavailable" };
    }
    if (res.status === 401 || res.status === 403) return { ok: false, reason: "invalid" };
    if (!res.ok) return { ok: false, reason: "unavailable" };

    let user;
    try {
      user = (await res.json())?.user;
    } catch {
      return { ok: false, reason: "unavailable" };
    }
    if (!user?.id) return { ok: false, reason: "unavailable" };

    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value); // oldest first
    cache.set(token, { user, until: now() + ttlMs });
    return { ok: true, user };
  };
}

module.exports = { createVerifier, meUrlFrom };
