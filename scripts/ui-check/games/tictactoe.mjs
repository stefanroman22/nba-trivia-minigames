// Adapter: NBA Tic-Tac-Toe, solo (src/Game Renderers/TicTacToe.tsx). A 3×3 board with team rows × criteria columns:
// pick a cell, name a player who fits both its row and its column. 25 points per cell (225 for the board), each player
// usable once, a 180 s clock. Right → `Correct! +25` (the ninth cell `Board cleared! +225`), a player who does not fit →
// `<Name> doesn't fit` (bad), an unknown name → `Not in our player index` (muted), a reused player →
// `<Name> already used` (muted). Nothing costs a life: the game ends on a full board or when the clock hits 0
// (`Time!`, bad). Ends in place with NO loader (Career Path split): the final board stays (unsolved cells are revealed
// one by one), the ScoreLine sits in the status row, Play again / Close game in the action slot.
//
// Right answers: the question payload `{ schema, game: 'tictactoe', qid, rows, cols, valid: [9 × person_id[]] }` the
// page received (dev questions store / prod manifest-v3 host) — the payload whose criteria labels equal the ones on the
// board. `valid[cell]` lists every player that fits the cell, so `perfect` is derivable: a one-player-per-cell matching
// (augmenting paths) over players whose name resolves, through the game's own name lookup (captured autocomplete list,
// first claim wins), to themselves. Fallback: fiber — TicTacToe props `gameInfo[0]`. No matching of nine → noTruth().
// Misses: a player outside `valid[cell]` ("doesn't fit"), a synthetic name ("Not in our player index"), a solved
// player in another cell ("already used"): all guaranteed by the data, never guessed.
import { L } from '../lib/pagemap.mjs';
import { answerFrom, capNames, fiberRound, noTruth, normAnswer, shellIsOver, syntheticNames } from './helpers.mjs';

const CELL_POINTS = 25;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** The kinds of miss, in the order a `timeout` run gives them. */
const MISS_KINDS = ['fit', 'index', 'used'];

/** utils/questions.ts buildNameLookup(names): normalised name or alias → id, first claim wins. */
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

/** One player per cell (Kuhn's augmenting paths): cell → id, or null when nine distinct players do not exist. */
function assign(candidates) {
  const owner = new Map(); // id → cell
  const take = (cell, seen) => {
    for (const id of candidates[cell]) {
      if (seen.has(id)) continue;
      seen.add(id);
      if (!owner.has(id) || take(owner.get(id), seen)) { owner.set(id, cell); return true; }
    }
    return false;
  };
  for (let c = 0; c < 9; c++) if (!take(c, new Set())) return null;
  const out = [];
  for (const [id, cell] of owner) out[cell] = id;
  return out;
}

const isQuestion = (b) => b && typeof b === 'object' && !Array.isArray(b) && b.game === 'tictactoe' && Array.isArray(b.rows) && Array.isArray(b.cols) && Array.isArray(b.valid) && b.valid.length === 9;

/** The criteria labels the board shows: { cols, rows }. */
const readLabels = (page) => page.evaluate(() => ({
  cols: [...document.querySelectorAll('.playing-wrap .ttt-crit--col')].map((e) => e.textContent.trim()),
  rows: [...document.querySelectorAll('.playing-wrap .ttt-crit--row')].map((e) => e.textContent.trim()),
}));

/** Per cell: { name, mine, revealed, selected } from the board. */
const readCells = (page) => page.evaluate(() => [...document.querySelectorAll('.playing-wrap .ttt-cell')].map((c) => ({
  name: (c.querySelector('.ttt-cell-name')?.textContent || '').trim(),
  mine: c.classList.contains('is-mine'),
  revealed: c.classList.contains('is-revealed'),
  selected: c.classList.contains('is-selected'),
})));

/** The visible feedback popup: { text, color } | null. */
const popup = (page) => page.evaluate(() => {
  const el = [...document.querySelectorAll('.feedback-slot > *')].find((e) => e.getBoundingClientRect().height > 0);
  return el ? { text: el.textContent.replace(/\s+/g, ' ').trim(), color: getComputedStyle(el).color } : null;
});

