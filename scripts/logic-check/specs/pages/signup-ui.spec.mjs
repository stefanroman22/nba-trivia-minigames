// Logic Check — signup suite, browser (spec §5: "the browser case checks that the form shows the backend's error
// text"). One case per matrix category, each chosen to pass the form's own checks so it reaches the backend; the
// assertion is the backend's message (lib/matrix.mjs MSG) appearing in the open modal, found by its text. Never
// layout, motion or the live rule list (UI check's AC-SIGNUP rows own those, spec §5 no-overlap matrix).
// Consent is by text since 2026-10-26.2 (no tick-box, no age): the open sign-up form has no checkbox and shows the terms
// note, and every sign-up it sends carries `accepted_terms: true` and no age field (age_confirmed, birth month / year).
// Messages are read from the form's error element (pagemap account.authError), never a free text search (the live rule
// list carries similar lines).
// Signup and check-name requests go out as their own simulated client (X-Forwarded-For, lib/auth.mjs), like the API
// cases: no real throttle budget is spent. An account a gap creates is recorded in the run's ledger
// (<runDir>/signup-accounts.json); at the cap (4 per run) a case is sent with logic.actor's taken email, which can
// never create one (every branch tested here is checked before "email taken").
import { test, expect } from '../../lib/fixtures.mjs';
import { L } from '../../../ui-check/lib/pagemap.mjs';
import { ACCOUNTS, ROLES, credentials } from '../../../check-core/lib/accounts.mjs';
import { MSG, TERMS_NOTE } from '../../lib/matrix.mjs';
import { capReached, clientIp, noteAccount, removeAccount, throwawayName } from '../../lib/auth.mjs';

const SIGNUP = /\/api\/signup\/$/;
const FAKE_CLIENT = /\/api\/(signup|check-name)\/$/;
const AGE_KEYS = ['age_confirmed', 'birth_month', 'birth_year'];

