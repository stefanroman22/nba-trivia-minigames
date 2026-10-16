// Guest permissions: admin and profile views, admin API, hidden games, no socket for guests.
import { test, expect, L } from '../../lib/fixtures.mjs';
import { drawerMode, openDrawer, apiBase, playableGames, gameById, LOCAL_LOAD } from '../../lib/guest.mjs';
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

test('[G-PERM-02] @live hidden game slugs and unknown routes answer 404 with the 404 page; hidden games are not listed', async ({ page, audit }) => {
  test.setTimeout(120_000);
  const hidden = hiddenGames();
  expect(hidden.length, 'hidden games parsed from GameUtils.tsx').toBeGreaterThan(0);
  const missing = ['/definitely-not-a-route', ...hidden.map((g) => g.path)];
  for (const path of missing) {
    await test.step(path, async () => {
      const res = await page.goto(path, { waitUntil: 'domcontentloaded' });
      if (res.status() !== 404) audit.violation('hidden-route', { selector: `GET ${path}`, measured: `HTTP ${res.status()}`, expected: '404', route: path });
      await expect(L(page, 'guest.notFoundCode')).toBeVisible({ timeout: 15_000 });
      await expect(L(page, 'guest.notFoundTitle')).toBeVisible();
      await audit.layout({ rules: ['overflow-x', 'offscreen'] });
    });
  }
  await audit.shot('404-page');
  // The 404 responses (and Chrome's console line for them) are the point of the loop above.
  await audit.console({ allow: [...LOCAL_LOAD, /^404 GET /, /status of 404/] });

  // UI-19: hidden games are in no listing (grid, rail, chips, footer).
  await audit.goto('/', { waitFor: '#games-grid .gtile' });
  const tileInfo = await L(page, 'guest.gameTiles').evaluateAll((els) => els.map((e) => ({ href: e.getAttribute('href'), lines: e.innerText.split('\n').map((l) => l.trim()) })));
  const footerInfo = await L(page, 'guest.footerGameLinks').evaluateAll((els) => els.map((e) => ({ href: e.getAttribute('href'), lines: [e.textContent.trim()] })));
  await audit.goto(gameById('series-winner').path, { waitFor: '.stage-col .idle' });
  const railInfo = [
    ...(await L(page, 'guest.railItems').evaluateAll((els) => els.map((e) => ({ href: null, lines: [e.querySelector('.rail-name')?.textContent.trim()] })))),
    ...(await L(page, 'guest.railChips').evaluateAll((els) => els.map((e) => ({ href: null, lines: [e.textContent.trim()] })))),
  ];
  for (const g of hidden) {
    for (const [where, items] of [['landing grid', tileInfo], ['footer', footerInfo], ['rail/chips', railInfo]]) {
      // Exact slug (href) or exact name line, never a substring.
      if (items.some((it) => it.href === g.path || it.lines.includes(g.name))) audit.violation('hidden-listed', { selector: where, measured: `"${g.name}" listed`, expected: 'hidden games appear nowhere (UI-19)' });
    }
  }
  await audit.console({ allow: LOCAL_LOAD });
  await audit.done();
});

test('[G-PERM-03] @live a guest gets the log-in prompt on /profile and "Log in to play online" on games, and opens no socket', async ({ page, audit }) => {
  test.setTimeout(240_000); // visits every online game
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

  for (const g of playableGames().filter((x) => x.online)) {
    await audit.goto(g.path, { waitFor: '.stage-col .idle' });
    // Positive control first: the multiplayer card itself rendered, so the zero counts below cannot pass on a missing aside.
    await expect(L(page, 'guest.mpAside')).toBeVisible();
    await expect(L(page, 'guest.mpLoginBtn')).toBeVisible();
    await expect(L(page, 'guest.mpRow')).toHaveCount(0);
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
