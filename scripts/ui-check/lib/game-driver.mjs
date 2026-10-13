// Games suite driver: plays one game through one scenario with its adapter (games/<id>.mjs) and asserts the
// GAME_DESIGN_CONSTRAINTS shell contract on the way. Used by specs/games/scenarios.spec.mjs (one test per game ×
// scenario) and specs/games/latency.spec.mjs. The adapter contract is documented in games/index.mjs.
//
// One scenario run (runScenario):
//   open the game (idle shot) → Play (startGame semantics of scripts/qa-browser.mjs) → playing shot →
//   ResizeObserver on .stage-shell → loop adapter.answer (≤ 60 turns) inside audit.motion(watch .stage-shell,
//   .playing-wrap), with an in-page recorder per turn: feedback latency (submitting click/Enter → feedback
//   element in a frame), its copy and colour (Rule 6.0) and banned loss copy (6.3); feedback shot on turn 1 →
//   end: over, end shot, layout, in place vs full-screen GameResult (7.3), score above Play again / Close game
//   (7.0), final score, no banned copy (6.3), adapter.endReveal, stage height constant while playing (6.2),
//   POST …/log-session/ 2xx with the score (solo) → Play again → playing shell → Close game → idle with a
//   cross-fade (scenario `wrong` closes from the end screen instead, so both end buttons are exercised).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { L } from './pagemap.mjs';
import { REPO_ROOT } from './run-id.mjs';
import { recordFrames, fadeSummary } from './guest.mjs';

/**
 * `slow-api` allowances for the 4-worker scenario pass only (never in GM-LATENCY-01): the session restore
 * `GET /api/me/` on page load answers in ~0.1-0.3 s idle, but four browsers on one local runserver push it past
 * 1 s (same reason as LOCAL_LOAD in lib/guest.mjs for /api/get-users/).
 */