test('[LC-SIGNUP-UI-01] the sign-up form shows the backend\'s error text: one case per category (username, email, password); consent by text: no tick-box, the terms note, accepted_terms sent with no age', async ({ page, lc, api }) => {
  test.setTimeout(120_000);
  const pa = await lc.page(page);
  const pw = credentials(ROLES['logic.actor']).password;
  const taken = ACCOUNTS[ROLES['logic.actor']].email;
  const email = (i) => `${throwawayName(i)}@uicheck.test`;
  const cases = [
    { category: 'username', label: 'moderated word "Dick"', username: 'Dick', email: email(70), password: pw, text: MSG.nameBlocked.text },
    { category: 'email', label: 'taken email', username: throwawayName(71), email: taken, password: pw, text: MSG.emailInUse.text },
    { category: 'password', label: 'common password "password123"', username: throwawayName(72), email: email(72), password: 'password123', text: 'This password is too common.' },
  ];
  const posts = [];
  const bodies = [];
  page.on('request', (r) => {
    if (r.method() !== 'POST' || !SIGNUP.test(r.url())) return;
    posts.push(r.url());
    try { bodies.push(r.postDataJSON()); } catch { bodies.push(null); }
  });
  await page.route(FAKE_CLIENT, (route) => route.continue({ headers: { ...route.request().headers(), 'x-forwarded-for': clientIp() } }));

  for (const c of cases) {
    await test.step(`${c.category}: ${c.label} → "${c.text}"`, async () => {
      const route = '/';
      const selector = `sign-up form, ${c.category}: ${c.label}`;
      await pa.goto('/', { waitFor: '#games-grid .gtile' });
      await L(page, 'common.navLogin').click();
      await expect(L(page, 'guest.modalPanel')).toBeVisible();
      await L(page, 'guest.authTabSignup').click();
      await expect(L(page, 'guest.authTabSignup')).toHaveAttribute('aria-selected', 'true');
      const capped = capReached();
      const emailUsed = capped ? taken : c.email;
      await L(page, 'account.signupEmail').fill(emailUsed);
      await L(page, 'account.signupUsername').fill(c.username);
      await L(page, 'account.password').fill(c.password);
      const answer = page.waitForResponse((r) => SIGNUP.test(r.url()) && r.request().method() === 'POST', { timeout: 15_000 }).catch(() => null);
      await L(page, 'account.submit').click();
      if (answer) {
        const res = await answer;
        if (!res) { lc.violation('signup-ui', { route, selector, measured: 'no POST /api/signup/ within 15 s of submit', expected: 'the form sends the case to the backend (nothing to tick first)' }); return; }
        if (res.status() < 300) {
          const j = await res.json().catch(() => null);
          noteAccount({ check: lc.checkId, case: c.label, username: j && j.user ? j.user.username : c.username, email: emailUsed });
          lc.violation('validation-gap', { route, selector, measured: `HTTP ${res.status()}: the backend accepted it`, expected: `"${c.text}"` });
          if (!(await removeAccount(api, { access: j && j.access, email: emailUsed, password: c.password }))) lc.violation('cleanup', { route, selector: emailUsed, measured: 'not deleted', expected: 'deleted by the check' });
          await page.evaluate(() => { try { localStorage.clear(); } catch { /* none */ } });
          return;
        }
        if (capped && res.status() === 409 && c.category !== 'email') {
          lc.violation('validation-gap', { route, selector, measured: `HTTP 409: the case passed its own check and reached "email taken" (not created: cap)`, expected: `"${c.text}"` });
          return;
        }
      }
      // The form's error element, its text exactly the backend's message (it may first show a previous error).
      const err = L(page, 'account.authError');
      const texts = async () => (await err.allTextContents()).map((t) => t.trim());
      const shown = await expect.poll(texts, { timeout: 10_000 }).toContain(c.text).then(() => true, () => false);
      if (!shown) {
        const actual = await texts().catch(() => []);
        lc.violation('error-text', { route, selector: `${selector} (account.authError)`, measured: actual.length ? `shows ${actual.map((t) => `"${t}"`).join(', ')}` : 'no error element', expected: `the backend's "${c.text}"` });
      }
    });
  }
  await test.step('consent by text: no tick-box, the terms note under the buttons, every sign-up sent with accepted_terms and no age', async () => {
    const route = '/';
    const boxes = await L(page, 'account.anyCheckbox').count();
    if (boxes) lc.violation('consent', { route, selector: 'sign-up form .modal-panel input[type=checkbox]', measured: `${boxes} checkbox(es)`, expected: 'none: agreement is by the text under the buttons (owner decision, 2026-10-26.2)' });
    const note = (await L(page, 'account.termsNote').allTextContents().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim());
    if (!note.some((t) => t.startsWith(TERMS_NOTE))) lc.violation('consent', { route, selector: 'sign-up form (account.termsNote)', measured: note.length ? `"${note[0]}"` : 'no terms note', expected: `"${TERMS_NOTE} Terms of Service and Privacy Policy."` });
    for (const [i, b] of bodies.entries()) {
      const age = b ? AGE_KEYS.filter((k) => k in b) : [];
      if (!b || b.accepted_terms !== true || age.length) lc.violation('consent', { route, selector: `POST /api/signup/ body #${i + 1}`, measured: b ? `accepted_terms ${JSON.stringify(b.accepted_terms)}${age.length ? `, ${age.join(', ')}` : ''}` : 'not JSON', expected: 'accepted_terms: true and no age field' });
    }
    if (!bodies.length) lc.violation('consent', { route, selector: 'POST /api/signup/ bodies', measured: 'none sent', expected: 'one per case above' });
  });
  // The answers' own 400/409 (and the browser's log line for them) are the point of the check, not noise.
  await lc.console({ allow: [/^40[09] POST \S+\/api\/signup\/$/, /Failed to load resource: the server responded with a status of 40[09]/] });
  lc.metric('signup posts', posts.length, { unit: '', route: '/', kind: 'data' });
  await lc.done();
});
