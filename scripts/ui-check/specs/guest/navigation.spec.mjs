// Guest navigation: top nav / drawer, footer, game rail and chips, landing grid.
import { test, expect, L } from '../../lib/fixtures.mjs';
import { drawerMode, chipsMode, openDrawer, playableGames, gameById, railTarget, explainDisabled, recordFrames, fadeSummary, valleys, searchLatency, LOCAL_LOAD } from '../../lib/guest.mjs';
import { visibleGames } from '../../lib/games-catalog.mjs';

/** Wait until #games-grid has been scrolled into the upper part of the viewport (the scroll is smooth). */
async function expectGamesInView(page) {
  await expect.poll(() => page.evaluate(() => {
    const r = document.getElementById('games-grid').getBoundingClientRect();
    return r.top < window.innerHeight * 0.6 && r.bottom > 0;
  }), { timeout: 5000, message: '#games-grid scrolled into view' }).toBe(true);
}

const modalTitle = (page) => L(page, 'guest.modalTitle');
const pageScrollTop = (page) => page.evaluate(() => window.scrollY);

test('[G-NAV-01] top nav links and the mobile drawer each do what they say', async ({ page, audit, vp }) => {
  test.setTimeout(150_000);
  await audit.goto('/', { waitFor: '#games-grid .gtile' });
  const first = gameById('series-winner');

  if (!drawerMode(vp)) {
    await expect(L(page, 'common.navGames')).toBeVisible();
    await expect(L(page, 'common.navAdmin')).toHaveCount(0);

    await test.step('Games scrolls to the grid', async () => {
      await L(page, 'common.navGames').click();
      await expectGamesInView(page);
    });
    await test.step('Leaderboard opens the leaderboard modal', async () => {
      await L(page, 'common.navLeaderboard').click();
      await expect(modalTitle(page)).toHaveText('Global Top 100');
      await page.keyboard.press('Escape');
      await expect(L(page, 'guest.modalBackdrop')).toHaveCount(0);
    });
    await test.step('Feedback opens the feedback modal', async () => {
      await L(page, 'common.navFeedback').click();
      await expect(modalTitle(page)).toHaveText('Share feedback');
      await page.keyboard.press('Escape');
      await expect(L(page, 'guest.modalBackdrop')).toHaveCount(0);
    });
    await test.step('Log in opens the login modal', async () => {
      await L(page, 'common.navLogin').click();
      await expect(modalTitle(page)).toHaveText('Welcome back');
      await page.keyboard.press('Escape');
      await expect(L(page, 'guest.modalBackdrop')).toHaveCount(0);
    });
    await test.step('from a game page, Games routes home to the grid; the brand goes home', async () => {
      await audit.goto(first.path, { waitFor: '.stage-col .idle' });
      await L(page, 'common.navGames').click();
      await expect(page).toHaveURL(/\/#games-grid$/);
      await expect(L(page, 'guest.gamesSection')).toBeVisible();
      await expectGamesInView(page);
      await audit.goto('/privacy', { waitFor: 'main article h1' });
      await L(page, 'common.navBrand').click();
      await expect(page).toHaveURL(/\/$/);
      await expect(L(page, 'guest.gameTiles').first()).toBeVisible();
    });
  } else {
    await expect(L(page, 'common.navGames')).toBeHidden();
    await expect(L(page, 'common.navMenuButton')).toBeVisible();

    await test.step('the drawer opens and closes with an animation', async () => {
      await audit.motion(async () => { await L(page, 'common.navMenuButton').click(); await expect(L(page, 'common.drawer')).toBeVisible(); }, { watch: ['#nav-drawer'] });
      const frames = await recordFrames(page, '#nav-drawer', async () => { await L(page, 'common.drawerClose').click(); }, { tail: 600 });
      const exit = fadeSummary(frames);
      if (exit.intermediate < 1) audit.violation('snap', { selector: '#nav-drawer', measured: `closed with no part-way frame among ${exit.frames} sampled`, expected: 'an animated exit' });
      await expect(L(page, 'common.drawer')).toHaveCount(0);
      await openDrawer(page);
      await page.keyboard.press('Escape');
      await expect(L(page, 'common.drawer')).toHaveCount(0);
      await expect(L(page, 'common.navMenuButton')).toBeFocused();
    });
    await test.step('drawer Games scrolls to the grid and closes the drawer', async () => {
      await openDrawer(page);
      await L(page, 'common.drawerGames').click();
      await expect(L(page, 'common.drawer')).toHaveCount(0);
      await expectGamesInView(page);
    });
    await test.step('drawer Leaderboard opens the modal and closes the drawer', async () => {
      await openDrawer(page);
      await L(page, 'common.drawerLeaderboard').click();
      await expect(L(page, 'common.drawer')).toHaveCount(0);
      await expect(modalTitle(page)).toHaveText('Global Top 100');
      await page.keyboard.press('Escape');
      await expect(L(page, 'guest.modalBackdrop')).toHaveCount(0);
    });
    await test.step('drawer Feedback opens the modal and closes the drawer', async () => {
      await openDrawer(page);
      await L(page, 'common.drawerFeedback').click();
      await expect(L(page, 'common.drawer')).toHaveCount(0);
      await expect(modalTitle(page)).toHaveText('Share feedback');
      await page.keyboard.press('Escape');
      await expect(L(page, 'guest.modalBackdrop')).toHaveCount(0);
    });
    await test.step('drawer Log in / Sign up opens the login modal', async () => {
      await openDrawer(page);
      await expect(L(page, 'common.drawerProfile')).toHaveCount(0);
      await L(page, 'common.drawerLogin').click();
      await expect(L(page, 'common.drawer')).toHaveCount(0);
      await expect(modalTitle(page)).toHaveText('Welcome back');
      await page.keyboard.press('Escape');
      await expect(L(page, 'guest.modalBackdrop')).toHaveCount(0);
    });
    await test.step('from a game page, drawer Games routes home and the drawer closes', async () => {
      await audit.goto(first.path, { waitFor: '.stage-col .idle' });
      await openDrawer(page);
      await L(page, 'common.drawerGames').click();
      await expect(L(page, 'common.drawer')).toHaveCount(0);
      await expect(page).toHaveURL(/\/#games-grid$/);
      await expectGamesInView(page);
    });
    await test.step('the drawer brand goes home and the drawer closes', async () => {
      await audit.goto('/privacy', { waitFor: 'main article h1' });
      await openDrawer(page);
      await L(page, 'common.drawer').locator('a.nav3-brand').click();
      await expect(L(page, 'common.drawer')).toHaveCount(0);
      await expect(page).toHaveURL(/\/$/);
    });
  }
  await audit.console({ allow: LOCAL_LOAD });
  await audit.done();
});

test('[G-NAV-02] footer links (Games, Terms, Privacy, Contact) work', async ({ page, audit }) => {
  test.setTimeout(90_000);
  await audit.goto('/', { waitFor: '#games-grid .gtile' });
  const games = playableGames();

  await test.step('footer game links: one per playable game, correct hrefs', async () => {
    const links = L(page, 'guest.footerGameLinks');
    await expect(links).toHaveCount(games.length);
    const hrefs = await links.evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    expect(hrefs).toEqual(games.map((g) => g.path));
    const opened = gameById('guess-mvps');
    const link = page.locator(`footer.site-footer nav[aria-label='Games'] a[href="${opened.path}"]`);
    await link.scrollIntoViewIfNeeded();
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${opened.path}$`));
    await expect(L(page, 'guest.gameTitle')).toHaveText(opened.name);
  });
  await test.step('Terms', async () => {
    await audit.goto('/', { waitFor: '#games-grid .gtile' });
    const link = L(page, 'guest.footerTerms');
    await link.scrollIntoViewIfNeeded();
    await link.click();
    await expect(page).toHaveURL(/\/terms$/);
    await expect(L(page, 'guest.termsH1')).toBeVisible();
  });
  await test.step('Privacy', async () => {
    await audit.goto('/', { waitFor: '#games-grid .gtile' });
    const link = L(page, 'guest.footerPrivacy');
    await link.scrollIntoViewIfNeeded();
    await link.click();
    await expect(page).toHaveURL(/\/privacy$/);
    await expect(L(page, 'guest.privacyH1')).toBeVisible();
  });
  await test.step('Contact is a mailto link with an address', async () => {
    const href = await L(page, 'guest.footerContact').getAttribute('href');
    expect(href).toMatch(/^mailto:[^@\s]+@[^@\s]+\.[a-z]{2,}$/i);
  });
  await audit.console({ allow: LOCAL_LOAD });
  await audit.done();
});

test('[G-NAV-03] game rail (desktop) or chips (mobile) switch games with the page fade; coming-soon is disabled', async ({ page, audit, vp, cap }) => {
  test.setTimeout(240_000);
  const chips = chipsMode(vp);
  const items = L(page, chips ? 'guest.railChips' : 'guest.railItems');
  const games = visibleGames();
  const playable = playableGames();
  const start = gameById('series-winner');
  await audit.goto(start.path, { waitFor: '.stage-col .idle' });

  await expect(L(page, chips ? 'guest.railStrip' : 'guest.railList')).toBeVisible();
  await expect(L(page, chips ? 'guest.railList' : 'guest.railStrip')).toBeHidden();
  await expect(items).toHaveCount(games.length);
  const names = await items.evaluateAll((els, chipMode) => els.map((e) => (chipMode ? e.textContent : e.querySelector('.rail-name').textContent).trim()), chips);
  expect(names).toEqual(games.map((g) => g.name));
  await expect(railTarget(page, vp, games.find((g) => g.id === 'coming-soon'))).toBeDisabled();

  const fadeProblems = []; // one violation per kind at the end, not one line per game
  const others = playable.filter((g) => g.id !== start.id);
  for (const g of others) {
    await test.step(`-> ${g.id}`, async () => {
      const target = railTarget(page, vp, g);
      await expect(target).toHaveCount(1);
      if (await target.isDisabled()) {
        // Only explained disables may be skipped (Wordle after the daily play); anything else is a finding.
        await explainDisabled(audit, cap, g, chips ? 'chip' : 'rail item');
        return;
      }
      const frames = await recordFrames(page, '#root > div', async () => { await target.click(); await expect(page).toHaveURL(new RegExp(`${g.path}$`)); }, { tail: 900 });
      await expect(L(page, 'guest.gameTitle')).toHaveText(g.name);
      const ops = frames.filter((f) => f.present).map((f) => f.o);
      if (Math.min(...ops) > 0.9) fadeProblems.push({ rule: 'no-fade', g, measured: `opacity never below ${Math.min(...ops).toFixed(2)} during the switch` });
      if (ops[ops.length - 1] < 0.99) fadeProblems.push({ rule: 'fade-stuck', g, measured: `opacity ${ops[ops.length - 1].toFixed(2)} 0.9s after the URL changed` });
      if (valleys(ops) > 1) fadeProblems.push({ rule: 'double-transition', g, measured: `${valleys(ops)} fade dips (the wrapper's opacity reverts after an animation ends)` });
      await expect(L(page, chips ? 'guest.railChipActive' : 'guest.railItemActive')).toHaveCount(1);
      await expect(target).toHaveAttribute('aria-current', 'true');
    });
  }
  for (const rule of ['no-fade', 'fade-stuck', 'double-transition']) {
    const hits = fadeProblems.filter((p) => p.rule === rule);
    if (hits.length) {
      audit.violation(rule, { selector: '#root > div', measured: hits[0].measured, expected: rule === 'double-transition' ? '1: out once, in once (UI-14)' : rule === 'fade-stuck' ? '1' : 'the page fades out and back in', route: `/${hits[0].g.id}`, note: `${hits.length} of ${others.length} switches: ${hits.map((h) => h.g.id).join(', ')}` });
    }
  }
  await audit.shot('after-rail-switch');
  await audit.layout();
  await audit.console({ allow: LOCAL_LOAD });
  await audit.done();
});

test('[G-NAV-04] landing grid: search filters instantly, clearing restores, every card opens its game', async ({ page, audit, cap }) => {
  test.setTimeout(240_000);
  const games = visibleGames();
  const playable = playableGames();
  await audit.goto('/', { waitFor: '#games-grid .gtile' });
  const tiles = L(page, 'guest.gameTiles');
  const search = L(page, 'guest.gamesSearch');
  await expect(tiles).toHaveCount(games.length);

  const target = gameById('career-path');
  // Timed inside the page (no CDP round trips or polling lag): typing -> the grid shows fewer cards.
  await searchLatency(audit, 'search filters the grid', target.name.split(' ').slice(-1)[0], `n > 0 && n < ${games.length}`, 300);
  const filtered = await tiles.allInnerTexts();
  expect(filtered.some((t) => t.includes(target.name)), `"${target.name}" among the filtered cards`).toBe(true);
  await audit.shot('search-filtered');

  await search.fill('zzzzqx');
  await expect(L(page, 'guest.gameTilesEmpty')).toBeVisible();
  await expect(tiles).toHaveCount(0);
  await audit.shot('search-empty');

  // Crossing zero results swaps the empty line for the grid (a cross-fade), so this one gets 1s.
  await searchLatency(audit, 'clearing the search restores the grid', '', `n === ${games.length}`, 1000);

  for (const g of games) {
    await test.step(g.id, async () => {
      if (!(await tiles.count())) await audit.goto('/', { waitFor: '#games-grid .gtile' });
      const tile = tiles.nth(games.findIndex((x) => x.id === g.id));
      await tile.scrollIntoViewIfNeeded();
      if (g.id === 'coming-soon') { await expect(tile).toBeDisabled(); return; }
      if (await tile.evaluate((e) => e.getAttribute('aria-disabled') === 'true')) { await explainDisabled(audit, cap, g, 'landing card'); return; }
      await expect(tile).toHaveAttribute('href', g.path);
      await tile.click();
      await expect(page).toHaveURL(new RegExp(`${g.path}$`));
      await expect(L(page, 'guest.gameTitle')).toHaveText(g.name);
      await page.goBack();
      await expect(tiles.first()).toBeVisible();
    });
  }
  await audit.console({ allow: LOCAL_LOAD });
  await audit.done();
});
