// Logic Check — signup suite, API (spec §5 signup row). The validation matrix (lib/matrix.mjs, derived from
// backend/users/views.py signup_view, consent.py, moderation_text.py, settings.py AUTH_PASSWORD_VALIDATORS and
// src/utils/passwordRules.ts) is posted case by case, each case a test.step: exact status + the backend's error
// message (and code). A case the backend ACCEPTS although the matrix expects a rejection is a `validation-gap`
// violation (the account it created is deleted at once), never an expected pass.
// Budget: ≤ 4 accounts created per run; POSTs are unthrottled locally via per-request X-Forwarded-For (lib/auth.mjs
// clientIp: the machine's real 10/h signup bucket is untouched). Every account a POST /signup/ creates is appended to
// the run's ledger (<runDir>/signup-accounts.json, shared with signup-ui.spec and surviving worker restarts); at
// ACCOUNT_CAP no check sends a sign-up that could create one: a remaining row is sent with logic.actor's (taken)
// email instead — every non-email branch is checked before "email taken", so a gap answers 409 and is still a
// `validation-gap` ("not created: cap") — and a row whose own field is the email is not sent (`signup-budget`).
// LC-SIGNUP-05 creates 2 when under the cap.
import { test, expect } from '../../lib/fixtures.mjs';
import { ACCOUNTS, ROLES, credentials, sweepAccounts } from '../../../check-core/lib/accounts.mjs';
import { MSG, VALIDATOR_OF, backendRules, errorMismatch, frontendRules, happyRows, signupMatrix, staleMessages } from '../../lib/matrix.mjs';
import { ACCOUNT_CAP, accountsCreated, attempt, capReached, get, login, noteAccount, post, removeAccount, said, throwawayName } from '../../lib/auth.mjs';

const ROUTE = '/api/signup/';

const actorEmail = () => ACCOUNTS[ROLES['logic.actor']].email;
const pw = () => credentials(ROLES['logic.actor']).password; // the test accounts' generated password: strong, unique
const describe = ({ text, code }) => `${typeof text === 'string' ? `"${text}"` : String(text)}${code ? ` (code ${code})` : ''}`;
const matrix = () => signupMatrix({ name: throwawayName, password: pw(), takenEmail: actorEmail() });
const capNote = () => `${accountsCreated()} of ${ACCOUNT_CAP} accounts already created this run (<runDir>/signup-accounts.json)`;

/** Post one matrix row and judge the answer. */
async function runCase(api, lc, row) {
  await test.step(`${row.category}: ${row.case} → ${row.expectStatus}`, async () => {
    const selector = `POST ${ROUTE} ${row.category}: ${row.case}`;
    const expected = `HTTP ${row.expectStatus} ${describe(row.expectError)}`;
    let body = row.body;
    const capped = capReached();
    if (capped) {
      if (row.category === 'email' && row.expectStatus !== 409) {
        lc.violation('signup-budget', { route: ROUTE, selector, measured: `not sent: ${capNote()}`, expected: 'the row tested (it could create an account)' });
        return;
      }
      body = { ...row.body, email: actorEmail() }; // can never create: a gap falls through to "email taken" (409)
    }
    const r = await attempt(post(api, '/signup/', body));
    if (r.error) { lc.violation('unreachable', { route: ROUTE, selector, measured: said(r), expected }); return; }
    if (r.status === 429) { lc.violation('throttled', { route: ROUTE, selector, measured: said(r), expected, note: 'the case was not tested: the throttle no longer keys by X-Forwarded-For (NUM_PROXIES = 0?, lib/auth.mjs clientIp)' }); return; }
    if (capped && r.status === 409 && row.expectStatus !== 409) {
      lc.violation('validation-gap', { route: ROUTE, selector, measured: `${said(r)}: the row passed its own check and reached "email taken" (not created: cap)`, expected });
      return;
    }
    if (r.status >= 200 && r.status < 300) {
      const u = r.json && r.json.user;
      const created = u ? `${u.username} <${u.email}>` : '(no user in the answer)';
      noteAccount({ check: lc.checkId, case: row.case, username: u ? u.username : null, email: u ? u.email : body.email });
      lc.violation('validation-gap', { route: ROUTE, selector, measured: `HTTP ${r.status}: the backend accepted it and created ${created}`, expected });
      const gone = await removeAccount(api, { access: r.json && r.json.access, email: body.email, password: body.password });
      if (!gone) lc.violation('cleanup', { route: ROUTE, selector: `POST /api/account/delete/ ${created}`, measured: 'the account could not be deleted', expected: 'deleted by the check (remove it by hand: it may not match the lgc sweep)' });
      return;
    }
    if (r.status >= 500) { lc.violation('server-error', { route: ROUTE, selector, measured: said(r), expected }); return; }
    const mismatch = r.status !== row.expectStatus ? `HTTP ${r.status}` : null;
    const msg = errorMismatch(r.json, row.expectError);
    if (mismatch || msg) lc.violation('signup-matrix', { route: ROUTE, selector, measured: [mismatch, msg].filter(Boolean).join(', ') || said(r), expected });
  });
}

