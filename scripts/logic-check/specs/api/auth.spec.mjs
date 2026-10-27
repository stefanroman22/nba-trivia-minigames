// Logic Check — auth suite, API (spec §5 auth row): login by username and by email (empty / wrong / unknown /
// correct → exact status + message), /me/, refresh rotation + blacklist, logout, the throttles' configuration, Google
// sign-in with a bad code, and a token whose account is gone. Reads as logic.actor (testuser4, minted tokens); the
// one destructive case (LC-AUTH-08) uses its own lgc throwaway. Every request goes out as its own simulated client
// (lib/auth.mjs clientIp → X-Forwarded-For), so the 30/h login and 60/h refresh buckets of this machine are untouched.
import { test } from '../../lib/fixtures.mjs';
import { ACCOUNTS, ROLES, credentials, mintTokens } from '../../../check-core/lib/accounts.mjs';
import { readApp } from '../../lib/matrix.mjs';
import { attempt, deleteAccount, get, login, post, said, throwawayName } from '../../lib/auth.mjs';

const LOGIN_FAILED = 'Incorrect email, username or password.'; // views.py LOGIN_FAILED (no account enumeration)
const REQUIRED = 'Email/username and password are required.';
const ACTOR = ROLES['logic.actor'];
const actor = () => ({ ...ACCOUNTS[ACTOR], password: credentials(ACTOR).password });
const errorOf = (r) => (r && r.json && typeof r.json.error === 'string' ? r.json.error : null);

/** One login case: exact status and, for a failure, the exact error message. */
async function loginCase(api, lc, label, id, password, { status, error, user }) {
  await test.step(`${label} → ${status}`, async () => {
    const r = await attempt(login(api, id, password));
    const selector = `POST /api/login/ ${label}`;
    const expected = `HTTP ${status}${error ? ` "${error}"` : ''}`;
    if (r.status !== status) { lc.violation(r.status >= 500 ? 'server-error' : 'login', { route: '/api/login/', selector, measured: said(r), expected }); return; }
    if (error && errorOf(r) !== error) lc.violation('login', { route: '/api/login/', selector, measured: said(r), expected });
    if (user) {
      const u = r.json && r.json.user;
      if (!r.json || !r.json.access || !r.json.refresh) lc.violation('login', { route: '/api/login/', selector, measured: 'no access/refresh in the answer', expected: '200 { access, refresh, user }' });
      if (!u || u.username !== user.username || u.email !== user.email) lc.violation('login', { route: '/api/login/', selector: `${selector} user`, measured: u ? `${u.username} <${u.email}>` : 'no user', expected: `${user.username} <${user.email}>` });
    }
  });
}

test('[LC-AUTH-01] login by username: empty, wrong password, unknown name, correct, Name#ID → exact status and message', async ({ api, lc }) => {
  const a = actor();
  await loginCase(api, lc, 'empty id and password', '', '', { status: 400, error: REQUIRED });
  await loginCase(api, lc, 'username, empty password', a.username, '', { status: 400, error: REQUIRED });
  await loginCase(api, lc, 'username, wrong password', a.username, `${a.password}x`, { status: 401, error: LOGIN_FAILED });
  await loginCase(api, lc, 'unknown username', 'lcnosuchplayer01', a.password, { status: 401, error: LOGIN_FAILED });
  await loginCase(api, lc, 'username, correct password', a.username, a.password, { status: 200, user: a });
  await loginCase(api, lc, 'username in other case', a.username.toUpperCase(), a.password, { status: 200, user: a });
  const me = (await mintTokens([ACTOR]))[ACTOR].user;
  await loginCase(api, lc, 'Name#ID', `${a.username}#${me.id}`, a.password, { status: 200, user: a });
  await loginCase(api, lc, 'Name#wrong ID', `${a.username}#ZZZZZZ`, a.password, { status: 401, error: LOGIN_FAILED });
  await lc.done();
});

