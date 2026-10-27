// Account suite: sign-up, log in, log out, session restore. All specs here start logged out
// (persona guest) except the expired-token check, which seeds a solo session first.
import { test, expect, L, createAudit } from '../../lib/fixtures.mjs';
import { contextOptions } from '../../lib/viewports.mjs';
import { credentials, soloUsername } from '../../lib/accounts.mjs';
import { openLogin, recordFrames, fadeSummary, routeLatency, LOCAL_LOAD } from '../../lib/guest.mjs';
import {
  THROTTLED, HASHING, motionStep, throwawayName, throwawayEmail, deleteAccountApi, countRequests, navState, expectSignedIn,
  typeLatency, ruleStates, openSignupTab, fillSignup, drawerMode, openDrawer, NAV_SAMPLER, navFlash,
} from '../../lib/account.mjs';

const TERMS_NOTE = 'By creating an account or continuing with Google you agree to our Terms of Service and Privacy Policy.';
const PW = "input[aria-label='Password']";
const PW_RULES = ".modal-panel ul[aria-label='Password requirements'] li.pw-rule";
const NAME_RULES = ".modal-panel ul[aria-label='Username requirements'] li.pw-rule";

/** JS expression: the rules under `sel` are in exactly these states. */
const rulesAre = (sel, states) => `(() => { const li = [...document.querySelectorAll(${JSON.stringify(sel)})]; const want = ${JSON.stringify(states)}; return li.length === want.length && li.every((e, i) => e.classList.contains('is-' + want[i])); })()`;

