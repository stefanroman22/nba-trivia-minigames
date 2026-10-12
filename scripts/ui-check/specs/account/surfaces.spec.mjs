// Account suite: what a signed-in player sees on the landing page and a game page — profile card,
// friends panel, leaderboard scope tabs, points, the friend-request round trip and the Play Online entry.
import { test, expect, L } from '../../lib/fixtures.mjs';
import { mintTokens } from '../../lib/accounts.mjs';
import { VIEWPORTS } from '../../lib/viewports.mjs';
import { LOCAL_LOAD, playableGames, recordFrames, fadeSummary } from '../../lib/guest.mjs';
import { motionStep, tabSlide, apiCall, clearFriendship, isFriend, expectSignedIn } from '../../lib/account.mjs';

const LANDING = '#leaderboard .lb-card';

test('[AC-SURF-01] @perf signed-in landing: profile card, Profile and Friends tabs glide, friends sub-tabs, leaderboard Global and Friends, points', async ({ page, audit, vp, session }) => {
  test.setTimeout(240_000);
  await audit.goto('/', { waitFor: LANDING });
  await expectSignedIn(page, session.username);
  const card = L(page, 'account.profileCard');
  await card.scrollIntoViewIfNeeded();

  await test.step('profile card', async () => {
    await expect(L(page, 'account.pcName')).toHaveText(session.username);
    await expect(L(page, 'account.pcStats')).toContainText(/Points/);
    await expect(L(page, 'account.pcStats')).toContainText(/Rank/);
    await expect(L(page, 'account.pcSettings')).toBeVisible();
    await expect(L(page, 'account.viewTabProfile')).toHaveAttribute('aria-selected', 'true');
    // Copy the player ID: the icon swaps to the "copied" state and back.
    const copy = L(page, 'account.pcCopy');
    await expect(copy).toHaveAttribute('aria-label', 'Copy player ID');
    await motionStep(audit, 'copy player ID (card)', async () => {
      await copy.click();
      await expect(copy).toHaveAttribute('aria-label', 'Player ID copied', { timeout: 2000 });
    }, { watch: ['.profile-card', '.pc-meta'], settleMs: 300 });
    await expect(copy).toHaveAttribute('aria-label', 'Copy player ID', { timeout: 5000 });
    await audit.layout({ scope: '#leaderboard' });
    await audit.shot('profile-card');
  });

  await test.step('points panel', async () => {
    const hero = L(page, 'account.heroPoints');
    await hero.scrollIntoViewIfNeeded();
    await expect(hero).toBeVisible();
    await expect(hero).toContainText(String(session.user.points));
    await audit.layout({ scope: '#play' });
    await audit.shot('hero-points');
    await card.scrollIntoViewIfNeeded();
  });

  const watchCard = ['.profile-wrap', '.profile-card', '.profile-view-body'];
  await test.step('Profile -> Friends', async () => {
    await tabSlide(audit, 'Profile -> Friends', '.profile-view-toggle .seg-thumb', () => L(page, 'account.viewTabFriends').click(), { watch: watchCard, settleMs: 800 });
    await expect(L(page, 'account.viewTabFriends')).toHaveAttribute('aria-selected', 'true');
    await expect(L(page, 'account.frTabs')).toBeVisible();
    await expect(L(page, 'account.frThumb')).toHaveCount(1);
    await audit.layout({ scope: '#leaderboard' });
    await audit.shot('friends-panel');
  });

  await test.step('friends sub-tabs', async () => {
    for (const [name, tab, ready] of [
      ['Requests', 'account.frTabRequests', () => expect(page.locator('.fr-group-label', { hasText: 'Incoming' })).toBeVisible()],
      ['Find', 'account.frTabFind', () => expect(L(page, 'account.frSearch')).toBeVisible()],
      ['Blocked', 'account.frTabBlocked', () => expect(L(page, 'account.frEmpty').or(L(page, 'account.frRows')).first()).toBeVisible()],
      ['Friends', 'account.frTabFriends', () => expect(L(page, 'account.frEmpty').or(L(page, 'account.frRows')).first()).toBeVisible()],
    ]) {
      await tabSlide(audit, `friends sub-tab ${name}`, '.fr-tabs .seg-thumb', () => L(page, tab).click(), { watch: [...watchCard, '.fr-stack'], settleMs: 800 });
      await expect(L(page, tab)).toHaveAttribute('aria-selected', 'true');
      await ready();
      await page.waitForTimeout(500);
      await audit.layout({ scope: '#leaderboard' });
      await audit.shot(`friends-${name.toLowerCase()}`);
    }
  });

  await test.step('Friends -> Profile', async () => {
    await tabSlide(audit, 'Friends -> Profile', '.profile-view-toggle .seg-thumb', () => L(page, 'account.viewTabProfile').click(), { watch: watchCard, settleMs: 800 });
    await expect(L(page, 'account.pcName')).toBeVisible();
  });

  await test.step('leaderboard Global <-> Friends', async () => {
    await L(page, 'account.lbCard').scrollIntoViewIfNeeded();
    await expect(L(page, 'account.lbScope')).toBeVisible();
    await expect(L(page, 'account.lbRows').first()).toBeVisible({ timeout: 15_000 });
    const watchLb = ['#leaderboard .lb-card', '#leaderboard .lb-body', '#leaderboard .lb-body-inner'];
    await tabSlide(audit, 'leaderboard Global -> Friends', '#leaderboard .lb-scope .seg-thumb', () => L(page, 'account.lbScopeFriends').click(), { watch: watchLb, settleMs: 900 });
    await expect(L(page, 'account.lbHeading')).toHaveText('Friends Leaderboard');
    await expect(page.locator('#leaderboard .lb-body-loading')).toHaveCount(0, { timeout: 15_000 });
    await page.waitForTimeout(600);
    await audit.layout({ scope: '#leaderboard' });
    await audit.shot('leaderboard-friends');
    await tabSlide(audit, 'leaderboard Friends -> Global', '#leaderboard .lb-scope .seg-thumb', () => L(page, 'account.lbScopeGlobal').click(), { watch: watchLb, settleMs: 900 });
    await expect(L(page, 'account.lbHeading')).toHaveText('Global Top 100');
    await expect(page.locator('#leaderboard .lb-body-loading')).toHaveCount(0, { timeout: 15_000 });
    await page.waitForTimeout(600);
    await audit.layout({ scope: '#leaderboard' });
    await audit.shot('leaderboard-global');
  });
  await audit.console({ allow: LOCAL_LOAD });
  await audit.done();
});