test('[LC-AUTH-02] login by email: empty, wrong password, unknown email, correct, other case → exact status and message', async ({ api, lc }) => {
  const a = actor();
  await loginCase(api, lc, 'email, empty password', a.email, '', { status: 400, error: REQUIRED });
  await loginCase(api, lc, 'email, wrong password', a.email, `${a.password}x`, { status: 401, error: LOGIN_FAILED });
  await loginCase(api, lc, 'unknown email', 'lc-nobody@uicheck.test', a.password, { status: 401, error: LOGIN_FAILED });
  await loginCase(api, lc, 'email, correct password', a.email, a.password, { status: 200, user: a });
  await loginCase(api, lc, 'email in upper case', a.email.toUpperCase(), a.password, { status: 200, user: a });
  await lc.done();
});

test('[LC-AUTH-03] /me/ returns the minted user; no token or a bad token → 401', async ({ api, lc }) => {
  const minted = (await mintTokens([ACTOR]))[ACTOR];
  const route = '/api/me/';
  await test.step('with the token → the same user', async () => {
    const r = await attempt(get(api, '/me/', { token: minted.access }));
    const u = r.json && r.json.user;
    if (r.status !== 200 || !u) { lc.violation('me', { route, selector: 'GET /api/me/', measured: said(r), expected: '200 { user }' }); return; }
    for (const k of ['id', 'username', 'email', 'points', 'rank', 'is_admin', 'is_teen']) {
      if (JSON.stringify(u[k]) !== JSON.stringify(minted.user[k])) lc.violation('me', { route, selector: `user.${k}`, measured: JSON.stringify(u[k]), expected: `${JSON.stringify(minted.user[k])} (the minted user)` });
    }
    if (u.username !== ACTOR) lc.violation('me', { route, selector: 'user.username', measured: u.username, expected: ACTOR });
    // No age rules since 2026-10-26.2: is_teen is always false and the age fields left the payload.
    if (u.is_teen !== false) lc.violation('me', { route, selector: 'user.is_teen', measured: JSON.stringify(u.is_teen), expected: 'false (always: no age rules)' });
    const ageFields = ['age_group', 'birth_month', 'birth_year', 'age_sets_left'].filter((k) => k in u);
    if (ageFields.length) lc.violation('me', { route, selector: 'user payload age fields', measured: ageFields.join(', '), expected: 'none (dropped with the age rules)' });
  });
  await test.step('no token → 401', async () => {
    const r = await attempt(get(api, '/me/'));
    if (r.status !== 401) lc.violation('me', { route, selector: 'GET /api/me/ without a token', measured: said(r), expected: 'HTTP 401' });
  });
  await test.step('a tampered token → 401', async () => {
    const parts = minted.access.split('.');
    const bad = `${parts[0]}.${parts[1]}.${parts[2].slice(0, -4)}AAAA`;
    const r = await attempt(get(api, '/me/', { token: bad }));
    if (r.status !== 401) lc.violation('me', { route, selector: 'GET /api/me/ with a tampered signature', measured: said(r), expected: 'HTTP 401' });
  });
  await lc.done();
});