async function runCategory(api, lc, category) {
  const rows = matrix().filter((r) => r.category === category);
  expect(rows.length, `matrix rows for ${category}`).toBeGreaterThan(0);
  for (const row of rows) await runCase(api, lc, row);
  lc.metric(`${category} cases`, rows.length, { unit: '', route: ROUTE, kind: 'data' });
  await lc.done();
}

test('[LC-SIGNUP-00] the frontend\'s stated sign-up rules and the backend\'s validators agree; the matrix\'s messages exist in the backend', async ({ lc }) => {
  const fe = frontendRules();
  const be = backendRules();
  const v = (selector, measured, expected) => lc.violation('matrix-agreement', { route: ROUTE, selector, measured, expected });
  for (const p of fe.problems) v('src/utils/passwordRules.ts', p, 'the frontend rule list parses');
  for (const p of be.problems) v('backend/backend/settings.py', p, 'the backend validators parse');

  await test.step('password minimum length', async () => {
    if (fe.minLength !== be.minLength) v('min length', `frontend ${fe.minLength}, backend MinimumLengthValidator ${be.minLength}`, 'the same minimum length');
    if (fe.minLength !== null) lc.metric('password min length', fe.minLength, { unit: '', route: ROUTE, kind: 'data' });
  });
  await test.step('every frontend rule has a backend validator', async () => {
    for (const { key, label } of fe.rules) {
      const val = VALIDATOR_OF[key];
      if (!val) v(`frontend rule "${key}"`, `"${label}" maps to no known Django validator`, 'a rule the backend enforces (teach VALIDATOR_OF a new one)');
      else if (!be.validators.includes(val)) v(`frontend rule "${key}"`, `"${label}" but AUTH_PASSWORD_VALIDATORS has no ${val}`, 'the backend enforces every rule the form states');
    }
  });
  await test.step('every backend validator is stated by the frontend (or declared server-only)', async () => {
    const stated = new Set([...fe.rules.map((r) => VALIDATOR_OF[r.key]), ...fe.serverOnly.map((k) => VALIDATOR_OF[k])]);
    for (const val of be.validators) if (!stated.has(val)) v(`backend ${val}`, 'no frontend rule and not declared server-only in passwordRules.ts', 'the form tells the player every rule the backend enforces');
  });
  await test.step('username pattern and consent message', async () => {
    if (fe.usernamePattern !== be.usernamePattern) v('username pattern', `form pattern ${fe.usernamePattern}, backend USERNAME_RE ${be.usernamePattern}`, 'the same pattern');
    if (fe.consentText !== be.consentMessage) v('consent message', `frontend CONSENT_NEEDED ${JSON.stringify(fe.consentText)}, backend ${JSON.stringify(be.consentMessage)}`, 'the same text');
  });
  await test.step('matrix provenance: every literal message exists in the backend source', async () => {
    for (const s of staleMessages()) lc.violation('matrix-stale', { route: ROUTE, selector: `${s.file} (${s.key})`, measured: `"${s.text}" not found`, expected: 'lib/matrix.mjs MSG matches the backend (update the matrix from the source)' });
    lc.metric('matrix messages', Object.keys(MSG).length, { unit: '', route: ROUTE, kind: 'data' });
  });
  await lc.done();
});

test('[LC-SIGNUP-01] username cases: empty, too short, too long, bad characters, moderated words → 400 with the backend message', async ({ api, lc }) => {
  await runCategory(api, lc, 'username');
});

test('[LC-SIGNUP-02] email cases: missing, invalid, taken → 400 / 409 with the backend message', async ({ api, lc }) => {
  await runCategory(api, lc, 'email');
});

test('[LC-SIGNUP-03] password cases: empty and every AUTH_PASSWORD_VALIDATORS rule → 400 with the validator message', async ({ api, lc }) => {
  await runCategory(api, lc, 'password');
});

test('[LC-SIGNUP-04] consent cases: accepted_terms / age_confirmed missing or false, under 13 → 400 with the consent code', async ({ api, lc }) => {
  await runCategory(api, lc, 'consent');
});