export const GAMES_LOCAL_LOAD = [/^slow GET \S+\/api\/me\/$/, /^slow GET \S+\/api\/get-users\//];

export const SCENARIOS = ['perfect', 'wrong', 'partial', 'timeout', 'giveup', 'daily-lock'];
export const MAX_TURNS = 60;
export const FEEDBACK_BUDGET_MS = 150;

/** Rule 6.3 banned loss announcements (the brief's regex plus the constraint doc's banned strings). */
export const BANNED_LOSS = /out of (guesses|lives|hearts)|no lives left|lives? (are )?gone|game over|run over/i;

/** Games allowed to end on the full-screen GameResult (scripts/game-result-allowlist.json, Rule 7.3). */
const ALLOWLIST = JSON.parse(readFileSync(path.join(REPO_ROOT, 'scripts', 'game-result-allowlist.json'), 'utf8'));
export const endsInPlace = (adapter) => adapter.endsInPlace ?? !Object.prototype.hasOwnProperty.call(ALLOWLIST, adapter.id);

/** Default feedback descriptor: the shell's SubmitGuessPopup portal, with the 6.0 copy rule. */
const feedbackOf = (adapter) => ({ selector: '.feedback-slot > *', copy: true, ...(adapter.feedback || {}) });

/**
 * `test.use({ userAgent: realUserAgent })` in the games specs: the browser's own user agent with "HeadlessChrome"
 * turned into "Chrome". cdn.nba.com (team logos and crests, hotlinked by the app) resets HTTP/2 streams for the
 * headless UA (net::ERR_HTTP2_PROTOCOL_ERROR; the same URL answers 200 with the normal UA), which would put
 * placeholder crests in every shot and a console error in every game. Real visitors never send that UA.
 */
let uaCache = null;
export async function realUserAgent({ browser }, use) {
  if (!uaCache) {
    const ctx = await browser.newContext();
    const ua = await (await ctx.newPage()).evaluate(() => navigator.userAgent);
    await ctx.close();
    uaCache = ua.replace(/HeadlessChrome/g, 'Chrome');
  }
  await use(uaCache);
}

/** Which answers a scenario gives: turn index → correct? */
export function planFor(adapter, scenario) {
  if (scenario === 'perfect') return () => true;
  if (scenario === 'partial') return adapter.lives ? (t) => t !== 0 : (t) => t % 2 === 0; // lives: one miss, then right
  return () => false; // wrong, giveup, timeout, daily-lock: misses
}

export function newCtx({ cap, fiber, vp, audit }, scenario) {
  return { cap, fiber, vp, audit, online: false, scenario, turn: 0, state: {} };
}

// ---------------------------------------------------------------- in-page instruments

function installResizeWatch() {
  const shell = document.querySelector('.stage-shell');
  if (!shell) return false;
  if (window.__gmRO && window.__gmRO.ro) window.__gmRO.ro.disconnect();
  const w = (window.__gmRO = { log: [], turn: 0, h: shell.getBoundingClientRect().height, ro: null });
  // A phase change (end of game) may resize the stage; a resize while still playing may not (Rule 6.2).
  const ending = () => !document.querySelector('.playing-wrap')
    || !!document.querySelector('.playing-wrap .endseq [role="status"], .playing-wrap .scorepanel, .exit-link.is-ended');
  w.ro = new ResizeObserver(() => {
    const h = shell.getBoundingClientRect().height;
    if (Math.abs(h - w.h) > 0.5) { w.log.push({ from: +w.h.toFixed(1), to: +h.toFixed(1), turn: w.turn, ending: ending() }); w.h = h; }
  });
  w.ro.observe(shell);
  return true;
}

/**
 * Arm the feedback recorder for one turn: the last click / Enter before the feedback element shows is the
 * submitting input; the feedback is the first visible element matching `selector` in an animation frame.
 */
function armFeedback({ selector, turn }) {
  if (window.__gmFbStop) window.__gmFbStop();
  if (window.__gmRO) window.__gmRO.turn = turn;
  const st = (window.__gmFb = { turn, input: null, at: null, latency: null, text: null, color: null, texts: [] });
  const onInput = (e) => { if (e.type === 'keydown' && e.key !== 'Enter') return; if (st.at === null) st.input = performance.now(); };
  document.addEventListener('click', onInput, true);
  document.addEventListener('keydown', onInput, true);
  let raf = 0;
  const tick = () => {
    const el = [...document.querySelectorAll(selector)].find((e) => e.getBoundingClientRect().height > 0);
    if (el) {
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (st.at === null && st.input !== null) {
        st.at = performance.now();
        st.latency = Math.round(st.at - st.input);
        st.text = text;
        st.color = getComputedStyle(el).color;
      }
      if (text && !st.texts.includes(text) && st.texts.length < 5) st.texts.push(text);
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  window.__gmFbStop = () => {
    cancelAnimationFrame(raf);
    document.removeEventListener('click', onInput, true);
    document.removeEventListener('keydown', onInput, true);
  };
}

function readFeedback() {
  if (window.__gmFbStop) window.__gmFbStop();
  return window.__gmFb || null;
}

/** var(--good) / var(--bad) / var(--muted) as computed colours. */
function tokenColors() {
  const out = {};
  for (const t of ['good', 'bad', 'muted']) {
    const s = document.createElement('span');
    s.style.color = `var(--${t})`;
    document.body.appendChild(s);
    out[t] = getComputedStyle(s).color;
    s.remove();
  }
  return out;
}

/** Visible text of the stage (innerText skips hidden and display:none content). */
const stageText = (page) => page.evaluate(() => (document.querySelector('.stage-inner') || document.body).innerText.replace(/\s+/g, ' ').trim());

/** End screen geometry for Rule 7.0: score line bottom vs the Play again / Close game row top. */
function endGeometry() {
  const vis = (el) => !!el && el.getBoundingClientRect().height > 0 && getComputedStyle(el).visibility !== 'hidden';
  const inner = document.querySelector('.stage-inner');
  const buttons = inner ? [...inner.querySelectorAll('button:not(.exit-link)')].filter((b) => vis(b) && /^(Play again|Close game)$/.test((b.textContent || '').trim())) : [];
  const panel = document.querySelector('.playing-wrap .scorepanel');
  let score = null;
  if (vis(panel)) score = panel.querySelector('.scorepanel-line');
  else if (inner && !document.querySelector('.playing-wrap')) {
    // GameResult: the big number (.tnum) row above the buttons.
    score = [...inner.querySelectorAll('.tnum')].find(vis);
    if (score && score.parentElement && score.parentElement !== inner) score = score.parentElement;
  }
  const r = (el) => { const b = el.getBoundingClientRect(); return { top: +b.top.toFixed(1), bottom: +b.bottom.toFixed(1), left: +b.left.toFixed(1), right: +b.right.toFixed(1) }; };
  const scoreText = panel && vis(panel)
    ? (panel.querySelector('.scorepanel-num')?.textContent || '').trim()
    : (score ? ([...score.querySelectorAll('.tnum')].find(vis) || score).textContent.trim() : null);
  return {
    inPlace: !!document.querySelector('.playing-wrap'),
    panel: vis(panel),
    score: score ? r(score) : null,
    scoreText,
    buttons: buttons.map((b) => ({ text: b.textContent.trim(), ...r(b) })),
  };
}

// ---------------------------------------------------------------- steps

/** Press Play and wait for the playing shell (qa-browser.mjs startGame: Play → .playing-wrap → 1.2 s settle). */
export async function startGame(page) {
  const play = L(page, 'games.playBtn');
  await play.waitFor({ timeout: 15_000 });
  await play.click();
  await page.waitForSelector('.playing-wrap', { timeout: 30_000 });
  await page.waitForTimeout(1200);
}

/** Wait until no element matches `selector` (an exiting popup from the previous turn), ≤ 3 s. */
const feedbackGone = (page, selector) => page.waitForFunction((s) => ![...document.querySelectorAll(s)].some((e) => e.getBoundingClientRect().height > 0), selector, { timeout: 3000 }).catch(() => {});

/**
 * Play turns until the adapter says over (≤ MAX_TURNS). Records per turn: {correct, truth, feedback:{latency,
 * text, color, texts}}. `stopAfter` ends the loop early (latency test, give-up). `onFirstFeedback` runs once while
 * the first feedback is on screen (the feedback shot).
 */
export async function playTurns(page, adapter, ctx, { plan, stopAfter = MAX_TURNS, onFirstFeedback } = {}) {
  const fb = feedbackOf(adapter);
  const turns = [];
  let over = false;
  for (let t = 0; t < Math.min(stopAfter, MAX_TURNS) && !over; t++) {
    ctx.turn = t;
    const correct = plan(t);
    await feedbackGone(page, fb.selector);
    await page.evaluate(armFeedback, { selector: fb.selector, turn: t });
    const shot = t === 0 && onFirstFeedback
      ? page.waitForFunction(() => window.__gmFb && window.__gmFb.at !== null, null, { timeout: 10_000 }).then(onFirstFeedback).catch(() => null)
      : null;
    const res = await adapter.answer(page, ctx, { correct });
    if (shot) await shot;
    const rec = await page.evaluate(readFeedback);
    turns.push({ turn: t, correct, truth: res.truth ?? null, expectFeedback: res.feedback !== false, feedback: rec });
    over = !!res.over;
    // Evidence for Rule 6.2: the board right after the first two turns that resized the stage while playing.
    const resized = await page.evaluate(() => (window.__gmRO ? window.__gmRO.log.filter((e) => !e.ending).length : 0));
    if (resized > (ctx.state.resizeSeen || 0) && (ctx.state.resizeSeen || 0) < 2 && ctx.audit) {
      ctx.state.resizeSeen = resized;
      const rel = await ctx.audit.shot(`resized-turn${t + 1}`);
      if (rel) (ctx.state.resizeEvidence ||= []).push(rel);
    }
  }
  return { turns, over };
}

/** Rule 6.0 / 6.3 per turn (copyRules) + feedback presence and latency. Latency is a note metric unless `enforceLatency` (then a timing metric + slow-action violation). */
export async function checkTurns(audit, adapter, turns, { enforceLatency = false, copyRules = true, scenario = '' } = {}) {
  const fb = feedbackOf(adapter);
  const colors = await audit.page.evaluate(tokenColors);
  const lat = [];
  for (const t of turns) {
    const r = t.feedback || {};
    const where = `turn ${t.turn + 1} (${t.correct ? 'right' : 'wrong'})`;
    if (!t.expectFeedback) continue;
    if (r.at == null) {
      audit.violation('feedback-missing', { selector: fb.selector, measured: `no feedback after the answer on ${where}`, expected: 'feedback shown for every answer (Rule 6.1)' });
      continue;
    }
    lat.push(r.latency);
    if (enforceLatency && r.latency > FEEDBACK_BUDGET_MS) {
      audit.violation('slow-action', { selector: `${adapter.id} feedback`, measured: `${r.latency}ms on ${where}`, expected: `≤ ${FEEDBACK_BUDGET_MS}ms from the answer to feedback on screen` });
    }
    for (const text of r.texts && r.texts.length ? r.texts : [r.text]) {
      if (BANNED_LOSS.test(text || '')) audit.violation('loss-announced', { selector: fb.selector, measured: `"${text}" on ${where}`, expected: 'running out of lives is never announced (Rule 6.3)' });
    }
    if (!fb.copy || !copyRules) continue;
    if (t.correct) {
      const want = `Correct! +${adapter.pointsPerCorrect}`;
      if (r.text !== want) audit.violation('feedback-copy', { selector: fb.selector, measured: `"${r.text}" on ${where}`, expected: `"${want}" (Rule 6.0)` });
      if (r.color !== colors.good) audit.violation('feedback-color', { selector: fb.selector, measured: `${r.color} on ${where}`, expected: `var(--good) ${colors.good} (Rule 6.0)` });
    } else {
      const truthShown = t.truth == null || (r.text || '').toLowerCase().includes(String(t.truth).toLowerCase());
      if (!truthShown || /^\s*wrong\b/i.test(r.text || '')) {
        audit.violation('feedback-copy', { selector: fb.selector, measured: `"${r.text}" on ${where}`, expected: `a statement of the truth naming "${t.truth}", never a bare "Wrong" (Rule 6.0)` });
      }
      if (r.color !== colors.bad) audit.violation('feedback-color', { selector: fb.selector, measured: `${r.color} on ${where}`, expected: `var(--bad) ${colors.bad} (Rule 6.0)` });
    }
  }
  if (lat.length) {
    const max = Math.max(...lat);
    audit.metrics.push({ kind: enforceLatency ? 'timing' : 'note', label: `${adapter.id}${scenario ? ` ${scenario}` : ''} feedback max`, value: max, unit: 'ms', budget: FEEDBACK_BUDGET_MS, route: audit.route });
  }
  return lat;
}

/** Score the driver expects from the answers given (null = not knowable, e.g. Who Would Win's crowd points). */
export function expectedScore(adapter, turns) {
  if (adapter.expectedScore) return adapter.expectedScore(turns);
  if (adapter.pointsPerCorrect == null) return null;
  return turns.filter((t) => t.correct).length * adapter.pointsPerCorrect;
}

/** Collect POST …/log-session/ requests of a page (attach before the game starts). */
export function watchLogSession(page) {
  const reqs = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && /\/trivia\/log-session\/?$/.test(new URL(req.url()).pathname)) reqs.push(req);
  });
  return {
    count: () => reqs.length,
    async settled(minCount = 1, timeout = 10_000) {
      const until = Date.now() + timeout;
      while (reqs.length < minCount && Date.now() < until) await new Promise((r) => setTimeout(r, 150));
      return Promise.all(reqs.map(async (req) => {
        const res = await req.response().catch(() => null);
        let body = null, json = null;
        try { body = JSON.parse(req.postData() || 'null'); } catch { /* not JSON */ }
        try { json = res ? await res.json() : null; } catch { /* no body */ }
        return { status: res ? res.status() : null, body, json };
      }));
    },
  };
}

