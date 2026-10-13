// Playing an online round with the single-player game adapters (games/<id>.mjs), for the multiplayer suite.
//
// Online, OnlineMatch renders the same game renderer (renderGame(..., multiplayer: true)) inside
// `.stage-inner .om-stage--play` instead of MiniGame's `.playing-wrap`, and without MiniGame's feedback slot: a
// SubmitGuessPopup falls back to its inline overlay (a 0-height relative div → an absolute, pointer-events:none row →
// the popup span) inside the renderer. The adapters address the solo shell (`.playing-wrap …`, `.feedback-slot > *`,
// about 100 places), so the online driver hands them a VIEW of the page (onlinePage) that maps those two scopes to
// the online ones in every selector, in-page function source and string argument it passes through. The adapters run
// unchanged; their `ctx.online` is true, `ctx.pool` reads the socket frames (lib/mp-pool.mjs), and the few online
// differences live in the adapter itself (helpers shellIsOver / payloads; wordle's word; tictactoe's `online` duel).
import { expect } from '@playwright/test';
import { fiberReader } from './fiber.mjs';
import { L } from './pagemap.mjs';
import { checkTurns, expectedScore, newCtx, planFor, playTurns, waitOver } from './game-driver.mjs';
import { framePool } from './mp-pool.mjs';
import { STAGE_BOX, checkWaiting, demoteMpLoaf, sleep, waitState } from './mp.mjs';

/** The popup span of SubmitGuessPopup's inline fallback (no FeedbackSlotContext online). */
export const ONLINE_FEEDBACK = '.stage-inner .om-stage--play div[style*="pointer-events: none"] > span.font-accent';
const MAP = [
  ['.feedback-slot > *', ONLINE_FEEDBACK],
  ['.feedback-slot', '.stage-inner .om-stage--play div[style*="pointer-events: none"]'],
  ['.playing-wrap', '.stage-inner .om-stage--play'],
];
const rewrite = (s) => MAP.reduce((acc, [from, to]) => acc.split(from).join(to), s);
const rewriteArg = (v) => {
  if (typeof v === 'string') return rewrite(v);
  if (Array.isArray(v)) return v.map(rewriteArg);
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rewriteArg(x)]));
  return v;
};
const fnCache = new WeakMap();
/** An in-page function with the selectors in its source mapped (it runs in the page: it can close over nothing). */
const rewriteFn = (fn) => {
  if (typeof fn === 'string') return rewrite(fn);
  if (typeof fn !== 'function') return fn;
  if (fnCache.has(fn)) return fnCache.get(fn);
  const src = fn.toString();
  const out = rewrite(src);
  // eslint-disable-next-line no-eval
  const mapped = out === src ? fn : (0, eval)(`(${out})`);
  fnCache.set(fn, mapped);
  return mapped;
};

/**
 * The page as an adapter sees it online: locator / evaluate / waitForFunction / waitForSelector / $eval / $$eval / getByRole
 * map the solo shell's scopes to the online ones (MAP); `uicOnline` is true (helpers shellIsOver); everything else is the page.
 */
