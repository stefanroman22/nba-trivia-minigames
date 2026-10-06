// multiplayer_server/src/identity.js
//
// Who is this socket? The relay no longer trusts the client's `identify` payload (that let anyone
// claim any public id, banned accounts included). The client sends its Django access token; we ask
// Django's GET /api/me/ (the same BanAwareJWTAuthentication every API call goes through) and key the
// player by the SERVER's answer. Verdicts are cached per token for VERIFY_TTL_MS so a reconnect storm
// costs one round trip. Fails closed: if Django can't be reached, nobody is identified.
//
// Zero dependencies: Node >= 18's global fetch.

// Same base and default as gameEndpoints.js (the Django API).
const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:8000";
const VERIFY_TTL_MS = 60000;
const CACHE_MAX_KEYS = 10000;
const VERIFY_TIMEOUT_MS = 5000;

const _cache = new Map(); // token -> { at, verdict }

function prune(now) {
  if (_cache.size <= CACHE_MAX_KEYS) return;
  for (const [key, entry] of _cache) {
    if (now - entry.at >= VERIFY_TTL_MS) _cache.delete(key);
  }
  // Still over (all fresh): drop the oldest insertions.
  while (_cache.size > CACHE_MAX_KEYS) _cache.delete(_cache.keys().next().value);
}

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Verify a Django access token.
 * @returns {Promise<{ok: true, user: object} | {ok: false, code: "account_banned"|"invalid_token"|"auth_unavailable", message: string}>}
 */
async function verifyToken(token, { fetchImpl = globalThis.fetch, now = Date.now, apiBaseUrl = API_BASE_URL } = {}) {
  if (!token || typeof token !== "string") {
    return { ok: false, code: "invalid_token", message: "Sign in to play online." };
  }
  const t = now();
  const hit = _cache.get(token);
  if (hit && t - hit.at < VERIFY_TTL_MS) return hit.verdict;

  let verdict;
  try {
    const res = await fetchImpl(`${apiBaseUrl}/api/me/`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(VERIFY_TIMEOUT_MS) : undefined,
    });
    const body = await readJson(res);
    if (res.status === 200 && body?.user?.id) {
      verdict = { ok: true, user: body.user };
    } else if (res.status === 403 && body?.code === "account_banned") {
      verdict = { ok: false, code: "account_banned", message: body.error || "This account has been banned." };
    } else if (res.status >= 400 && res.status < 500) {
      verdict = { ok: false, code: "invalid_token", message: "Your session expired. Sign in again to play online." };
    } else {
      // 5xx: don't cache, the next attempt should ask again.
      return { ok: false, code: "auth_unavailable", message: "Can't verify your account right now. Please try again." };
    }
  } catch {
    return { ok: false, code: "auth_unavailable", message: "Can't verify your account right now. Please try again." };
  }
  _cache.set(token, { at: t, verdict });
  prune(t);
  return verdict;
}

module.exports = { verifyToken, VERIFY_TTL_MS, _cache };
