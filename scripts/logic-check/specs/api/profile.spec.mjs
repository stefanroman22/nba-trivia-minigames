// Logic Check — profile suite, API (spec §5 profile row): each profile change persists and is enforced. Username change
// (valid / bad characters / too long / too short), the photo upload with no age set (no age gate since 2026-10-26.2:
// any signed-in player may upload), the removed age route and a legacy teen's photo, photo removal, the data export, and
// account deletion's two gates.
// LC-PROFILE-01/02 change logic.actor (testuser4) and put it back in `finally` (name, photo, age unknown); the sweep's
// logic scope is the fallback (names, photos and ages of testuser4/5/6). -03..-06 each use their own minted `lgc`
// throwaway, deleted in `finally` (the lgc sweep as the last resort).
// Budget: account-data is 10/hour PER ACCOUNT (authenticated throttles key by user, not address); testuser4 spends none.
// The export, the removal flow and the deletes spend the throwaways' own buckets. friend-action: one send by -05's throwaway.
import { test } from '../../lib/fixtures.mjs';
import { ROLES, credentials, forgetAge, mintTokens, seedLegacyTeen } from '../../../check-core/lib/accounts.mjs';
import { attempt, deleteAccount, get, login, post, said, throwawayName } from '../../lib/auth.mjs';

const ACTOR = ROLES['logic.actor'];
const PEER = ROLES['logic.peer'];
const USERNAME_RULES = 'Username must be 3-20 characters using letters, numbers or underscores.'; // views.py
const LOGIN_FAILED = 'Incorrect email, username or password.';
// What the removed age route (users/urls.py account/age/, gone 2026-10-26.2) used to take.
const TEEN = { birth_month: 1, birth_year: new Date().getFullYear() - 14 };
// /me/ fields that went with the age rules (views.py user_payload): none may come back.
const AGE_FIELDS = ['age_group', 'birth_month', 'birth_year', 'age_sets_left'];
// A valid 1x1 PNG (Pillow opens it; the backend normalises it to a 256x256 JPEG).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const errorOf = (r) => (r && r.json && typeof r.json.error === 'string' ? r.json.error : null);
const photoOf = (r) => (r && r.json && r.json.user ? r.json.user.profile_photo : undefined);

/** Multipart photo upload as `token` (api.fetch sends JSON only); local origin, still asked of the guard. */
async function uploadPhoto(api, guard, token) {
  const url = `${api.base}/update-profile/`;
  if (!guard.allow('POST', url)) throw new Error(`logic-check: POST ${url} refused by the guard`);
  const fd = new FormData();
  fd.append('profile_photo', new Blob([PNG], { type: 'image/png' }), 'lc-check.png');
  const res = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, body: fd, signal: AbortSignal.timeout(20_000) });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  return { status: res.status, ok: res.ok, json, text };
}

const me = (api, token) => attempt(get(api, '/me/', { token }));

/** One expected answer: status (+ exact error); a mismatch is a violation of `rule`. → the response */
async function expectAnswer(lc, rule, r, { route, selector, status, error }) {
  const expected = `HTTP ${status}${error ? ` "${error}"` : ''}`;
  if (r.status !== status) lc.violation(r.status >= 500 ? 'server-error' : rule, { route, selector, measured: said(r), expected });
  else if (error && errorOf(r) !== error) lc.violation(rule, { route, selector, measured: said(r), expected });
  return r;
}

/** Delete a throwaway this check minted (username + delete); a failure is a `cleanup` violation (the lgc sweep catches it). */
async function dropThrowaway(api, lc, t, name) {
  const d = await attempt(deleteAccount(api, { access: t.access, password: credentials(name).password }));
  if (d.status !== 200) lc.violation('cleanup', { route: '/api/account/delete/', selector: `delete throwaway ${name}`, measured: said(d), expected: 'HTTP 200 (else the teardown sweep removes it)' });
}