test('[LC-SIGNUP-05] happy path: a new lgc account gets 201 + tokens, logs in, /me/ matches, a repeated display name is allowed, delete ends the login', async ({ api, lc }) => {
  const password = pw();
  const { happy, repeat } = happyRows({ name: throwawayName, password });
  const alive = new Map(); // label → { access, email } of accounts this test created and has not deleted yet
  const v = (rule, selector, r, expected) => lc.violation(rule, { route: ROUTE, selector, measured: typeof r === 'string' ? r : said(r), expected });
  let first = null;
  let created = 0;
  try {
    await test.step('sign up → 201 with tokens and the user', async () => {
      if (capReached()) { v('signup-budget', `POST ${ROUTE} ${happy.body.username}`, `not sent: ${capNote()}`, 'the happy path runs (it creates 2 accounts)'); return; }
      const r = await attempt(post(api, '/signup/', happy.body));
      const u = r.json && r.json.user;
      if (r.status >= 200 && r.status < 300) noteAccount({ check: lc.checkId, case: happy.case, username: u ? u.username : null, email: happy.body.email });
      if (r.status !== 201 || !r.json || !r.json.access || !r.json.refresh || !u) { v('signup', `POST ${ROUTE} ${happy.body.username}`, r, '201 { access, refresh, user }'); if (r.json && r.json.access) alive.set('happy', { access: r.json.access, email: happy.body.email }); return; }
      alive.set('happy', { access: r.json.access, email: happy.body.email });
      created++;
      first = { ...u, access: r.json.access };
      if (u.username !== happy.body.username || u.email !== happy.body.email) v('signup', 'user payload', `${u.username} <${u.email}>`, `${happy.body.username} <${happy.body.email}>`);
      if (typeof u.id !== 'string' || !u.id) v('signup', 'user.id', JSON.stringify(u.id), 'a public id');
    });
    if (first) await happySteps();
  } finally {
    // Whatever failed above: nothing this test created stays behind (the lgc sweep is the last resort).
    for (const [label, a] of alive) {
      if (await removeAccount(api, { ...a, password }).catch(() => false)) continue;
      if (label === 'happy') {
        const s = await sweepAccounts({ scope: 'logic' }).catch(() => null);
        if (s && s.deleted.includes(happy.body.username)) continue;
      }
      v('cleanup', `${label} ${a.email}`, 'still exists after the check', 'deleted by the check or the lgc sweep');
    }
  }
  lc.metric('accounts created', created, { unit: '', route: ROUTE, kind: 'data' });
  await lc.done();

  async function happySteps() {
    await test.step('log in by email with the new password → 200, same user', async () => {
      const r = await attempt(login(api, happy.body.email, password));
      if (r.status !== 200 || !r.json || !r.json.access) v('login', `POST /api/login/ ${happy.body.email}`, r, '200 with tokens');
      else if (r.json.user.id !== first.id) v('login', 'user.id', r.json.user.id, first.id);
    });
    await test.step('/me/ with the signup token matches the new user', async () => {
      const r = await attempt(get(api, '/me/', { token: first.access }));
      const u = r.json && r.json.user;
      if (r.status !== 200 || !u) v('me', 'GET /api/me/', r, '200 { user }');
      else for (const k of ['id', 'username', 'email']) if (u[k] !== first[k]) v('me', `user.${k}`, JSON.stringify(u[k]), JSON.stringify(first[k]));
    });
    await test.step('the same display name with another email → 201 (names are not unique); a bare-name login is then ambiguous', async () => {
      if (capReached()) { v('signup-budget', `POST ${ROUTE} ${repeat.body.username} <${repeat.body.email}>`, `not sent: ${capNote()}`, 'the repeated-name sign-up runs'); return; }
      const r = await attempt(post(api, '/signup/', repeat.body));
      const u = r.json && r.json.user;
      if (r.status >= 200 && r.status < 300) noteAccount({ check: lc.checkId, case: repeat.case, username: u ? u.username : null, email: repeat.body.email });
      if (r.json && r.json.access) alive.set('repeat', { access: r.json.access, email: repeat.body.email });
      if (r.status === 201) created++;
      if (r.status !== 201 || !u) { v('signup', `POST ${ROUTE} ${repeat.body.username} <${repeat.body.email}>`, r, '201: display names may repeat (views.py USERNAME_RE comment)'); return; }
      if (u.id === first.id) v('signup', 'user.id of the repeat', u.id, 'a different public id');
      const amb = await attempt(login(api, happy.body.username, password));
      if (amb.status !== 401 || !/Several players use that name/.test((amb.json && amb.json.error) || '')) v('login', `POST /api/login/ ${happy.body.username} (two accounts)`, amb, '401 "Several players use that name…" (AUTH-2)');
      const gone = await removeAccount(api, { access: r.json.access, email: repeat.body.email, password });
      if (gone) alive.delete('repeat'); else v('cleanup', `POST /api/account/delete/ ${repeat.body.email}`, 'not deleted', '200');
    });
    await test.step('delete with the username + "delete" → 200', async () => {
      const r = await attempt(post(api, '/account/delete/', { confirm_username: happy.body.username, confirm_text: 'delete' }, { token: first.access }));
      if (r.status !== 200 || !r.json || !r.json.status) v('delete', 'POST /api/account/delete/', r, '200 { status }');
      else alive.delete('happy');
    });
    await test.step('login after the delete fails → 401', async () => {
      const r = await attempt(login(api, happy.body.email, password));
      if (r.status !== 401) v('login-after-delete', `POST /api/login/ ${happy.body.email}`, r, '401 "Incorrect email, username or password."');
    });
  }
});
