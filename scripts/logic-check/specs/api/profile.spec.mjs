// Logic Check — profile suite, API (spec §5 profile row): each profile change persists and is enforced. Username change
// (valid / bad characters / too long / too short), the photo flow (age unknown → 428 → age → upload → /me/ has the photo),
// a teen's upload refused, photo removal, the data export, and account deletion's two gates.
// LC-PROFILE-01/02 change logic.actor (testuser4) and put it back in `finally` (name, photo, age unknown); the sweep's
// logic scope is the fallback (names, photos and ages of testuser4/5/6). -03..-06 each use their own minted `lgc`
// throwaway, deleted in `finally` (the lgc sweep as the last resort).
// Budget: account-data is 10/hour PER ACCOUNT (authenticated throttles key by user, not address). testuser4 spends one
// (`POST /account/age/` in -02) per run; the export, the teen's age, the removal flow and the deletes spend the
// throwaways' own buckets. friend-action: one send by -05's throwaway.
import { test } from '../../lib/fixtures.mjs';
import { ROLES, credentials, forgetAge, mintTokens } from '../../../check-core/lib/accounts.mjs';
import { attempt, deleteAccount, get, login, post, said, throwawayName } from '../../lib/auth.mjs';

const ACTOR = ROLES['logic.actor'];
const PEER = ROLES['logic.peer'];
const USERNAME_RULES = 'Username must be 3-20 characters using letters, numbers or underscores.'; // views.py
const PHOTO_MIN_AGE = 16; // users/consent.py
const AGE_REQUIRED = `Profile photos are for players aged ${PHOTO_MIN_AGE} and over. Tell us your birth month and year first.`;
const TEEN_REFUSED = `Profile photos are available from age ${PHOTO_MIN_AGE}.`;
const AGE_KNOWN = 'Your age is already confirmed.'; // consent.set_age_from_birth_date
const LOGIN_FAILED = 'Incorrect email, username or password.';
const YEAR = new Date().getFullYear();
const ADULT = { birth_month: 1, birth_year: YEAR - 30 };
const TEEN = { birth_month: 1, birth_year: YEAR - 14 };
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

test('[LC-PROFILE-02] photo upload: age unknown → 428 age_required (nothing saved); POST /account/age/ adult → 200; upload → 200 and /me/ has the photo', async ({ api, guard, lc }) => {
  const route = '/api/update-profile/';
  await forgetAge([ACTOR]);
  const t = (await mintTokens([ACTOR]))[ACTOR];
  try {
    await test.step('start without a photo', async () => {
      const r = await attempt(post(api, '/account/remove-photo/', {}, { token: t.access }));
      if (r.status !== 200 || photoOf(r) !== null) lc.violation('setup', { route: '/api/account/remove-photo/', selector: 'remove any photo first', measured: said(r), expected: '200 with profile_photo null' });
    });
    await test.step('upload with the age unknown → 428 code age_required', async () => {
      const r = await attempt(uploadPhoto(api, guard, t.access));
      await expectAnswer(lc, 'photo-age', r, { route, selector: 'multipart upload, age unknown', status: 428, error: AGE_REQUIRED });
      if (r.status === 428 && (!r.json || r.json.code !== 'age_required')) lc.violation('photo-age', { route, selector: 'code', measured: JSON.stringify(r.json && r.json.code), expected: '"age_required" (the client opens the age prompt on it)' });
      const m = await me(api, t.access);
      if (photoOf(m) !== null) lc.violation('photo-age', { route: '/api/me/', selector: 'profile_photo after the 428', measured: String(photoOf(m)).slice(0, 40), expected: 'null (nothing saved)' });
    });
    await test.step('POST /account/age/ adult → 200, is_teen false', async () => {
      const r = await attempt(post(api, '/account/age/', ADULT, { token: t.access }));
      if (r.status !== 200 || !r.json || !r.json.user) { lc.violation(r.status >= 500 ? 'server-error' : 'photo-age', { route: '/api/account/age/', selector: `POST /api/account/age/ ${JSON.stringify(ADULT)}`, measured: said(r), expected: '200 { user }' }); return; }
      if (r.json.user.is_teen !== false) lc.violation('photo-age', { route: '/api/account/age/', selector: 'user.is_teen', measured: JSON.stringify(r.json.user.is_teen), expected: 'false (adult)' });
    });
    await test.step('upload again → 200 and /me/ carries the photo', async () => {
      const r = await attempt(uploadPhoto(api, guard, t.access));
      if (r.status !== 200 || !r.json || r.json.status !== 'success') { lc.violation(r.status >= 500 ? 'server-error' : 'photo', { route, selector: 'multipart upload, adult', measured: said(r), expected: '200 {"status": "success", user}' }); return; }
      const m = await me(api, t.access);
      const p = photoOf(m);
      if (typeof p !== 'string' || !p.startsWith('data:image/jpeg;base64,')) lc.violation('photo', { route: '/api/me/', selector: 'profile_photo after the upload', measured: JSON.stringify(p === undefined ? said(m) : p).slice(0, 60), expected: 'a data:image/jpeg;base64,… URL (the normalised photo)' });
      if (photoOf(r) !== p) lc.violation('photo', { route, selector: 'user.profile_photo in the upload answer', measured: 'differs from /me/', expected: 'the same photo as /me/' });
    });
  } finally {
    const r = await attempt(post(api, '/account/remove-photo/', {}, { token: t.access }));
    if (r.status !== 200 || photoOf(r) !== null) lc.violation('cleanup', { route: '/api/account/remove-photo/', selector: `remove ${ACTOR}'s photo`, measured: said(r), expected: '200 with profile_photo null (else the sweep drops it)' });
    await forgetAge([ACTOR]).catch((e) => lc.violation('cleanup', { route: '/api/account/age/', selector: `forget ${ACTOR}'s age`, measured: String(e.message).split('\n')[0], expected: 'age unknown again (else the sweep resets it)' }));
  }
  await lc.done();
});

