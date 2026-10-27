// Account suite: every submit in the suite blocks a second submit. Each server answer is held back 1.5 s
// (page.route) so the busy window is long enough to see; the button must show it within 100 ms of the
// click, and a second click while it is busy must not send a second request.
import { test, expect, L, createAudit, seedContext } from '../../lib/fixtures.mjs';
import { contextOptions } from '../../lib/viewports.mjs';
import { mintTokens, credentials, soloUsername } from '../../lib/accounts.mjs';
import { LOCAL_LOAD, openLogin, routeLatency } from '../../lib/guest.mjs';
import { HASHING, apiCall, clearFriendship, openSignupTab, fillSignup, throwawayName, restoreUsername, removePhoto, clearFriendshipChecked, deleteThrowaway } from '../../lib/account.mjs';

const HOLD_MS = 1500;
/** The 1.5 s answers are held back by this test on purpose, so the generic 1 s slow-api rule does not apply to them. */
const HELD = [/^slow POST \S+\/api\/(update-profile|send-friend-request|account\/delete|login|signup)\/$/];
const BUSY_MS = 100;

/**
 * Click `button` with the answer to `urlRe` held back; `busy` (a JS expression run in the page on every frame)
 * must turn true within BUSY_MS of the click; then click again and count the requests that went out.
 */