export default {
  id: 'tictactoe',
  path: '/tictactoe',
  online: true,
  lives: null,
  partialMisses: 2, // `partial`: two misses on the board, then the whole board
  timerMs: 180_000,
  timeoutAfter: 5, // `timeout`: right, right, then one miss of each kind, then the clock runs out
  timeoutPlan: (t) => t < 2,
  pointsPerCorrect: CELL_POINTS,
  feedback: {
    selector: '.feedback-slot > *',
    // (turn, record, colours) → problems. meta: { kind: 'right' | 'last' | 'fit' | 'index' | 'used', name }.
    copy: (t, r, colors) => {
      const k = t.meta && t.meta.kind;
      const want = { right: ['Correct! +25', colors.good], last: ['Board cleared! +225', colors.good], fit: [`${t.meta && t.meta.name} doesn't fit`, colors.bad], index: ['Not in our player index', colors.muted], used: [`${t.meta && t.meta.name} already used`, colors.muted] }[k];
      if (!want) return [`unknown turn kind ${k}`];
      const problems = [];
      if (r.text !== want[0]) problems.push(`"${r.text}" instead of "${want[0]}"`);
      if (r.color !== want[1]) problems.push(`${r.color} instead of ${want[1]}`);
      return problems;
    },
  },
  scenarios: {
    perfect: true, // nine valid players, one per cell → Board cleared! 225
    wrong: 'a wrong name costs nothing and nothing else can lose: the game ends only on a full board or the clock, so misses are driven inside `timeout` (a miss of each kind) and `partial`',
    partial: true, // two misses ("doesn't fit", "Not in our player index"), then the whole board → 225
    timeout: true, // two cells solved, one miss of each kind, then the clock runs out (page.clock) → Time! with 50
    giveup: 'Tic-Tac-Toe has no give-up control (only Close game, which abandons without an end state)',
    'daily-lock': 'not a daily game (any number of plays per day)',
  },
  labels: {
    perfect: 'fill all nine cells with valid players',
    partial: 'two misses, then fill all nine cells',
    timeout: 'two cells, three kinds of miss, then the 3-minute clock runs out',
  },

  expectedScore(turns) {
    return turns.filter((t) => t.correct).length * CELL_POINTS;
  },

  async answer(page, ctx, { correct }) {
    const st = ctx.state;
    if (!st.q) {
      const labels = await readLabels(page);
      const same = (q) => q.rows.map((c) => c.label).join('|') === labels.rows.join('|') && q.cols.map((c) => c.label).join('|') === labels.cols.join('|');
      st.names = await capNames(ctx);
      st.toId = lookupOf(st.names);
      st.nameOf = new Map(st.names.map((n) => [n.id, n.full_name]));
      st.q = await answerFrom(ctx, `board ${labels.rows.join(' / ')} x ${labels.cols.join(' / ')}`,
        async () => {
          for (const e of (await ctx.cap.entries(/./)).reverse()) if (isQuestion(e.body) && same(e.body)) return e.body;
          return null;
        },
        async () => {
          const f = await fiberRound(ctx, 'gameInfo');
          const q = f && f.rows[0];
          return isQuestion({ game: 'tictactoe', ...q }) && same(q) ? q : null;
        });
      st.resolves = (id) => st.nameOf.has(id) && st.toId(st.nameOf.get(id)) === id;
      st.used = new Set();
      st.solvedName = {};
      st.misses = 0;
      st.guessNo = 0;
    }
    const q = st.q;
    const cells = await readCells(page);
    const cell = cells.findIndex((c) => !c.mine);
    if (cell < 0) throw new Error('tictactoe: every cell is already solved');
    let guess, kind, display, id = null;
    if (correct) {
      if (!st.plan) {
        st.plan = assign(q.valid.map((ids) => ids.filter(st.resolves)));
        if (!st.plan) {
          const why = 'no set of nine distinct, resolvable players fits the nine cells (valid lists / names list)';
          return noTruth(ctx, `board ${q.qid}`, why);
        }
      }
      id = st.plan[cell];
      guess = display = st.nameOf.get(id);
      kind = cells.filter((c) => c.mine).length === 8 ? 'last' : 'right';
    } else {
      kind = MISS_KINDS[st.misses % MISS_KINDS.length];
      if (kind === 'used' && !st.used.size) kind = 'fit'; // nobody is solved yet: nothing to reuse
      if (kind === 'fit') {
        const miss = st.names.find((n) => !q.valid[cell].includes(n.id) && !st.used.has(n.id) && st.resolves(n.id) && !(st.tried && st.tried.has(n.id)));
        if (!miss) throw new Error('tictactoe: no player outside the cell\'s valid list');
        (st.tried ||= new Set()).add(miss.id);
        guess = display = miss.full_name;
      } else if (kind === 'index') {
        guess = syntheticNames(1)[0];
        display = guess;
      } else {
        const reuse = [...st.used][0];
        guess = display = st.nameOf.get(reuse);
      }
      st.misses++;
    }
    // Select the cell (a click on the selected one would deselect it: a miss leaves it selected), type, Confirm.
    if (!cells[cell].selected) await L(page, 'games.tttCells').nth(cell).click();
    const input = L(page, 'games.comboInput');
    await input.fill(guess);
    await page.keyboard.press('Escape');
    await L(page, 'games.tttConfirm').click();
    st.guessNo++;
    if (correct) {
      st.used.add(id);
      st.solvedName[cell] = display;
      const until = Date.now() + 10_000;
      while (Date.now() < until) {
        if (await shellIsOver(page)) break;
        if ((await readCells(page))[cell].mine) break;
        await sleep(100);
      }
      if (kind === 'last') {
        const over = Date.now() + 5000;
        while (Date.now() < over && !(await shellIsOver(page))) await sleep(100);
      }
    } else {
      const want = kind === 'fit' ? `${display} doesn't fit` : kind === 'index' ? 'Not in our player index' : `${display} already used`;
      const until = Date.now() + 5000;
      while (Date.now() < until && (await popup(page))?.text !== want) await sleep(80);
    }
    return { over: await shellIsOver(page), truth: null, meta: { kind, name: display } };
  },

  isOver: shellIsOver,

  /** Clock out: still running with time left right before the jump; 181 s later (Date shifted) `Time!` (bad) is shown. */
  async timeout(page, ctx) {
    const clock = (await L(page, 'games.tttClock').first().textContent({ timeout: 2000 }).catch(() => '')) || '';
    const m = /^(\d+):(\d\d)$/.exec(clock.trim());
    ctx.state.clockBefore = m ? +m[1] * 60 + +m[2] : null;
    ctx.state.overBefore = await shellIsOver(page);
    // Shift the system time (Date), not the whole clock: the game reads Date.now() on a 500 ms interval. clock.fastForward /
    // runFor also jump performance.now(), and framer-motion starts its native (WAAPI) animations at performance.now(), so after
    // a 180 s jump every exit/enter animation (SwapText, EndSequence, the popup) would wait 180 s of real time.
    await page.clock.setSystemTime((await page.evaluate(() => Date.now())) + 180_000 + 1000);
    const until = Date.now() + 8000;
    let pop = null;
    while (Date.now() < until) {
      pop = await popup(page);
      if (pop && pop.text === 'Time!') break;
      await sleep(80);
    }
    if (!pop || pop.text !== 'Time!') {
      ctx.audit.violation('feedback-missing', { selector: '.feedback-slot > *', measured: `no "Time!" popup after the clock ran out (saw ${JSON.stringify(pop && pop.text)})`, expected: 'the clock running out ends the game with "Time!" (bad colour)' });
    } else {
      const bad = await page.evaluate(() => { const s = document.createElement('span'); s.style.color = 'var(--bad)'; document.body.appendChild(s); const c = getComputedStyle(s).color; s.remove(); return c; });
      if (pop.color !== bad) ctx.audit.violation('feedback-color', { selector: '.feedback-slot > *', measured: `${pop.color} on Time!`, expected: `var(--bad) ${bad}` });
    }
  },

  /**
   * Online duel (the multiplayer suite, lib/mp-play.mjs playDuel). Not the solo board: OnlineMatch renders TicTacToe with
   * `multiplayer` and the relay owns the game (multiplayer_server/src/turnGames.js): turns alternate, host first, 25 s per
   * turn (a turn that runs out passes to the other player), 3 steals each, three cells in a line win (225 vs 90; a full
   * board without a line is a draw, 150 each). The board shows only the criteria labels; the cells' valid players come
   * from the published question with the same labels (ctx.pool('tictactoe'), lib/mp-pool.mjs), names resolve through
   * the page's own names list (capNames + lookupOf, as solo).
   *   move(page, ctx, { correct }) — ONE move, on this player's turn:
   *     correct → claim the next free cell of the top row with a valid, unused player (three of them win the line);
   *     wrong   → claim a free cell (the bottom-right first) with a listed player who does NOT fit it: the relay refuses
   *               it ("<name> doesn't fit that square.", a warn notice) and the turn stays until its clock passes it.
   *   → { cell, name, kind: 'claim' | 'miss' }
   */
  online: {
    turnBased: true,
    myTurn: (page) => L(page, 'games.tttTurnYou').first().isVisible({ timeout: 300 }).catch(() => false),
    async move(page, ctx, { correct }) {
      const st = ctx.state;
      if (!st.q) {
        const labels = await readLabels(page);
        st.names = await capNames(ctx);
        st.toId = lookupOf(st.names);
        st.nameOf = new Map(st.names.map((n) => [n.id, n.full_name]));
        st.resolves = (id) => st.nameOf.has(id) && st.toId(st.nameOf.get(id)) === id;
        st.q = await answerFrom(ctx, `duel board ${labels.rows.join(' / ')} x ${labels.cols.join(' / ')}`,
          async () => (await ctx.pool('tictactoe'))[0] || null,
          async () => null); // the online renderer holds no `valid` lists: the published question is the only source
        st.used = new Set();
        st.tried = new Set();
      }
      const q = st.q;
      const cells = await readCells(page);
      const free = (i) => !cells[i].name;
      let cell, name;
      if (correct) {
        cell = [0, 1, 2].find(free);
        if (cell == null) throw new Error('tictactoe online: the top row is already full');
        const id = q.valid[cell].find((x) => st.resolves(x) && !st.used.has(x));
        if (id == null) return noTruth(ctx, `cell ${cell + 1} of ${q.qid}`, 'no unused, resolvable player fits it');
        st.used.add(id);
        name = st.nameOf.get(id);
      } else {
        cell = [8, 7, 6, 5, 4, 3].find(free);
        if (cell == null) throw new Error('tictactoe online: no free cell for a miss');
        const miss = st.names.find((n) => !q.valid[cell].includes(n.id) && st.resolves(n.id) && !st.tried.has(n.id) && !st.used.has(n.id));
        if (!miss) throw new Error('tictactoe online: no listed player outside the cell\'s valid list');
        st.tried.add(miss.id);
        name = miss.full_name;
      }
      await L(page, 'games.tttCells').nth(cell).click();
      await L(page, 'games.comboInput').fill(name);
      await page.keyboard.press('Escape');
      await L(page, 'games.tttConfirmMove').click();
      return { cell, name, kind: correct ? 'claim' : 'miss' };
    },
  },

  /** In place: the final board stays, every cell shows a player that fits it (unsolved ones revealed), solved cells keep theirs. */
  async endReveal(page, ctx, turns) {
    const problems = [];
    const st = ctx.state;
    const timedOut = ctx.scenario === 'timeout';
    if (timedOut) {
      if (st.overBefore) problems.push('the game was already over before the clock was run out');
      if (!(st.clockBefore > 5)) problems.push(`the clock showed ${st.clockBefore}s right before it was run out, expected more than 5`);
    }
    // The reveal fills one unsolved cell every 380 ms after a 500 ms beat: wait for all nine names.
    let cells = await readCells(page);
    for (let i = 0; i < 40 && !cells.every((c) => c.name); i++) { await sleep(250); cells = await readCells(page); }
    const solved = turns.filter((t) => t.correct).length;
    cells.forEach((c, i) => {
      if (!c.name) { problems.push(`cell ${i + 1} shows no player at the end`); return; }
      const id = st.toId(c.name);
      if (id == null || !st.q.valid[i].includes(id)) problems.push(`cell ${i + 1} shows "${c.name}", who does not fit it`);
      if (c.mine && st.solvedName[i] !== c.name) problems.push(`solved cell ${i + 1} changed from "${st.solvedName[i]}" to "${c.name}" (Rule 7.2: earned answers are not re-revealed)`);
      if (!c.mine && !c.revealed) problems.push(`unsolved cell ${i + 1} is not marked as revealed`);
    });
    if (cells.filter((c) => c.mine).length !== solved) problems.push(`${cells.filter((c) => c.mine).length} solved cells on the board for ${solved} right answers`);
    const end = await page.evaluate(() => ({
      label: (document.querySelector('.playing-wrap .gf-status-left .gf-label, .playing-wrap .gf-status-left')?.textContent || '').replace(/\s+/g, ' ').trim(),
      clock: (document.querySelector('.playing-wrap .ttt-clock')?.textContent || '').trim(),
    }));
    if (!/FINAL BOARD/.test(end.label)) problems.push(`the status label reads "${end.label}", expected FINAL BOARD`);
    if (timedOut && end.clock !== '0:00') problems.push(`the clock reads ${end.clock} after the time ran out, expected 0:00`);
    return problems;
  },
};
