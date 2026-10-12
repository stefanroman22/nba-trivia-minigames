// Guest performance: load metrics for / and a game, route-change latency.
import { test, expect, L } from '../../lib/fixtures.mjs';
import { IS_PROD, playableGames, routeLatency, LOCAL_LOAD } from '../../lib/guest.mjs';

test('[G-PERF-01] load performance of / and a game, and route-change latency', async ({ page, audit }) => {
  test.setTimeout(120_000);
  const games = playableGames();
  // One warm-up load first: the metrics describe a normal visit, not the first hit on a cold route
  // while four browsers share one local server.
  await audit.goto('/', { waitFor: '#games-grid .gtile' });
  await audit.goto('/', { waitFor: '#games-grid .gtile' });
  await audit.perf('home');

  await audit.goto(games[0].path, { waitFor: '.stage-col .idle' });
  await audit.perf('game');

  // Click -> the new page's main content is in the DOM and no longer transparent. Measured inside the
  // page, so the budget (1000ms in prod) is not eaten by CDP round trips. The dev server compiles routes
  // on demand, so in dev the check only records.
  const budget = IS_PROD() ? 1000 : 8000;
  const onGame = (g) => `location.pathname === '${g.path}' && !!document.querySelector('section.stage-col .idle') && document.querySelector('section.stage-col h1')?.textContent === ${JSON.stringify(g.name)} && +getComputedStyle(document.querySelector('#root > div')).opacity > 0.05`;

  await audit.goto('/', { waitFor: '#games-grid .gtile' });
  const tile = L(page, 'guest.gameTiles').first();
  await tile.scrollIntoViewIfNeeded();
  await routeLatency(audit, 'home -> game (card click to idle screen)', () => tile.click(), onGame(games[0]), budget);

  const w = page.viewportSize().width;
  await routeLatency(audit, 'game -> game (rail or chip click to idle screen)', () => L(page, w <= 820 ? 'guest.railChips' : 'guest.railItems').nth(2).click(), onGame(games[2]), budget);

  await routeLatency(audit, 'game -> home (brand click to grid)', () => L(page, 'common.navBrand').click(),
    `location.pathname === '/' && document.querySelectorAll('#games-grid .gtile').length > 0 && +getComputedStyle(document.querySelector('#root > div')).opacity > 0.05`, budget);
  await expect(L(page, 'guest.gameTiles').first()).toBeVisible();
  await audit.console({ allow: LOCAL_LOAD });
  await audit.done();
});