test('[LC-AUTH-04] token refresh rotates the refresh token and blacklists the old one', async ({ api, lc }) => {
  const route = '/api/token/refresh/';
  const r1 = (await mintTokens([ACTOR]))[ACTOR].refresh;
  let r2 = null, access2 = null;
  await test.step('refresh → 200 with a new access and a new refresh token', async () => {
    const r = await attempt(post(api, '/token/refresh/', { refresh: r1 }));
    if (r.status !== 200 || !r.json || !r.json.access || !r.json.refresh) { lc.violation('refresh', { route, selector: 'POST /api/token/refresh/ (R1)', measured: said(r), expected: '200 { access, refresh }' }); return; }
    r2 = r.json.refresh; access2 = r.json.access;
    if (r2 === r1) lc.violation('refresh', { route, selector: 'refresh token', measured: 'the same token came back', expected: 'a rotated refresh token (ROTATE_REFRESH_TOKENS)' });
    if (!r.json.user || r.json.user.username !== ACTOR) lc.violation('refresh', { route, selector: 'user', measured: JSON.stringify(r.json.user && r.json.user.username), expected: `${ACTOR} (users.tokens hands back the /me/ payload)` });
  });
  await test.step('the old refresh token again → 401 (blacklisted)', async () => {
    const r = await attempt(post(api, '/token/refresh/', { refresh: r1 }));
    if (r.status !== 401) lc.violation('refresh-reuse', { route, selector: 'POST /api/token/refresh/ (R1 again)', measured: said(r), expected: 'HTTP 401 (BLACKLIST_AFTER_ROTATION)' });
  });
  if (r2) {
    await test.step('the rotated refresh token → 200; the new access token works', async () => {
      const r = await attempt(post(api, '/token/refresh/', { refresh: r2 }));
      if (r.status !== 200) lc.violation('refresh', { route, selector: 'POST /api/token/refresh/ (R2)', measured: said(r), expected: 'HTTP 200' });
      const me = await attempt(get(api, '/me/', { token: access2 }));
      if (me.status !== 200) lc.violation('refresh', { route: '/api/me/', selector: 'GET /api/me/ with the refreshed access token', measured: said(me), expected: 'HTTP 200' });
    });
  }
  await test.step('garbage refresh token → 401', async () => {
    const r = await attempt(post(api, '/token/refresh/', { refresh: 'not-a-token' }));
    if (r.status !== 401) lc.violation('refresh', { route, selector: 'POST /api/token/refresh/ (garbage)', measured: said(r), expected: 'HTTP 401' });
  });
  await lc.done();
});

test('[LC-AUTH-05] logout blacklists the refresh token: it can no longer refresh or log out again', async ({ api, lc }) => {
  const route = '/api/logout/';
  const refresh = (await mintTokens([ACTOR]))[ACTOR].refresh;
  await test.step('logout → 200', async () => {
    const r = await attempt(post(api, '/logout/', { refresh }));
    if (r.status !== 200 || !r.json || r.json.status !== 'success') lc.violation('logout', { route, selector: 'POST /api/logout/', measured: said(r), expected: '200 {"status": "success"}' });
  });
  await test.step('refresh with the logged-out token → 401', async () => {
    const r = await attempt(post(api, '/token/refresh/', { refresh }));
    if (r.status !== 401) lc.violation('logout', { route: '/api/token/refresh/', selector: 'POST /api/token/refresh/ after logout', measured: said(r), expected: 'HTTP 401 (blacklisted)' });
  });
  await test.step('logout again with it → 400', async () => {
    const r = await attempt(post(api, '/logout/', { refresh }));
    if (r.status !== 400 || errorOf(r) !== 'Invalid or expired refresh token') lc.violation('logout', { route, selector: 'POST /api/logout/ (same token)', measured: said(r), expected: 'HTTP 400 "Invalid or expired refresh token"' });
  });
  await test.step('logout without a token → 400', async () => {
    const r = await attempt(post(api, '/logout/', {}));
    if (r.status !== 400 || errorOf(r) !== 'Refresh token required') lc.violation('logout', { route, selector: 'POST /api/logout/ {}', measured: said(r), expected: 'HTTP 400 "Refresh token required"' });
  });
  await lc.done();
});

// AUTH_CONSTRAINTS.md AUTH-9: the per-view throttles and their rates.
const THROTTLES = [
  { view: 'login_view', file: 'views', cls: 'LoginRateThrottle', scope: 'auth-login', rate: '30/hour' },
  { view: 'google_login', file: 'views', cls: 'LoginRateThrottle', scope: 'auth-login', rate: '30/hour' },
  { view: 'signup_view', file: 'views', cls: 'SignupRateThrottle', scope: 'auth-signup', rate: '10/hour' },
  { view: 'SessionRefreshView', file: 'tokens', cls: 'RefreshRateThrottle', scope: 'auth-refresh', rate: '60/hour' },
];

