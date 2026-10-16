// Games suite: the GAME_DESIGN_CONSTRAINTS shell contract (Rule 0 GameFrame root + gap, 4.1 family, 4.2 distances,
// 4.2a lone status slot, 1.2 game inside the shell, 4.7 every component centred: `off-centre`) for every visible
// game on all 7 viewports. Same measurement and
// assertions as scripts/ui-audit.mjs (scripts/lib/game-shell.mjs), with the game list from the live catalogue
// instead of ui-audit's hand-kept list. Logged out on purpose: measuring needs no account, and a guest's daily
// Wordle play (keyed by a fresh device id per context) never locks the solo accounts' daily word.
import { test } from '../../lib/fixtures.mjs';
import { playableGames } from '../../lib/guest.mjs';
import { measureInPage, shellFailures } from '../../../lib/game-shell.mjs';
import { GAMES_LOCAL_LOAD, realUserAgent, startGame } from '../../lib/game-driver.mjs';

test.use({ persona: 'guest', userAgent: realUserAgent });

test('[GM-SHELL-01] every visible game keeps the shell contract while playing', async ({ page, audit }) => {
  test.setTimeout(420_000);
  for (const g of playableGames()) {
    await test.step(g.id, async () => {
      await audit.goto(g.path, { waitFor: '.stage-col .idle' });
      try {
        await startGame(page);
      } catch (e) {
        audit.violation('no-playing', { selector: '.playing-wrap', measured: `Play did not reach the playing shell: ${String(e.message).split('\n')[0]}`, expected: 'Play → loading → playing' });
        return;
      }
      const row = { id: g.id, ...(await page.evaluate(measureInPage)) };
      if (!row.mounted) {
        audit.violation('shell-contract', { selector: '.playing-wrap', measured: `${g.id}: .stage-inner / .playing-wrap / .exit-link missing`, expected: 'the playing shell is mounted' });
        return;
      }
      for (const f of shellFailures(row)) {
        if (f.endsWith(' off centre — Rule 4.7')) audit.violation('off-centre', { selector: `${g.id} .gf`, measured: f, expected: 'every component centred on the game frame: box within 1.5px, text ink within 2px (Rule 4.7)' });
        else audit.violation('shell-contract', { selector: `${g.id} .playing-wrap > :first-child`, measured: f, expected: 'GAME_DESIGN_CONSTRAINTS Rule 0 / 4.1 / 4.2 / 4.2a / 1.2' });
      }
      audit.metrics.push({ kind: 'note', label: `${g.id} shell`, value: JSON.stringify({ top: row.shellTop, toExit: row.gameToExit, bottom: row.exitToBottom, pad: row.stagePad, fits: row.playAreaFitsViewport }), unit: '', route: g.path });
      await audit.shot(`playing-${g.id}`);
    });
  }
  await audit.console({ allow: GAMES_LOCAL_LOAD });
  await audit.done();
});
