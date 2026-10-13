// Adapter: Fill in the Starting 5 (src/Game Renderers/StartingFive.tsx). One real game; five position cards
// (PG, SG, SF, PF, C), each with its own autocomplete + Confirm; 3 lives. Right → "Correct! +10" in the card;
// wrong → "Not in this lineup" and one heart; the third wrong guess shows no popup (Rule 6.3) and reveals the
// lineup. Five found → +50 bonus (100). Both ends are in place (EndSequence loader → ScorePanel), not allowlisted.
//
// Right answer: ctx.pool('starting-five') (single player: captured HTTP JSON, capPool; fetchGamePool("starting-five", 1):
// /data/starting-five.json in dev, manifest-v3 chunks in prod). Rows { team_a, team_b, final_score, game_date,
// winning_team, starting_5: [{ name, position }] } with position G / F / C (the board is 2 G + 2 F + 1 C). The game is
// identified from the scoreboard (both team names + final score, date disambiguates); the card to fill is the first
// one not yet found, and the answer is a lineup player of that card's position family (PG/SG → G, SF/PF → F, C → C)
// not yet used. Fallback: fiber — StartingFive props `gameInfo`. Wrong guess: a player from another game's
// lineup whose normalised name matches nobody in this lineup, never repeated.
import { L } from '../lib/pagemap.mjs';
import { answerFrom, fiberRound, nextTurn, normAnswer, shellIsOver, syntheticNames, typeAndConfirm } from './helpers.mjs';

const POOL = 'starting-five';
const FAMILY = { 'Point Guard': 'G', 'Shooting Guard': 'G', 'Small Forward': 'F', 'Power Forward': 'F', Center: 'C' };
const family = (pos) => (pos === 'PF' || pos === 'SF' || pos === 'F' ? 'F' : pos === 'PG' || pos === 'SG' || pos === 'G' ? 'G' : pos);

/** Scoreboard text of the game on screen. */
const readBoard = (page) => page.evaluate(() => {
  const t = (s) => (document.querySelector(s)?.textContent || '').replace(/\s+/g, ' ').trim();
  return {
    teams: [...document.querySelectorAll('.playing-wrap .s5-team-name')].map((e) => e.textContent.trim()),
    score: t('.playing-wrap .s5-score-num'),
    date: t('.playing-wrap .s5-score-date'),
  };
});

/** found cards | hearts left; null once the game is ending (5 found or 0 hearts) so nextTurn waits for the end. */
async function readState(page) {
  const s = await page.evaluate(() => {
    const lives = /(\d+)\s*lives left/.exec(document.querySelector('.playing-wrap .s5-lives')?.getAttribute('aria-label') || '');
    const cards = [...document.querySelectorAll('.playing-wrap .s5-card')];
    return { lives: lives ? +lives[1] : null, found: cards.filter((c) => c.classList.contains('is-correct')).length, cards: cards.length };
  });
  if (s.lives == null || s.cards !== 5) return null;
  if (s.lives === 0 || s.found === 5) return null;
  return `${s.found}|${s.lives}`;
}

/** The pool row for the scoreboard (teams + score; the date picks between two games with the same result). */
async function rowOnScreen(page, rows) {
  const b = await readBoard(page);
  const hits = rows.filter((r) => b.teams[0] === r.team_a && b.teams[1] === r.team_b && String(r.final_score).trim() === b.score);
  if (hits.length <= 1) return hits[0] || null;
  const dates = await page.evaluate((ds) => ds.map((d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })), hits.map((r) => r.game_date));
  return hits[dates.indexOf(b.date)] || hits[0];
}

