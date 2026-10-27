// Helpers shared by the account specs (specs/account/*.spec.mjs). Locators live in pagemap/account.json
// (+ guest.json for the modal shell, common.json for nav and drawer); this file holds behaviour only:
// API calls as a minted user, throwaway users, in-page latency and nav samplers, submit counting.
import { expect } from '@playwright/test';
import { CORE } from './viewports.mjs';
import { L } from './pagemap.mjs';
import { mintTokens, credentials } from './accounts.mjs';
import { apiBase, drawerMode, openDrawer, recordFrames } from './guest.mjs';

export { apiBase, drawerMode, openDrawer };

export const THROTTLED = 'throttled endpoint — core viewports only';

/** Password hashing makes POST /signup/ and /login/ slow by design (/account/delete/ checked the password before 2026-10-19)
 *  (1-2 s here); their budgets are the explicit timings in AC-SIGNUP-02 / AC-LOGIN-01, not the generic 1 s slow-api rule. */
export const HASHING = [/^slow POST \S+\/api\/(signup|login|account\/delete)\/$/];

/** audit.motion with the step name added to every violation's note, so a digest line says what was running. */
export async function motionStep(audit, step, fn, opts) {
  const vs = await audit.motion(fn, opts);
  for (const v of vs) v.note = [v.note, `during: ${step}`].filter(Boolean).join(' · ');
  return vs;
}

/** Digits of the run id (`20261012-1926` -> `202610121926`). */
export const runDigits = () => String(process.env.UI_CHECK_RUN || '').replace(/\D/g, '') || String(Date.now()).slice(-10);

/**
 * Throwaway user name `uic<run digits><kind><core index>`: kind 1 = sign-up flow, 2 = delete-account flow.
 * Max 3 + 12 + 2 = 17 chars (the API allows 20).
 */
export function throwawayName(kind, vp) {
  const i = CORE.indexOf(vp.id) + 1;
  return `uic${runDigits()}${kind}${i || 9}`;
}
export const throwawayEmail = (name) => `${name}@uicheck.test`;

