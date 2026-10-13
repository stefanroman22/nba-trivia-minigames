// Adapter: Name the NBA Club (src/Game Renderers/NameLogo.tsx). 5 rounds, one guess per round through the
// autocomplete + Confirm; a right guess shows "Correct! +10" and advances after 1.5 s, a wrong one shows
// "It was the <team>" and advances after 1.8 s; the last round hands over to the full-screen GameResult
// (allowlisted).
//
// Right answer: ctx.cap. The pool is `name-logo` (fetchGamePool("name-logo", 5)): /data/name-logo.json in dev,
// the manifest-v3 single file in prod; rows { team_id, full_name, logo }. The round is identified by the puzzle
// image: `/logos/scrambled/<team_id>.webp` (constants/teamLogos.ts scrambledLogoUrl) for the 30 current
// franchises, else the row's own `logo` URL. Fallback: fiber — NameLogo props `seriesList` + hook 0.
// Wrong guess: another franchise from the same pool. NameLogo ignores a second submit in a round (advanceTimer).
import { L } from '../lib/pagemap.mjs';
import { answerFrom, capPool, fiberRound, nextTurn, roundLabel, shellIsOver, typeAndConfirm, wrongFrom } from './helpers.mjs';

const POOL = 'name-logo';

/** The puzzle image's src: one key per round (a game never repeats a team; the image only changes once the
 *  previous logo has faded out, so a half-swapped round is never read). */
async function readRound(page) {
  const src = await L(page, 'games.logoPuzzle').first().getAttribute('src', { timeout: 500 }).catch(() => null);
  if (!src || !(await roundLabel(page))) return null;
  if (!(await L(page, 'games.comboInput').isEditable({ timeout: 500 }).catch(() => false))) return null;
  return src;
}

export default {
  id: 'name-logo',
  path: '/name-logo',
  online: true,
  lives: null,
  timerMs: null,
  pointsPerCorrect: 10,
  scenarios: {
    perfect: true,
    wrong: true,
    partial: true, // no lives: finish with a mix of right and wrong guesses
    timeout: 'no clock in Name the NBA Club',
    giveup: 'Name the NBA Club has no give-up control (only Close game, which abandons without an end state)',
    'daily-lock': 'not a daily game (any number of plays per day)',
  },

  async answer(page, ctx, { correct }) {
    const st = ctx.state;
    const keyOf = () => readRound(page);
    if (!st.key) st.key = (await nextTurn(page, keyOf, null, shellIsOver)).key;
    const src = st.key;
    const rows = await capPool(ctx, POOL);
    const scrambled = /\/logos\/scrambled\/(\d+)\.webp/.exec(src);
    const team = await answerFrom(ctx, `logo ${src}`,
      async () => {
        const hit = rows.find((x) => (scrambled ? String(x.team_id) === scrambled[1] : x.logo && src.endsWith(new URL(x.logo, 'http://x').pathname)));
        return hit ? hit.full_name : null;
      },
      async () => {
        const f = await fiberRound(ctx, 'seriesList');
        const row = f && f.index != null ? f.rows[f.index] : null;
        return row ? row.full_name : null;
      });
    const names = rows.length ? rows.map((x) => x.full_name) : ['Boston Celtics', 'Los Angeles Lakers'];
    await typeAndConfirm(page, correct ? team : wrongFrom(names, team));
    const next = await nextTurn(page, keyOf, st.key, shellIsOver);
    st.key = next.key;
    return { over: next.over, truth: team };
  },

  isOver: shellIsOver,
};
