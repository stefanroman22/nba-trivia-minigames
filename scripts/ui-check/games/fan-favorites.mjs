// Adapter: Fan Favorites (src/Game Renderers/FanFavorites.tsx). One survey ("Name a player who…"), 6-17 hidden answers
// on a board, free-text autocomplete + Confirm, 3 hearts. A hit reveals its slot ("+N fans said it!"), a miss shows
// "Not on the board" and costs a heart (the third also reveals the board, popup included: it reuses the ordinary
// wrong copy, Rule 6.3). Clearing the board scores 200 ("Board cleared! +200"), otherwise round(200 × found / total).
// Ends in place (EndSequence loader → ScorePanel); not allowlisted.
//
// Rule 6.0 deviation, documented in docs/GAME_DESIGN_CONSTRAINTS.md: the correct popup is not `Correct! +N` (no
// per-answer points exist). `feedback.copy: 'wrong'` therefore checks the copy and colour of misses only.
//
// Right answer: ctx.pool('fan-favorites') (single player: captured HTTP JSON, capPool; fetchGamePool("fan-favorites", 1):
// /data/fan-favorites.json in dev, manifest-v3 chunks in prod). Rows { qid, prompt, category, answers: [{ answer,
// count, aliases }] }. The survey is identified by its prompt (the GameFrame title) and slot count; the next hit is
// the first unrevealed answer, typed as its canonical text (or an alias when another answer claims the canonical
// text under answerMatch.ts). Fallback: fiber — FanFavorites props `gameInfo`. Wrong guess: a candidate that
// matchAnswer finds on NO slot of this board (that check IS the guarantee), never repeated. Candidates, in order:
// answers and aliases of the other captured surveys (same category first; prod captures only the chunk the page
// loaded, often just this survey), the page's player list (`all-players`), then a fixed list of famous names, teams
// and seasons (WRONG_FALLBACK).
import { L } from '../lib/pagemap.mjs';
import { answerFrom, fiberRound, nextTurn, normAnswer, shellIsOver, syntheticNames, typeAndConfirm } from './helpers.mjs';

const POOL = 'fan-favorites';
/** Last-resort wrong guesses: each is checked against the board with matchIdx before use, so a board that does claim one skips it. */
const WRONG_FALLBACK = ['Michael Jordan', 'LeBron James', 'Boston Celtics', 'Los Angeles Lakers', 'Phil Jackson', '1995-96', 'Stephen Curry', 'Kobe Bryant',
  'Chicago Bulls', 'Gregg Popovich', '2015-16', 'Shaquille ONeal', 'Tim Duncan', 'Golden State Warriors', 'Pat Riley'];

/** src/utils/answerMatch.ts matchAnswer: the index of the answer a guess hits, else -1. */
const matchIdx = (guess, answers) => {
  const g = normAnswer(guess);
  if (!g) return -1;
  return answers.findIndex((a) => normAnswer(a.answer) === g || (a.aliases || []).some((x) => normAnswer(x) === g));
};

const readState = (page) => page.evaluate(() => {
  const slots = [...document.querySelectorAll('.playing-wrap .ff-slot')];
  const lives = /(\d+)\s*lives left/.exec(document.querySelector('.playing-wrap .ff-lives')?.getAttribute('aria-label') || '');
  if (!slots.length || !lives) return null;
  const hits = slots.filter((s) => s.classList.contains('is-hit')).length;
  if (+lives[1] === 0 || hits === slots.length) return null; // ending: nextTurn waits for the end
  return `${hits}|${lives[1]}`;
});