/** End-state assertions (7.0, 7.3, 6.3, 6.2, score, points logged). */
export async function checkEnd(audit, adapter, ctx, { turns, over, log, logged = true, resize = true, scoreKnown = true }) {
  const page = audit.page;
  if (!over) {
    audit.violation('never-ended', { selector: adapter.id, measured: `still playing after ${turns.length} turns`, expected: `the game ends within ${MAX_TURNS} turns` });
    return;
  }
  await page.waitForTimeout(700); // end entrance (Stage cross-fade / EndSequence) settles
  const geo = await page.evaluate(endGeometry);
  await audit.shot('end');
  await audit.layout({ scope: 'section.stage-col' });

  const inPlace = endsInPlace(adapter);
  if (inPlace && !geo.inPlace) {
    audit.violation('not-in-place', { selector: '.stage-inner', measured: 'full-screen GameResult replaced the board', expected: 'the game ends in place: board + EndSequence + ScorePanel (Rule 7.3)' });
  }
  // Rule 7.0: the score line sits above Play again / Close game.
  if (!geo.score) {
    audit.violation('end-score', { selector: inPlace ? '.scorepanel-line' : 'GameResult score', measured: 'no visible score line', expected: 'score line above the end buttons (Rule 7.0)' });
  } else if (!geo.buttons.length) {
    audit.violation('end-buttons', { selector: '.stage-inner', measured: 'no Play again / Close game', expected: 'end buttons under the score (Rule 7.0)' });
  } else {
    const top = Math.min(...geo.buttons.map((b) => b.top));
    if (geo.score.bottom > top + 0.5) {
      audit.violation('score-not-above', { selector: inPlace ? '.scorepanel-line' : 'GameResult score', measured: `score bottom ${geo.score.bottom}px > buttons top ${top}px`, expected: 'score line above Play again / Close game (Rule 7.0)' });
    }
  }
  // Final score (GameResult / ScorePanel count up with AnimatedNumber: wait for it to land).
  const want = scoreKnown ? expectedScore(adapter, turns) : null;
  if (want != null) {
    const got = await page.waitForFunction((w) => {
      const panel = document.querySelector('.playing-wrap .scorepanel-num');
      const el = panel || [...document.querySelectorAll('.stage-inner .tnum')].find((e) => e.getBoundingClientRect().height > 0);
      const t = el ? el.textContent.replace(/[^\d]/g, '') : '';
      return t === String(w) ? t : false;
    }, want, { timeout: 5000 }).then((h) => h.jsonValue()).catch(async () => (await page.evaluate(endGeometry)).scoreText);
    if (String(got).replace(/[^\d]/g, '') !== String(want)) {
      audit.violation('end-score', { selector: inPlace ? '.scorepanel-num' : 'GameResult score', measured: `shows ${got}`, expected: `${want} (${turns.filter((t) => t.correct).length} right × ${adapter.pointsPerCorrect})` });
    }
  }
  // Rule 6.3: the end state never announces the loss.
  const text = await stageText(page);
  const banned = BANNED_LOSS.exec(text);
  if (banned) audit.violation('loss-announced', { selector: '.stage-inner', measured: `"${banned[0]}" in the end state`, expected: 'running out of lives is never announced (Rule 6.3)' });
  // Adapter-specific reveal (in-place games: the answers stay visible).
  if (adapter.endReveal) for (const problem of await adapter.endReveal(page, ctx, turns)) {
    audit.violation('answer-hidden', { selector: '.playing-wrap', measured: problem, expected: 'every answer visible at the end (Rule 7.3)' });
  }
  // Rule 6.2: the stage never resized while playing (end-of-game phase change excepted).
  if (resize) {
    const log = await page.evaluate(() => (window.__gmRO ? window.__gmRO.log : null));
    const evidence = ctx.state.resizeEvidence || [];
    for (const [i, e] of (log || []).filter((x) => !x.ending).entries()) {
      const v = audit.violation('stage-resized', { selector: '.stage-shell', measured: `${e.from}→${e.to}px (Δ${+(e.to - e.from).toFixed(1)}) on turn ${e.turn + 1}`, expected: 'stage height constant while playing (Rule 6.2)' });
      if (evidence.length) v.shot = evidence[Math.min(i, evidence.length - 1)]; // the board after the resizing turn
    }
  }
  // Points logged for the solo user.
  if (logged && log) {
    const calls = await log.settled(1);
    if (calls.length !== 1) {
      audit.violation('points-not-logged', { selector: 'POST /trivia/log-session/', measured: `${calls.length} request(s)`, expected: 'exactly one per finished game' });
    }
    for (const c of calls) {
      const ok = c.status >= 200 && c.status < 300;
      const scoreOk = want == null || (c.body && c.body.score === want);
      if (!ok || !scoreOk || !c.body || c.body.game !== adapter.id || c.body.mode !== 'single') {
        audit.violation('points-not-logged', {
          selector: 'POST /trivia/log-session/',
          measured: `HTTP ${c.status} body ${JSON.stringify(c.body)}${c.status === 429 ? ' (score-submit throttle, 60/h per account)' : ''}`,
          expected: `2xx with {game:"${adapter.id}", mode:"single"${want != null ? `, score:${want}` : ''}}`,
        });
      } else if (want > 0 && c.json && c.json.awarded !== want) {
        audit.violation('points-not-logged', { selector: 'POST /trivia/log-session/', measured: `awarded ${c.json.awarded}`, expected: `awarded ${want}` });
      }
    }
  }
}

