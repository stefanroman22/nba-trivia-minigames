// Adapter: NBA Wordle (src/Game Renderers/Wordle.tsx). The daily player last name (5 letters), 5 attempts, a physical
// keyboard and an on-screen one; 500 − 100 per attempt used. Any five letters are accepted (no dictionary). A solve
// pops "Correct! +N"; a miss shows NOTHING but the tile flip (no popup, Rule 6.3 for the last one too), so those turns
// return `feedback: false`. Ends in place: the keyboard stays until the last row lands (1.75 s), then a 0.5 s loader and
// the ScorePanel (Close game ONLY — accepted deviation: once per day, a replay would hit the 423 lock); the status
// label becomes `ANSWER: <WORD>`.
//
// Server gate (backend/trivia/wordle_daily.py + views.wordle_daily_play): ONE play per Europe/Paris day per account OR per
// device id (a union: locked when either played; the id is localStorage `nba-mg:wordle-device-id`, so a fresh browser
// context = a fresh device). Throttle `wordle-play` 20/h is DRF UserRateThrottle: keyed by account when logged in, by IP
// for guests. So every scenario here runs as its own brand-new account (`freshAccount: true`) in its own fresh context:
// neither gate can lock a later scenario, and each account's throttle bucket sees one play.
//
// Right answer: the `POST /trivia/wordle/daily-play/` response `{ series: [WORD], next_reset_at }` the page received (the
// word is by design in the play response — the client checks guesses itself). Fallback: fiber — Wordle props `gameInfo`.
import { L } from '../lib/pagemap.mjs';
import { answerFrom, fiberRound, nextTurn, shellIsOver } from './helpers.mjs';

const MAX_GUESSES = 5;
const POINTS_PER_GUESS = 100;
/** Five-letter strings (the game has no dictionary); the first one that is not the solution is used. */
const MISSES = ['ABOUT', 'HOUSE', 'MIGHT', 'PLANK', 'FJORD', 'QUIRK', 'ZZZZZ'];

/**
 * Submitted rows so far, as the key of a turn; null once the game is ending (a row of five greens, or the fifth row), so
 * nextTurn waits for the end sequence instead of returning a half-ended turn.
 */
const readState = (page) => page.evaluate(() => {
  const rows = [...document.querySelectorAll('.playing-wrap .wordle-board .line')];
  const graded = rows.filter((r) => [...r.querySelectorAll('.tile')].every((t) => /\b(correct|present|absent)\b/.test(t.className)));
  if (!rows.length) return null;
  const solved = graded.some((r) => [...r.querySelectorAll('.tile')].every((t) => /\bcorrect\b/.test(t.className)));
  if (solved || graded.length >= 5 || document.querySelector('.playing-wrap .wk.is-ended')) return null;
  return `rows ${graded.length}`;
});

/** Type five letters: even guesses on the physical keyboard, odd ones on the on-screen keys (both input paths run). */
async function enter(page, word, turn) {
  if (turn % 2 === 0) {
    await page.keyboard.type(word, { delay: 25 });
    await page.keyboard.press('Enter');
  } else {
    for (const ch of word) await page.locator(`.playing-wrap .wk-key[aria-label="${ch}"]`).click();
    await page.locator('.playing-wrap .wk-key[aria-label="Enter"]').click();
  }
}