/** A request against the Django API as a user. -> { status, body } (never throws on a 4xx/5xx). */
export async function apiCall(request, token, method, p, data) {
  // The local sqlite DB answers 500 "database is locked" when parallel workers write at once; the failed write was
  // rolled back, so retrying a 5xx a couple of times is safe and keeps that harness noise out of the results.
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await request.fetch(`${apiBase()}/${p}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
      data: method === 'GET' ? undefined : (data ?? {}),
      failOnStatusCode: false,
    });
    const text = await res.text();
    let body = text;
    try { body = JSON.parse(text); } catch { /* not JSON */ }
    last = { status: res.status(), body };
    if (last.status < 500) break;
    await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
  }
  return last;
}

/** A fresh access token for a ui-check account. */
export async function tokenFor(username) {
  return (await mintTokens([username]))[username];
}

/** Delete a ui-check account through the API (cleanup). Returns the HTTP status (404/401 = already gone). */
export async function deleteAccountApi(request, username) {
  let t;
  try { t = await tokenFor(username); } catch { return 'no-account'; }
  // The username + delete confirm; the old password/DELETE fields ride along for a backend from before 2026-10-19.
  const r = await apiCall(request, t.access, 'POST', 'account/delete/', {
    confirm_username: t.user?.username ?? username, confirm_text: 'delete', password: credentials(username).password, confirm: 'DELETE',
  });
  return r.status;
}

/** Does the account still exist? (the mint op would re-create it, so ask the API with a login instead) */
export async function accountExists(request, usernameOrEmail, password) {
  const r = await apiCall(request, null, 'POST', 'login/', { id: usernameOrEmail, password });
  return r.status === 200;
}

/** Count requests to a URL pattern from now on. */
export function countRequests(page, re, method = 'POST') {
  const hits = [];
  page.on('request', (r) => { if (r.method() === method && re.test(r.url())) hits.push(r.url()); });
  return hits;
}

/** Nav state read from the page: is the avatar chip showing, is a Log in button showing. */
export function navState(page) {
  return page.evaluate(() => {
    const shown = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    const chip = [...document.querySelectorAll('nav.nav3 button.nav3-user')].find(shown);
    const login = [...document.querySelectorAll('nav.nav3 .nav3-right button')].find((b) => shown(b) && /^Log in$/.test(b.textContent.trim()));
    return { chip: chip ? chip.getAttribute('aria-label') : null, login: !!login };
  });
}

/** Wait for the signed-in chip (aria-label `<name> #<id>`), optionally for one name. */
export async function expectSignedIn(page, name) {
  const chip = L(page, 'common.navUserChip');
  await expect(chip).toBeVisible({ timeout: 15_000 });
  if (name) await expect(chip).toHaveAttribute('aria-label', new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} #`));
  return chip;
}

/** Init script (string): sample the nav on every frame from the first paint of each document. */
export const NAV_SAMPLER = `(() => {
  const log = (window.__navLog = { rows: [] });
  const shown = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const tick = () => {
    const nav = document.querySelector('nav.nav3');
    const chip = nav ? [...nav.querySelectorAll('button.nav3-user')].some(shown) : false;
    log.rows.push([performance.now(), !!nav, chip]);
    if (log.rows.length < 4000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();`;

/** Read the sampler: ms the nav was on screen without the signed-in chip, and when the chip first appeared. */
export function navFlash(page) {
  return page.evaluate(() => {
    const rows = (window.__navLog && window.__navLog.rows) || [];
    let flash = 0, firstNav = null, firstChip = null, returned = 0;
    for (let i = 0; i < rows.length; i++) {
      const [t, nav, chip] = rows[i];
      if (nav && firstNav === null) firstNav = t;
      if (chip && firstChip === null) firstChip = t;
      const dt = i + 1 < rows.length ? rows[i + 1][0] - t : 0;
      if (nav && !chip) { flash += dt; if (firstChip !== null) returned += dt; }
    }
    return { frames: rows.length, flash: Math.round(flash), toChip: firstNav !== null && firstChip !== null ? Math.round(firstChip - firstNav) : null, returned: Math.round(returned) };
  });
}

/**
 * Set a field the way typing does (native setter + input event, one render) and time, in the page,
 * until `predicate` (a JS expression string) is true on an animation frame. -> ms
 */
export async function typeLatency(page, selector, value, predicate) {
  return Math.round(await page.evaluate(({ selector, value, predicate }) => new Promise((resolve, reject) => {
    const input = document.querySelector(selector);
    if (!input) { reject(new Error(`typeLatency: no ${selector}`)); return; }
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    const test = new Function(`return (${predicate});`);
    const t0 = performance.now();
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const give = t0 + 8000;
    const check = () => {
      if (test()) resolve(performance.now() - t0);
      else if (performance.now() > give) reject(new Error(`typeLatency: "${predicate}" never true after typing into ${selector}`));
      else requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  }), { selector, value, predicate }));
}

/** The rules of a checklist: [{ state: 'ok'|'bad'|'pending', label }] (visible label text only). */
export function ruleStates(page, selector) {
  return page.evaluate((selector) => [...document.querySelectorAll(selector)].map((li) => {
    const c = li.cloneNode(true);
    c.querySelectorAll('.pw-sr, .pw-rule-icon').forEach((n) => n.remove());
    return { state: /is-(ok|bad|pending)/.exec(li.className)?.[1] || '?', label: c.textContent.replace(/\s+/g, ' ').trim() };
  }), selector);
}

/** Open the Sign up tab of the open login modal. */
export async function openSignupTab(page) {
  await L(page, 'guest.authTabSignup').click();
  await expect(L(page, 'guest.authTabSignup')).toHaveAttribute('aria-selected', 'true');
}

/** Fill the open sign-up form (there is no consent box: the terms are agreed by the text under the buttons). */
export async function fillSignup(page, { email, username, password }) {
  await L(page, 'account.signupEmail').fill(email);
  await L(page, 'account.signupUsername').fill(username);
  await L(page, 'account.password').fill(password);
}

/** Dismiss a sweetalert popup if one is showing (waits briefly for it). Returns its text or null. */
export async function dismissSwal(page, { wait = 4000 } = {}) {
  const popup = L(page, 'account.swalPopup');
  const seen = await popup.first().waitFor({ state: 'visible', timeout: wait }).then(() => true, () => false);
  if (!seen) return null;
  const text = (await popup.first().innerText()).replace(/\s+/g, ' ').trim();
  await L(page, 'account.swalConfirm').click();
  await expect(popup).toHaveCount(0, { timeout: 5000 });
  return text;
}

/**
 * Run `trigger` (a tab click) while recording the tab thumb and the watched boxes: the thumb must end
 * at another x with at least one frame in between (a slide, not a jump), and `watch` boxes must not snap.
 */
export async function tabSlide(audit, label, thumbSelector, trigger, { watch, settleMs = 700, ignore } = {}) {
  const { page } = audit;
  const frames = await recordFrames(page, thumbSelector, async () => {
    await motionStep(audit, label, trigger, { watch, settleMs, ignore });
  }, { tail: 500 });
  const xs = frames.filter((f) => f.present).map((f) => f.x);
  if (!xs.length) { audit.violation('snap', { selector: thumbSelector, measured: `${label}: no thumb found`, expected: 'one .seg-thumb' }); return; }
  const from = xs[0], to = xs[xs.length - 1];
  const between = xs.filter((x) => x > Math.min(from, to) + 2 && x < Math.max(from, to) - 2).length;
  if (Math.abs(to - from) < 4) audit.violation('snap', { selector: thumbSelector, measured: `${label}: thumb moved ${Math.round(to - from)}px`, expected: 'the thumb moves to the chosen tab' });
  else if (between < 1) audit.violation('snap', { selector: thumbSelector, measured: `${label}: thumb jumped ${Math.round(from)} -> ${Math.round(to)}px, no frame in between`, expected: 'a slide' });
}

/** Friend-API cleanup as `token`: cancel/decline any request with `otherId`, and remove the friendship. */
export async function clearFriendship(request, token, otherId) {
  const o = await apiCall(request, token, 'GET', 'friends-overview/');
  const body = o.body || {};
  for (const r of body.outgoing_requests || []) if (r.id === otherId) await apiCall(request, token, 'POST', 'cancel-friend-request/', { request_id: r.request_id });
  for (const r of body.incoming_requests || []) if (r.id === otherId) await apiCall(request, token, 'POST', 'decline-friend-request/', { request_id: r.request_id });
  return apiCall(request, token, 'POST', 'remove-friend/', { public_id: otherId });
}

/** Is `otherId` in `token`'s friend list? */
export async function isFriend(request, token, otherId) {
  const r = await apiCall(request, token, 'GET', 'search-friends/?q=&limit=100&offset=0');
  return (r.body?.results || []).some((f) => f.id === otherId);
}

// --- cleanup that cannot be skipped -------------------------------------------------------------------
// Every restore mints a FRESH token (the test's own may be expired, rotated or revoked), checks the answer
// and records a `cleanup` violation when it is not what it should be. Each step runs on its own: a throw in one
// never skips the next. The suite-level sweep (lib/stack.teardown.mjs) catches whatever a crashed worker left.

/** Run one cleanup step; `fn` returns an HTTP status or { status }. A status outside `ok` (or a throw) is a `cleanup` violation. */
export async function cleanupStep(audit, label, fn, ok = [200, 201, 204]) {
  try {
    const r = await fn();
    const status = r && typeof r === 'object' ? r.status : r;
    audit.metrics.push({ kind: 'note', label: `cleanup: ${label}`, value: String(status), unit: '', route: audit.route });
    if (!ok.includes(status)) audit.violation('cleanup', { selector: label, measured: `HTTP ${status}`, expected: ok.join('/') });
  } catch (e) {
    audit.violation('cleanup', { selector: label, measured: `threw: ${String(e && e.message).split('\n')[0].slice(0, 140)}`, expected: 'the cleanup call succeeds' });
  }
}

/** Solo account back to its own name (minting restores it), verified with /me/. */
export function restoreUsername(audit, request, username) {
  return cleanupStep(audit, `restore username ${username}`, async () => {
    const t = await tokenFor(username); // the mint puts the username back
    const me = await apiCall(request, t.access, 'GET', 'me/');
    if (me.body?.user?.username !== username) return { status: `username is "${me.body?.user?.username}"` };
    return me.status;
  });
}

export function removePhoto(audit, request, username) {
  return cleanupStep(audit, `remove photo ${username}`, async () => apiCall(request, (await tokenFor(username)).access, 'POST', 'account/remove-photo/'));
}

/** testuser3-family <-> other: no friendship, no request (verified). */
export function clearFriendshipChecked(audit, request, username, otherId) {
  return cleanupStep(audit, `clear friendship ${username} <-> ${otherId}`, async () => {
    const t = await tokenFor(username);
    await clearFriendship(request, t.access, otherId);
    const o = await apiCall(request, t.access, 'GET', 'friends-overview/');
    const left = [...(o.body?.outgoing_requests || []), ...(o.body?.incoming_requests || [])].filter((r) => r.id === otherId).length;
    if (left || await isFriend(request, t.access, otherId)) return { status: 'friendship or request still there' };
    return 200;
  });
}

export function deleteThrowaway(audit, request, username) {
  return cleanupStep(audit, `delete throwaway ${username}`, async () => deleteAccountApi(request, username));
}