test('[LC-PROFILE-01] username change: valid → 200 and /me/ shows it; bad characters, too long, too short → 400 USERNAME_RULES and the name is unchanged', async ({ api, lc }) => {
  const route = '/api/update-profile/';
  const t = (await mintTokens([ACTOR]))[ACTOR]; // the mint also puts testuser4's name back
  const fresh = `lcProfile${String(Date.now()).slice(-4)}`;
  let renamed = false;
  try {
    for (const [label, name] of [['bad characters', 'lc bad!'], ['hyphen', 'lc-actor'], ['too long (21)', 'a'.repeat(21)], ['too short (2)', 'ab']]) {
      await test.step(`${label} "${name}" → 400`, async () => {
        const r = await attempt(post(api, '/update-profile/', { username: name }, { token: t.access }));
        await expectAnswer(lc, 'username', r, { route, selector: `POST /api/update-profile/ ${label}`, status: 400, error: USERNAME_RULES });
        const m = await me(api, t.access);
        const now = m.json && m.json.user && m.json.user.username;
        if (now !== ACTOR) lc.violation('username', { route: '/api/me/', selector: `username after the ${label} attempt`, measured: JSON.stringify(now), expected: `${ACTOR} (unchanged)` });
      });
    }
    await test.step(`valid "${fresh}" → 200 and /me/ shows it`, async () => {
      const ok = await attempt(post(api, '/check-name/', { username: fresh }));
      if (!ok.json || ok.json.ok !== true) { lc.violation('setup', { route: '/api/check-name/', selector: `check-name ${fresh}`, measured: said(ok), expected: '{ "ok": true } (a name moderation allows; never rename into a strike)' }); return; }
      const r = await attempt(post(api, '/update-profile/', { username: fresh }, { token: t.access }));
      if (r.status === 200) renamed = true;
      if (r.status !== 200 || !r.json || r.json.status !== 'success') { lc.violation(r.status >= 500 ? 'server-error' : 'username', { route, selector: `POST /api/update-profile/ ${fresh}`, measured: said(r), expected: '200 {"status": "success"}' }); return; }
      const m = await me(api, t.access);
      const now = m.json && m.json.user && m.json.user.username;
      if (now !== fresh) lc.violation('username', { route: '/api/me/', selector: 'username after the change', measured: JSON.stringify(now), expected: fresh });
    });
  } finally {
    if (renamed) {
      const back = await attempt(post(api, '/update-profile/', { username: ACTOR }, { token: t.access }));
      const m = await me(api, t.access);
      const now = m.json && m.json.user && m.json.user.username;
      if (back.status !== 200 || now !== ACTOR) lc.violation('cleanup', { route, selector: `restore username ${ACTOR}`, measured: `${said(back)}; /me/ ${JSON.stringify(now)}`, expected: `200 and /me/ ${ACTOR} (else the sweep restores it)` });
    }
  }
  await lc.done();
});

/** A successful upload answer and /me/ carry the same normalised photo; a mismatch is a `photo` violation. */
async function expectPhotoSaved(api, lc, r, token, selector) {
  const route = '/api/update-profile/';
  if (r.status !== 200 || !r.json || r.json.status !== 'success') { lc.violation(r.status >= 500 ? 'server-error' : 'photo', { route, selector, measured: said(r), expected: '200 {"status": "success", user} (no age gate since 2026-10-26.2: no 428 age_required, no 403 for a teen)' }); return; }
  const m = await me(api, token);
  const p = photoOf(m);
  if (typeof p !== 'string' || !p.startsWith('data:image/jpeg;base64,')) lc.violation('photo', { route: '/api/me/', selector: `profile_photo after the upload (${selector})`, measured: JSON.stringify(p === undefined ? said(m) : p).slice(0, 60), expected: 'a data:image/jpeg;base64,… URL (the normalised photo)' });
  if (photoOf(r) !== p) lc.violation('photo', { route, selector: `user.profile_photo in the upload answer (${selector})`, measured: 'differs from /me/', expected: 'the same photo as /me/' });
}

