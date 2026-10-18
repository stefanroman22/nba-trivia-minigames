// Adapter: LeContexto (src/Game Renderers/Contexto.tsx). A hidden secret player; any number of guesses, each shows its
// similarity rank (#1 = the secret); Give up reveals the secret. Score 200, −5 per guess past the tenth, floor 50; a
// give-up scores 0. Ends in place: the secret card flips to the name, the guess list stays, input → 1.5 s loader → ScorePanel
// (Close game ONLY, like Wordle: solo Contexto is once per day, a replay would hit the 423 lock).
//
// Server gate (backend/trivia/wordle_daily.py + views.contexto_daily_play): ONE solo play per Europe/Paris day per account OR
// per device id (the same localStorage `nba-mg:wordle-device-id` Wordle uses; a fresh browser context = a fresh device);
// the play response `{ day, next_reset_at }` names the day whose question the page then loads. Throttle `contexto-play`
// 20/h (account, or IP for guests). So every scenario runs as its own brand-new account (`freshAccount: true`), like
// Wordle. Online Contexto (the relay deals the round) has no lock.
//
// Feedback copy (accepted deviation: no `Correct! +N`): a miss pops `#<rank>` in good (≤ 25) / brand (≤ 100) / bad
// colour, the solve `Got it in N! +score` in good, a give-up `It was <name>` in bad. The driver's Rule 6.0 text check is
// replaced by `feedback.copy` below (the game's own copy).
//
// Right answer: the question payload `{ schema, game: 'contexto', qid, day, secret, ranking: [[person_id, rank], …] }`
// the page received (dev questions store / prod manifest-v3 host; online the round the relay dealt, helpers payloads):
// the secret AND the whole ranking are in the captured data. Fallback: fiber — Contexto props `gameInfo[0]`. The typed text must resolve through the game's own name
// lookup (the captured autocomplete list, first claim wins); the secret is typed only when its text resolves to it.
// Misses are players ranked 20 / 80 / 400 / 5 … in the ranking whose name resolves to themselves; never repeated.
import { L } from '../lib/pagemap.mjs';
import { answerFrom, capNames, fiberRound, nextTurn, normAnswer, payloads, shellIsOver, typeAndConfirm } from './helpers.mjs';

const MAX_SCORE = 200;
const scoreFor = (guesses) => Math.max(50, MAX_SCORE - 5 * Math.max(0, guesses - 10));
const bucket = (rank) => (rank <= 25 ? 'good' : rank <= 100 ? 'brand' : 'bad');
/** Ranks the misses aim for (clamped to the pool): one per colour bucket first. */
const TARGETS = [20, 80, 400, 5, 150, 40, 700, 10, 250, 60];

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

/** Guess rows so far; null once the solve row is up (the game is ending: nextTurn waits for the end). */
const readState = (page) => page.evaluate(() => {
  if (document.querySelector('.playing-wrap .cx-row.is-win')) return null;
  if (!document.querySelector('.playing-wrap .gf-inputrow input')) return null;
  return `rows ${document.querySelectorAll('.playing-wrap .cx-row').length}`;
});

const isQuestion = (b) => b && typeof b === 'object' && !Array.isArray(b) && b.game === 'contexto' && b.secret && Array.isArray(b.ranking);