/** Click and require a cross-fade of the Stage phase wrapper (a part-way opacity frame), then `ready`. */
async function phaseChange(audit, label, click, ready) {
  const rows = await recordFrames(audit.page, '.stage-inner > div', async () => { await click(); await ready(); }, { tail: 400 });
  const f = fadeSummary(rows);
  if (f.intermediate === 0) audit.violation('no-transition', { selector: '.stage-inner > div', measured: `${label}: no part-way frame among ${f.frames}`, expected: 'the stage cross-fades between phases' });
}

/** Start watching `.stage-shell` height changes (Rule 6.2); call once the playing shell is up. */
export async function watchStage(page) {
  if (!(await page.evaluate(installResizeWatch))) throw new Error('game driver: no .stage-shell to watch');
}

/**
 * Loop-time `loaf` (long animation frames) depends on CPU load: in the 4-worker pass it is moved from the violations
 * to a note metric, and GM-LATENCY-01 (@perf, single worker) owns long frames while answering.
 */
export function demoteLoaf(audit, added) {
  for (const v of added.filter((x) => x.rule === 'loaf')) {
    const i = audit.violations.indexOf(v);
    if (i >= 0) audit.violations.splice(i, 1);
    const m = /(\d+)ms/.exec(v.measured || '');
    audit.metrics.push({ kind: 'note', label: 'longest frame while playing (parallel pass)', value: m ? +m[1] : null, unit: 'ms', route: v.route, note: v.note });
  }
}