test('[LC-AUTH-06] login, Google login, signup and refresh carry their throttles with the documented rates; a normal login is not throttled', async ({ api, lc }) => {
  const route = '/api/login/';
  const src = { views: readApp('backend/users/views.py') || '', tokens: readApp('backend/users/tokens.py') || '' };
  const throttles = readApp('backend/backend/throttles.py') || '';
  const settings = readApp('backend/backend/settings.py') || '';
  const v = (selector, measured, expected) => lc.violation('throttle-config', { route, selector, measured, expected });
  for (const t of THROTTLES) {
    await test.step(`${t.view}: ${t.cls} (${t.scope} ${t.rate})`, async () => {
      const applied = t.file === 'tokens'
        ? new RegExp(`class ${t.view}\\b[\\s\\S]*?throttle_classes\\s*=\\s*\\[([^\\]]*)\\]`).exec(src.tokens)
        : new RegExp(`@throttle_classes\\(\\[([^\\]]*)\\]\\)\\s*\\n(?:@[^\\n]*\\n)*def ${t.view}\\(`).exec(src.views);
      if (!applied || !applied[1].split(',').map((s) => s.trim()).includes(t.cls)) v(`${t.view} throttle_classes`, applied ? `[${applied[1]}]` : 'none', t.cls);
      const scope = new RegExp(`class ${t.cls}\\((\\w+)\\):[\\s\\S]*?scope\\s*=\\s*"([^"]+)"`).exec(throttles);
      if (!scope || scope[2] !== t.scope) v(`${t.cls}.scope`, scope ? scope[2] : 'class not found', t.scope);
      else if (scope[1] !== 'UserRateThrottle') v(`${t.cls} base`, scope[1], 'UserRateThrottle (per account, per IP for guests)');
      const rate = new RegExp(`"${t.scope}"\\s*:\\s*"([^"]+)"`).exec(settings);
      if (!rate || rate[1] !== t.rate) v(`DEFAULT_THROTTLE_RATES["${t.scope}"]`, rate ? rate[1] : 'missing', `${t.rate} (AUTH-9)`);
    });
  }
  await test.step('a correct login answers 200, no 429 / Retry-After', async () => {
    const a = actor();
    const r = await attempt(login(api, a.email, a.password));
    if (r.status !== 200) v('POST /api/login/', said(r), 'HTTP 200');
    const h = r.headers || {};
    if (h['retry-after']) v('Retry-After', h['retry-after'], 'absent below the limit');
    // DRF sends no rate headers below the limit (Retry-After only with a 429): the limits are proven by configuration.
    const rateHeaders = Object.keys(h).filter((k) => /ratelimit|retry-after/i.test(k));
    lc.metric('rate headers on a 200 login', rateHeaders.length, { unit: '', route, kind: 'data' });
  });
  await lc.done();
});

