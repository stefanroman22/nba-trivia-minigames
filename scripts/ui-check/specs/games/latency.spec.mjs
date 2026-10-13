// Games suite, timing: answer → feedback on screen within 150 ms, and no long animation frame while answering,
// for every game with an adapter. @perf: runs in run.mjs's single-worker pass (in the 4-worker scenario pass the
// same numbers are recorded as notes only). Three turns per game (right, wrong, right), then Close game. Two games
// are played to the end so the end transitions are measured too: Series Winner (full-screen GameResult) and Who
// Would Win (in place: EndSequence spinner → ScorePanel); the remaining turns are misses / skips. That finishes 2
// games per core viewport (6 log-session POSTs per run, see notes/games.md). Core viewports only.
import { test } from '../../lib/fixtures.mjs';
import { CORE } from '../../lib/viewports.mjs';
import { playableGames } from '../../lib/guest.mjs';
import { adapterFor } from '../../games/index.mjs';
import { L } from '../../lib/pagemap.mjs';
import { checkTurns, newCtx, playTurns, realUserAgent, startGame, waitOver } from '../../lib/game-driver.mjs';

test.use({ userAgent: realUserAgent });

/** Games played to the end, one per end-of-game kind. */
const FINISH = new Set(['series-winner', 'who-would-win', 'career-path', 'who-are-ya']);

test.describe(() => {
  test.skip(({ vpId }) => !CORE.includes(vpId), 'core viewports only');
  test('[GM-LATENCY-01] @perf answer feedback within 150 ms and no long frames while answering or ending, every game with an adapter', async ({ page, audit, cap, fiber, vp }) => {
    test.setTimeout(420_000);
    for (const g of playableGames()) {
      const adapter = adapterFor(g.id);
      if (!adapter) continue;
      const finish = FINISH.has(g.id);
      await test.step(`${g.id}${finish ? ' (to the end)' : ''}`, async () => {
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
      });
    }
    await audit.console();
    await audit.done();
  });
});
