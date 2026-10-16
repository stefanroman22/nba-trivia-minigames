// Adapter: Career Path (src/Game Renderers/CareerPath.tsx). One mystery player; a rail of career cards (one per team
// stint), the first face-up; ONE name guess per card: every miss flips the next card, the guess after the last card
// ends the game with 0. A right guess scores 200 − 40 × misses (floor 40). Right → "Correct! +N" (N varies with the misses,
// so the answer result carries `points`), wrong → "Not him." (the last miss too: the ordinary copy, Rule 6.3). Ends in place with NO loader and NO ScorePanel: the result line sits in the status row, Play again /
// Close game alone in the action slot (a documented deviation, constraints doc; the driver reads both).
//
// Right answer: the question payload `{ schema, game: 'career-path', qid, player }` the page received (capQuestions:
// dev from the questions store, prod from the manifest-v3 host). Several can be captured (Play again fetches a new
// one), so the payload is the newest whose stints equal what the rail shows: same stint count and the same team +
// years on every face-up card. Fallback: fiber — CareerPath props `gameInfo` ([question | player]) accepted on the
// same test. Wrong guess: another player's name from the page's autocomplete list (capNames) that answerMatch.ts
// does not match to this player (name or alias); never repeated. `partial` never spends the last guess: when the
// plan asks for a miss with one guess left, the adapter answers right instead (and says so in the turn result),
// which also covers a one-stint player.
import { L } from '../lib/pagemap.mjs';
import { answerFrom, capNames, capQuestions, fiberRound, nextTurn, normAnswer, shellIsOver, typeAndConfirm } from './helpers.mjs';

/** CareerPath.tsx stintYears. */
const years = (s) => (s.end_year === null ? `${s.start_year} – present` : s.end_year === s.start_year ? `${s.start_year}` : `${s.start_year} – ${s.end_year}`);
const squash = (t) => String(t || '').replace(/\s+/g, ' ').trim();

/** The rail: [{ up, team, years }] per card. */
const readRail = (page) => page.evaluate(() => [...document.querySelectorAll('.playing-wrap .cp-rail .cp-card')].map((c) => ({
  up: !!c.querySelector('.cp-flip.is-flipped'),
  team: (c.querySelector('.cp-card-team')?.textContent || '').trim(),
  years: (c.querySelector('.cp-card-years')?.textContent || '').trim(),
})));

/** Number of face-up cards; null once the game is ending (the result line replaced the label). */
async function readState(page) {
  const ended = await page.evaluate(() => !!document.querySelector('.playing-wrap .cp-result'));
  if (ended) return null;
  const rail = await readRail(page);
  return rail.length ? String(rail.filter((c) => c.up).length) : null;
}

const matchesRail = (player, rail) => !!player && Array.isArray(player.teams) && player.teams.length === rail.length
  && rail.every((c, i) => !c.up || (squash(c.team) === squash(player.teams[i].name) && squash(c.years) === squash(years(player.teams[i]))));

