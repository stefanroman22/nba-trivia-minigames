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
// So `perfect` = vote on every matchup, `wrong` = skip all, `partial` = alternate vote / skip.
// Expected score: each vote's tally response (GET /trivia/who-would-win/tally/, captured by ctx.cap, counted
// AFTER the player's own vote) scored with the game's own rule (src/utils/whoWouldWinPoints.ts pointsFor): 20
// when the picked side has at least as many votes as the other, 5 when fewer, 20 when the tally failed (a network
// fault never costs points), 0 for a skip. The driver asserts that sum on the ScorePanel, in the log-session body
// and as `awarded`.
import { L } from '../lib/pagemap.mjs';
import { nextTurn, shellIsOver } from './helpers.mjs';

const TALLY = /\/trivia\/who-would-win\/tally\//;
const MAJORITY = 20, MINORITY = 5; // WWW_POINTS_MAJORITY / WWW_POINTS_MINORITY

/** utils/whoWouldWinPoints.ts pointsFor, mirrored: choice 'a'|'b'|null, tally {a,b} | 'error'. */
export function pointsFor(choice, tally) {
  if (choice === null) return 0;
  if (!tally || tally === 'error') return MAJORITY;
  const mine = choice === 'a' ? tally.a : tally.b;
  const other = choice === 'a' ? tally.b : tally.a;
  return mine >= other ? MAJORITY : MINORITY;
}

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
  labels: { perfect: 'vote on every matchup', wrong: 'skip every matchup', partial: 'vote and skip alternately' },
  scenarios: {
    perfect: true, // vote on every matchup
    wrong: true, // skip every matchup (no right answer exists; skipping is the 0-point path)
    partial: true, // alternate vote / skip
    timeout: 'no clock in Who Would Win',
    giveup: 'Who Would Win has no give-up control (Skip is per matchup; Close game abandons without an end state)',
    'daily-lock': 'not a daily game (any number of plays per day)',
  },

  /** Sum of the per-matchup points from the captured tallies (see the header). */
  expectedScore(turns, ctx) {
    const picks = (ctx && ctx.state.picks) || [];
    return turns.reduce((sum, t) => {
      if (!t.correct) return sum;
      const p = picks[t.turn];
      if (!p) throw new Error(`who-would-win: no recorded pick for turn ${t.turn + 1}`);
      return sum + pointsFor(p.side, p.tally);
    }, 0);
  },

  async answer(page, ctx, { correct }) {
    const st = ctx.state;
    const keyOf = () => readMatchup(page);
    if (!st.key) st.key = (await nextTurn(page, keyOf, null, shellIsOver)).key;
    if (correct) {
      st.votes = (st.votes || 0) + 1;
      const side = st.votes % 2 ? 'a' : 'b';
      const before = (await ctx.cap.entries(TALLY)).length;
      await L(page, 'games.wwwCards').nth(side === 'a' ? 0 : 1).click();
      // The vote resolves to a split, or "No split yet" when the tally failed; Next is enabled either way.
      await page.waitForFunction(() => {
        const mine = document.querySelector('.playing-wrap .www-card.is-mine .www-split');
        return !!mine && (!!mine.querySelector('.www-split-nums') || /No split yet/.test(mine.textContent || ''));
      }, null, { timeout: 12_000 });
      // This vote's tally: the newest response after the click (none or non-2xx = the game's "error" case).
      const got = (await ctx.cap.entries(TALLY)).slice(before);
      const last = got[got.length - 1];
      const tally = last && last.status === 200 && last.body && typeof last.body.a === 'number' ? { a: last.body.a, b: last.body.b } : 'error';
      (st.picks ||= [])[ctx.turn] = { side, tally };
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