export default {
  id: 'contexto',
  path: '/contexto',
  online: true,
  lives: null,
  partialMisses: 3, // three misses (one per rank colour), then the secret
  giveUpAfter: 4, // `giveup`: four misses on the board, then Give up
  latencyPlan: (t) => t === 2, // two misses, then the secret (played to the end)
  timerMs: null,
  pointsPerCorrect: null,
  playAgain: false, // the locked result: Close game only
  idleAfterPlay: 'games.idleNote', // Close game lands on "Next secret player available in …", not on Play
  freshAccount: true, // every scenario is its own account + fresh device id (once-per-day gate)
  feedback: {
    selector: '.feedback-slot > *',
    // (turn, record, colours) → problems. `truth` of a miss is `#<rank>`, of the solve `Got it in N! +score`; `meta.bucket` its colour.
    copy: (t, r, colors) => {
      const problems = [];
      if (r.text !== t.truth) problems.push(`"${r.text}" instead of "${t.truth}"`);
      const want = t.correct ? colors.good : colors[t.meta.bucket];
      if (r.color !== want) problems.push(`${r.color} instead of var(--${t.correct ? 'good' : t.meta.bucket}) ${want}`);
      return problems;
    },
  },
  scenarios: {
    perfect: true, // the secret on the first guess → 200
    wrong: 'every miss is only a rank and the game never ends on its own: the only loss path is Give up, driven by `giveup` (four misses, then Give up)',
    partial: true, // three misses (rank colours good / brand / bad), then the secret → 200
    timeout: 'no clock in Contexto',
    giveup: true, // four misses, then Give up: the secret is revealed (Rule 7.3), 0 points
    'daily-lock': true, // after a finished play (four misses, Give up): reload → countdown note, no Play, rail item disabled
  },
  labels: { giveup: 'four misses, then give up (the secret is revealed)', partial: 'three misses, then the secret' },

  expectedScore(turns) {
    return turns.some((t) => t.correct) ? scoreFor(turns.length) : 0;
  },

  async answer(page, ctx, { correct }) {
    const st = ctx.state;
    const keyOf = () => readState(page);
    if (!st.key) st.key = (await nextTurn(page, keyOf, null, shellIsOver)).key;
    if (!st.q) {
      st.names = await capNames(ctx);
      st.toId = lookupOf(st.names);
      st.tried = new Set();
      st.guesses = 0;
      st.q = await answerFrom(ctx, 'the secret player',
        async () => {
          for (const b of (await payloads(ctx, 'contexto')).reverse()) if (isQuestion(b)) return b;
          return null;
        },
        async () => {
          const f = await fiberRound(ctx, 'gameInfo');
          const q = f && f.rows[0];
          return isQuestion({ game: 'contexto', ...q }) ? q : null;
        });
      st.ranks = [...st.q.ranking].sort((a, b) => a[1] - b[1]);
    }
    const { secret } = st.q;
    let guess, truth, rank;
    if (correct) {
      guess = [secret.full_name, ...(secret.aliases || [])].find((c) => st.toId(c) === secret.person_id);
      if (guess == null) throw new Error(`contexto: no text resolves to the secret (${secret.full_name}) in the game's name lookup`);
      rank = 1;
    } else {
      const want = Math.min(TARGETS[st.guesses % TARGETS.length], st.ranks.length);
      const nameOf = new Map(st.names.map((n) => [n.id, n.full_name]));
      const ok = ([pid, r]) => r > 1 && !st.tried.has(pid) && nameOf.has(pid) && st.toId(nameOf.get(pid)) === pid;
      const pick = st.ranks.find((e) => e[1] >= want && ok(e)) || st.ranks.find(ok);
      if (!pick) throw new Error('contexto: no resolvable non-secret player in the captured ranking and names list');
      st.tried.add(pick[0]);
      guess = nameOf.get(pick[0]);
      rank = pick[1];
    }
    st.guesses++;
    await typeAndConfirm(page, guess, { confirm: L(page, 'games.cxSubmit') });
    const next = await nextTurn(page, keyOf, st.key, shellIsOver, { timeout: 20_000 });
    st.key = next.key;
    return correct
      ? { over: next.over, truth: `Got it in ${st.guesses}! +${scoreFor(st.guesses)}`, meta: { bucket: 'good' } }
      : { over: next.over, truth: `#${rank}`, meta: { bucket: bucket(rank) } };
  },

  isOver: shellIsOver,

  /** Give up: the popup names the secret in the bad colour, then the end sequence runs. */
  async giveUp(page, ctx) {
    await L(page, 'games.cxGiveUp').click();
    const secret = ctx.state.q.secret.full_name;
    const pop = await page.waitForFunction((name) => {
      const el = [...document.querySelectorAll('.feedback-slot > *')].find((e) => e.getBoundingClientRect().height > 0);
      return el && (el.textContent || '').includes(name) ? { text: el.textContent.replace(/\s+/g, ' ').trim(), color: getComputedStyle(el).color } : false;
    }, secret, { timeout: 5000 }).then((h) => h.jsonValue(), () => null);
    if (!pop) ctx.audit.violation('feedback-missing', { selector: '.feedback-slot > *', measured: 'no "It was <name>" popup after Give up', expected: 'Give up states the answer (Rule 6.0)' });
    else {
      const bad = await page.evaluate(() => { const s = document.createElement('span'); s.style.color = 'var(--bad)'; document.body.appendChild(s); const c = getComputedStyle(s).color; s.remove(); return c; });
      if (pop.text !== `It was ${secret}` || pop.color !== bad) ctx.audit.violation('feedback-copy', { selector: '.feedback-slot > *', measured: `"${pop.text}" in ${pop.color} after Give up`, expected: `"It was ${secret}" in var(--bad) ${bad}` });
    }
  },

  /** In place: the secret card names the player (visible), the guess list stays (one row per guess), no Play again. */
  async endReveal(page, ctx, turns) {
    const problems = [];
    const { secret } = ctx.state.q;
    const won = turns.some((t) => t.correct);
    const end = await page.evaluate(() => {
      const card = document.querySelector('.playing-wrap .cx-reveal');
      const name = card && card.querySelector('.cx-row-name');
      const label = card && card.querySelector('.cx-reveal-label');
      const vis = (el) => !!el && el.getBoundingClientRect().height > 0 && getComputedStyle(el).visibility !== 'hidden' && +getComputedStyle(el).opacity > 0.5;
      return {
        card: !!card, good: card ? card.classList.contains('is-good') : false, brand: card ? card.classList.contains('is-brand') : false,
        name: name ? name.textContent.trim() : null, nameVisible: vis(name), label: label ? label.textContent.trim() : null,
        rows: document.querySelectorAll('.playing-wrap .cx-row').length,
        again: [...document.querySelectorAll('.stage-inner button')].some((b) => /^Play again$/.test((b.textContent || '').trim()) && b.getBoundingClientRect().height > 0),
      };
    });
    if (!end.card) problems.push('no secret-player card at the end');
    else {
      if (normAnswer(end.name || '') !== normAnswer(secret.full_name)) problems.push(`the secret card shows "${end.name}", the secret was ${secret.full_name}`);
      else if (!end.nameVisible) problems.push(`the secret's name "${end.name}" is not visible`);
      if (end.label !== 'The secret player') problems.push(`the secret card is still labelled "${end.label}"`);
      if (won ? !end.good : !end.brand) problems.push(`the secret card is not in its ${won ? 'won (is-good)' : 'given-up (is-brand)'} state`);
    }
    if (end.rows !== turns.length) problems.push(`${end.rows} guess rows stay on the board for ${turns.length} guesses`);
    if (end.again && !ctx.online) problems.push('the end screen offers Play again, but a replay only hits the daily lock (423)');
    return problems;
  },

  /** After the finished play and a reload (the driver's daily-lock scenario): countdown note, disabled rail item. */
  async checkLocked(page) {
    const problems = [];
    const note = await L(page, 'games.idleNote').first().textContent({ timeout: 2000 }).catch(() => null);
    if (!/^\s*Next secret player available in (\d+ (minutes?|hours?)|any moment now)\.\s*$/.test(note || '')) problems.push(`idle note reads "${(note || '').trim()}", expected "Next secret player available in <n> hours."`);
    const railState = () => page.evaluate(() => {
      const vis = (el) => el.getBoundingClientRect().height > 0 && getComputedStyle(el).visibility !== 'hidden';
      const items = [...document.querySelectorAll('button.rail-item, button.rail-chip')].filter((b) => /Contexto/i.test(b.textContent || '') && vis(b));
      return items.map((b) => ({ cls: b.className, disabled: b.disabled }));
    });
    let items = await railState();
    for (let i = 0; i < 20 && !(items.length && items.every((b) => b.disabled)); i++) { await page.waitForTimeout(250); items = await railState(); }
    if (!items.length) problems.push('no visible LeContexto item in the game rail');
    else if (!items.every((b) => b.disabled)) problems.push('the LeContexto rail item is still enabled after the daily play');
    return problems;
  },
};
