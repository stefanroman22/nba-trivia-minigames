// Logic Check — pages suite: the public routes on the checkout (local stack, prod build), in one Chromium context.
// Status, shell, hydration and one real click; never layout, motion or perf budgets (UI check's G- rows own those —
// spec §5: G-PERF-01 holds the local load times). TTFB is recorded as a metric only.
import { test } from '../../lib/fixtures.mjs';
import { NOT_FOUND_ROUTE, publicRoutes } from '../../lib/app.mjs';
import { L } from '../../../ui-check/lib/pagemap.mjs';

const SHELL = 'main.page, #root *';

/** React attached its event props to an interactive element (the app is hydrated, clicks are handled). */
const hydrated = (page) => page.waitForFunction(() => {
  const els = document.querySelectorAll('button, input, a[href]');
  for (let i = 0; i < els.length && i < 60; i++) if (Object.keys(els[i]).some((k) => k.startsWith('__reactProps$'))) return true;
  return false;
}, null, { timeout: 10_000 }).then(() => true, () => false);

test('[LC-PAGES-01] every public route loads with its status, the app shell and hydration; a click on the 404 page navigates home', async ({ page, lc }) => {
  await lc.page(page);
  const load = async (route, status) => {
    const res = await page.goto(route, { waitUntil: 'domcontentloaded' }).catch((e) => ({ error: e }));
    if (!res || res.error) { lc.violation('unreachable', { route, selector: `GET ${route}`, measured: String(res && res.error ? res.error.message : 'no response').split('\n')[0], expected: `HTTP ${status}` }); return false; }
    if (res.status() !== status) lc.violation('http-status', { route, selector: `GET ${route}`, measured: `HTTP ${res.status()}`, expected: `HTTP ${status}` });
    if (!(await page.waitForSelector(SHELL, { timeout: 20_000 }).then(() => true, () => false))) {
      lc.violation('shell', { route, selector: SHELL, measured: 'no app shell after 20s', expected: 'the app shell renders' });
      return false;
    }
    if (!(await hydrated(page))) lc.violation('not-hydrated', { route, selector: 'button, input, a[href]', measured: 'no React event props after 10s', expected: 'a hydrated page (clicks work)' });
    const ttfb = await page.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; return n ? Math.round(n.responseStart - n.requestStart) : null; });
    if (ttfb !== null) lc.metric(`ttfb ${route}`, ttfb, { route, kind: 'perf' });
    return true;
  };

  for (const route of publicRoutes()) await test.step(route, () => load(route, 200));
  await test.step(`${NOT_FOUND_ROUTE} → 404, then "Back to games"`, async () => {
    if (!(await load(NOT_FOUND_ROUTE, 404))) return;
    const back = L(page, 'guest.notFoundHome');
    if (!(await back.isVisible().catch(() => false))) {
      lc.violation('hydration-click', { route: NOT_FOUND_ROUTE, selector: 'button "Back to games"', measured: 'not visible', expected: 'the 404 page offers Back to games' });
      return;
    }
    await back.click();
    const home = await page.waitForURL((u) => u.pathname === '/', { timeout: 10_000 }).then(() => true, () => false);
    if (!home) lc.violation('hydration-click', { route: NOT_FOUND_ROUTE, selector: 'button "Back to games"', measured: `still on ${new URL(page.url()).pathname} 10s after the click`, expected: 'navigates to /' });
  });
  await lc.done();
});
