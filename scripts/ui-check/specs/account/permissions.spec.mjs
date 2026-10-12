// Account suite: what a signed-in, non-admin player cannot do.
import { test, expect, L } from '../../lib/fixtures.mjs';
import { LOCAL_LOAD } from '../../lib/guest.mjs';
import { apiCall, drawerMode, openDrawer, expectSignedIn } from '../../lib/account.mjs';

const ADMIN_ENDPOINTS = [
  ['GET', 'games/'], ['GET', 'source-rows/'], ['GET', 'feedback/'], ['GET', 'feedback/stats/'],
  ['PATCH', 'feedback/1/'], ['PUT', 'feedback/1/'], ['DELETE', 'feedback/1/'],
];

test('[AC-PERM-01] a signed-in non-admin sees "Admins only" on /admin, has no Admin link, and every /api/admin/* call answers 403', async ({ page, audit, vp, request, session }) => {
  test.setTimeout(120_000);
  const adminCalls = [];
  page.on('request', (r) => { if (/\/api\/admin\//.test(r.url())) adminCalls.push(`${r.method()} ${r.url()}`); });
  expect(session.user.is_admin, 'the solo account is not an admin').toBe(false);

  await audit.goto('/admin', { waitFor: '.admin-placeholder, .admin-loading' });
  await expectSignedIn(page, session.username);
  await expect(L(page, 'guest.adminOnly')).toBeVisible({ timeout: 15_000 });
  await expect(L(page, 'guest.adminBack')).toBeVisible();
  await expect(L(page, 'guest.adminTabs')).toHaveCount(0);
  await expect(L(page, 'guest.adminTable')).toHaveCount(0);
  await expect(L(page, 'common.navAdmin')).toHaveCount(0);
  if (drawerMode(vp)) {
    await openDrawer(page);
    await expect(L(page, 'common.drawer').locator('button.drawer-link', { hasText: /^Admin$/ })).toHaveCount(0);
    await audit.shot('drawer-no-admin');
    await L(page, 'common.drawerClose').click();
    await expect(L(page, 'common.drawer')).toHaveCount(0); // gone, not mid-slide, before the layout scan
  }
  await audit.layout();
  await audit.shot('admin-non-admin');
  if (adminCalls.length) audit.violation('admin-api-call', { selector: '/api/admin/*', measured: adminCalls[0], expected: 'a non-admin page makes no admin API calls', route: '/admin' });

  await test.step('admin API with the solo token', async () => {
    for (const [method, p] of ADMIN_ENDPOINTS) {
      const r = await apiCall(request, session.access, method, `admin/${p}`);
      if (r.status !== 403) audit.violation('admin-api-open', { selector: `${method} /api/admin/${p}`, measured: `HTTP ${r.status} with a signed-in non-admin token`, expected: '403', route: '/admin' });
    }
  });
  await audit.console({ allow: LOCAL_LOAD });
  await audit.done();
});
