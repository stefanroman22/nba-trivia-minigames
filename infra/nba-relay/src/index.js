/**
 * Relays GET /stats/<endpoint>?<query> to https://stats.nba.com/stats/<endpoint>?<query>
 * for the monthly data refresh, which runs on GitHub-hosted runners that
 * stats.nba.com refuses. nba_api sends its own browser headers (STATS_HEADERS);
 * they are forwarded as sent, minus Host and the relay's own key header.
 *
 * Secret: RELAY_KEY — shared with GitHub secret NBA_RELAY_KEY. Every /stats
 * request must carry it in X-Relay-Key. Set with:
 *   npx wrangler@4 secret put RELAY_KEY   (from infra/nba-relay)
 * Unset secret = every /stats request is refused, so a misdeploy fails closed.
 */
const UPSTREAM = "https://stats.nba.com/stats/";
const TIMEOUT_MS = 25_000;
const ENDPOINT = /^\/stats\/([a-z0-9]+)$/;

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// Hash both sides first so timingSafeEqual always gets equal-length inputs and
// the comparison time reveals nothing about the key.
async function keyMatches(given, expected) {
  if (!given || !expected) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(given)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

function upstreamHeaders(incoming) {
  const headers = new Headers();
  for (const [name, value] of incoming) {
    const n = name.toLowerCase();
    if (n === "host" || n === "x-relay-key") continue;
    if (n.startsWith("cf-") || n.startsWith("x-forwarded-") || n === "x-real-ip") continue;
    headers.set(name, value);
  }
  return headers;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health" && request.method === "GET") {
      return json(200, { ok: true });
    }

    const match = ENDPOINT.exec(url.pathname);
    if (!match) return json(404, { error: "not found" });
    if (request.method !== "GET") return json(405, { error: "method not allowed" });

    if (!(await keyMatches(request.headers.get("X-Relay-Key"), env.RELAY_KEY))) {
      return json(401, { error: "unauthorized" });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const upstream = await fetch(UPSTREAM + match[1] + url.search, {
        method: "GET",
        headers: upstreamHeaders(request.headers),
        signal: controller.signal,
      });
      // Buffer inside the timeout so a stalled body also ends in a 504.
      const body = await upstream.arrayBuffer();
      const headers = { "Cache-Control": "no-store" };
      const type = upstream.headers.get("Content-Type");
      if (type) headers["Content-Type"] = type;
      return new Response(body, { status: upstream.status, headers });
    } catch (err) {
      if (controller.signal.aborted) return json(504, { error: "upstream timeout" });
      return json(502, { error: "upstream fetch failed", detail: String(err).slice(0, 200) });
    } finally {
      clearTimeout(timer);
    }
  },
};
