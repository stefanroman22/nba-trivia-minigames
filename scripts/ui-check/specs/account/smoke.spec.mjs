// Temporary persona smoke check (Task 2); the account suite proper replaces it in Task 4.
import { test, expect, L } from '../../lib/fixtures.mjs';

test('[AC-SMOKE] solo persona is signed in on load', async ({ page, audit, cap, session }) => {
  await audit.goto('/');
  const chip = L(page, 'common.navUserChip');
  await expect(chip).toBeVisible();
  await expect(chip).toHaveAttribute('aria-label', `${session.username} #${session.user.id}`);
  await expect(L(page, 'common.navLogin')).toHaveCount(0);
  // The session restore (utils/Api.tsx via app/providers.tsx): /me/ with a valid access token,
  // or token/refresh/ when it had expired.
  const restore = [...await cap.entries(/\/api\/me\/$/), ...await cap.entries(/\/api\/token\/refresh\/$/)];
  expect(restore.map((r) => `${r.method} ${new URL(r.url).pathname} ${r.status}`)).toContainEqual(expect.stringMatching(/ 200$/));
  await audit.done();
});
