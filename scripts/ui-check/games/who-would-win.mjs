// Adapter: Who Would Win (src/Game Renderers/WhoWouldWin.tsx). 10 matchups; pick side A or B (the vote is
// POSTed to /trivia/log-guesses/ and the community split is fetched from /trivia/who-would-win/tally/) and
// press Next, or press Skip (no vote, 0 points). The game ends in place: "See results" → spinner (≥ 1.5 s) →
// the per-matchup list + ScorePanel (Play again / Close game).
//
// There is no right answer (an opinion vote; 20 points with the crowd, 5 against, 0 for a skip), so:
//   correct: true  → vote (sides alternate A, B, A… so both cards are exercised); the turn's feedback is the
//                    picked card (`.www-card.is-mine`) — accepted deviation 6.1: no per-matchup popup, so no
//                    Rule 6.0 copy check;
//   correct: false → Skip (no vote, no feedback by design).
// So `perfect` = vote on every matchup, `wrong` = skip all (score 0, the only score the driver can predict),
// `partial` = alternate vote / skip. Nothing to look up: ctx.cap / ctx.fiber are not needed.
import { L } from '../lib/pagemap.mjs';
import { nextTurn, shellIsOver } from './helpers.mjs';

/** One key per matchup: "<n>|<card A label>|<card B label>", only while both cards are pressable. */
async function readMatchup(page) {
  return page.evaluate(() => {
    const cards = [...document.querySelectorAll('.playing-wrap .www-card')];
    if (cards.length !== 2 || cards.some((c) => c.disabled)) return null;
    const t = document.querySelector('.playing-wrap .gf-status-left');
    const m = /(\d+)\s*\/\s*(\d+)/.exec(t ? t.textContent : '');
    const labels = cards.map((c) => (c.querySelector('.www-card-label')?.textContent || '').trim());
    if (!m || labels.some((l) => !l)) return null;
    return `${m[1]}|${labels.join('|')}`;
  });
}

export default {
  id: 'who-would-win',
  path: '/who-would-win',
  online: true,
  lives: null,
  timerMs: null,
  pointsPerCorrect: null,
  feedback: { selector: '.playing-wrap .www-card.is-mine', copy: false },
  scenarios: {
    perfect: true, // vote on every matchup
    wrong: true, // skip every matchup (no right answer exists; skipping is the 0-point path)
    partial: true, // alternate vote / skip
    timeout: 'no clock in Who Would Win',
    giveup: 'Who Would Win has no give-up control (Skip is per matchup; Close game abandons without an end state)',
    'daily-lock': 'not a daily game (any number of plays per day)',
  },

  /** Only an all-skip game has a known score (0); crowd points depend on the live split. */
  expectedScore(turns) {
    return turns.every((t) => !t.correct) ? 0 : null;
  },

  async answer(page, ctx, { correct }) {
    const st = ctx.state;
    const keyOf = () => readMatchup(page);
    if (!st.key) st.key = (await nextTurn(page, keyOf, null, shellIsOver)).key;
    if (correct) {
      st.votes = (st.votes || 0) + 1;
      await L(page, 'games.wwwCards').nth(st.votes % 2 ? 0 : 1).click();
      // The vote resolves to a split, or "No split yet" when the tally failed; Next is enabled either way.
      await page.waitForFunction(() => {
        const mine = document.querySelector('.playing-wrap .www-card.is-mine .www-split');
        return !!mine && (!!mine.querySelector('.www-split-nums') || /No split yet/.test(mine.textContent || ''));
      }, null, { timeout: 12_000 });
      await L(page, 'games.wwwNext').click();
    } else {
      await L(page, 'games.wwwSkip').click();
    }
    const next = await nextTurn(page, keyOf, st.key, shellIsOver, { timeout: 20_000 });
    st.key = next.key;
    return { over: next.over, truth: null, feedback: correct };
  },

  isOver: shellIsOver,

  /** In place, the per-matchup list is the final board: one visible row per matchup played. */
  async endReveal(page, ctx, turns) {
    const rows = L(page, 'games.wwwSummaryRows');
    const n = await rows.count();
    const problems = [];
    if (n !== turns.length) problems.push(`${n} summary rows for ${turns.length} matchups`);
    for (let i = 0; i < n; i++) if (!(await rows.nth(i).isVisible())) { problems.push(`summary row ${i + 1} is not visible`); break; }
    const skipped = await page.locator('.playing-wrap .www-summary-row.is-skipped').count();
    const want = turns.filter((t) => !t.correct).length;
    if (skipped !== want) problems.push(`${skipped} rows marked skipped for ${want} skips`);
    return problems;
  },
};