test('[LC-AUTH-07] Google login is one step: a bad code, no code, a non-string code → 400 with an error, never 5xx; an older client\'s consent token or tick-box fields are ignored (no 428 consent step)', async ({ api, lc }) => {
  const route = '/api/login/google/';
  // Since 2026-10-26.2 the code is the only input (views.py google_login): `consent_token`, `accepted_terms`,
  // `age_confirmed` and birth fields from an older client change nothing, and no answer asks for a second step.
  const cases = [
    { label: 'bad code', body: { code: 'lc-check-not-a-real-code' }, status: 400 },
    { label: 'bad code with an older client\'s tick-box fields', body: { code: 'lc-check-not-a-real-code', accepted_terms: true, age_confirmed: true, birth_month: 1, birth_year: new Date().getFullYear() - 5 }, status: 400 },
    { label: 'no code', body: {}, status: 400, error: 'Missing code' },
    { label: 'code not a string', body: { code: 12345 }, status: 400, error: 'Missing code' },
    { label: 'an older client\'s consent token, no code', body: { consent_token: 'lc-forged', accepted_terms: true, age_confirmed: true }, status: 400, error: 'Missing code' },
    { label: 'consent token alone', body: { consent_token: 'lc-forged' }, status: 400, error: 'Missing code' },
  ];
  for (const c of cases) {
    await test.step(`${c.label} → ${c.status}`, async () => {
      const r = await attempt(post(api, '/login/google/', c.body));
      const selector = `POST /api/login/google/ ${c.label}`;
      if (r.status >= 500 || r.status === 0) { lc.violation('server-error', { route, selector, measured: said(r), expected: `HTTP ${c.status} (4xx, never 5xx)` }); return; }
      if (r.status === 428 || (r.json && (r.json.consent_token || r.json.code === 'needs_signup_consent' || r.json.code === 'consent_required'))) {
        lc.violation('google-consent-step', { route, selector, measured: said(r), expected: `HTTP ${c.status}: Google sign-in is one step (no 428 needs_signup_consent, no consent_token, no consent_required since 2026-10-26.2)` });
        return;
      }
      if (r.status !== c.status) lc.violation('google', { route, selector, measured: said(r), expected: `HTTP ${c.status}` });
      else if (c.error && errorOf(r) !== c.error) lc.violation('google', { route, selector, measured: said(r), expected: `"${c.error}"` });
      else if (c.code && (!r.json || r.json.code !== c.code)) lc.violation('google', { route, selector, measured: said(r), expected: `code ${c.code}` });
      else if (!errorOf(r)) lc.violation('google', { route, selector, measured: said(r), expected: 'an "error" message the form can show' });
    });
  }
  await lc.done();
});

test('[LC-AUTH-08] tokens of a deleted account are refused: access → 401 on /me/, refresh → 401, login → 401', async ({ api, lc }) => {
  const name = throwawayName(80);
  const { password } = credentials(name);
  const t = (await mintTokens([name]))[name]; // a fresh lgc throwaway (local sqlite only), with the test password
  let deleted = false;
  try {
    await test.step('the throwaway works, then deletes itself → 200', async () => {
      const me = await attempt(get(api, '/me/', { token: t.access }));
      if (me.status !== 200) lc.violation('setup', { route: '/api/me/', selector: `GET /api/me/ as ${name}`, measured: said(me), expected: 'HTTP 200' });
      const d = await attempt(deleteAccount(api, { access: t.access, password }));
      if (d.status !== 200) lc.violation('delete', { route: '/api/account/delete/', selector: `POST /api/account/delete/ as ${name}`, measured: said(d), expected: 'HTTP 200' });
      else deleted = true;
    });
    if (deleted) {
      await test.step('its access token on /me/ → 401', async () => {
        const r = await attempt(get(api, '/me/', { token: t.access }));
        if (r.status !== 401) lc.violation(r.status >= 500 ? 'server-error' : 'deleted-token', { route: '/api/me/', selector: 'GET /api/me/ with a deleted account\'s access token', measured: said(r), expected: 'HTTP 401' });
      });
      await test.step('its refresh token → 401', async () => {
        const r = await attempt(post(api, '/token/refresh/', { refresh: t.refresh }));
        if (r.status !== 401) lc.violation(r.status >= 500 ? 'server-error' : 'deleted-token', { route: '/api/token/refresh/', selector: 'POST /api/token/refresh/ with a deleted account\'s refresh token', measured: said(r), expected: 'HTTP 401' });
      });
      await test.step('login → 401', async () => {
        const r = await attempt(login(api, t.user.email, password));
        if (r.status !== 401) lc.violation('deleted-token', { route: '/api/login/', selector: `POST /api/login/ ${t.user.email}`, measured: said(r), expected: 'HTTP 401' });
      });
    }
  } finally {
    if (!deleted) await attempt(deleteAccount(api, { access: t.access, password })); // the teardown's lgc sweep is the fallback
  }
  await lc.done();
});
