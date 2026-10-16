// HTTP helpers of the auth and signup suites (on the api fixture's guarded fetch).
//   clientIp()   a fresh simulated client address per call (10.<a>.<b>.<n>, a/b random per process). Sent as
//                X-Forwarded-For: DRF's throttles key an anonymous caller by that header when NUM_PROXIES is unset
//                (backend/backend/settings.py sets none), and users.strikes hashes its first hop. So every signup /
//                login case gets its own throttle bucket: the checks never spend the machine's real 10/h signup or
//                30/h login budget (UI check's sign-up flow runs on the same stack), and never see a 429 they did not
//                ask for. A 429 anyway means the backend stopped trusting the header: the case reports `throttled`.
//   post / get   → api.fetch's result ({ status, ok, json, text, headers, ms }) with that header and an optional token
//   throwawayName(i)   `lgc<12 digits of this process's start ms><i, 2 digits>` (17 chars; the sweep's lgc<digits>)
//   deleteAccount      POST /account/delete/ { password, confirm: 'DELETE' } as the account
//   login              POST /login/ { id, password }
import { randomInt } from 'node:crypto';

const A = randomInt(1, 255);
let B = randomInt(0, 255);
let n = 0;
/** A fresh simulated client address (see the header). */
export function clientIp() {
  if (++n > 254) { n = 1; B = (B + 1) % 256; }
  return `10.${A}.${B}.${n}`;
}

const STAMP = String(Date.now()).slice(-12);
/** Throwaway username for slot i (0..99): lgc + 12 digits + 2 digits. */
export const throwawayName = (i) => `lgc${STAMP}${String(i).padStart(2, '0')}`;

const url = (api, p) => `${api.base}${p.startsWith('/') ? '' : '/'}${p}`;

/** POST JSON to an API path as a fresh simulated client (or `ip`), optionally with a bearer token. */
export const post = (api, p, body, { token = null, ip = clientIp() } = {}) =>
  api.fetch(url(api, p), { method: 'POST', body: body ?? {}, token, headers: { 'x-forwarded-for': ip } });

/** GET an API path, optionally with a bearer token. */
export const get = (api, p, { token = null, ip = clientIp() } = {}) =>
  api.fetch(url(api, p), { method: 'GET', token, headers: { 'x-forwarded-for': ip } });

export const login = (api, id, password, opts) => post(api, '/login/', { id, password }, opts);

export const deleteAccount = (api, { access, password }, opts) =>
  post(api, '/account/delete/', { password, confirm: 'DELETE' }, { ...opts, token: access });

/** One-line HTTP summary of a response for a violation's `measured`. */
export const said = (r) => {
  if (!r) return 'no response';
  if (r.error) return String(r.error.message || r.error).split('\n')[0].slice(0, 120);
  const j = r.json;
  const what = j && typeof j === 'object' ? (j.error || j.detail || j.code || '') : String(r.text || '').replace(/\s+/g, ' ').slice(0, 80);
  return `HTTP ${r.status}${what ? ` "${String(what).slice(0, 110)}"` : ''}`;
};

/** await a request; a thrown network error comes back as { error }. */
export const attempt = (p) => p.catch((error) => ({ error, status: 0, json: null }));

/**
 * Remove an account a check created (its signup answer `created` carries tokens): delete as it, else log in by
 * `email` + `password` first. → true when gone (the delete answered 200), false otherwise.
 */
export async function removeAccount(api, { access, email, password }) {
  let token = access;
  if (!token && email) {
    const l = await attempt(login(api, email, password));
    token = l.json && l.json.access;
  }
  if (!token) return false;
  const d = await attempt(deleteAccount(api, { access: token, password }));
  return d.status === 200;
}
