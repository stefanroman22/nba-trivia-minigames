// Guest performance: cold load metrics for / and a game, route-change latency.
// Tagged @perf: run.mjs runs it alone (one worker) after the parallel pass. No LOCAL_LOAD allowance here:
// a slow /api/get-users/ must show up.
import { test, expect, L, createAudit } from '../../lib/fixtures.mjs';
import { contextOptions } from '../../lib/viewports.mjs';
import { inPage, perfSnapshot } from '../../lib/detect.mjs';
import { IS_PROD, gameById, tileFor, railTarget, routeLatency } from '../../lib/guest.mjs';

test('[G-PERF-01] @perf cold load performance of / and a game, and route-change latency', async ({ page, audit, vp, browser, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  const first = gameById('series-winner'), third = gameById('guess-mvps');
  const cold = [];

  // Cold = the first load in a brand-new context (empty HTTP cache, no storage). Budgets (prod) apply to
  // this value. A warm reload of the same page is recorded as a metric only.
  for (const [name, route, ready] of [['home', '/', '#games-grid .gtile'], ['game', first.path, '.stage-col .idle']]) {
    const context = await browser.newContext({ ...contextOptions(vp.id), baseURL });
    const page2 = await context.newPage();
    const a = await createAudit(page2, testInfo, { vp, label: `cold-${name}` });
    cold.push({ a, context });
    await a.goto(route, { waitFor: ready });
    await a.perf(`${name} cold`);
    await page2.reload({ waitUntil: 'domcontentloaded' });
    await page2.waitForSelector(ready);
    await page2.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await page2.waitForTimeout(400);
    const warm = await page2.evaluate(inPage(perfSnapshot));
    for (const k of ['ttfb', 'fcp', 'lcp', 'cls']) {
      if (warm[k] !== null && warm[k] !== undefined) a.metrics.push({ kind: 'perf', label: `${name} warm ${k}`, value: warm[k], unit: k === 'cls' ? '' : 'ms', route: a.route });
    }
    await a.console();
  }

  // Click -> the new page's main content is in the DOM and no longer transparent. Measured inside the
  // page, so the budget (1000ms in prod) is not eaten by CDP round trips. The dev server compiles routes
  // on demand, so in dev the check only records.
  const budget = IS_PROD() ? 1000 : 8000;
  const onGame = (g) => `location.pathname === '${g.path}' && !!document.querySelector('section.stage-col .idle') && document.querySelector('section.stage-col h1')?.textContent === ${JSON.stringify(g.name)} && +getComputedStyle(document.querySelector('#root > div')).opacity > 0.05`;

  await audit.goto('/', { waitFor: '#games-grid .gtile' });
  const tile = tileFor(page, first);
  await tile.scrollIntoViewIfNeeded();
  await routeLatency(audit, 'home -> game (card click to idle screen)', () => tile.click(), onGame(first), budget);
  await routeLatency(audit, 'game -> game (rail or chip click to idle screen)', () => railTarget(page, vp, third).click(), onGame(third), budget);
  await routeLatency(audit, 'game -> home (brand click to grid)', () => L(page, 'common.navBrand').click(),
    `location.pathname === '/' && document.querySelectorAll('#games-grid .gtile').length > 0 && +getComputedStyle(document.querySelector('#root > div')).opacity > 0.05`, budget);
  await expect(L(page, 'guest.gameTiles').first()).toBeVisible();
  await audit.console();

  const errors = [];
  for (const { a, context } of cold) {
    try { await a.done(); } catch (e) { errors.push(e); }
    await context.close().catch(() => {});
  }
  try { await audit.done(); } catch (e) { errors.push(e); }
  if (errors.length) throw errors[0];
});