test('[LC-PROFILE-02] photo upload with no age set → 200 and /me/ has the photo (no age gate: no 428 age_required)', async ({ api, guard, lc }) => {
  const route = '/api/update-profile/';
  await forgetAge([ACTOR]); // the state that once answered 428 age_required
  const t = (await mintTokens([ACTOR]))[ACTOR];
  try {
    await test.step('start without a photo', async () => {
      const r = await attempt(post(api, '/account/remove-photo/', {}, { token: t.access }));
      if (r.status !== 200 || photoOf(r) !== null) lc.violation('setup', { route: '/api/account/remove-photo/', selector: 'remove any photo first', measured: said(r), expected: '200 with profile_photo null' });
    });
    await test.step('upload with no age set → 200 and /me/ carries the photo', async () => {
      const r = await attempt(uploadPhoto(api, guard, t.access));
      if (r.status === 428 || (r.json && r.json.code === 'age_required')) { lc.violation('photo-age-gate', { route, selector: 'multipart upload, no age set', measured: said(r), expected: '200: the age gate is gone (owner decision, 2026-10-26.2); a 428 age_required means it was restored' }); return; }
      await expectPhotoSaved(api, lc, r, t.access, 'no age set');
    });
  } finally {
    const r = await attempt(post(api, '/account/remove-photo/', {}, { token: t.access }));
    if (r.status !== 200 || photoOf(r) !== null) lc.violation('cleanup', { route: '/api/account/remove-photo/', selector: `remove ${ACTOR}'s photo`, measured: said(r), expected: '200 with profile_photo null (else the sweep drops it)' });
    await forgetAge([ACTOR]).catch((e) => lc.violation('cleanup', { route: '/api/me/', selector: `forget ${ACTOR}'s age`, measured: String(e.message).split('\n')[0], expected: 'age unknown again (else the sweep resets it)' }));
  }
  await lc.done();
});

test('[LC-PROFILE-03] no age rules: POST /account/age/ → 404 (route gone); a legacy teen account has is_teen false, no age fields on /me/, and its upload → 200', async ({ api, guard, lc }) => {
  const name = throwawayName(60);
  const t = (await mintTokens([name]))[name]; // a fresh lgc account
  try {
    await seedLegacyTeen([name]); // the age columns an earlier 14-year-old's account still carries
    await test.step('POST /account/age/ (a teen\'s birth date) → 404, the route is gone', async () => {
      const r = await attempt(post(api, '/account/age/', TEEN, { token: t.access }));
      if (r.status !== 404) lc.violation(r.status >= 500 ? 'server-error' : 'age-route', { route: '/api/account/age/', selector: `POST /api/account/age/ ${JSON.stringify(TEEN)}`, measured: said(r), expected: 'HTTP 404 (users/urls.py has no account/age/ since 2026-10-26.2)' });
    });
    await test.step('/me/ of the legacy teen: is_teen false, no age fields', async () => {
      const m = await me(api, t.access);
      const u = m.json && m.json.user;
      if (m.status !== 200 || !u) { lc.violation('me', { route: '/api/me/', selector: `GET /api/me/ as ${name}`, measured: said(m), expected: '200 { user }' }); return; }
      if (u.is_teen !== false) lc.violation('is-teen', { route: '/api/me/', selector: 'user.is_teen (age_group "teen" in the database)', measured: JSON.stringify(u.is_teen), expected: 'false (always, views.py user_payload: no age rules)' });
      const back = AGE_FIELDS.filter((k) => k in u);
      if (back.length) lc.violation('is-teen', { route: '/api/me/', selector: 'user payload age fields', measured: back.map((k) => `${k} ${JSON.stringify(u[k])}`).join(', '), expected: `none of ${AGE_FIELDS.join(', ')} (dropped with the age rules)` });
    });
    await test.step('the legacy teen uploads a photo → 200 (no 403 teen refusal)', async () => {
      const r = await attempt(uploadPhoto(api, guard, t.access));
      if (r.status === 403) { lc.violation('photo-age-gate', { route: '/api/update-profile/', selector: 'multipart upload, legacy teen', measured: said(r), expected: '200: any signed-in player may upload (a 403 means the teen refusal was restored)' }); return; }
      await expectPhotoSaved(api, lc, r, t.access, 'legacy teen');
    });
  } finally {
    await dropThrowaway(api, lc, t, name);
  }
  await lc.done();
});

