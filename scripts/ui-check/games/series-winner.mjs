// Adapter: Guess the Series Winner (src/Game Renderers/PlayOffSeries.tsx). 5 rounds, pick one of two
// team buttons; the round reveals the winner (green/red card + "Correct! +10" / "It was the <winner>")
// and advances after 1.8 s; the last round hands over to the full-screen GameResult (allowlisted).
//
// Right answer: ctx.pool('playoff') (single player: captured HTTP JSON, capPool). The pool is `playoff`
// (GameUtils fetchGamePool("playoff", 5)): the bundled /data/playoff.json in dev, the manifest-v3 host's
// `playoff` chunks + `teams` lookup in prod. The round is the eyebrow "<round> · <season>" plus the two team
// names on the buttons (sides are swapped at random per round, so the pair is matched unordered); the row's
// `winner` is the answer. Fallback: fiber — PlayOffSeries props `seriesList` + hook 0 `currentIndex`.
// An empty pool fails loudly (`no-truth`): a round is only accepted when it matches a pool row.
import { L } from '../lib/pagemap.mjs';
import { answerFrom, exactly, fiberRound, nextTurn, noTruth, shellIsOver } from './helpers.mjs';

const POOL = 'playoff';

/** What the round shows: eyebrow + both team names, as a key and parts. */
async function readRound(page) {
  return page.evaluate(() => {
    const eb = document.querySelector('.playing-wrap .gf-eyebrow');
    const btns = [...document.querySelectorAll('.playing-wrap .gf-board button')];
    if (!eb || btns.length !== 2 || btns.some((b) => b.disabled)) return null;
    const names = btns.map((b) => (b.querySelector('span.font-display')?.textContent || '').trim());
    const eyebrow = eb.textContent.replace(/\s+/g, ' ').trim();
    if (!eyebrow || names.some((n) => !n)) return null;
    return { eyebrow, names, key: `${eyebrow}|${names.join('|')}` };
  });
}

/** The captured row for a shown round: same season, same unordered team pair. */
function matchRow(rows, r) {
  const season = r.eyebrow.split('·').map((s) => s.trim())[1];
  const pair = [...r.names].sort().join('|');
  return rows.find((x) => x.season === season && [x.team_a, x.team_b].sort().join('|') === pair) || null;
}

export default {
  id: 'series-winner',
  path: '/series-winner',
  online: true,
  lives: null,
  timerMs: null,
  pointsPerCorrect: 10,
  scenarios: {
    perfect: true,
    wrong: true,
    partial: true, // no lives: finish with a mix of right and wrong picks
    timeout: 'no clock in Series Winner (rounds wait for a pick)',
    giveup: 'Series Winner has no give-up control (only Close game, which abandons without an end state)',
    'daily-lock': 'not a daily game (any number of plays per day)',
  },

  async answer(page, ctx, { correct }) {
    const st = ctx.state;
    // Without the pool nothing can validate a round or know its winner: fail loudly, never accept any key.
    if (!(await ctx.pool(POOL)).length) noTruth(ctx, `${POOL} pool`, 'no playoff series in the round data');
    // A round is ready once its eyebrow and both names match one captured series: the eyebrow and the names
    // are separate SwapTexts, so a half-swapped round (new season, old teams) never counts as a turn.
    const keyOf = async () => {
      const x = await readRound(page);
      if (!x) return null;
      return matchRow(await ctx.pool(POOL), x) ? x.key : null;
    };
    if (!st.round) {
      await nextTurn(page, keyOf, null, shellIsOver);
      st.round = await readRound(page);
    }
    const r = st.round;
    const winner = await answerFrom(ctx, `series "${r.key}"`,
      async () => {
        const hit = matchRow(await ctx.pool(POOL), r);
        return hit ? hit.winner : null;
      },
      async () => {
        const f = await fiberRound(ctx, 'seriesList');
        const row = f && f.index != null ? f.rows[f.index] : null;
        return row && r.names.includes(row.winner) ? row.winner : null;
      });
    if (!r.names.includes(winner)) throw new Error(`series-winner: winner "${winner}" is not one of the shown teams ${r.names.join(' / ')}`);
    const pick = correct ? winner : r.names.find((n) => n !== winner);
    const btn = L(page, 'games.seriesPicks').filter({ has: page.locator('span.font-display', { hasText: exactly(pick) }) }).first();
    await btn.click();
    const next = await nextTurn(page, keyOf, r.key, shellIsOver);
    st.round = next.over ? null : await readRound(page);
    if (st.round && st.round.key !== next.key) st.round = null; // changed since: the next answer() re-reads it
    return { over: next.over, truth: winner };
  },

  isOver: shellIsOver,
};
