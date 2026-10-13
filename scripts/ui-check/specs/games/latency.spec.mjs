// Games suite, timing: answer → feedback on screen within 150 ms, and no long animation frame while answering,
// one test per game with an adapter (`[GM-LATENCY-<game>]`, so one game's finding does not hide the others). @perf: runs
// in run.mjs's single-worker pass (in the 4-worker scenario pass the same numbers are recorded as notes only). Three turns
// per game (right, wrong, right, or the adapter's latencyPlan), then Close game. Series Winner (full-screen GameResult),
// Who Would Win, Career Path and Who Are Ya (in place) are played to the end so the end transitions are measured too.
// Core viewports only.
import { test } from '../../lib/fixtures.mjs';
import { CORE } from '../../lib/viewports.mjs';
import { playableGames } from '../../lib/guest.mjs';
import { adapterFor } from '../../games/index.mjs';
import { L } from '../../lib/pagemap.mjs';
import { checkTurns, newCtx, playTurns, realUserAgent, startGame, waitOver } from '../../lib/game-driver.mjs';

test.use({ userAgent: realUserAgent });

/** Games played to the end, one per end-of-game kind. */
const FINISH = new Set(['series-winner', 'who-would-win', 'career-path', 'who-are-ya']);

for (const g of playableGames()) {
  const adapter = adapterFor(g.id);
  if (!adapter) continue;
  const finish = FINISH.has(g.id);
  test.describe(() => {
    test.skip(({ vpId }) => !CORE.includes(vpId), 'core viewports only');
    // @catalog-family GM-LATENCY-<game>
    test(`[GM-LATENCY-${g.id}] @perf ${g.name}: answer feedback within 150 ms and no long frames while answering${finish ? ' or ending' : ''}`, async ({ page, audit, cap, fiber, vp }) => {
      test.setTimeout(finish ? 180_000 : 120_000);
      const ctx = newCtx({ cap, fiber, vp, audit }, 'latency');
      await audit.goto(adapter.path, { waitFor: '.stage-col .idle' });
      await startGame(page);
      let turns = [];
      let over = false;
      await audit.motion(async () => {
        ({ turns, over } = await playTurns(page, adapter, ctx, { plan: adapter.latencyPlan || ((t) => t === 0 || t === 2), stopAfter: finish ? undefined : 3 }));
        if (finish) {
          if (!over) over = await waitOver(page, adapter);
          await page.waitForTimeout(1500); // the end entrance (GameResult spring / EndSequence score) inside the window
        }
      }, { watch: ['.stage-shell', '.playing-wrap'], settleMs: 600 });
      await checkTurns(audit, adapter, turns, { enforceLatency: true, copyRules: false });
      if (finish) {
        if (!over) audit.violation('never-ended', { selector: g.id, measured: `still playing after ${turns.length} turns`, expected: 'the game ends' });
        else await L(page, 'games.endCloseGame').first().click();
      } else if (await L(page, 'games.exitLink').isVisible()) {
        await L(page, 'games.exitLink').click();
      }
      await L(page, 'games.playBtn').waitFor({ timeout: 10_000 });
      await audit.console();
      await audit.done();
    });
  });
}
