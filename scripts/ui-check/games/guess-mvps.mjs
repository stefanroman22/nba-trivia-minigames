// Adapter: Guess the MVPs (src/Game Renderers/GuessMvps.tsx). 5 award seasons, one guess each through the autocomplete
// + Confirm; right → "Correct! +20" (advance 1.5 s), wrong → "It was <winners>" (advance 1.8 s); the last round hands
// over to the full-screen GameResult (allowlisted).
//
// Right answer: ctx.pool('mvps') (single player: captured HTTP JSON, capPool). The pool is `mvps`
// (fetchGamePool("mvps", 5)): /data/mvps.json in dev, the manifest-v3 single file in prod; rows { season, mvp, award?,
// winners?, prompt? }, one per season and award (backend trivia/data_pipeline/award_seasons.py); an old file has one
// MVP row per season and no prompt. The round is the eyebrow (the season) + the title (the row's prompt, "Who won
// MVP?" on an old row); the row's first winner (`mvp`) is the answer. Fallback: fiber — GuessMvps props `seasonsList`
// + hook 0. Wrong guess: another row's winner.
// Note: GuessMvps has no guard against a second submit in the same round (NameLogo has one); the adapter submits
// exactly once per round.
import { L } from '../lib/pagemap.mjs';
import { answerFrom, fiberRound, nextTurn, roundLabel, shellIsOver, typeAndConfirm, wrongFrom } from './helpers.mjs';

const POOL = 'mvps';
const SEP = '\u0001';

/** The visible title: SwapText also lays out the reserved (aria-hidden) longest prompt in the same h2. */
const titleText = (page) => page.evaluate(() => {
  const el = document.querySelector('.playing-wrap .gf-title');
  if (!el) return '';
  const copy = el.cloneNode(true);
  copy.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
  return (copy.textContent || '').trim();
}).catch(() => '');

/** Season + prompt on screen: one key per round (a game never repeats a row). */
async function readRound(page) {
  const season = (await L(page, 'games.eyebrow').first().textContent({ timeout: 500 }).catch(() => '') || '').trim();
  const title = await titleText(page);
  const rl = await roundLabel(page);
  if (!season || !title || !rl) return null;
  if (!(await L(page, 'games.comboInput').isEditable({ timeout: 500 }).catch(() => false))) return null;
  // Between rounds the input is cleared and the popup hides together with the index change.
  const busy = await page.evaluate(() => [...document.querySelectorAll('.feedback-slot > *')].some((e) => e.getBoundingClientRect().height > 0));
  if (busy) return null;
  return `${season}${SEP}${title}`;
}

/** The row a round shows: same season, and the same prompt (an old row has none and shows "Who won MVP?"). */
const rowMatches = (row, season, title) => row && row.season === season && (row.prompt ? row.prompt === title : true);

export default {
  id: 'guess-mvps',
  path: '/guess-mvps',
  online: true,
  lives: null,
  timerMs: null,
  pointsPerCorrect: 20,
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
    const [season, title] = st.key.split(SEP);
    const rows = await ctx.pool(POOL);
    const mvp = await answerFrom(ctx, `${season} ${title}`,
      async () => {
        const hit = rows.find((x) => rowMatches(x, season, title));
        return hit ? hit.mvp : null;
      },
      async () => {
        const f = await fiberRound(ctx, 'seasonsList');
        const row = f && f.index != null ? f.rows[f.index] : null;
        return rowMatches(row, season, title) ? row.mvp : null;
      });
    // A wrong guess must not be a co-winner of this row.
    const hit = rows.find((x) => rowMatches(x, season, title));
    const right = new Set((hit?.winners || []).map((w) => w.name).concat(mvp));
    const names = rows.length ? rows.map((x) => x.mvp).filter((n) => !right.has(n)) : ['Michael Jordan', 'LeBron James'];
    await typeAndConfirm(page, correct ? mvp : wrongFrom(names, mvp));
    const next = await nextTurn(page, keyOf, st.key, shellIsOver);
    st.key = next.key;
    return { over: next.over, truth: mvp };
  },

  isOver: shellIsOver,
};
