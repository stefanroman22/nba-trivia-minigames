// Guest permissions: admin and profile views, admin API, hidden games, no socket for guests.
import { test, expect, L } from '../../lib/fixtures.mjs';
import { drawerMode, openDrawer, apiBase, playableGames, LOCAL_LOAD } from '../../lib/guest.mjs';
import { hiddenGames } from '../../lib/games-catalog.mjs';

const ADMIN_ENDPOINTS = [
  ['GET', 'games/'], ['GET', 'source-rows/'], ['GET', 'feedback/'], ['GET', 'feedback/stats/'],
  ['PATCH', 'feedback/1/'], ['PUT', 'feedback/1/'], ['DELETE', 'feedback/1/'],
];

test('[G-PERM-01] /admin shows "Admins only" to a guest and the admin API refuses it', async ({ page, audit, vp, request }) => {
  test.setTimeout(90_000);
  const adminCalls = [];
  page.on('request', (r) => { if (/\/api\/admin\//.test(r.url())) adminCalls.push(`${r.method()} ${r.url()}`); });

  await audit.goto('/admin', { waitFor: '.admin-placeholder, .admin-loading' });
  await expect(L(page, 'guest.adminOnly')).toBeVisible();
  await expect(L(page, 'guest.adminBack')).toBeVisible();
  await expect(L(page, 'guest.adminTabs')).toHaveCount(0);
  await expect(L(page, 'guest.adminTable')).toHaveCount(0);
  await expect(L(page, 'common.navAdmin')).toHaveCount(0);
  if (drawerMode(vp)) {
    await openDrawer(page);
    await expect(L(page, 'common.drawer').locator('button.drawer-link', { hasText: /^Admin$/ })).toHaveCount(0);
    await L(page, 'common.drawerClose').click();
  }
  await audit.shot('admin-guest');
  await L(page, 'guest.adminBack').click();
  await expect(page).toHaveURL(/\/$/);
  if (adminCalls.length) audit.violation('admin-api-call', { selector: '/api/admin/*', measured: adminCalls[0], expected: 'a guest page makes no admin API calls', route: '/admin' });

  const base = apiBase();
  for (const [method, p] of ADMIN_ENDPOINTS) {
    for (const [who, headers] of [['no token', {}], ['bogus token', { Authorization: 'Bearer not.a.real.token' }]]) {
      const res = await request.fetch(`${base}/admin/${p}`, { method, headers, failOnStatusCode: false, data: method === 'GET' ? undefined : {} });
      if (![401, 403].includes(res.status())) audit.violation('admin-api-open', { selector: `${method} /api/admin/${p}`, measured: `HTTP ${res.status()} (${who})`, expected: '401 or 403', route: '/admin' });
    }
  }
  await audit.console({ allow: LOCAL_LOAD });
  await audit.done();
});

test('[G-PERM-02] hidden game slugs and unknown routes answer 404 with the 404 page; hidden games are not listed', async ({ page, audit }) => {
  test.setTimeout(120_000);
  const hidden = hiddenGames();
  expect(hidden.length, 'hidden games parsed from GameUtils.tsx').toBeGreaterThan(0);
  const missing = ['/definitely-not-a-route', ...hidden.map((g) => g.path)];
  for (const path of missing) {
    await test.step(path, async () => {
      const res = await page.goto(path, { waitUntil: 'domcontentloaded' });
      if (res.status() !== 404) audit.violation('hidden-route', { selector: `GET ${path}`, measured: `HTTP ${res.status()}`, expected: '404', route: path });
      await page.waitForSelector('h1', { timeout: 15_000 });
      const shown = await L(page, 'guest.notFoundCode').count();
      const title = await L(page, 'guest.notFoundTitle').count();
      if (!shown || !title) audit.violation('hidden-route', { selector: 'NoPageFound', measured: 'no 404 heading / "Nothing here yet"', expected: 'the 404 page', route: path });
      await audit.layout({ rules: ['overflow-x', 'offscreen'] });
    });
  }
  await audit.shot('404-page');
  // The 404 responses (and Chrome's console line for them) are the point of the loop above.
  await audit.console({ allow: [...LOCAL_LOAD, /^404 GET /, /status of 404/] });

  // UI-19: hidden games are in no listing (grid, rail, chips, footer).
  await audit.goto('/', { waitFor: '#games-grid .gtile' });
  const tileText = (await L(page, 'guest.gameTiles').allInnerTexts()).join('\n');
  const footerText = (await L(page, 'guest.footerGameLinks').evaluateAll((as) => as.map((a) => `${a.textContent} ${a.getAttribute('href')}`))).join('\n');
  await audit.goto(playableGames()[0].path, { waitFor: '.stage-col .idle' });
  const railText = (await L(page, 'guest.railItems').allInnerTexts()).concat(await L(page, 'guest.railChips').allInnerTexts()).join('\n');
  for (const g of hidden) {
    for (const [where, text] of [['landing grid', tileText], ['footer', footerText], ['rail/chips', railText]]) {
      if (text.includes(g.name) || text.includes(g.path)) audit.violation('hidden-listed', { selector: where, measured: `"${g.name}" listed`, expected: 'hidden games appear nowhere (UI-19)' });
    }
  }
  await audit.console({ allow: LOCAL_LOAD });
  await audit.done();
});

test('[G-PERM-03] a guest gets the log-in prompt on /profile and "Log in to play online" on games, and opens no socket', async ({ page, audit }) => {
  test.setTimeout(90_000);
  const sockets = [];
  page.on('websocket', (ws) => { if (!/\/_next\//.test(ws.url())) sockets.push(ws.url()); }); // dev-server HMR is not the relay
  const polling = [];
  page.on('request', (r) => { if (/socket\.io/.test(r.url())) polling.push(r.url()); });

  await audit.goto('/profile', { waitFor: 'section.ps-empty' });
  await expect(L(page, 'guest.profilePrompt')).toBeVisible();
  await expect(L(page, 'guest.profileLoginBtn')).toBeVisible();
  // No account data: no editable profile, no export/delete controls.
  await expect(page.locator('.ps-stack')).toHaveCount(0);
  await expect(page.getByText(/delete (my )?account|export (my )?data/i)).toHaveCount(0);
  await audit.shot('profile-guest');
  await L(page, 'guest.profileLoginBtn').click();
  await expect(L(page, 'guest.modalTitle')).toHaveText('Welcome back');
  await page.keyboard.press('Escape');

  for (const g of playableGames().filter((x) => x.online).slice(0, 3)) {
    await audit.goto(g.path, { waitFor: '.stage-col .idle' });
    await expect(L(page, 'guest.mpLoginBtn')).toBeVisible();
    await expect(L(page, 'guest.mpPlay1v1Btn')).toHaveCount(0);
    await expect(L(page, 'guest.mpFriendBtn')).toHaveCount(0);
  }
  await audit.shot('game-mp-guest');
  await L(page, 'guest.mpLoginBtn').click();
  await expect(L(page, 'guest.modalTitle')).toHaveText('Welcome back');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);

  if (sockets.length || polling.length) audit.violation('guest-socket', { selector: 'socket.io', measured: `${sockets.length} websocket(s), ${polling.length} polling request(s): ${(sockets[0] || polling[0] || '').slice(0, 100)}`, expected: 'a guest never connects to the multiplayer relay' });
  await audit.console({ allow: LOCAL_LOAD });
  await audit.done();
});