export function onlinePage(page) {
  return new Proxy(page, {
    get(target, prop) {
      if (prop === 'uicOnline') return true;
      if (prop === 'locator') return (sel, opts) => target.locator(rewrite(sel), opts);
      if (prop === 'evaluate' || prop === 'waitForFunction') return (fn, arg, opts) => target[prop](rewriteFn(fn), rewriteArg(arg), opts);
      if (prop === 'waitForSelector') return (sel, opts) => target.waitForSelector(rewrite(sel), opts);
      if (prop === '$eval' || prop === '$$eval') return (sel, fn, arg) => target[prop](rewrite(sel), rewriteFn(fn), rewriteArg(arg));
      const v = Reflect.get(target, prop, target);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

/** Adapter context for one player of an online round: socket-frame pool, fiber through the online view. */
export function onlineCtx(p, scenario) {
  const pg = onlinePage(p.page);
  const ctx = newCtx({ cap: p.cap, fiber: fiberReader(pg), vp: p.vp, audit: p.audit }, scenario, { online: true, pool: framePool(p.cap) });
  return { pg, ctx };
}

/** The scenario a player gives in a full match: the host `perfect`; the joiner `wrong`, or `giveup` for a game whose only loss path it is. */
export function lossScenario(adapter) {
  if (adapter.scenarios.wrong === true) return 'wrong';
  if (adapter.scenarios.giveup === true && adapter.giveUp) return 'giveup';
  return null;
}

/**
 * One player plays the whole online round with the adapter (`scenario`), inside audit.motion (snap / CLS on the stage;
 * `loaf` demoted to a note like the games suite's parallel pass), then the per-turn feedback presence (Rule 6.1; the copy
 * and colour rules belong to the games suite). → { turns, over, ctx, expected }
 */
export async function playOnline(p, adapter, scenario, { tag = '' } = {}) {
  const { pg, ctx } = onlineCtx(p, scenario);
  await expect(L(p.page, 'multiplayer.gameRoot')).toBeVisible({ timeout: 30_000 });
  await p.page.waitForTimeout(900); // the playing screen's entrance (OnlineMatch swap 0.34 s) and the renderer's first round
  await p.audit.layout({ scope: 'section.stage-col' });
  await p.audit.shot(`${tag}playing`);
  let result = { turns: [], over: false };
  const plan = planFor(adapter, scenario);
  const added = await p.audit.motion(async () => {
    if (scenario === 'giveup') {
      result = await playTurns(pg, adapter, ctx, { plan, stopAfter: adapter.giveUpAfter ?? 1, onFirstFeedback: () => p.audit.shot(`${tag}feedback`) });
      if (!result.over) { await adapter.giveUp(pg, ctx); result.over = await waitOver(pg, adapter, 20_000); }
    } else {
      result = await playTurns(pg, adapter, ctx, { plan, onFirstFeedback: () => p.audit.shot(`${tag}feedback`) });
    }
  }, { watch: STAGE_BOX, settleMs: 800 });
  demoteMpLoaf(p.audit, added);
  await checkTurns(p.audit, adapter, result.turns, { scenario, copyRules: false });
  if (!result.over) p.audit.violation('never-ended', { selector: adapter.id, measured: `still playing after ${result.turns.length} turns`, expected: 'the online round ends and the score goes to the match' });
  if (ctx.state.sources) p.audit.metrics.push({ kind: 'note', label: 'answer source', value: JSON.stringify(ctx.state.sources), unit: '', route: p.audit.route });
  return { ...result, ctx, expected: expectedScore(adapter, result.turns, ctx) };
}

/**
 * A whole round of a non-turn game: the host plays it to the end first (then the waiting screen is checked), then the
 * joiner. → { h, j } (each playOnline's result; `expected` is the score the answers should give).
 */
export async function playBoth(pair, adapter, { host = 'perfect', joiner = lossScenario(adapter), tag = '' } = {}) {
  const h = await playOnline(pair.host, adapter, host, { tag });
  await waitDone(pair.host);
  await checkWaiting(pair, h.expected, { tag });
  const j = await playOnline(pair.joiner, adapter, joiner, { tag });
  await waitDone(pair.joiner);
  return { h, j };
}

/** The relay's Tic-Tac-Toe duel scores (multiplayer_server/src/turnGames.js TTT_WIN_SCORE / TTT_LOSS_SCORE). */
export const TTT_SCORES = { win: 225, loss: 90 };
export const TTT_TURN_MS = 25_000;

/**
 * A turn-based duel (adapter.online.turnBased): the host wins with three claims in the top row, the joiner only misses.
 * Each joiner miss is refused by the relay (warn notice) and its turn passes to the host only when its 25 s clock runs
 * out, so a duel waits that clock out twice (pair A only; that wait IS the check that a turn passes on time).
 * Records `turn-pass` / `turn-reject` / `duel` violations. → { moves, passes: [ms] }
 */
export async function playDuel(pair, adapter) {
  const sides = { host: onlineCtx(pair.host, 'perfect'), joiner: onlineCtx(pair.joiner, 'wrong') };
  for (const p of [pair.host, pair.joiner]) {
    await expect(L(p.page, 'multiplayer.gameRoot')).toBeVisible({ timeout: 30_000 });
    await p.page.waitForTimeout(900);
    await p.audit.layout({ scope: 'section.stage-col' });
    await p.audit.shot('playing');
  }
  const moves = [], passes = [];
  let banners = [null, null];
  const ended = () => pair.host.page.locator('.stage-inner .om-stage--play .ttt-banner, .stage-inner .om-stage--results').count().catch(() => 0);
  const run = async () => {
    for (let i = 0; i < 12 && !(await ended()); i++) {
      // Whose turn: the side whose status says YOUR TURN (neither once the board is decided).
      let who = null;
      const until = Date.now() + TTT_TURN_MS + 10_000;
      while (!who && Date.now() < until && !(await ended())) {
        if (await adapter.online.myTurn(sides.host.pg)) who = 'host';
        else if (await adapter.online.myTurn(sides.joiner.pg)) who = 'joiner';
        else await sleep(150);
      }
      if (!who) {
        if (await ended()) break;
        throw new Error('tictactoe duel: neither player shows YOUR TURN');
      }
      const p = pair[who], { pg, ctx } = sides[who];
      const before = JSON.stringify(await readBoard(p.page));
      const m = await adapter.online.move(pg, ctx, { correct: who === 'host' });
      moves.push({ who, ...m });
      if (who === 'host') {
        await p.page.waitForFunction((b) => JSON.stringify([...document.querySelectorAll('.stage-inner .om-stage--play .ttt-cell')].map((c) => (c.querySelector('.ttt-cell-name')?.textContent || '').trim())) !== b, before, { timeout: 10_000 })
          .catch(() => p.audit.violation('duel', { selector: '.ttt-cell', measured: `the claim of ${m.name} on cell ${m.cell + 1} never showed on the board`, expected: 'a valid claim lands within 10 s' }));
        if (moves.filter((x) => x.who === 'host').length === 1) await p.audit.shot('claimed');
      } else {
        // The relay refuses the move (turnReject → warn notice); the turn stays until the clock passes it.
        const t0 = Date.now();
        const rejected = await p.page.waitForFunction((name) => [...document.querySelectorAll('.stage-inner .om .om-notice')].some((n) => n.textContent.includes(`${name} doesn't fit`)), m.name, { timeout: 8000 }).then(() => true, () => false);
        if (!rejected) p.audit.violation('turn-reject', { selector: '.om-notice', measured: `no "${m.name} doesn't fit that square." notice after the miss`, expected: 'the refused move is explained (turnReject → warn notice)' });
        else {
          // The notice bar sits over the top of the stage: it must not hide the turn label or the clock while it shows.
          const cover = await p.page.evaluate(() => {
            const n = [...document.querySelectorAll('.stage-inner .om .om-notice')].pop();
            const r = (el) => (el ? el.getBoundingClientRect() : null);
            const nb = r(n);
            const hit = ['.ttt-clock', '.ttt-turn'].map((s) => [s, r(document.querySelector(`.stage-inner .om-stage--play ${s}`))])
              .filter(([, b]) => nb && b && b.width && nb.left < b.right && nb.right > b.left && nb.top < b.bottom && nb.bottom > b.top);
            return hit.map(([s]) => s);
          });
          if (cover.length) p.audit.violation('notice-covers', { selector: '.om-notice', measured: `the "${m.name} doesn't fit" notice covers ${cover.join(' and ')} while the turn clock runs`, expected: 'a notice never hides the turn label or the clock' });
          if (moves.filter((x) => x.who === 'joiner').length === 1) await p.audit.shot('rejected');
        }
        const passed = await pair.host.page.waitForFunction(() => !!document.querySelector('.stage-inner .om-stage--play .ttt-turn.is-you'), null, { timeout: TTT_TURN_MS + 8000 }).then(() => true, () => false);
        const ms = Date.now() - t0;
        passes.push(ms);
        if (!passed) p.audit.violation('turn-pass', { selector: '.ttt-turn', measured: `the host still waits ${Math.round(ms / 1000)} s after the joiner's turn began`, expected: `a turn passes when its ${TTT_TURN_MS / 1000} s clock runs out` });
      }
    }
    // The decided board: a banner on both sides (held 1.8 s before the results), read while it shows.
    banners = await Promise.all([pair.host, pair.joiner].map((p) => p.page.locator('.stage-inner .om-stage--play .ttt-banner').first().innerText({ timeout: 5000 }).then((t) => t.trim(), () => null)));
    await Promise.all([pair.host, pair.joiner].map((p) => p.audit.shot('final-board')));
  };
  // Both pages sampled for snap / CLS while the duel runs (loaf demoted: two browsers at once).
  const outer = await pair.host.audit.motion(async () => {
    const inner = await pair.joiner.audit.motion(run, { watch: STAGE_BOX, settleMs: 400 });
    demoteMpLoaf(pair.joiner.audit, inner);
  }, { watch: STAGE_BOX, settleMs: 400 });
  demoteMpLoaf(pair.host.audit, outer);
  if (banners[0] !== 'You win!') pair.host.audit.violation('duel', { selector: '.ttt-banner', measured: `host banner "${banners[0]}"`, expected: '"You win!" after three in a row' });
  if (banners[1] !== 'Opponent wins') pair.joiner.audit.violation('duel', { selector: '.ttt-banner', measured: `joiner banner "${banners[1]}"`, expected: '"Opponent wins"' });
  for (const s of Object.values(sides)) if (s.ctx.state.sources) s.ctx.audit.metrics.push({ kind: 'note', label: 'answer source', value: JSON.stringify(s.ctx.state.sources), unit: '', route: s.ctx.audit.route });
  return { moves, passes };
}

/** Cell names of the duel board, in order. */
const readBoard = (page) => page.evaluate(() => [...document.querySelectorAll('.stage-inner .om-stage--play .ttt-cell')].map((c) => (c.querySelector('.ttt-cell-name')?.textContent || '').trim()));

/** Wait until a player left the playing screen (its score is in): waiting or results. */
export const waitDone = (p, timeout = 30_000) => waitState(p, ['waiting', 'results'], timeout);
