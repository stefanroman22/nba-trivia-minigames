// Guest accessibility: axe on the main public surfaces.
import { test, expect, L } from '../../lib/fixtures.mjs';
import { openLogin, playableGames, LOCAL_LOAD } from '../../lib/guest.mjs';

test('[G-A11Y-01] axe finds no serious or critical issues on /, /privacy, a game idle screen and the login modal', async ({ page, audit, vp }) => {
  test.setTimeout(120_000);
  await audit.goto('/', { waitFor: '#games-grid .gtile' });
  await audit.a11y();
  await audit.goto('/privacy', { waitFor: 'main article h1' });
  await audit.a11y();
  await audit.goto(playableGames()[0].path, { waitFor: '.stage-col .idle' });
  await audit.a11y();
  await audit.goto('/', { waitFor: '#games-grid .gtile' });
  await openLogin(page, vp);
  await page.waitForTimeout(400);
  await audit.a11y();
  await expect(L(page, 'guest.modalPanel')).toBeVisible();
  await audit.console({ allow: LOCAL_LOAD });
  await audit.done();
});
