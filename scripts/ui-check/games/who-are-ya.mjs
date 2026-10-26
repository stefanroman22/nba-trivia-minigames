// Adapter: Who Are Ya (src/Game Renderers/WhoAreYa.tsx). A blurred headshot of a mystery player, 8 guesses; every
// guess must be a player from the shared names list (anything else, or a repeat, costs nothing and is not used here).
// A miss adds a feedback row of chips and sharpens the photo; a right guess scores 250 − 30 × misses ("Correct! +N",
// N varies, so the answer result carries `points`); the 8th miss scores 0. Wrong copy is "Not <guessed name>." (the
// 8th too: the ordinary wrong copy, Rule 6.3). Ends in place: reveal card + EndSequence loader (1.5 s) → ScorePanel.
//
// Right answer: the question payload `{ schema, game: 'who-are-ya', qid, player }` the page received (capQuestions:
// dev from the questions store, prod from the manifest-v3 host). The photo is a Wikimedia Commons file (or the
// silhouette), whose URL carries no person_id, so the newest payload is taken.
// Fallback: fiber — WhoAreYa props `gameInfo`. The typed text must resolve through the game's own name lookup
// (utils/questions.ts buildNameLookup over the captured autocomplete list, first claim wins, canonical names and
// aliases): the adapter rebuilds it, types the mystery's full name only when it resolves to the mystery, and a wrong
// guess is a player whose name resolves to HIMSELF and not to the mystery, never repeated.
import { L } from '../lib/pagemap.mjs';
import { answerFrom, capNames, capQuestions, fiberRound, nextTurn, normAnswer, shellIsOver, typeAndConfirm } from './helpers.mjs';

const MAX_GUESSES = 8;

/** utils/questions.ts buildNameLookup(names).toId over the captured list. */
function lookupOf(names) {
  const toId = new Map();
  for (const n of names) {
    const canon = normAnswer(n.full_name);
    if (canon && !toId.has(canon)) toId.set(canon, n.id);
    for (const a of n.aliases || []) {
      const k = normAnswer(a);
      if (k && !toId.has(k)) toId.set(k, n.id);
    }
  }
  return (guess) => toId.get(normAnswer(guess)) ?? null;
}

/** Feedback rows so far; null once the reveal card is up (the game is ending: nextTurn waits for the end). */
const readState = (page) => page.evaluate(() => {
  if (document.querySelector('.playing-wrap .waya-reveal')) return null;
  if (!document.querySelector('.playing-wrap .gf-inputrow input')) return null;
  return `rows ${document.querySelectorAll('.playing-wrap .waya-row').length}`;
});