async function submitGuard(audit, { label, button, busy, urlRe, method = 'POST' }) {
  const { page } = audit;
  const sent = [];
  const onRequest = (r) => { if (r.method() === method && urlRe.test(r.url())) sent.push(r.url()); };
  page.on('request', onRequest);
  await page.route(urlRe, async (route) => {
    if (route.request().method() !== method) { await route.continue(); return; }
    await new Promise((r) => setTimeout(r, HOLD_MS));
    await route.continue().catch(() => {});
  });
  try {
    await routeLatency(audit, `${label}: busy after click`, () => button.click(), busy, BUSY_MS);
    await button.click({ force: true, timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(250);
    await button.click({ force: true, timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(HOLD_MS + 900);
  } finally {
    page.off('request', onRequest);
    await page.unroute(urlRe).catch(() => {});
  }
  audit.metrics.push({ kind: 'note', label: `${label}: requests sent`, value: String(sent.length), unit: '', route: audit.route });
  if (sent.length !== 1) audit.violation('double-submit', { selector: label, measured: `${sent.length} ${method} requests for 3 clicks`, expected: 'exactly 1' });
}

/** A page in a fresh context at the same viewport: logged out, or signed in with `tokens` (a minted session). */
async function guestPage(browser, baseURL, testInfo, vp, label, tokens = null) {
  const ctx = await browser.newContext({ ...contextOptions(vp.id), baseURL });
  if (tokens) await seedContext(ctx, baseURL, tokens);
  const page = await ctx.newPage();
  const audit = await createAudit(page, testInfo, { project: testInfo.project.name, vp, label });
  return { ctx, page, audit };
}

test('[AC-BLOCK-01] @perf every submit disables or shows its busy label within 100 ms and a second click sends no second request', async ({ browser, baseURL, page, audit, vp, request, session }, testInfo) => {
  test.setTimeout(420_000);
  const original = session.username;
  const other = (await mintTokens(['testuser2'])).testuser2;
  await clearFriendship(request, session.access, other.user.id);
  await apiCall(request, session.access, 'POST', 'account/remove-photo/');
  const throttled = vp.core;
  let throwaway = null;
  try {
    await test.step('username Save', async () => {
      await audit.goto('/profile', { waitFor: 'section.ps-hero' });
      await L(page, 'account.psUsernameBtn').click();
      await L(page, 'account.psUsername').fill(`Block${vp.width}`);
      await submitGuard(audit, {
        label: 'username Save', button: L(page, 'account.psUsernameBtn'), urlRe: /\/api\/update-profile\/$/,
        busy: `document.querySelector('.ps-row:has(#ps-username) button.ps-link-btn').disabled`,
      });
      await expect(L(page, 'account.psTitle')).toHaveText(`Block${vp.width}`);
    });

    await test.step('friend Add', async () => {
      await page.addInitScript(() => { try { localStorage.setItem('sq:profile-view', 'friends'); } catch { /* storage blocked */ } });
      await audit.goto('/', { waitFor: '#leaderboard .lb-card' });
      await L(page, 'account.profileCard').scrollIntoViewIfNeeded();
      await L(page, 'account.frTabFind').click();
      await L(page, 'account.frSearch').fill(other.user.id);
      const row = page.locator('.fr-row', { hasText: `#${other.user.id}` });
      await expect(row).toBeVisible({ timeout: 15_000 });
      await submitGuard(audit, {
        label: 'friend Add', button: row.locator('button.fr-btn-primary'), urlRe: /\/api\/send-friend-request\/$/,
        busy: `(() => { const b = document.querySelector('.fr-row button.fr-btn-primary'); return !!b && (b.disabled || /Sending/.test(b.textContent)); })()`,
      });
      await expect(row.locator('.fr-status')).toHaveText('Request sent', { timeout: 15_000 });
    });

    if (throttled) {
      // Export and delete share one 10-an-hour limit per ACCOUNT, and the serial pass runs every viewport on the same solo
      // account, so the delete submit uses a throwaway user. (The photo age Continue submit went with the age prompt,
      // 2026-10-26.2: a photo now uploads on pick, with no submit button to guard.)
      throwaway = throwawayName(3, vp);
      const tokens = (await mintTokens([throwaway]))[throwaway];
      const g = await guestPage(browser, baseURL, testInfo, vp, 'throwaway', tokens);
      try {
        // The button only unlocks once the username and the word match (no password to get wrong), so the
        // throwaway really deletes itself here; the finally below is then a no-op cleanup.
        await test.step('delete account (the throwaway is deleted once)', async () => {
          await g.audit.goto('/profile', { waitFor: 'section.ps-hero' });
          await L(g.page, 'account.psDeleteToggle').click();
          await L(g.page, 'account.psDeleteName').fill(tokens.user.username);
          await L(g.page, 'account.psDeleteWord').fill('delete');
          await submitGuard(g.audit, {
            label: 'delete account', button: L(g.page, 'account.psDeleteConfirm'), urlRe: /\/api\/account\/delete\/$/,
            busy: `(() => { const b = [...document.querySelectorAll('.ps-delete button')].find((x) => /Delet/.test(x.textContent)); return !b || b.disabled || /Deleting/.test(b.textContent); })()`,
          });
          await expect(g.page.locator('section.ps-empty')).toBeVisible({ timeout: 10_000 });
        });
        await g.audit.console({ allow: [...LOCAL_LOAD, ...HASHING, ...HELD, /status of 403/, /^403 POST /] });
        await g.audit.done();
      } finally {
        await g.audit.finalize();
        await g.ctx.close().catch(() => {});
      }

      const who = credentials(soloUsername(testInfo.parallelIndex));
      await test.step('log in (wrong password)', async () => {
        const g = await guestPage(browser, baseURL, testInfo, vp, 'login');
        try {
          await g.audit.goto('/', { waitFor: '#games-grid .gtile' });
          await openLogin(g.page, vp);
          await L(g.page, 'account.loginId').fill(who.username);
          await L(g.page, 'account.password').fill('not-the-password');
          await submitGuard(g.audit, {
            label: 'log in', button: L(g.page, 'account.submit'), urlRe: /\/api\/login\/$/,
            busy: `(() => { const b = document.querySelector('.modal-panel button.modal-primary-btn'); return !!b && (b.disabled || /Logging in/.test(b.textContent)); })()`,
          });
          await expect(L(g.page, 'account.authError')).toBeVisible({ timeout: 10_000 });
          await g.audit.console({ allow: [...LOCAL_LOAD, ...HASHING, ...HELD, /status of 401/, /^401 POST /] });
          await g.audit.done();
        } finally {
          await g.audit.finalize();
          await g.ctx.close().catch(() => {});
        }
      });

      if (vp.id === 'phone-390') {
        // One viewport only: sign-up is throttled to 10 an hour per IP and AC-SIGNUP-02 uses six of them.
        await test.step('sign up (duplicate email, nothing is created)', async () => {
          const g = await guestPage(browser, baseURL, testInfo, vp, 'signup');
          try {
            await g.audit.goto('/', { waitFor: '#games-grid .gtile' });
            await openLogin(g.page, vp);
            await openSignupTab(g.page);
            await fillSignup(g.page, { email: credentials('testuser3').email, username: 'BlockCheck', password: who.password });
            await submitGuard(g.audit, {
              label: 'sign up', button: L(g.page, 'account.submit'), urlRe: /\/api\/signup\/$/,
              busy: `(() => { const b = document.querySelector('.modal-panel button.modal-primary-btn'); return !!b && (b.disabled || /Creating/.test(b.textContent)); })()`,
            });
            await expect(L(g.page, 'account.authError')).toBeVisible({ timeout: 10_000 });
            await g.audit.console({ allow: [...LOCAL_LOAD, ...HASHING, ...HELD, /status of 409/, /^409 POST /] });
            await g.audit.done();
          } finally {
            await g.audit.finalize();
            await g.ctx.close().catch(() => {});
          }
        });
      }
    }
    await audit.console({ allow: [...LOCAL_LOAD, ...HASHING, ...HELD, /status of 403/, /^403 POST /] });
  } finally {
    await restoreUsername(audit, request, original);
    await removePhoto(audit, request, original);
    await clearFriendshipChecked(audit, request, original, other.user.id);
    if (throwaway) await deleteThrowaway(audit, request, throwaway);
  }
  await audit.done();
});

// ---------------------------------------------------------------------------------------------------
// No action waits more than 400 ms on an animation: from the click (or from the server's answer, for the
// log-in close) until the next control is interactable = enabled, visible and not covered (elementFromPoint).
const WAIT_MS = 400;
const interactable = (sel) => `(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.getClientRects().length > 0); if (!el || el.disabled) return false; const r = el.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!h && el.contains(h); })()`;

test.describe('animation waits', () => {
  test.use({ persona: 'guest' });

  test('[AC-BLOCK-02] @perf tab switches and closing the log-in modal leave the next control usable within 400 ms', async ({ page, audit, vp }) => {
    test.setTimeout(240_000);
    await audit.goto('/', { waitFor: '#games-grid .gtile' });
    await openLogin(page, vp);
    await page.waitForTimeout(600);
    await routeLatency(audit, 'Log in -> Sign up: Email field usable', () => L(page, 'guest.authTabSignup').click(), interactable(".modal-panel input[aria-label='Email']"), WAIT_MS);
    await page.waitForTimeout(600);
    await routeLatency(audit, 'Sign up -> Log in: Email or username field usable', () => L(page, 'guest.authTabLogin').click(), interactable(".modal-panel input[aria-label='Email or username']"), WAIT_MS);
    await page.waitForTimeout(600);
    // The X: the page behind (the nav brand, covered by the backdrop while the modal is open) is usable again.
    await routeLatency(audit, 'modal X: nav brand usable', () => L(page, 'guest.modalClose').click(), interactable('nav.nav3 a.nav3-brand'), WAIT_MS);
    await expect(L(page, 'guest.modalBackdrop')).toHaveCount(0);
    await audit.console({ allow: LOCAL_LOAD });
    await audit.done();
  });

  test('[AC-BLOCK-03] @perf after a successful log in the page behind the modal is usable within 400 ms of the success message', async ({ page, audit, vp }, testInfo) => {
    test.skip(!vp.core, 'throttled endpoint — core viewports only');
    test.setTimeout(240_000);
    const who = credentials(soloUsername(testInfo.parallelIndex));
    await audit.goto('/', { waitFor: '#games-grid .gtile' });
    await openLogin(page, vp);
    await L(page, 'account.loginId').fill(who.username);
    await L(page, 'account.password').fill(who.password);
    await L(page, 'account.submit').click();
    await expect(L(page, 'account.successTitle')).toBeVisible({ timeout: 15_000 });
    // From the moment the success message shows (the server has answered) until the nav avatar can be pressed.
    const ms = Math.round(await page.evaluate(({ predicate }) => new Promise((resolve, reject) => {
      const t0 = performance.now();
      const ok = new Function(`return (${predicate});`);
      const tick = () => { if (ok()) resolve(performance.now() - t0); else if (performance.now() - t0 > 10000) reject(new Error('never usable')); else requestAnimationFrame(tick); };
      tick();
    }), { predicate: interactable('nav.nav3 button.nav3-user') }));
    audit.metrics.push({ kind: 'timing', label: 'log in success -> nav avatar usable', value: ms, unit: 'ms', budget: WAIT_MS, route: audit.route });
    if (ms > WAIT_MS) audit.violation('slow-action', { selector: 'log in success -> nav avatar usable', measured: `${ms}ms (success pane hold + modal exit)`, expected: `<= ${WAIT_MS}ms` });
    await audit.console({ allow: [...LOCAL_LOAD, ...HASHING] });
    await audit.done();
  });
});
