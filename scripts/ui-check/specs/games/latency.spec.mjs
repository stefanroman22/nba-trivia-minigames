// Games suite, timing: answer → feedback on screen within 150 ms, and no long animation frame while answering,
// for every game with an adapter. @perf: runs in run.mjs's single-worker pass (in the 4-worker scenario pass the
// same numbers are recorded as notes only). Three turns per game (right, wrong, right), then Close game — no game
// is finished, so nothing is logged against the score-submit throttle. Core viewports only.
import { test } from '../../lib/fixtures.mjs';
import { CORE } from '../../lib/viewports.mjs';
import { playableGames } from '../../lib/guest.mjs';
import { adapterFor } from '../../games/index.mjs';
import { L } from '../../lib/pagemap.mjs';
import { checkTurns, newCtx, playTurns, realUserAgent, startGame } from '../../lib/game-driver.mjs';

test.use({ userAgent: realUserAgent });

test.describe(() => {
  test.skip(({ vpId }) => !CORE.includes(vpId), 'core viewports only');
  test('[GM-LATENCY-01] @perf answer feedback within 150 ms and no long frames while answering, every game with an adapter', async ({ page, audit, cap, fiber, vp }) => {
    test.setTimeout(300_000);
    for (const g of playableGames()) {
      const adapter = adapterFor(g.id);
      if (!adapter) continue;
      await test.step(g.id, async () => {
        const ctx = newCtx({ cap, fiber, vp, audit }, 'latency');
        await audit.goto(adapter.path, { waitFor: '.stage-col .idle' });
        await startGame(page);
        let turns = [];
        await audit.motion(async () => {
          ({ turns } = await playTurns(page, adapter, ctx, { plan: (t) => t !== 1, stopAfter: 3 }));
        }, { watch: ['.stage-shell', '.playing-wrap'], settleMs: 600 });
        await checkTurns(audit, adapter, turns, { enforceLatency: true, copyRules: false });
        if (await L(page, 'games.exitLink').isVisible()) await L(page, 'games.exitLink').click();
      });
    }
    await audit.console();
    await audit.done();
  });
});