test('[AC-SURF-02] friend request round trip: testuser3 sends from the Find tab, testuser2 accepts through the API, the friend shows after a refresh', async ({ page, audit, vp, request, session }) => {
  test.skip(!vp.core, 'shared testuser2 and friend-request throttles — core viewports only');
  test.setTimeout(240_000);
  const other = (await mintTokens(['testuser2'])).testuser2;
  const otherId = other.user.id;
  const myId = session.user.id;
  const wasFriend = await isFriend(request, session.access, otherId);
  audit.metrics.push({ kind: 'note', label: 'friendship before (cleared first)', value: String(wasFriend), unit: '', route: '/' });
  await clearFriendship(request, session.access, otherId);
  try {
    await page.addInitScript(() => { try { localStorage.setItem('sq:profile-view', 'friends'); } catch { /* storage blocked */ } });
    await audit.goto('/', { waitFor: LANDING });
    await expectSignedIn(page, session.username);
    await L(page, 'account.profileCard').scrollIntoViewIfNeeded();
    await expect(L(page, 'account.viewTabFriends')).toHaveAttribute('aria-selected', 'true');

    await test.step('search by player ID and send the request', async () => {
      await L(page, 'account.frTabFind').click();
      const search = L(page, 'account.frSearch');
      await expect(search).toBeVisible();
      await search.fill(otherId);
      const row = page.locator('.fr-row', { hasText: `#${otherId}` });
      await expect(row).toBeVisible({ timeout: 15_000 });
      await expect(row).toContainText('testuser2');
      await audit.shot('found');
      await motionStep(audit, 'send request', async () => {
        await row.locator('button.fr-btn-primary').click();
        await expect(row.locator('.fr-status')).toHaveText('Request sent', { timeout: 15_000 });
      }, { watch: ['.profile-card', '.fr-stack', '.fr-list'], settleMs: 700 });
      await audit.shot('request-sent');
    });

    await test.step('testuser2 accepts through the API', async () => {
      const overview = await apiCall(request, other.access, 'GET', 'friends-overview/');
      const mine = (overview.body.incoming_requests || []).find((r) => r.id === myId);
      expect(mine, `testuser2 has a request from ${session.username} (${myId})`).toBeTruthy();
      const accepted = await apiCall(request, other.access, 'POST', 'accept-friend-request/', { request_id: mine.request_id });
      expect(accepted.status).toBe(200);
    });

    await test.step('the friend list shows testuser2 after a refresh', async () => {
      await audit.goto('/', { waitFor: LANDING }); // a fresh load of the page
      await L(page, 'account.profileCard').scrollIntoViewIfNeeded();
      await expect(L(page, 'account.viewTabFriends')).toHaveAttribute('aria-selected', 'true');
      await expect(L(page, 'account.frTabFriends')).toHaveAttribute('aria-selected', 'true');
      const row = page.locator('.fr-row', { hasText: `#${otherId}` });
      await expect(row).toBeVisible({ timeout: 15_000 });
      await expect(row).toContainText('testuser2');
      await audit.layout({ scope: '#leaderboard' });
      await audit.shot('friend-listed');
    });
    await audit.console({ allow: LOCAL_LOAD });
  } finally {
    const r = await clearFriendship(request, session.access, otherId);
    const still = await isFriend(request, session.access, otherId);
    audit.metrics.push({ kind: 'note', label: `friendship ${session.username} <-> testuser2 removed (cleanup)`, value: `remove ${r.status}, still friends: ${still}`, unit: '', route: '/' });
    if (still) audit.violation('cleanup', { selector: `friendship ${session.username} <-> testuser2`, measured: 'still friends after cleanup', expected: 'removed' });
  }
  await audit.done();
});

