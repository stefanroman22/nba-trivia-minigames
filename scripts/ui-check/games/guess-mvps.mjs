// Adapter: Guess the MVPs (src/Game Renderers/GuessMvps.tsx). 5 seasons, one guess each through the autocomplete
// + Confirm; right → "Correct! +10" (advance 1.5 s), wrong → "It was <mvp>" (advance 1.8 s); the last round hands
// over to the full-screen GameResult (allowlisted).
//
// Right answer: ctx.pool('mvps') (single player: captured HTTP JSON, capPool). The pool is `mvps`
// (fetchGamePool("mvps", 5)): /data/mvps.json in dev, the manifest-v3 single file in prod; rows { season, mvp, … }, one per season. The round is the eyebrow (the season); the row's
// `mvp` is the answer. Fallback: fiber — GuessMvps props `seasonsList` + hook 0. Wrong guess: another season's MVP.
// Note: GuessMvps has no guard against a second submit in the same round (NameLogo has one); the adapter submits
// exactly once per round.
import { L } from '../lib/pagemap.mjs';
import { answerFrom, fiberRound, nextTurn, roundLabel, shellIsOver, typeAndConfirm, wrongFrom } from './helpers.mjs';

const POOL = 'mvps';

/** The season on the eyebrow: one key per round (a game never repeats a season). */
async function readRound(page) {
  const season = (await L(page, 'games.eyebrow').first().textContent({ timeout: 500 }).catch(() => '') || '').trim();
  const rl = await roundLabel(page);
  if (!season || !rl) return null;
  if (!(await L(page, 'games.comboInput').isEditable({ timeout: 500 }).catch(() => false))) return null;
  // Between rounds the input is cleared and the popup hides together with the index change.
  const busy = await page.evaluate(() => [...document.querySelectorAll('.feedback-slot > *')].some((e) => e.getBoundingClientRect().height > 0));
  if (busy) return null;
  return season;
}

export default {
  id: 'guess-mvps',
  path: '/guess-mvps',
  online: true,
  lives: null,
  timerMs: null,
  pointsPerCorrect: 10,
  scenarios: {
    perfect: true,
    wrong: true,
    partial: true, // no lives: finish with a mix of right and wrong guesses
    timeout: 'no clock in Guess the MVPs',
    giveup: 'Guess the MVPs has no give-up control (only Close game, which abandons without an end state)',
    'daily-lock': 'not a daily game (any number of plays per day)',
  },

  async answer(page, ctx, { correct }) {
    const st = ctx.state;
    const keyOf = () => readRound(page);
    if (!st.key) st.key = (await nextTurn(page, keyOf, null, shellIsOver)).key;
    const season = st.key;
    const rows = await ctx.pool(POOL);
    const mvp = await answerFrom(ctx, `season ${season}`,
      async () => {
        const hit = rows.find((x) => x.season === season);
        return hit ? hit.mvp : null;
      },
      async () => {
        const f = await fiberRound(ctx, 'seasonsList');
        const row = f && f.index != null ? f.rows[f.index] : null;
        return row && row.season === season ? row.mvp : null;
      });
    const names = rows.length ? rows.map((x) => x.mvp) : ['Michael Jordan', 'LeBron James'];
    await typeAndConfirm(page, correct ? mvp : wrongFrom(names, mvp));
    const next = await nextTurn(page, keyOf, st.key, shellIsOver);
    st.key = next.key;
    return { over: next.over, truth: mvp };
  },

  isOver: shellIsOver,
};