test('[LC-PROFILE-03] teen: POST /account/age/ teen → 200 is_teen true; upload → 403; the age cannot be given again (409)', async ({ api, guard, lc }) => {
  const name = throwawayName(60);
  const t = (await mintTokens([name]))[name]; // a fresh lgc account, age unknown
  try {
    await test.step('POST /account/age/ teen → 200, is_teen true', async () => {
      const r = await attempt(post(api, '/account/age/', TEEN, { token: t.access }));
      if (r.status !== 200 || !r.json || !r.json.user) { lc.violation(r.status >= 500 ? 'server-error' : 'photo-age', { route: '/api/account/age/', selector: `POST /api/account/age/ ${JSON.stringify(TEEN)}`, measured: said(r), expected: '200 { user }' }); return; }
      if (r.json.user.is_teen !== true) lc.violation('photo-age', { route: '/api/account/age/', selector: 'user.is_teen', measured: JSON.stringify(r.json.user.is_teen), expected: 'true (teen)' });
    });
    await test.step('upload as a teen → 403, nothing saved', async () => {
      const r = await attempt(uploadPhoto(api, guard, t.access));
      await expectAnswer(lc, 'photo-teen', r, { route: '/api/update-profile/', selector: 'multipart upload, teen', status: 403, error: TEEN_REFUSED });
      const m = await me(api, t.access);
      if (photoOf(m) !== null) lc.violation('photo-teen', { route: '/api/me/', selector: 'profile_photo after the 403', measured: String(photoOf(m)).slice(0, 40), expected: 'null' });
    });
    await test.step('the teen gives an adult year → 409 (age set once)', async () => {
      const r = await attempt(post(api, '/account/age/', ADULT, { token: t.access }));
      await expectAnswer(lc, 'photo-teen', r, { route: '/api/account/age/', selector: 'POST /api/account/age/ adult after teen', status: 409, error: AGE_KNOWN });
    });
  } finally {
    await dropThrowaway(api, lc, t, name);
  }
  await lc.done();
});

test('[LC-PROFILE-04] remove photo: an adult with a photo → POST /account/remove-photo/ 200; /me/ photo null and the public photo URL 404', async ({ api, guard, lc }) => {
  const name = throwawayName(61);
  const t = (await mintTokens([name]))[name];
  try {
    let ready = false;
    await test.step('setup: adult, photo uploaded', async () => {
      const a = await attempt(post(api, '/account/age/', ADULT, { token: t.access }));
      const u = a.status === 200 ? await attempt(uploadPhoto(api, guard, t.access)) : null;
      if (!u || u.status !== 200 || typeof photoOf(u) !== 'string') { lc.violation('setup', { route: '/api/update-profile/', selector: 'adult + upload', measured: `age ${said(a)}; upload ${said(u)}`, expected: '200, 200 with a photo' }); return; }
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