export default {
  id: 'career-path',
  path: '/career-path',
  online: true,
  lives: null, // guesses = stints, known only from the rail: partialMisses + the in-adapter override below
  partialMisses: 1,
  latencyPlan: (t) => t === 1, // a miss, then the right name (a right first guess would end the game after one sample)
  timerMs: null,
  pointsPerCorrect: null, // varies: the answer result carries `points`
  scenarios: {
    perfect: true, // right first guess → 200
    wrong: true, // a miss per card until the last guess → 0
    partial: true, // one miss, then the right name (never the last guess)
    timeout: 'no clock in Career Path',
    giveup: 'Career Path has no give-up control (only Close game, which abandons without an end state)',
    'daily-lock': 'not a daily game (any number of plays per day)',
  },

  expectedScore(turns, ctx) {
    const won = turns.some((t) => t.correct);
    return won ? Math.max(40, 200 - 40 * turns.filter((t) => !t.correct).length) : 0;
  },

  async answer(page, ctx, { correct }) {
    const st = ctx.state;
    const keyOf = () => readState(page);
    if (!st.key) st.key = (await nextTurn(page, keyOf, null, shellIsOver)).key;
    if (!st.player) {
      const rail = await readRail(page);
      st.stints = rail.length;
      st.wrong = 0;
      st.tried = new Set();
      st.player = await answerFrom(ctx, `career of ${rail.map((c) => c.team).join(' > ')}`,
        async () => {
          const hit = (await capQuestions(ctx, 'career-path')).filter((q) => matchesRail(q.player, rail)).pop();
          return hit ? hit.player : null;
        },
        async () => {
          const f = await fiberRound(ctx, 'gameInfo');
          const q = f && f.rows[0];
          const p = q && (q.player || q);
          return matchesRail(p, rail) ? p : null;
        });
    }
    const player = st.player;
    const left = st.stints - st.wrong;
    let right = correct;
    if (!right && ctx.scenario === 'partial' && left === 1) {
      right = true; // keep one guess: partial must still win
      if (st.wrong === 0 && ctx.audit) ctx.audit.metrics.push({ kind: 'note', label: 'partial degenerated to perfect (one-stint player: right answer forced)', value: st.stints, unit: 'stints', route: ctx.audit.route });
    }
    let guess;
    if (right) {
      guess = player.full_name;
    } else {
      const names = (await capNames(ctx)).map((n) => n.full_name);
      const own = [{ answer: player.full_name, aliases: player.aliases || [] }];
      const ownNorm = new Set([own[0].answer, ...own[0].aliases].map(normAnswer));
      guess = names.find((n) => !ownNorm.has(normAnswer(n)) && !st.tried.has(normAnswer(n)));
      if (guess == null) throw new Error('career-path: no guaranteed-wrong name available (no captured autocomplete list)');
      st.tried.add(normAnswer(guess));
    }
    const points = right ? Math.max(40, 200 - 40 * st.wrong) : null;
    if (!right) st.wrong++;
    await typeAndConfirm(page, guess, { confirm: L(page, 'games.confirmGuess') });
    const next = await nextTurn(page, keyOf, st.key, shellIsOver);
    st.key = next.key;
    return { over: next.over, truth: right ? player.full_name : null, correct: right, points };
  },

  isOver: shellIsOver,

  /** In place: a win shows the player's name (answer pane); a loss has every card face-up and the name behind "See the answer". */
  async endReveal(page, ctx, turns) {
    const problems = [];
    const { player, stints } = ctx.state;
    const won = turns.some((t) => t.correct);
    const rail = await readRail(page);
    if (rail.filter((c) => c.up).length !== stints && !won) problems.push(`${rail.filter((c) => c.up).length} of ${stints} career cards face-up after the loss`);
    const nameVisible = () => page.evaluate(() => {
      const e = document.querySelector('.playing-wrap .cp-reveal-name');
      const pane = e && e.closest('.cp-answer');
      return e ? { text: e.textContent.trim(), visible: e.getBoundingClientRect().height > 0 && !!pane && getComputedStyle(pane).visibility !== 'hidden' && +getComputedStyle(pane).opacity > 0.5 } : null;
    });
    let shown = await nameVisible();
    if (!won) {
      // Loss: the answer is one click away ("See the answer" toggle).
      const toggle = page.locator('.playing-wrap .cp-toggle');
      if (!(await toggle.isVisible({ timeout: 1000 }).catch(() => false))) problems.push('no "See the answer" toggle after the loss');
      else {
        await toggle.click();
        await page.waitForTimeout(700);
        shown = await nameVisible();
      }
    }
    if (!shown) problems.push('the player\'s name is not in the end state');
    else if (!shown.visible) problems.push(`the player's name "${shown.text}" is not visible`);
    else if (normAnswer(shown.text) !== normAnswer(player.full_name)) problems.push(`the end state names "${shown.text}", the player was ${player.full_name}`);
    return problems;
  },
};