test('[AC-ONLINE-01] @perf Play Online (1v1) shows the searching screen with Cancel; Cancel returns to the idle card with animation', async ({ page, audit, vp }) => {
  test.setTimeout(180_000);
  // Each viewport searches in a different game, so parallel workers never match each other.
  const games = playableGames().filter((g) => g.online);
  const game = games[Object.keys(VIEWPORTS).indexOf(vp.id) % games.length];
  await audit.goto(game.path, { waitFor: '.stage-col .idle' });
  await expectSignedIn(page);
  const play = L(page, 'account.mpPlay1v1');
  await expect(play).toBeVisible();
  await expect(L(page, 'account.mpFriendButton')).toBeVisible();
  await expect(L(page, 'guest.mpLoginBtn')).toHaveCount(0);
  await audit.layout({ scope: 'aside.game-aside' });
  await audit.shot('idle');

  for (const via of ['stage Cancel', 'side Cancel']) {
    await test.step(via, async () => {
      await play.click();
      await expect(L(page, 'account.mpSearchingStage')).toBeVisible({ timeout: 15_000 });
      await expect(L(page, 'account.mpSearchingStage')).toContainText('Finding an opponent');
      await expect(L(page, 'account.mpAsideButton')).toHaveText('Cancel', { useInnerText: true });
      await page.waitForTimeout(500);
      if (via === 'stage Cancel') { await audit.layout({ scope: '.stage-col' }); await audit.shot('searching'); }

      const frames = await recordFrames(page, '.om-stage--compact', async () => {
        await motionStep(audit, `${via} -> idle`, async () => {
          if (via === 'stage Cancel') await L(page, 'account.mpSearchingCancel').click();
          else await L(page, 'account.mpAsideButton').click();
          await expect(L(page, 'guest.gameIdle')).toBeVisible({ timeout: 10_000 });
        }, { watch: ['.stage-col', 'aside.game-aside', 'aside.game-aside .mp-panel'], settleMs: 700 });
      }, { tail: 400 });
      const fade = fadeSummary(frames);
      if (fade.intermediate < 1) audit.violation('snap', { selector: '.om-stage--compact', measured: `${via}: no part-way frame among ${fade.frames} sampled while the searching screen left`, expected: 'an animated exit' });
      await expect(L(page, 'account.mpSearchingStage')).toHaveCount(0);
      await expect(play).toBeVisible();
      await expect(play).toBeEnabled();
      if (via === 'stage Cancel') await audit.shot('after-cancel');
    });
  }
  await audit.console({ allow: LOCAL_LOAD });
  await audit.done();
});