export default {
  id: 'who-are-ya',
  path: '/who-are-ya',
  online: true,
  lives: MAX_GUESSES, // 8 guesses: partial = 7 would end the game on the 8th, so partialMisses says how many to spend
  partialMisses: 2,
  latencyPlan: (t) => t === 2, // two misses, then the right player
  timerMs: null,
  pointsPerCorrect: null, // varies: the answer result carries `points`
  scenarios: {
    perfect: true, // right first guess → 250
    wrong: true, // eight misses → the mystery is revealed, 0 points
    partial: true, // two misses, then the right player → 190
    timeout: 'no clock in Who Are Ya',
    giveup: 'Who Are Ya has no give-up control (only Close game, which abandons without an end state)',
    'daily-lock': 'not a daily game (any number of plays per day)',
  },

  expectedScore(turns) {
    return turns.some((t) => t.correct) ? 250 - 30 * turns.filter((t) => !t.correct).length : 0;
  },

  async answer(page, ctx, { correct }) {
    const st = ctx.state;
    const keyOf = () => readState(page);
    if (!st.key) st.key = (await nextTurn(page, keyOf, null, shellIsOver)).key;
    if (!st.mystery) {
      const src = (await L(page, 'games.wayaPhoto').first().getAttribute('src', { timeout: 1000 }).catch(() => null)) || '';
      const id = Number((/\/(\d+)\.png/.exec(src) || [])[1]) || null;
      // Id-space assumption: the autocomplete list's `id` is the question payload's `player.person_id` (buildNameLookup
      // keys on NamesEntry.id; the game itself compares guessed.person_id === mystery.person_id). A mismatch would show
      // up as a right answer that the game scores wrong, or as no-wrong-player.
      st.names = await capNames(ctx);
      st.toId = lookupOf(st.names);
      st.wrong = 0;
      st.tried = new Set();
      st.mystery = await answerFrom(ctx, `mystery ${id ?? '(no photo)'}`,
        async () => {
          const qs = await capQuestions(ctx, 'who-are-ya');
          const hit = id == null ? qs[qs.length - 1] : qs.filter((q) => q.player.person_id === id).pop();
          return hit ? hit.player : null;
        },
        async () => {
          const f = await fiberRound(ctx, 'gameInfo');
          const q = f && f.rows[0];
          const p = q && (q.player || q);
          return p && p.full_name && (id == null || p.person_id === id) ? p : null;
        });
    }
    const m = st.mystery;
    let guess, shown;
    if (correct) {
      guess = [m.full_name, ...(m.aliases || [])].find((c) => st.toId(c) === m.person_id);
      if (guess == null) throw new Error(`who-are-ya: no text resolves to the mystery (${m.full_name}) in the game's name lookup`);
      shown = m.full_name;
    } else {
      const pick = st.names.find((n) => n.id !== m.person_id && st.toId(n.full_name) === n.id && !st.tried.has(n.id));
      if (!pick) throw new Error('who-are-ya: no guaranteed-wrong player available (no captured autocomplete list)');
      st.tried.add(pick.id);
      guess = shown = pick.full_name;
    }
    const points = correct ? 250 - 30 * st.wrong : null;
    if (!correct) st.wrong++;
    await typeAndConfirm(page, guess, { confirm: L(page, 'games.confirmGuess') });
    const next = await nextTurn(page, keyOf, st.key, shellIsOver, { timeout: 20_000 });
    st.key = next.key;
    return { over: next.over, truth: correct ? m.full_name : shown, points };
  },

  isOver: shellIsOver,

  /** In place: the reveal card names the mystery, the photo is sharp, one feedback row per guess (the right one marked). */
  async endReveal(page, ctx, turns) {
    const problems = [];
    const m = ctx.state.mystery;
    const won = turns.some((t) => t.correct);
    const card = await page.evaluate(() => {
      const e = document.querySelector('.playing-wrap .waya-reveal');
      const img = document.querySelector('.playing-wrap .waya-photo');
      return {
        reveal: e ? { name: (e.querySelector('.waya-reveal-name')?.textContent || '').trim(), visible: e.getBoundingClientRect().height > 0, won: e.classList.contains('is-won') } : null,
        filter: img ? getComputedStyle(img).filter : null,
        rows: document.querySelectorAll('.playing-wrap .waya-row').length,
        correctRows: document.querySelectorAll('.playing-wrap .waya-row.is-correct').length,
      };
    });
    if (!card.reveal || !card.reveal.visible) problems.push('no reveal card with the mystery player at the end');
    else if (normAnswer(card.reveal.name) !== normAnswer(m.full_name)) problems.push(`the reveal card names "${card.reveal.name}", the mystery was ${m.full_name}`);
    else if (card.reveal.won !== won) problems.push(`reveal card is-won=${card.reveal.won} after a ${won ? 'win' : 'loss'}`);
    if (card.filter == null) problems.push('no .waya-photo at the end (the headshot is missing or replaced by the silhouette), so the blur could not be checked');
    else if (!/^(none|blur\(0(px)?\))$/.test(card.filter)) problems.push(`the photo is still blurred at the end (${card.filter})`);
    if (card.rows !== turns.length) problems.push(`${card.rows} feedback rows for ${turns.length} guesses`);
    if (card.correctRows !== (won ? 1 : 0)) problems.push(`${card.correctRows} rows marked correct after a ${won ? 'win' : 'loss'}`);
    return problems;
  },
};