test.describe('logged out', () => {
  test.use({ persona: 'guest' });

  test('[AC-SIGNUP-01] @perf sign-up form: tabs slide, password and username rules update live, terms agreed by the text under the buttons (no tick-box)', async ({ page, audit, vp }) => {
    test.setTimeout(180_000);
    const signups = countRequests(page, /\/api\/signup\/$/);
    await audit.goto('/', { waitFor: '#games-grid .gtile' });
    await openLogin(page, vp);
    await page.waitForTimeout(500);
    await audit.layout({ scope: '.modal-panel' });
    await audit.shot('login-tab');

    // Log in -> Sign up: the thumb slides and the panel never snaps (the owner's reported jitter).
    await test.step('tab slide', async () => {
      const frames = await recordFrames(page, '.modal-panel .seg-thumb', async () => {
        await motionStep(audit, 'tab slide', async () => { await L(page, 'guest.authTabSignup').click(); }, { watch: ['.modal-panel', '.modal-panel .auth-stack', '.modal-panel form'], settleMs: 700 });
      }, { tail: 600 });
      const xs = frames.filter((f) => f.present).map((f) => f.x);
      const from = xs[0], to = xs[xs.length - 1];
      const between = xs.filter((x) => x > Math.min(from, to) + 2 && x < Math.max(from, to) - 2).length;
      if (Math.abs(to - from) < 4) audit.violation('snap', { selector: '.seg-thumb', measured: `thumb moved ${Math.round(to - from)}px`, expected: 'the thumb moves to Sign up' });
      else if (between < 1) audit.violation('snap', { selector: '.seg-thumb', measured: `thumb jumped ${Math.round(from)} -> ${Math.round(to)}px, no frame in between`, expected: 'a slide' });
      await expect(L(page, 'guest.authTabSignup')).toHaveAttribute('aria-selected', 'true');
      await expect(L(page, 'guest.segThumb')).toHaveCount(1);
    });
    await page.waitForTimeout(400);
    await audit.layout({ scope: '.modal-panel' });
    await audit.shot('signup-empty');

    await L(page, 'account.signupEmail').fill('layout.check@uicheck.test');

    // Username: rules open on the first character; the server verdict swaps the third rule in place.
    await test.step('username rules', async () => {
      const nameInput = L(page, 'account.signupUsername');
      await expect(L(page, 'account.nameRules')).toHaveCount(0);
      const open = await typeLatency(page, ".modal-panel input[aria-label='Username']", 'ab', rulesAre(NAME_RULES, ['bad', 'ok', 'pending']));
      audit.metrics.push({ kind: 'timing', label: 'username rules after typing', value: open, unit: 'ms', budget: 150, route: audit.route });
      if (open > 150) audit.violation('slow-action', { selector: 'username rules', measured: `${open}ms`, expected: '≤ 150ms (live rules update instantly)' });
      const badChars = await typeLatency(page, ".modal-panel input[aria-label='Username']", 'bad name!', rulesAre(NAME_RULES, ['ok', 'bad', 'pending']));
      if (badChars > 150) audit.violation('slow-action', { selector: 'username rules', measured: `${badChars}ms`, expected: '≤ 150ms' });
      const before = await ruleStates(page, NAME_RULES);
      expect(before.map((r) => r.label)).toContain('Not reserved or offensive');
      // A reserved name: the third rule turns into the server's message, in the same list row (UI-21).
      await motionStep(audit, 'reserved username', async () => {
        await nameInput.fill('admin');
        await expect(L(page, 'account.nameRules').nth(2)).toHaveClass(/is-bad/, { timeout: 8000 });
      }, { watch: ['.modal-panel', `ul[aria-label='Username requirements']`], settleMs: 700 });
      const bad = await ruleStates(page, NAME_RULES);
      expect(bad).toHaveLength(3);
      expect(bad[2].label).not.toBe('Not reserved or offensive');
      await audit.shot('username-reserved');
      // Names may repeat (the player ID tells them apart): an existing name is fine, there is no "taken" rule.
      await nameInput.fill('testuser2');
      await expect(L(page, 'account.nameRules').nth(2)).toHaveClass(/is-ok/, { timeout: 8000 });
      expect((await ruleStates(page, NAME_RULES)).map((r) => r.state)).toEqual(['ok', 'ok', 'ok']);
      await nameInput.fill('courtking');
      await expect(L(page, 'account.nameRules').nth(2)).toHaveClass(/is-ok/, { timeout: 8000 });
    });

    // Password: rules update on the same frame the value changes.
    await test.step('password rules', async () => {
      await expect(L(page, 'account.pwRules')).toHaveCount(0);
      const cases = [
        ['abc', ['bad', 'ok', 'ok']],
        ['12345678', ['ok', 'bad', 'ok']],
        ['courtking99', ['ok', 'ok', 'bad']],
        ['Str0ng!pass', ['ok', 'ok', 'ok']],
      ];
      for (const [value, states] of cases) {
        const ms = await typeLatency(page, `.modal-panel ${PW}`, value, rulesAre(PW_RULES, states));
        audit.metrics.push({ kind: 'timing', label: `password rules "${value}"`, value: ms, unit: 'ms', budget: 150, route: audit.route });
        if (ms > 150) audit.violation('slow-action', { selector: 'password rules', measured: `${ms}ms for "${value}"`, expected: '≤ 150ms (live rules update instantly)' });
      }
      // The eye button shows and hides the password.
      await L(page, 'account.pwToggle').click();
      await expect(L(page, 'account.password')).toHaveAttribute('type', 'text');
      await L(page, 'account.pwToggle').click();
      await expect(L(page, 'account.password')).toHaveAttribute('type', 'password');
      await page.waitForTimeout(400);
      await audit.layout({ scope: '.modal-panel' });
      await audit.shot('signup-filled');
    });

    // Consent is by text (owner decision, 2026-10-26.2): no tick-box and no age question; the note under the buttons
    // says pressing either button agrees, and links the Terms and the Privacy Policy. It leaves with the Sign up tab.
    await test.step('terms by text, no tick-box', async () => {
      await expect(L(page, 'account.anyCheckbox'), 'no tick-box in the sign-up form').toHaveCount(0);
      await expect(L(page, 'account.termsNote')).toBeVisible();
      await expect(L(page, 'account.termsNote')).toHaveText(TERMS_NOTE);
      await expect(L(page, 'account.termsNoteTerms')).toHaveText('Terms of Service');
      await expect(L(page, 'account.termsNotePrivacy')).toHaveText('Privacy Policy');
      await expect(L(page, 'guest.modalPanel')).not.toContainText(/13\+|13 or older|birth/i);
      await expect(L(page, 'account.submit')).toBeEnabled();
      await expect(L(page, 'account.submit')).toHaveText('Create account');
      await audit.layout({ scope: '.modal-panel' });
      await audit.shot('terms-note');
      await motionStep(audit, 'Sign up -> Log in, the terms note leaves', async () => {
        await L(page, 'guest.authTabLogin').click();
        await expect(L(page, 'account.termsNote')).toHaveCount(0, { timeout: 5000 });
      }, { watch: ['.modal-panel', '.modal-panel form'], settleMs: 700 });
      await expect(L(page, 'guest.modalPanel')).not.toContainText(/13\+|13 or older|birth/i);
      await expect(L(page, 'account.anyCheckbox')).toHaveCount(0);
    });
    expect(signups, 'the form never posted').toHaveLength(0);
    await audit.console({ allow: LOCAL_LOAD });
    await audit.done();
  });

  test('[AC-SIGNUP-02] @perf real sign-up of a throwaway user: errors inline, success closes the modal, avatar within 1500 ms', async ({ page, audit, vp, request }) => {
    test.skip(!vp.core, THROTTLED);
    test.setTimeout(180_000);
    const name = throwawayName(1, vp);
    const email = throwawayEmail(name);
    const password = credentials(name).password;
    const taken = credentials('testuser3').email;
    try {
      await audit.goto('/', { waitFor: '#games-grid .gtile' });
      await openLogin(page, vp);
      await openSignupTab(page);
      await page.waitForTimeout(500);

      // Duplicate email: the server's refusal shows inline, the modal does not jump.
      await test.step('duplicate email', async () => {
        await fillSignup(page, { email: taken, username: name, password });
        await motionStep(audit, 'duplicate email error', async () => {
          await L(page, 'account.submit').click();
          await expect(L(page, 'account.authError')).toBeVisible({ timeout: 10_000 });
        }, { watch: ['.modal-panel', '.modal-panel form'], settleMs: 800 });
        await expect(L(page, 'account.authError')).toContainText(/email/i);
        await expect(L(page, 'account.signupEmail')).toHaveAttribute('aria-invalid', 'true');
        await expect(L(page, 'account.submit')).toBeEnabled();
        await expect(L(page, 'account.submit')).toHaveText('Create account');
        await audit.layout({ scope: '.modal-panel' });
        await audit.shot('duplicate-email');
      });

      // The real sign-up. Timing is taken in the page: capture-phase click -> avatar chip painted.
      await test.step('sign up', async () => {
        await L(page, 'account.signupEmail').fill(email);
        const frames = await recordFrames(page, '.modal-panel', async () => {
          await routeLatency(
            audit, 'signup submit -> avatar chip',
            () => L(page, 'account.submit').click(),
            `[...document.querySelectorAll('nav.nav3 button.nav3-user')].some((b) => b.getClientRects().length > 0)`,
            1500,
          );
          await expect(L(page, 'account.successTitle')).toBeVisible({ timeout: 10_000 });
          await audit.shot('welcome');
          await expect(L(page, 'guest.modalBackdrop')).toHaveCount(0, { timeout: 10_000 });
        }, { tail: 600 });
        const exit = fadeSummary(frames);
        if (exit.intermediate < 1) audit.violation('snap', { selector: '.modal-panel', measured: `no part-way frame among ${exit.frames} sampled while the modal closed after sign-up`, expected: 'an animated exit' });
        await expectSignedIn(page, name);
        await expect(L(page, 'common.navLogin')).toHaveCount(0);
      });
      // The session is real: it survives a reload.
      await page.reload();
      await expectSignedIn(page, name);
      await audit.layout({ scope: '#leaderboard' });
      await audit.shot('after-signup');
    } finally {
      const status = await deleteAccountApi(request, name);
      audit.metrics.push({ kind: 'note', label: `cleanup ${name}`, value: String(status), unit: '', route: '/' });
    }
    await audit.console({ allow: [...LOCAL_LOAD, ...HASHING, /status of 409/, /^409 POST /] });
    await audit.done();
  });

  test('[AC-LOGIN-01] @perf log in by username and by email, wrong password inline, session survives reload, log out', async ({ browser, baseURL, page, audit, vp }, testInfo) => {
    test.skip(!vp.core, THROTTLED);
    test.setTimeout(240_000);
    const who = credentials(soloUsername(testInfo.parallelIndex));

    await audit.goto('/', { waitFor: '#games-grid .gtile' });
    await openLogin(page, vp);
    await page.waitForTimeout(500);

    await test.step('wrong password', async () => {
      await L(page, 'account.loginId').fill(who.username);
      await L(page, 'account.password').fill(`${who.password}x`);
      await motionStep(audit, 'wrong password error', async () => {
        await L(page, 'account.submit').click();
        await expect(L(page, 'account.authError')).toBeVisible({ timeout: 10_000 });
      }, { watch: ['.modal-panel', '.modal-panel form'], settleMs: 800 });
      await expect(L(page, 'account.authError')).toContainText(/incorrect|password/i);
      await expect(L(page, 'account.submit')).toBeEnabled();
      await expect(L(page, 'account.submit')).toHaveText('Log in');
      expect(await navState(page)).toMatchObject({ chip: null });
      await audit.layout({ scope: '.modal-panel' });
      await audit.shot('wrong-password');
    });

    await test.step('log in by username', async () => {
      await L(page, 'account.password').fill(who.password);
      await routeLatency(
        audit, 'login submit -> avatar chip',
        () => L(page, 'account.submit').click(),
        `[...document.querySelectorAll('nav.nav3 button.nav3-user')].some((b) => b.getClientRects().length > 0)`,
        1500,
      );
      await expect(L(page, 'account.successTitle')).toContainText(`Welcome back, ${who.username}`, { timeout: 15_000 });
      await expect(L(page, 'guest.modalBackdrop')).toHaveCount(0, { timeout: 10_000 });
      await expectSignedIn(page, who.username);
    });

    await test.step('reload keeps the session', async () => {
      await page.reload();
      await expectSignedIn(page, who.username);
      expect(await page.evaluate(() => !!localStorage.getItem('refreshToken'))).toBe(true);
    });

    await test.step('log out (asks first: Cancel keeps the session, Log out confirms)', async () => {
      const askLogout = async (shot) => {
        if (vp.width <= 500) {
          await openDrawer(page);
          await L(page, 'common.drawerLogout').click();
        } else {
          await L(page, 'common.navUserChip').click();
          await expect(L(page, 'common.profileMenu')).toBeVisible();
          if (shot) await audit.shot('profile-menu');
          await L(page, 'common.profileMenuLogout').click();
        }
        await expect(L(page, 'common.logoutConfirm')).toBeVisible({ timeout: 5000 });
      };
      await askLogout(true);
      await audit.shot('logout-confirm');
      await L(page, 'common.logoutCancel').click();
      await expect(L(page, 'guest.modalBackdrop')).toHaveCount(0, { timeout: 5000 });
      await expectSignedIn(page, who.username);
      await askLogout();
      await L(page, 'common.logoutConfirm').click();
      await expect.poll(() => navState(page).then((s) => s.chip), { timeout: 10_000 }).toBeNull();
      expect(await page.evaluate(() => [localStorage.getItem('accessToken'), localStorage.getItem('refreshToken')])).toEqual([null, null]);
      if (!drawerMode(vp)) await expect(L(page, 'common.navLogin')).toBeVisible();
      await page.reload();
      expect(await navState(page)).toMatchObject({ chip: null });
      await audit.shot('logged-out');
    });

    // A fresh context (nothing stored) logs in with the email.
    await test.step('log in by email, fresh context', async () => {
      const ctx = await browser.newContext({ ...contextOptions(vp.id), baseURL });
      try {
        const p2 = await ctx.newPage();
        const a2 = await createAudit(p2, testInfo, { project: testInfo.project.name, vp, label: 'email' });
        try {
          await a2.goto('/', { waitFor: '#games-grid .gtile' });
          await openLogin(p2, vp);
          await L(p2, 'account.loginId').fill(who.email);
          await L(p2, 'account.password').fill(who.password);
          await L(p2, 'account.submit').click();
          await expect(L(p2, 'account.successTitle')).toBeVisible({ timeout: 15_000 });
          await expect(L(p2, 'guest.modalBackdrop')).toHaveCount(0, { timeout: 10_000 });
          await expectSignedIn(p2, who.username);
          await a2.shot('logged-in-by-email');
          await a2.console({ allow: [...LOCAL_LOAD, ...HASHING] });
          await a2.done();
        } finally {
          await a2.finalize();
        }
      } finally {
        await ctx.close().catch(() => {});
      }
    });
    await audit.console({ allow: [...LOCAL_LOAD, ...HASHING, /status of 401/, /^401 POST /] });
    await audit.done();
  });
});

