// HTTP for Logic Check: one guarded fetch (node's fetch) and the persona-aware `api` built on it.
//   guard: every request to a remote origin (not localhost) is counted; anything but GET/HEAD to one is refused before
//          it leaves the machine (`live-write`, same rule as ui-check --live's guardLive) — in every env: a local suite
//          has no business writing anywhere but localhost, and the live suite is GET-only.
//   api.call(persona, method, path, body?) → { status, ok, json, text, headers, ms, totalMs, url }
//          path relative to the API base (`/login/` → <base>/login/); persona 'guest' sends no token, a role
//          (logic.actor | logic.peer | logic.admin) a token minted for its test user (accounts.mjs, local sqlite only).
//   api.get(url, opts?) / api.fetch(url, { method, body, headers, token, redirect, timeoutMs }) for absolute URLs.
// `ms` is the time to the response headers (a TTFB as seen from this machine), `totalMs` to the end of the body.
import { isRemote } from '../../ui-check/lib/fixtures.mjs';

const READ_METHODS = new Set(['GET', 'HEAD']);

/** → { read, write, writes: [{ method, url }], listeners: Set<fn(write)>, allow(method, url) → boolean } */
export function createGuard() {
  const g = { read: 0, write: 0, writes: [], listeners: new Set() };
  g.allow = (method, url) => {
    if (!isRemote(url)) return true;
    if (READ_METHODS.has(method)) { g.read++; return true; }
    const w = { method, url };
    g.write++;
    g.writes.push(w);
    for (const fn of g.listeners) fn(w);
    return false;
  };
  return g;
}

/**
 * The api object of one test. `base`: the API base (…/api, no trailing slash); `guard`: createGuard(); `tokenFor(persona)`
 * → an access token (async), or null for 'guest'.
 */
export function makeApi({ base, guard, tokenFor = async () => null, env = 'local' }) {
  async function request(url, { method = 'GET', body, headers = {}, token = null, redirect = 'follow', timeoutMs = 20_000 } = {}) {
    method = String(method).toUpperCase();
    if (!guard.allow(method, url)) {
      throw new Error(`logic-check: ${method} ${String(url).split('?')[0]} refused — ${env === 'live' ? 'the live site is GET/HEAD only' : 'no writes to a remote origin'}`);
    }
    const h = { accept: 'application/json, */*', ...headers };
    if (body !== undefined && !('content-type' in h)) h['content-type'] = 'application/json';
    if (token) h.authorization = `Bearer ${token}`;
    const t0 = performance.now();
    const res = await fetch(url, { method, headers: h, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)), redirect, signal: AbortSignal.timeout(timeoutMs) });
    const ms = Math.round(performance.now() - t0);
    const text = method === 'HEAD' ? '' : await res.text();
    const totalMs = Math.round(performance.now() - t0);
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    return { status: res.status, ok: res.ok, json, text, headers: Object.fromEntries(res.headers), ms, totalMs, url };
  }
  return {
    base,
    env,
    async call(persona, method, p, body) {
      const token = persona && persona !== 'guest' ? await tokenFor(persona) : null;
      return request(`${base}${p.startsWith('/') ? '' : '/'}${p}`, { method, body, token });
    },
    get: (url, opts = {}) => request(url, { ...opts, method: 'GET' }),
    fetch: request,
  };
}
