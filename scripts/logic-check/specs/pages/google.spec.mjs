// Logic Check — auth suite, browser: Google sign-in on the checkout (spec §5: the Google button is a browser case).
// The GIS script loads (network 200) when the login modal mounts it, the button is there, and a click opens Google's
// window (closed at once) or its iframe. No OAuth round trip: the consent screen and the code exchange stay a manual
// owner check; LC-AUTH-07 covers /api/login/google/ with bad input. Never layout or motion (UI check's AC-GOOGLE-01).
import { test, expect } from '../../lib/fixtures.mjs';
import { L } from '../../../ui-check/lib/pagemap.mjs';

const GIS = /^https:\/\/accounts\.google\.com\/gsi\/client/;

test('[LC-AUTH-GOOGLE-01] Google sign-in: the GIS script loads, the button is present, a click opens Google\'s window', async ({ page, context, lc }) => {
  const pa = await lc.page(page);
  const route = '/';
  await pa.goto('/', { waitFor: '#games-grid .gtile' });
  const gis = page.waitForResponse((r) => GIS.test(r.url()), { timeout: 20_000 }).catch(() => null);
  await L(page, 'common.navLogin').click();
  await expect(L(page, 'guest.modalPanel')).toBeVisible();

  await test.step('GIS script → 200', async () => {
    const res = await gis;
    if (!res) lc.violation('google', { route, selector: 'GET accounts.google.com/gsi/client', measured: 'not requested within 20 s of opening the login modal', expected: 'the modal loads Google Identity Services' });
    else if (res.status() !== 200) lc.violation('google', { route, selector: 'GET accounts.google.com/gsi/client', measured: `HTTP ${res.status()}`, expected: 'HTTP 200' });
    const ready = await page.waitForFunction(() => !!(window.google && window.google.accounts && window.google.accounts.oauth2), null, { timeout: 15_000 }).then(() => true, () => false);
    if (!ready) lc.violation('google', { route, selector: 'window.google.accounts.oauth2', measured: 'not defined 15 s after the modal opened', expected: 'the GIS client initialised' });
  });
  await test.step('"Continue with Google" is present and enabled', async () => {
    const btn = L(page, 'account.google');
    if (!(await btn.isVisible().catch(() => false))) { lc.violation('google', { route, selector: 'button.auth-google', measured: 'not visible', expected: 'the Google button in the login modal' }); return; }
    if (!(await btn.isEnabled())) lc.violation('google', { route, selector: 'button.auth-google', measured: 'disabled', expected: 'enabled' });
    const text = (await btn.textContent()) || '';
    if (!/Continue with Google/.test(text)) lc.violation('google', { route, selector: 'button.auth-google', measured: `"${text.trim()}"`, expected: '"Continue with Google"' });
  });
  await test.step('a click opens Google\'s window (popup or GIS iframe), closed at once', async () => {
    const popupP = context.waitForEvent('page', { timeout: 10_000 }).catch(() => null);
    await L(page, 'account.google').click();
    const popup = await popupP;
    if (popup) {
      await popup.waitForURL(/^https:\/\/accounts\.google\.com\//, { timeout: 10_000, waitUntil: 'commit' }).catch(() => {}); // opens as about:blank first
      const host = (() => { try { return new URL(popup.url()).hostname; } catch { return ''; } })();
      if (!/(^|\.)google\.com$/.test(host)) lc.violation('google', { route, selector: 'popup', measured: popup.url().slice(0, 80), expected: 'a Google window (accounts.google.com)' });
      await popup.close().catch(() => {});
    } else if (!(await page.locator('iframe[src*="accounts.google.com"]').count())) {
      lc.violation('google', { route, selector: 'button.auth-google', measured: 'no popup and no Google iframe within 10 s of the click', expected: 'the Google sign-in window opens' });
    }
  });
  await lc.console({ allow: [/accounts\.google\.com/, /Cross-Origin-Opener-Policy/i, /\[GSI_LOGGER\]/] });
  await lc.done();
});