export default {
  id: 'starting-five',
  path: '/starting-five',
  online: true,
  lives: 3,
  timerMs: null,
  pointsPerCorrect: 10,
  scenarios: {
    perfect: true, // five right → 100 with the lineup bonus
    wrong: true, // three misses → the lineup is revealed, 0 points
    partial: true, // two misses (one heart left), then all five right
    timeout: 'no clock in Fill in the Starting 5',
    giveup: 'Fill in the Starting 5 has no give-up control (only Close game, which abandons without an end state)',
    'daily-lock': 'not a daily game (any number of plays per day)',
  },

  expectedScore(turns) {
    const right = turns.filter((t) => t.correct).length;
    return right * 10 + (right === 5 ? 50 : 0);
  },

  async answer(page, ctx, { correct }) {
    const st = ctx.state;
    const keyOf = () => readState(page);
    if (!st.key) st.key = (await nextTurn(page, keyOf, null, shellIsOver)).key;
    const rows = await ctx.pool(POOL);
    // The lineup, fixed for the whole game.
    if (!st.lineup) {
      const board = await readBoard(page);
      st.lineup = await answerFrom(ctx, `game ${board.teams.join(' vs ')} ${board.score}`,
        async () => {
          const r = await rowOnScreen(page, rows);
          return r ? r.starting_5 : null;
        },
        async () => {
          const f = await fiberRound(ctx, 'gameInfo');
          const r = f && f.rows[0];
          return r && r.team_a === board.teams[0] && r.team_b === board.teams[1] && String(r.final_score).trim() === board.score ? r.starting_5 : null;
        });
      st.used = new Set();
      st.tried = new Set();
    }
    // The first card still waiting for a player.
    const cards = L(page, 'games.s5Cards');
    const n = await cards.count();
    let card = null, slot = null;
    for (let i = 0; i < n && !card; i++) {
      const c = cards.nth(i);
      const cls = (await c.getAttribute('class', { timeout: 1000 })) || '';
      if (!/is-correct|is-revealed/.test(cls)) { card = c; slot = (await c.locator('.s5-card-pos').textContent({ timeout: 1000 })).trim(); }
    }
    if (!card) throw new Error('starting-five: no card is waiting for a player');
    const lives = Number(/(\d+)\s*lives left/.exec(await L(page, 'games.s5Lives').getAttribute('aria-label', { timeout: 1000 }))?.[1]);

    let name;
    if (correct) {
      const want = FAMILY[slot];
      const p = st.lineup.find((x) => family(x.position) === want && !st.used.has(x.name));
      if (!p) throw new Error(`starting-five: no unused ${want} in the lineup for the ${slot} card`);
      name = p.name;
      st.used.add(name);
    } else {
      const inLineup = new Set(st.lineup.map((x) => normAnswer(x.name)));
      // Other lineups first, then made-up names that cannot run out (free text is submittable: handleGuessSubmit takes the typed text).
      const pool = rows.flatMap((r) => r.starting_5.map((x) => x.name)).concat(syntheticNames());
      name = pool.find((x) => !inLineup.has(normAnswer(x)) && !st.tried.has(normAnswer(x)));
      if (!name) throw new Error('starting-five: no guaranteed-wrong name available');
      st.tried.add(normAnswer(name));
    }
    await typeAndConfirm(page, name, { input: card.locator('input[role="combobox"]'), confirm: card.getByRole('button', { name: /^Confirm/ }) });
    const next = await nextTurn(page, keyOf, st.key, shellIsOver);
    st.key = next.key;
    // The miss that spends the last heart shows no popup (Rule 6.3).
    return { over: next.over, truth: correct ? name : null, feedback: correct || lives > 1 };
  },

  isOver: shellIsOver,

  /** In place: all five cards end up named; found ones green (is-correct), the rest revealed (is-revealed) with the real lineup. */
  async endReveal(page, ctx, turns) {
    const problems = [];
    const lineup = (ctx.state.lineup || []).map((x) => normAnswer(x.name)).sort();
    await page.waitForFunction(() => [...document.querySelectorAll('.playing-wrap .s5-card-name')].filter((e) => e.textContent.trim()).length === 5, null, { timeout: 4000 }).catch(() => {});
    const shown = await page.evaluate(() => [...document.querySelectorAll('.playing-wrap .s5-card')].map((c) => ({
      name: (c.querySelector('.s5-card-name')?.textContent || '').trim(),
      cls: c.className,
      visible: !!c.querySelector('.s5-card-name') && c.querySelector('.s5-card-name').getBoundingClientRect().height > 0,
    })));
    if (shown.length !== 5) problems.push(`${shown.length} player cards at the end`);
    const missing = shown.filter((c) => !c.name || !c.visible);
    if (missing.length) problems.push(`${missing.length} of 5 cards show no player name at the end`);
    if (lineup.length && !missing.length && JSON.stringify(shown.map((c) => normAnswer(c.name)).sort()) !== JSON.stringify(lineup)) {
      problems.push(`cards show ${shown.map((c) => c.name).join(', ')}, the lineup was ${ctx.state.lineup.map((x) => x.name).join(', ')}`);
    }
    const right = turns.filter((t) => t.correct).length;
    const found = shown.filter((c) => /is-correct/.test(c.cls)).length, revealed = shown.filter((c) => /is-revealed/.test(c.cls)).length;
    if (found !== right || revealed !== 5 - right) problems.push(`${found} found / ${revealed} revealed cards for ${right} right answers`);
    return problems;
  },
};