test('[LC-PROFILE-04] remove photo: an account with a photo → POST /account/remove-photo/ 200; /me/ photo null and the public photo URL 404', async ({ api, guard, lc }) => {
  const name = throwawayName(61);
  const t = (await mintTokens([name]))[name];
  try {
    let ready = false;
    await test.step('setup: photo uploaded', async () => {
      const u = await attempt(uploadPhoto(api, guard, t.access));
      if (u.status !== 200 || typeof photoOf(u) !== 'string') { lc.violation('setup', { route: '/api/update-profile/', selector: 'upload', measured: `upload ${said(u)}`, expected: '200 with a photo' }); return; }
      const pub = await attempt(api.get(`${api.base}/users/${encodeURIComponent(t.user.id)}/photo/`));
      if (pub.status !== 200) lc.violation('photo', { route: '/api/users/<id>/photo/', selector: 'public photo before removal', measured: said(pub), expected: 'HTTP 200' });
      ready = true;
    });
    if (ready) {
      await test.step('remove → 200; /me/ photo null; public photo 404', async () => {
        const r = await attempt(post(api, '/account/remove-photo/', {}, { token: t.access }));
        if (r.status !== 200 || photoOf(r) !== null) lc.violation(r.status >= 500 ? 'server-error' : 'photo-remove', { route: '/api/account/remove-photo/', selector: 'POST /api/account/remove-photo/', measured: said(r), expected: '200 { user.profile_photo: null }' });
        const m = await me(api, t.access);
        if (photoOf(m) !== null) lc.violation('photo-remove', { route: '/api/me/', selector: 'profile_photo after removal', measured: String(photoOf(m)).slice(0, 40), expected: 'null' });
        const pub = await attempt(api.get(`${api.base}/users/${encodeURIComponent(t.user.id)}/photo/`));
        if (pub.status !== 404) lc.violation('photo-remove', { route: '/api/users/<id>/photo/', selector: 'public photo after removal', measured: said(pub), expected: 'HTTP 404 (version 0 = no photo)' });
      });
    }
  } finally {
    await dropThrowaway(api, lc, t, name);
  }
  await lc.done();
});

test('[LC-PROFILE-05] export: GET /account/export/ is a JSON attachment with the account\'s own username and email; another player appears only as id + username, never their email', async ({ api, lc }) => {
  const route = '/api/account/export/';
  const name = throwawayName(62);
  const t = (await mintTokens([name]))[name];
  const peer = (await mintTokens([PEER]))[PEER].user;
  try {
    await test.step(`setup: ${name} sends ${PEER} a friend request (another player in the export)`, async () => {
      const r = await attempt(post(api, '/send-friend-request/', { public_id: peer.id }, { token: t.access }));
      if (r.status !== 201) lc.violation('setup', { route: '/api/send-friend-request/', selector: `${name} → ${PEER}`, measured: said(r), expected: 'HTTP 201' });
    });
    await test.step('export → 200 attachment with this account\'s data only', async () => {
      const r = await attempt(get(api, '/account/export/', { token: t.access }));
      if (r.status !== 200 || !r.json || !r.json.account) { lc.violation(r.status >= 500 ? 'server-error' : 'export', { route, selector: 'GET /api/account/export/', measured: said(r), expected: '200 JSON { account, … }' }); return; }
      const cd = (r.headers && r.headers['content-disposition']) || '';
      if (!/attachment/i.test(cd)) lc.violation('export', { route, selector: 'Content-Disposition', measured: JSON.stringify(cd), expected: 'attachment; filename=…' });
      const a = r.json.account;
      if (a.username !== name || a.email !== t.user.email || a.id !== t.user.id) lc.violation('export', { route, selector: 'account', measured: `${a.id} ${a.username} <${a.email}>`, expected: `${t.user.id} ${name} <${t.user.email}>` });
      const sent = r.json.friend_requests_sent || [];
      const row = sent.find((x) => x.id === peer.id);
      if (!row || row.username !== PEER) lc.violation('export', { route, selector: 'friend_requests_sent', measured: JSON.stringify(sent).slice(0, 120), expected: `a row { id: ${peer.id}, username: ${PEER} }` });
      const emails = [...new Set((r.text.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) || []).map((e) => e.toLowerCase()))];
      const others = emails.filter((e) => e !== t.user.email.toLowerCase());
      if (others.length) lc.violation('export-leak', { route, selector: 'emails in the export', measured: others.join(', '), expected: `only ${t.user.email}` });
      if (r.text.includes(peer.email)) lc.violation('export-leak', { route, selector: `${PEER}'s email`, measured: 'present', expected: 'absent' });
    });
  } finally {
    await dropThrowaway(api, lc, t, name); // cascades the request
  }
  await lc.done();
});