/** Poll adapter.isOver for up to `ms`. */
export async function waitOver(page, adapter, ms = 15_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await adapter.isOver(page)) return true;
    await page.waitForTimeout(150);
  }
  return false;
}

/**
 * One scenario of one game (see the header). `full` = core viewport: post-game Play again / Close game and the
 * log-session assertion run; otherwise (non-core `perfect`) the play is layout-only.
 */
export async function runScenario({ page, audit, cap, fiber, vp }, adapter, scenario, { full = true } = {}) {
  const ctx = newCtx({ cap, fiber, vp, audit }, scenario);
  const log = watchLogSession(page);
  if (scenario === 'timeout') await page.clock.install(); // before the first load, so the game's clock is ours
  await audit.goto(adapter.path, { waitFor: '.stage-col .idle' });
  await audit.shot('idle');
  await startGame(page);
  await watchStage(page);
  await audit.shot('playing');
  await audit.layout({ scope: 'section.stage-col' });

  let result = { turns: [], over: false };
  const plan = planFor(adapter, scenario);
  const added = await audit.motion(async () => {
    if (scenario === 'timeout') {
      await adapter.timeout(page, ctx);
      result.over = await waitOver(page, adapter);
    } else if (scenario === 'giveup') {
      result = await playTurns(page, adapter, ctx, { plan, stopAfter: 1, onFirstFeedback: () => audit.shot('feedback') });
      if (!result.over) { await adapter.giveUp(page, ctx); result.over = await waitOver(page, adapter); }
    } else {
      result = await playTurns(page, adapter, ctx, { plan, onFirstFeedback: () => audit.shot('feedback') });
    }
  }, { watch: ['.stage-shell', '.playing-wrap'], settleMs: 800 });
  demoteLoaf(audit, added);

  await checkTurns(audit, adapter, result.turns, { scenario });
  const known = scenario === 'perfect' || scenario === 'wrong' || scenario === 'partial';
  await checkEnd(audit, adapter, ctx, { ...result, log, logged: full, scoreKnown: known });
  if (ctx.state.sources) audit.metrics.push({ kind: 'note', label: 'answer source', value: JSON.stringify(ctx.state.sources), unit: '', route: audit.route });
  if (full) await afterEnd(audit, { closeFromEnd: scenario === 'wrong' || scenario === 'daily-lock' });
  if (scenario === 'daily-lock') {
    // After a finished daily play, a fresh load of the game shows the lock note instead of Play.
    await audit.goto(adapter.path, { waitFor: '.stage-col .idle' });
    const locked = (await L(page, 'games.idleNote').count()) > 0 && (await L(page, 'games.playBtn').count()) === 0;
    if (!locked) audit.violation('daily-lock', { selector: '.stage-col .idle', measured: 'Play is offered again after the daily play', expected: 'the idle card shows the next-play countdown and no Play button' });
    await audit.shot('locked');
  }
  return { ctx, ...result };
}