export default {
  id: 'wordle',
  path: '/wordle',
  online: true,
  lives: MAX_GUESSES,
  partialMisses: 2,
  latencyPlan: (t) => t === 1, // one miss (no popup), then the solve (played to the end)
  timerMs: null,
  pointsPerCorrect: null, // varies with the attempt: the answer result carries `points`
  playAgain: false, // the locked result: Close game only
  idleAfterPlay: 'games.idleNote', // Close game lands on "Next word available in …", not on Play
  freshAccount: true, // every scenario is its own account + fresh device id (once-per-day gate)
  feedback: { selector: '.feedback-slot > *', copy: true },
  scenarios: {
    perfect: true, // solved on the first attempt → 500
    wrong: true, // five misses → the answer is revealed, 0 points
    partial: true, // two misses, then the solve → 300
    timeout: 'no clock in Wordle',
    giveup: 'Wordle has no give-up control (only Close game, which abandons without an end state)',
    'daily-lock': true, // after a finished play: reload → countdown note, no Play, rail item disabled, no Play again
  },

  expectedScore(turns) {
    return turns.some((t) => t.correct) ? (MAX_GUESSES - (turns.length - 1)) * POINTS_PER_GUESS : 0;
  },

  async answer(page, ctx, { correct }) {
    const st = ctx.state;
    const keyOf = () => readState(page);
    if (!st.key) st.key = (await nextTurn(page, keyOf, null, shellIsOver)).key;
    if (!st.solution) {
      st.solution = await answerFrom(ctx, 'the daily word',
        async () => {
          const hits = (await ctx.cap.entries(/\/trivia\/wordle\/daily-play\/?(\?|$)/)).filter((e) => e.status === 200 && e.body && Array.isArray(e.body.series) && e.body.series[0]);
          return hits.length ? String(hits[hits.length - 1].body.series[0]).toUpperCase() : null;
        },
        async () => {
          const f = await fiberRound(ctx, 'gameInfo');
          return f && f.rows[0] ? String(f.rows[0]).toUpperCase() : null;
        });
      st.guesses = 0;
    }
    const word = correct ? st.solution : MISSES.find((w) => w !== st.solution);
    const points = correct ? (MAX_GUESSES - st.guesses) * POINTS_PER_GUESS : null;
    await enter(page, word, st.guesses);
    st.guesses++;
    const next = await nextTurn(page, keyOf, st.key, shellIsOver, { timeout: 20_000 });
    st.key = next.key;
    // A miss shows no popup by design (the tile flip is the feedback): only the solve is checked for copy.
    return { over: next.over, truth: correct ? st.solution : null, points, feedback: correct };
  },

  isOver: shellIsOver,

  /** In place: the status label names the word, every guessed row stays on the board, and there is no Play again. */
  async endReveal(page, ctx, turns) {
    const problems = [];
    const { solution } = ctx.state;
    const end = await page.evaluate(() => {
      const label = document.querySelector('.playing-wrap .gf-status-left');
      const rect = label ? label.getBoundingClientRect() : null;
      const rows = [...document.querySelectorAll('.playing-wrap .wordle-board .line')].map((r) => [...r.querySelectorAll('.tile')].map((t) => (t.textContent || '').trim()).join(''));
      const again = [...document.querySelectorAll('.stage-inner button')].some((b) => /^Play again$/.test((b.textContent || '').trim()) && b.getBoundingClientRect().height > 0);
      return { label: label ? label.textContent.replace(/\s+/g, ' ').trim() : null, visible: !!rect && rect.height > 0, rows, again };
    });
    if (end.label !== `ANSWER: ${solution}`) problems.push(`the status label reads "${end.label}", expected "ANSWER: ${solution}"`);
    else if (!end.visible) problems.push('the answer label is not visible');
    const shown = end.rows.filter(Boolean).length;
    if (shown !== turns.length) problems.push(`${shown} guessed rows stay on the board for ${turns.length} guesses`);
    if (end.again) problems.push('the end screen offers Play again, but a replay only hits the daily lock (423)');
    return problems;
  },

  /** After the finished play and a reload (the driver's daily-lock scenario): countdown note, disabled rail item. */
  async checkLocked(page) {
    const problems = [];
    const note = await L(page, 'games.idleNote').first().textContent({ timeout: 2000 }).catch(() => null);
    if (!/^\s*Next word available in (\d+ (minutes?|hours?)|any moment now)\.\s*$/.test(note || '')) problems.push(`idle note reads "${(note || '').trim()}", expected "Next word available in <n> hours."`);
    const railState = () => page.evaluate(() => {
      const vis = (el) => el.getBoundingClientRect().height > 0 && getComputedStyle(el).visibility !== 'hidden';
      const items = [...document.querySelectorAll('button.rail-item, button.rail-chip')].filter((b) => /Wordle/i.test(b.textContent || '') && vis(b));
      return items.map((b) => ({ cls: b.className, disabled: b.disabled }));
    });
    let items = await railState();
    for (let i = 0; i < 20 && !(items.length && items.every((b) => b.disabled)); i++) { await page.waitForTimeout(250); items = await railState(); }
    if (!items.length) problems.push('no visible Wordle item in the game rail');
    else if (!items.every((b) => b.disabled)) problems.push('the Wordle rail item is still enabled after the daily play');
    return problems;
  },
};
