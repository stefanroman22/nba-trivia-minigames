// Account suite: every submit in the suite blocks a second submit. Each server answer is held back 1.5 s
// (page.route) so the busy window is long enough to see; the button must show it within 100 ms of the
// click, and a second click while it is busy must not send a second request.
import { test, expect, L, createAudit, seedContext } from '../../lib/fixtures.mjs';
import { contextOptions } from '../../lib/viewports.mjs';
import { mintTokens, credentials, soloUsername } from '../../lib/accounts.mjs';
import { LOCAL_LOAD, openLogin, routeLatency } from '../../lib/guest.mjs';
import { HASHING, apiCall, clearFriendship, openSignupTab, fillSignup, throwawayName, deleteAccountApi } from '../../lib/account.mjs';
import { fileURLToPath } from 'node:url';

const AVATAR = fileURLToPath(new URL('../../fixtures/upload/avatar.png', import.meta.url));
const HOLD_MS = 1500;
/** The 1.5 s answers are held back by this test on purpose, so the generic 1 s slow-api rule does not apply to them. */
const HELD = [/^slow POST \S+\/api\/(update-profile|send-friend-request|account\/age|account\/delete|login|signup)\/$/];
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
        busy: `(() => { const b = document.querySelector('.fr-row button.fr-btn-primary'); return !b || b.disabled || /Sending/.test(b.textContent); })()`,
      });
      await expect(row.locator('.fr-status')).toHaveText('Request sent', { timeout: 15_000 });
    });

    if (throttled) {
      // Export, delete and set-age share one 10-an-hour limit per ACCOUNT, and the serial pass runs every viewport on the
      // same solo account (AC-PROFILE-02 already uses seven of them), so these two submits use a throwaway user.
      throwaway = throwawayName(3, vp);
      const tokens = (await mintTokens([throwaway]))[throwaway];
      const g = await guestPage(browser, baseURL, testInfo, vp, 'throwaway', tokens);
      try {
        await test.step('photo age Continue', async () => {
          await g.audit.goto('/profile', { waitFor: 'section.ps-hero' });
          await L(g.page, 'account.psPhotoInput').setInputFiles(AVATAR);
          await expect(L(g.page, 'account.agePrompt')).toBeVisible({ timeout: 15_000 });
          await L(g.page, 'account.ageMonth').selectOption('6');
          await L(g.page, 'account.ageYear').selectOption(String(new Date().getFullYear() - 30));
          await submitGuard(g.audit, {
            label: 'photo age Continue', button: L(g.page, 'account.ageContinue'), urlRe: /\/api\/account\/age\/$/,
            busy: `(() => { const b = document.querySelector('form.photo-age button[type=submit]'); return !b || b.disabled || /Saving/.test(b.textContent); })()`,
          });
          await expect(L(g.page, 'account.psPhotoState')).toHaveText('Shown to other players', { timeout: 20_000 });
        });

        await test.step('delete account (wrong password, nothing is deleted)', async () => {
          await g.audit.goto('/profile', { waitFor: 'section.ps-hero' });
          await L(g.page, 'account.psDeleteToggle').click();
          await L(g.page, 'account.psDeleteWord').fill('DELETE');
          await L(g.page, 'account.psDeletePassword').fill('not-the-password');
          await submitGuard(g.audit, {
            label: 'delete account', button: L(g.page, 'account.psDeleteConfirm'), urlRe: /\/api\/account\/delete\/$/,
            busy: `(() => { const b = [...document.querySelectorAll('.ps-delete button')].find((x) => /Delet/.test(x.textContent)); return !!b && (b.disabled || /Deleting/.test(b.textContent)); })()`,
          });
          await expect(L(g.page, 'account.psDeleteError')).toBeVisible({ timeout: 10_000 });
        });
        await g.audit.console({ allow: [...LOCAL_LOAD, ...HASHING, ...HELD, /status of (403|428)/, /^(403|428) POST /] });
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
            busy: `(() => { const b = document.querySelector('.modal-panel button.modal-primary-btn'); return !b || b.disabled || /Logging in/.test(b.textContent); })()`,
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
            await L(g.page, 'account.consentBox').check();
            await submitGuard(g.audit, {
              label: 'sign up', button: L(g.page, 'account.submit'), urlRe: /\/api\/signup\/$/,
              busy: `(() => { const b = document.querySelector('.modal-panel button.modal-primary-btn'); return !b || b.disabled || /Creating/.test(b.textContent); })()`,
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
    await audit.console({ allow: [...LOCAL_LOAD, ...HASHING, ...HELD, /status of (403|428)/, /^(403|428) POST /] });
  } finally {
    await apiCall(request, session.access, 'POST', 'update-profile/', { username: original });
    await apiCall(request, session.access, 'POST', 'account/remove-photo/');
    await clearFriendship(request, session.access, other.user.id);
    if (throwaway) audit.metrics.push({ kind: 'note', label: `cleanup ${throwaway}`, value: String(await deleteAccountApi(request, throwaway)), unit: '', route: '/profile' });
    const me = await apiCall(request, session.access, 'GET', 'me/');
    if (me.body?.user?.username !== original) audit.violation('cleanup', { selector: `account ${original}`, measured: `username is "${me.body?.user?.username}"`, expected: `restored to ${original}` });
  }
  await audit.done();
});