/** After the end: Play again → playing shell → Close game → idle; or (closeFromEnd) the end screen's Close game → idle. */
export async function afterEnd(audit, { closeFromEnd = false } = {}) {
  const page = audit.page;
  const again = L(page, 'games.endPlayAgain');
  const idleReady = async () => { await expect(L(page, 'games.playBtn')).toBeVisible({ timeout: 10_000 }); };
  if (!closeFromEnd && await again.count()) {
    await again.click();
    await page.waitForSelector('.playing-wrap', { timeout: 30_000 });
    await expect(L(page, 'games.exitLink')).toBeVisible();
    const r = await page.evaluate(() => {
      const t = document.querySelector('.playing-wrap .gf-status-left');
      return { ended: !!document.querySelector('.playing-wrap .scorepanel'), label: t ? t.textContent.replace(/\s+/g, ' ').trim() : null };
    });
    if (r.ended || (r.label && !/\b1\s*\//.test(r.label))) {
      audit.violation('replay', { selector: '.playing-wrap', measured: `after Play again: ${JSON.stringify(r)}`, expected: 'a fresh game at round 1' });
    }
    await page.waitForTimeout(800);
    await audit.shot('replay');
    await phaseChange(audit, 'Close game', () => L(page, 'games.exitLink').click(), idleReady);
  } else {
    await phaseChange(audit, 'Close game (end screen)', () => L(page, 'games.endCloseGame').first().click(), idleReady);
  }
  await audit.shot('closed');
}
