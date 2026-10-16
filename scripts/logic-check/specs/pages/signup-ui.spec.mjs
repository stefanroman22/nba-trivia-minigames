// Logic Check — signup suite, browser (spec §5: "the browser case checks that the form shows the backend's error
// text"). One case per matrix category, each chosen to pass the form's own checks so it reaches the backend; the
// assertion is the backend's message (lib/matrix.mjs MSG) appearing in the open modal, found by its text. Never
// layout, motion or the live rule list (UI check's AC-SIGNUP rows own those, spec §5 no-overlap matrix).
// Consent: the form never sends an unticked sign-up (it stops with CONSENT_NEEDED), so that case asserts the text it
// shows is the backend's consent message (consent.py) and that no request left. Signup POSTs go out as their own
// simulated client (X-Forwarded-For, lib/auth.mjs), like the API cases: no real signup budget is spent.
import { test, expect } from '../../lib/fixtures.mjs';
import { L } from '../../../ui-check/lib/pagemap.mjs';
import { ACCOUNTS, ROLES, credentials } from '../../../check-core/lib/accounts.mjs';
import { MSG, backendRules } from '../../lib/matrix.mjs';
import { clientIp, removeAccount, throwawayName } from '../../lib/auth.mjs';

const SIGNUP = /\/api\/signup\/$/;

test('[LC-SIGNUP-UI-01] the sign-up form shows the backend\'s error text: one case per category (username, email, password, consent)', async ({ page, lc, api }) => {
  test.setTimeout(120_000);
  const pa = await lc.page(page);
  const pw = credentials(ROLES['logic.actor']).password;
  const taken = ACCOUNTS[ROLES['logic.actor']].email;
  const email = (i) => `${throwawayName(i)}@uicheck.test`;
  const cases = [
    { category: 'username', label: 'moderated word "Dick"', username: 'Dick', email: email(70), password: pw, tick: true, text: MSG.nameBlocked.text, sends: true },
    { category: 'email', label: 'taken email', username: throwawayName(71), email: taken, password: pw, tick: true, text: MSG.emailInUse.text, sends: true },
    { category: 'password', label: 'common password "password123"', username: throwawayName(72), email: email(72), password: 'password123', tick: true, text: 'This password is too common.', sends: true },
    { category: 'consent', label: 'box unticked', username: throwawayName(73), email: email(73), password: pw, tick: false, text: backendRules().consentMessage, sends: false },
  ];
  const posts = [];
  page.on('request', (r) => { if (r.method() === 'POST' && SIGNUP.test(r.url())) posts.push(r.url()); });
  await page.route(SIGNUP, (route) => route.continue({ headers: { ...route.request().headers(), 'x-forwarded-for': clientIp() } }));

  for (const c of cases) {
    await test.step(`${c.category}: ${c.label} → "${c.text}"`, async () => {
      const route = '/';
      const selector = `sign-up form, ${c.category}: ${c.label}`;
      await pa.goto('/', { waitFor: '#games-grid .gtile' });
      await L(page, 'common.navLogin').click();
      await expect(L(page, 'guest.modalPanel')).toBeVisible();
      await L(page, 'guest.authTabSignup').click();
      await expect(L(page, 'guest.authTabSignup')).toHaveAttribute('aria-selected', 'true');
      await L(page, 'account.signupEmail').fill(c.email);
      await L(page, 'account.signupUsername').fill(c.username);
      await L(page, 'account.password').fill(c.password);
      if (c.tick) await L(page, 'account.consentBox').check();
      const before = posts.length;
      const answer = c.sends ? page.waitForResponse((r) => SIGNUP.test(r.url()) && r.request().method() === 'POST', { timeout: 15_000 }).catch(() => null) : null;
      await L(page, 'account.submit').click();
      if (answer) {
        const res = await answer;
        if (!res) { lc.violation('signup-ui', { route, selector, measured: 'no POST /api/signup/ within 15 s of submit', expected: 'the form sends the case to the backend' }); return; }
        if (res.status() < 300) {
          const j = await res.json().catch(() => null);
          lc.violation('validation-gap', { route, selector, measured: `HTTP ${res.status()}: the backend accepted it`, expected: `"${c.text}"` });
          if (!(await removeAccount(api, { access: j && j.access, email: c.email, password: c.password }))) lc.violation('cleanup', { route, selector: c.email, measured: 'not deleted', expected: 'deleted by the check' });
          await page.evaluate(() => { try { localStorage.clear(); } catch { /* none */ } });
          return;
        }
      }
      const shown = page.locator('.modal-panel').getByText(c.text, { exact: true });
      if (!(await shown.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false))) {
        const actual = await L(page, 'account.authError').textContent({ timeout: 1000 }).catch(() => null);
        lc.violation('error-text', { route, selector, measured: actual ? `shows "${actual.trim()}"` : 'no error text', expected: `the backend's "${c.text}"` });
      }
      if (!c.sends) {
        await page.waitForTimeout(1000);
        if (posts.length !== before) lc.violation('signup-ui', { route, selector, measured: `${posts.length - before} POST /api/signup/ sent`, expected: 'nothing sent without the tick (the form stops first)' });
      }
    });
  }
  // The answers' own 400/409 (and the browser's log line for them) are the point of the check, not noise.
  await lc.console({ allow: [/^40[09] POST \S+\/api\/signup\/$/, /Failed to load resource: the server responded with a status of 40[09]/] });
  lc.metric('signup posts', posts.length, { unit: '', route: '/', kind: 'data' });
  await lc.done();
});
