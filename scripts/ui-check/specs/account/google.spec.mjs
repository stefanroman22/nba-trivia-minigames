// Account suite: the "Continue with Google" button. Never signs in with a real Google account; the full
// OAuth round trip (consent screen, code exchange, new account) stays a manual owner check (CHECKS.md).
import { test, expect, L, createAudit } from '../../lib/fixtures.mjs';
import { contextOptions } from '../../lib/viewports.mjs';
import { openLogin, LOCAL_LOAD } from '../../lib/guest.mjs';
import { openSignupTab } from '../../lib/account.mjs';

test.use({ persona: 'guest' });

const IN_APP_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.30.110 (iPhone14,5; iOS 17_4; en_US; en-US; scale=3.00; 1170x2532; 600000000)';

/** True when no new tab/popup opens within `ms` of `action`. */
async function opensNoPopup(context, action, ms = 1500) {
  let popup = null;
  const seen = context.waitForEvent('page', { timeout: ms }).then((p) => { popup = p; }, () => {});
  await action();
  await seen;
  if (popup) await popup.close().catch(() => {});
  return !popup;
}

/** The Google script is ready (it loads from accounts.google.com when the modal mounts); false after 15 s. */
const gisReady = (page) => page.waitForFunction(() => !!(window.google && window.google.accounts && window.google.accounts.oauth2), null, { timeout: 15_000 }).then(() => true, () => false);

/** Click Google: its window opens (closed at once, its URL a note) or a Google iframe appears. → true | false */
async function opensGoogle(page, context, audit, label) {
  const popupP = context.waitForEvent('page', { timeout: 10_000 }).catch(() => null);
  await L(page, 'account.google').click();
  const popup = await popupP;
  if (popup) {
    audit.metrics.push({ kind: 'note', label: `google popup url (${label})`, value: popup.url().slice(0, 60), unit: '', route: audit.route });
    await popup.close().catch(() => {});
    return true;
  }
  return (await page.locator('iframe[src*="google"]').count()) > 0;
}

test('[AC-GOOGLE-01] Google button renders and is sized, opens the Google window from both tabs (no tick-box on Sign up), and warns inside an in-app browser', async ({ page, context, browser, baseURL, audit, vp }, testInfo) => {
  test.setTimeout(150_000);
  await audit.goto('/', { waitFor: '#games-grid .gtile' });
  await openLogin(page, vp);
  await page.waitForTimeout(500);

  await test.step('renders, sized, inside the modal', async () => {
    const btn = L(page, 'account.google');
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
    await expect(btn).toContainText('Continue with Google');
    const b = await btn.boundingBox();
    const panel = await L(page, 'guest.modalPanel').boundingBox();
    if (b.height < 40) audit.violation('google-button-size', { selector: 'button.auth-google', measured: `${Math.round(b.width)}×${Math.round(b.height)}px`, expected: 'at least 40px tall' });
    if (b.x < panel.x - 0.5 || b.x + b.width > panel.x + panel.width + 0.5) {
      audit.violation('google-button-overflow', { selector: 'button.auth-google', measured: `x ${Math.round(b.x)}..${Math.round(b.x + b.width)} vs panel ${Math.round(panel.x)}..${Math.round(panel.x + panel.width)}`, expected: 'inside the modal panel' });
    }
    const spill = await btn.evaluate((el) => el.scrollWidth - el.clientWidth);
    if (spill > 1) audit.violation('google-button-overflow', { selector: 'button.auth-google', measured: `content ${spill}px wider than the button`, expected: 'label fits the button' });
    await audit.layout({ scope: '.modal-panel' });
    await audit.shot('google-login');
  });

  // Since 2026-10-26.2 Google is one step from either tab: no tick-box gates it, the note under the buttons is the
  // agreement. A sign-up click opens Google's window exactly like a log-in one, and no consent message shows.
  await test.step('sign-up tab: no tick-box, Google opens straight away', async () => {
    await openSignupTab(page);
    await expect(L(page, 'account.anyCheckbox'), 'no tick-box in the sign-up form').toHaveCount(0);
    await expect(L(page, 'account.termsNote')).toContainText('continuing with Google you agree to our');
    if (!(await gisReady(page))) {
      audit.violation('skip-explained', { selector: 'accounts.google.com/gsi/client', measured: 'script not loaded in 15 s, sign-up click not tried', expected: 'explained: Google unreachable from this machine' });
    } else if (!(await opensGoogle(page, context, audit, 'sign-up'))) {
      audit.violation('google-signup-blocked', { selector: 'button.auth-google', measured: 'no popup and no Google iframe within 10 s of the sign-up click', expected: 'the Google sign-in window opens from Sign up (no tick-box step)' });
    }
    await expect(L(page, 'account.google')).toBeEnabled({ timeout: 5000 });
    await expect(L(page, 'account.authError')).toHaveCount(0);
    await audit.shot('google-signup');
    await L(page, 'guest.authTabLogin').click();
    await expect(L(page, 'guest.authTabLogin')).toHaveAttribute('aria-selected', 'true');
    await expect(L(page, 'account.authError')).toHaveCount(0);
  });

  await test.step('click opens the Google window', async () => {
    if (!(await gisReady(page))) {
      audit.violation('skip-explained', { selector: 'accounts.google.com/gsi/client', measured: 'script not loaded in 15 s, click not tried', expected: 'explained: Google unreachable from this machine' });
      return;
    }
    if (!(await opensGoogle(page, context, audit, 'log-in'))) audit.violation('google-popup', { selector: 'button.auth-google', measured: 'no popup and no Google iframe within 10 s of the click', expected: 'the Google sign-in window opens' });
    // Closing the window leaves the form usable and says nothing.
    await expect(L(page, 'account.google')).toBeEnabled({ timeout: 5000 });
    await expect(L(page, 'account.submit')).toBeEnabled();
    await expect(L(page, 'account.authError')).toHaveCount(0);
  });

  await test.step('in-app browser warning', async () => {
    const ctx = await browser.newContext({ ...contextOptions(vp.id), baseURL, userAgent: IN_APP_UA });
    try {
      const p2 = await ctx.newPage();
      const a2 = await createAudit(p2, testInfo, { project: testInfo.project.name, vp, label: 'instagram' });
      try {
        await a2.goto('/', { waitFor: '#games-grid .gtile' });
        await openLogin(p2, vp);
        const none = await opensNoPopup(ctx, () => L(p2, 'account.google').click());
        if (!none) a2.violation('google-in-app', { selector: 'button.auth-google', measured: 'a window opened inside an Instagram user agent', expected: 'the in-app-browser warning instead' });
        await expect(L(p2, 'account.authError')).toContainText("Google doesn't allow sign-in inside this app's browser");
        await a2.layout({ scope: '.modal-panel' });
        await a2.shot('in-app-warning');
        await a2.console({ allow: LOCAL_LOAD });
        await a2.done();
      } finally {
        await a2.finalize();
      }
    } finally {
      await ctx.close().catch(() => {});
    }
  });

  await audit.console({ allow: LOCAL_LOAD });
  await audit.done();
});