test('[LC-PROFILE-06] delete: wrong username → 400, no "delete" → 400, both → 200 deleted (no password); afterwards login → 401 and the token → 401', async ({ api, lc }) => {
  const route = '/api/account/delete/';
  const name = throwawayName(63);
  const { password } = credentials(name);
  const t = (await mintTokens([name]))[name];
  const username = t.user.username;
  let deleted = false;
  try {
    await test.step('wrong username + delete → 400, account kept', async () => {
      const r = await attempt(post(api, '/account/delete/', { confirm_username: `${username}x`, confirm_text: 'delete' }, { token: t.access }));
      await expectAnswer(lc, 'delete', r, { route, selector: 'wrong username', status: 400, error: 'Type your username exactly as it appears to confirm.' });
      if (r.status === 200) deleted = true;
    });
    if (!deleted) {
      await test.step('right username, no "delete" → 400, account kept', async () => {
        const r = await attempt(post(api, '/account/delete/', { confirm_username: username }, { token: t.access }));
        await expectAnswer(lc, 'delete', r, { route, selector: 'confirm missing', status: 400, error: 'Type delete to confirm.' });
        if (r.status === 200) deleted = true;
        const m = await me(api, t.access);
        if (!deleted && m.status !== 200) lc.violation('delete', { route: '/api/me/', selector: 'the account after two refused deletes', measured: said(m), expected: 'HTTP 200 (still there)' });
      });
    }
    if (!deleted) {
      await test.step('username + "DELETE" (any case), no password → 200 {"status": "deleted"}', async () => {
        const r = await attempt(post(api, '/account/delete/', { confirm_username: username, confirm_text: 'DELETE' }, { token: t.access }));
        if (r.status === 200) deleted = true;
        if (r.status !== 200 || !r.json || r.json.status !== 'deleted') lc.violation(r.status >= 500 ? 'server-error' : 'delete', { route, selector: 'username + delete', measured: said(r), expected: '200 {"status": "deleted"}' });
      });
    }
    if (deleted) {
      await test.step('afterwards: login → 401, the access token → 401', async () => {
        const l = await attempt(login(api, t.user.email, password));
        if (l.status !== 401 || errorOf(l) !== LOGIN_FAILED) lc.violation('delete', { route: '/api/login/', selector: `login ${t.user.email} after delete`, measured: said(l), expected: `HTTP 401 "${LOGIN_FAILED}"` });
        const m = await me(api, t.access);
        if (m.status !== 401) lc.violation('delete', { route: '/api/me/', selector: '/me/ with the deleted account\'s token', measured: said(m), expected: 'HTTP 401' });
      });
    }
  } finally {
    if (!deleted) await dropThrowaway(api, lc, t, name);
  }
  await lc.done();
});