test.describe('signed in', () => {
  test.use({ persona: 'solo' });

  test('[AC-LOGIN-02] @perf an expired or invalid access token refreshes silently on reload, with no logged-out flash over 300 ms', async ({ page, audit, cap }) => {
    test.setTimeout(150_000);
    await page.addInitScript(NAV_SAMPLER);
    await audit.goto('/', { waitFor: '#games-grid .gtile' });
    const chip0 = await expectSignedIn(page);
    const label = await chip0.getAttribute('aria-label');

    // Baseline: the same reload with a valid token (metric only). The gap before the chip is the page's own
    // server-render -> hydration time; the expired-token runs below are judged against the 300 ms limit.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(L(page, 'common.navUserChip')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(800);
    const base = await navFlash(page);
    audit.metrics.push({ kind: 'timing', label: 'logged-out nav flash, valid access token (baseline)', value: base.flash, unit: 'ms', budget: 300, route: audit.route });

    // A well-formed JWT whose exp is in the past, then plain garbage: both must refresh and stay signed in.
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const expired = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ token_type: 'access', exp: 1_600_000_000, user_id: 1 })}.invalidsignature`;
    for (const [kind, access] of [['expired', expired], ['garbage', 'not-a-token']]) {
      await test.step(kind, async () => {
        cap.clear();
        await page.evaluate((t) => localStorage.setItem('accessToken', t), access);
        const refreshBefore = await page.evaluate(() => localStorage.getItem('refreshToken'));
        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect(L(page, 'common.navUserChip')).toBeVisible({ timeout: 15_000 });
        await page.waitForTimeout(1200); // let the sampler see any late flip back to logged out
        const f = await navFlash(page);
        audit.metrics.push({ kind: 'timing', label: `logged-out nav flash, ${kind} access token`, value: f.flash, unit: 'ms', budget: 300, route: audit.route });
        if (f.flash > 300) audit.violation('logged-out-flash', { selector: 'nav.nav3', measured: `${f.flash}ms without the signed-in chip (chip first painted ${f.toChip}ms after the nav; ${kind} token)`, expected: '≤ 300ms', note: f.returned ? `${f.returned}ms of it after the chip had already shown` : undefined });
        await expect(L(page, 'common.navUserChip')).toHaveAttribute('aria-label', label);
        const stored = await page.evaluate(() => [localStorage.getItem('accessToken'), localStorage.getItem('refreshToken')]);
        expect(stored[0], 'a new access token replaced the bad one').not.toBe(access);
        expect(stored[1], 'the refresh token rotated').not.toBe(refreshBefore);
        const refreshes = await cap.entries(/\/api\/token\/refresh\/$/);
        expect(refreshes.map((r) => r.status), 'silent refresh answered 200').toContain(200);
        await audit.shot(`after-${kind}`);
      });
    }
    // The 401s are the test's own condition: calls the page makes with the bad token before the refresh lands.
    await audit.console({ allow: [...LOCAL_LOAD, /status of 401/, /^401 GET /] });
    await audit.done();
  });
});
