// Games suite: every visible game × every scenario of its adapter (games/<id>.mjs), played by lib/game-driver.mjs.
// All scenarios on the core viewports; `perfect` as a layout-only pass on the other four (no post-game buttons,
// no log-session assertion: the score-submit throttle is 60/h per account). A scenario the adapter cannot drive is
// a skipped test with the adapter's reason (coverage gap); a visible game without an adapter is one skipped
// `[GM-<id>-adapter]` test. Skips are declared at describe level, so a skipped test opens no browser context.
import { test } from '../../lib/fixtures.mjs';
import { CORE } from '../../lib/viewports.mjs';
import { playableGames } from '../../lib/guest.mjs';
import { adapterFor } from '../../games/index.mjs';
import { GAMES_LOCAL_LOAD, SCENARIOS, realUserAgent, runScenario } from '../../lib/game-driver.mjs';

test.use({ userAgent: realUserAgent });

const WHAT = {
  perfect: 'every answer right',
  wrong: 'every answer wrong (or out of lives)',
  partial: 'finish with lives to spare (a mix of right and wrong)',
  timeout: 'the clock runs out',
  giveup: 'give up',
  'daily-lock': 'the daily lock after a finished play',
};

for (const g of playableGames()) {
  const adapter = adapterFor(g.id);
  if (!adapter) {
    test.describe(() => {
      test.skip(true, 'no adapter yet');
      // @catalog-family GM-<game>-adapter
      test(`[GM-${g.id}-adapter] ${g.name}: scenarios`, async () => {});
    });
    continue;
  }
  for (const scenario of SCENARIOS) {
    const can = adapter.scenarios[scenario];
    test.describe(() => {
      test.skip(can !== true, typeof can === 'string' ? can : `adapter declares no "${scenario}" scenario`);
      test.skip(({ vpId }) => !CORE.includes(vpId) && scenario !== 'perfect', 'core viewports only (the other viewports run `perfect` as a layout-only pass)');
      // @catalog-family GM-<game>-<scenario>
      test(`[GM-${g.id}-${scenario}] ${g.name}: ${(adapter.labels && adapter.labels[scenario]) || WHAT[scenario]}`, async ({ page, audit, cap, fiber, vp }) => {
        test.setTimeout(240_000);
        await runScenario({ page, audit, cap, fiber, vp }, adapter, scenario, { full: vp.core });
        await audit.console({ allow: GAMES_LOCAL_LOAD });
        await audit.done();
      });
    });
  }
}