export default {
  id: 'fan-favorites',
  path: '/fan-favorites',
  online: true,
  lives: 3,
  timerMs: null,
  pointsPerCorrect: null,
  feedback: { selector: '.feedback-slot > *', copy: 'wrong' },
  scenarios: {
    perfect: true, // reveal the whole board → 200
    wrong: true, // three misses → the board is revealed, 0 points
    partial: true, // two misses (one heart left), then clear the board
    timeout: 'no clock in Fan Favorites',
    giveup: 'Fan Favorites has no give-up control (only Close game, which abandons without an end state)',
    'daily-lock': 'not a daily game (any number of plays per day)',
  },

  expectedScore(turns, ctx) {
    const total = ctx.state.survey.answers.length;
    const found = turns.filter((t) => t.correct).length;
    return found === total ? 200 : Math.round((200 * found) / total);
  },

  async answer(page, ctx, { correct }) {
    const st = ctx.state;
    const keyOf = () => readState(page);
    if (!st.key) st.key = (await nextTurn(page, keyOf, null, shellIsOver)).key;
    const rows = await ctx.pool(POOL);
    if (!st.survey) {
      const prompt = ((await L(page, 'games.title').first().textContent({ timeout: 1000 })) || '').trim();
      const slots = await L(page, 'games.ffSlots').count();
      st.survey = await answerFrom(ctx, `survey "${prompt}"`,
        async () => rows.find((r) => r.prompt === prompt && r.answers.length === slots) || null,
        async () => {
          const f = await fiberRound(ctx, 'gameInfo');
          const r = f && f.rows[0];
          return r && r.prompt === prompt && r.answers.length === slots ? r : null;
        });
      st.hit = new Set();
      st.tried = new Set();
    }
    const { answers } = st.survey;
    let text;
    if (correct) {
      const i = answers.findIndex((_, k) => !st.hit.has(k));
      if (i < 0) throw new Error('fan-favorites: every answer is already revealed');
      text = [answers[i].answer, ...(answers[i].aliases || [])].find((c) => matchIdx(c, answers) === i);
      if (text == null) throw new Error(`fan-favorites: no text hits answer "${answers[i].answer}" (an earlier answer claims it)`);
      st.hit.add(i);
    } else {
      const same = rows.filter((r) => r.category === st.survey.category && r.qid !== st.survey.qid);
      const others = rows.filter((r) => r.category !== st.survey.category && r.qid !== st.survey.qid);
      const players = (await ctx.pool('all-players')).filter((x) => typeof x === 'string');
      const candidates = [...same, ...others].flatMap((r) => r.answers.flatMap((a) => [a.answer, ...(a.aliases || [])])).concat(players.slice(0, 200), WRONG_FALLBACK, syntheticNames()); // the synthetic tail cannot run out (free text is submittable)
      text = candidates.find((c) => normAnswer(c) && matchIdx(c, answers) < 0 && !st.tried.has(normAnswer(c)));
      if (text == null) throw new Error('fan-favorites: no guaranteed-wrong answer available');
      st.tried.add(normAnswer(text));
    }
    await typeAndConfirm(page, text, { confirm: L(page, 'games.confirmGuess') });
    const next = await nextTurn(page, keyOf, st.key, shellIsOver);
    st.key = next.key;
    return { over: next.over, truth: null };
  },

  isOver: shellIsOver,

  /** In place: every slot shows its answer and count, hits green (is-hit), the rest revealed (is-missed). */
  async endReveal(page, ctx, turns) {
    const problems = [];
    const { answers } = ctx.state.survey;
    await page.waitForFunction(() => [...document.querySelectorAll('.playing-wrap .ff-slot')].every((s) => s.querySelector('.ff-answer')), null, { timeout: 6000 }).catch(() => {});
    const shown = await page.evaluate(() => [...document.querySelectorAll('.playing-wrap .ff-slot')].map((s) => ({
      answer: (s.querySelector('.ff-answer')?.textContent || '').trim(),
      count: (s.querySelector('.ff-count')?.textContent || '').trim(),
      cls: s.className,
      visible: !!s.querySelector('.ff-answer') && s.querySelector('.ff-answer').getBoundingClientRect().height > 0,
    })));
    if (shown.length !== answers.length) problems.push(`${shown.length} slots for ${answers.length} answers`);
    const blank = shown.filter((s) => !s.answer || !s.visible).length;
    if (blank) problems.push(`${blank} of ${answers.length} board slots still hide their answer at the end`);
    shown.forEach((s, i) => {
      if (answers[i] && s.answer && (s.answer !== answers[i].answer || s.count !== String(answers[i].count))) problems.push(`slot ${i + 1} shows "${s.answer}" ${s.count}, the survey says "${answers[i].answer}" ${answers[i].count}`);
    });
    const right = turns.filter((t) => t.correct).length;
    const hit = shown.filter((s) => /is-hit/.test(s.cls)).length, missed = shown.filter((s) => /is-missed/.test(s.cls)).length;
    if (hit !== right || missed !== answers.length - right) problems.push(`${hit} hit / ${missed} missed slots for ${right} right answers of ${answers.length}`);
    return problems;
  },
};
