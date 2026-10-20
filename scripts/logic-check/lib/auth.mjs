// HTTP helpers of the auth and signup suites (on the api fixture's guarded fetch).
//   clientIp()   a fresh simulated client address per call (10.<a>.<b>.<n>, a/b random per process). Sent as
//                X-Forwarded-For: DRF's throttles key an anonymous caller by that header (the whole header while
//                NUM_PROXIES is unset, as backend/backend/settings.py has it; its last hop with NUM_PROXIES >= 1 —
//                ours, as the local stack has no proxy), and users.strikes hashes its first hop. So every signup /
//                login case gets its own throttle bucket: the checks never spend the machine's real 10/h signup or
//                30/h login budget (UI check's sign-up flow runs on the same stack), and never see a 429 they did not
//                ask for. Only NUM_PROXIES = 0 (REMOTE_ADDR only) breaks this: cases then report `throttled`.
//   post / get   → api.fetch's result ({ status, ok, json, text, headers, ms }) with that header and an optional token
//   throwawayName(i)   `lgc<12 digits of this process's start ms><i, 2 digits>` (17 chars; the sweep's lgc<digits>)
//   deleteAccount      POST /account/delete/ { confirm_username, confirm_text: 'delete' } as the account (+ the old
//                      password/DELETE fields for a backend from before 2026-10-19)
//   login              POST /login/ { id, password }
//   accountsCreated() / noteAccount(entry) / capReached()   the run's account ledger: <runDir>/signup-accounts.json,
//                one JSON object per line, appended (O_APPEND) by every check that created an account through
//                POST /signup/ (signup.spec and signup-ui.spec, any worker, any worker restart). ACCOUNT_CAP = 4 per run:
//                at the cap no check may send a sign-up that could create one.
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { randomInt } from 'node:crypto';
import { runDir } from '../../ui-check/lib/run-id.mjs';

const A = randomInt(1, 255);
let B = randomInt(0, 255);
let n = 0;
/** A fresh simulated client address (see the header). */
export function clientIp() {
  if (++n > 254) { n = 1; B = (B + 1) % 256; }
  return `10.${A}.${B}.${n}`;
}

export const ACCOUNT_CAP = 4;
const ledger = () => path.join(runDir(), 'signup-accounts.json');
/** Accounts created through POST /signup/ in this run (all workers). */
export function accountsCreated() {
  try { return readFileSync(ledger(), 'utf8').split('\n').filter((l) => l.trim()).length; } catch { return 0; }
}
/** Record one created account ({ check, username, email }) in the run's ledger (one append: one line). */
export function noteAccount(entry) {
  mkdirSync(runDir(), { recursive: true });
  appendFileSync(ledger(), `${JSON.stringify({ ...entry, at: new Date().toISOString() })}\n`, { flag: 'a' });
}
export const capReached = () => accountsCreated() >= ACCOUNT_CAP;

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

/** The account's own username (GET /me/), for the delete confirmation. */
export const ownUsername = async (api, access) => {
  const me = await attempt(get(api, '/me/', { token: access }));
  return (me.json && me.json.user && me.json.user.username) || '';
};

/** Confirms with the username + the word delete; the old password + DELETE fields ride along so the same call
 *  also works on a backend from before 2026-10-19 (the production backend until it is promoted). */
export const deleteAccount = async (api, { access, password, username }, opts) =>
  post(api, '/account/delete/', {
    confirm_username: username ?? await ownUsername(api, access), confirm_text: 'delete', password, confirm: 'DELETE',
  }, { ...opts, token: access });

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
