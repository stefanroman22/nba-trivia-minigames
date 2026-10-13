// Multiplayer suite helpers (specs/multiplayer/*.spec.mjs): two logged-in players (`mp.pair()`: testuser1 host,
// testuser2 joiner) driven through the real UI. Locators live in pagemap/multiplayer.json; this file holds behaviour:
// the pair's lifecycle (open on a game page, clean idle, leave everything in afterEach), the room / match steps, the
// per-player screen state, frame recorders, the results reader and "both audits done, fail once".
//
// State of one player's screen (mpState): idle | friend-menu | lobby | searching | intro | playing | waiting |
// results | ended | online (an om-stage this helper does not know) | unknown (not a game page). It is read from the
// DOM only (the MultiplayerContext phase is not reachable from outside): the stage's `.om-stage` variant, else the
// Multiplayer card (`.fp-code-row` / `.fp-mini` = lobby).
import { expect } from '@playwright/test';
import { L } from './pagemap.mjs';
import { motionStep } from './account.mjs';
import { readStack } from './stack.mjs';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const ASIDE = 'aside.game-aside .mp-panel';
/** Boxes watched for `snap` around Multiplayer card / stage swaps. */
export const WATCH_CARD = [ASIDE, 'aside.game-aside'];
export const WATCH_STAGE = ['.stage-shell', '.stage-col'];

/** In-page: the player's multiplayer screen right now (see the header). */
function mpStateInPage() {
  const stages = [...document.querySelectorAll('.stage-inner .om-stage')];
  const s = stages[stages.length - 1];
  if (s) {
    if (s.classList.contains('om-stage--compact')) return 'searching';
    if (s.classList.contains('om-stage--play')) return 'playing';
    if (s.classList.contains('om-stage--results')) return 'results';
    if (s.querySelector('.om-ended-title')) return 'ended';
    if (s.querySelector('.om-yourscore')) return 'waiting';
    if (s.querySelector('.om-eyebrow')) return 'intro';
    return 'online';
  }
  const aside = document.querySelector('aside.game-aside');
  if (!aside) return 'unknown';
  if (aside.querySelector('.fp-code-row, .fp-mini')) return 'lobby';
  if (aside.querySelector('.mp-friend')) return 'friend-menu';
  if (aside.querySelector('.mp-choice') && document.querySelector('.stage-col .idle')) return 'idle';
  return 'unknown';
}

export const mpState = (page) => page.evaluate(mpStateInPage).catch(() => 'closed');

/** Wait until the player's screen is one of `states` (string or array). → the state reached. */
export async function waitState(p, states, timeout = 20_000) {
  const want = [].concat(states);
  const until = Date.now() + timeout;
  let s = null;
  while (Date.now() < until) {
    s = await mpState(p.page);
    if (want.includes(s)) return s;
    await sleep(120);
  }
  throw new Error(`${p.label} (${p.username}) never reached ${want.join(' | ')} within ${Math.round(timeout / 1000)} s (screen: ${s})`);
}

/**
 * Record the sequence of screens one player passes through (a rAF loop in the page; survives client-side route
 * changes, not reloads). read() → [{ state, t }] (t in ms since start), consecutive duplicates collapsed.
 */
export async function startStateLog(page) {
  await page.evaluate(`(() => {
    const read = ${mpStateInPage.toString()};
    const log = (window.__mpLog = { rows: [], t0: performance.now(), stop: false });
    const tick = () => {
      const s = read();
      const last = log.rows[log.rows.length - 1];
      if (!last || last.state !== s) log.rows.push({ state: s, t: Math.round(performance.now() - log.t0) });
      if (!log.stop) requestAnimationFrame(tick);
    };
    tick();
  })()`);
}
export const readStateLog = (page) => page.evaluate(() => (window.__mpLog ? window.__mpLog.rows : [])).catch(() => []);
export const stateTrail = (rows) => rows.map((r) => r.state).join(' > ');

/**
 * The distinct innerTexts `selector` showed on every animation frame while `fn` ran (+ `tail` ms), plus the element
 * identity: { texts, swaps (text changes while the same element stayed mounted), remounts (element replaced) }.
 * A SwapText label changes text inside the same element; a content swap that remounts the control shows `remounts`.
 */
let txtSeq = 0;
export async function recordTexts(page, selector, fn, { tail = 500 } = {}) {
  const id = ++txtSeq; // recorders may nest (one per selector)
  await page.evaluate(({ sel, id }) => {
    const rec = ((window.__mpTxt ||= {})[id] = { texts: [], swaps: 0, remounts: 0, last: null, el: null, stop: false, done: false });
    const tick = () => {
      const el = document.querySelector(sel);
      if (el) {
        const t = (el.innerText || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
        if (rec.el && el !== rec.el) rec.remounts++;
        else if (rec.last !== null && t !== rec.last) rec.swaps++;
        if (t && !rec.texts.includes(t)) rec.texts.push(t);
        rec.el = el;
        rec.last = t;
      }
      if (!rec.stop) requestAnimationFrame(tick); else rec.done = true;
    };
    requestAnimationFrame(tick);
  }, { sel: selector, id });
  await fn();
  await page.waitForTimeout(tail);
  await page.evaluate((id) => { window.__mpTxt[id].stop = true; }, id);
  await page.waitForFunction((id) => window.__mpTxt[id].done, id, { timeout: 5000 }).catch(() => {});
  return page.evaluate((id) => { const { texts, swaps, remounts } = window.__mpTxt[id]; return { texts, swaps, remounts }; }, id);
}

/**
 * Long animation frames are not enforced here: every multiplayer step makes TWO browsers render the same event at once
 * on one machine (both players' screens change), so a frame's length is not attributable to the page. Long frames are
 * owned by the single-browser @perf passes (guest G-MOTION/G-PERF, account, GM-LATENCY-<game>). A `loaf` from a
 * motion window becomes a note metric with its step; snap and CLS stay enforced.
 */
export function demoteMpLoaf(audit, added) {
  for (const v of added.filter((x) => x.rule === 'loaf')) {
    const i = audit.violations.indexOf(v);
    if (i >= 0) audit.violations.splice(i, 1);
    const m = /(\d+)ms/.exec(v.measured || '');
    audit.metrics.push({ kind: 'note', label: 'longest frame (two browsers at once, not enforced)', value: m ? +m[1] : null, unit: 'ms', route: v.route, note: v.note });
  }
  return added.filter((x) => x.rule !== 'loaf');
}

/** audit.motion with a step name, watching the Multiplayer card and the stage (loaf demoted, see demoteMpLoaf). */
export const motion = async (p, step, fn, watch = [...WATCH_CARD, ...WATCH_STAGE], settleMs = 700) => demoteMpLoaf(p.audit, await motionStep(p.audit, step, fn, { watch, settleMs }));

/** Both pages sampled at once while `fn` runs (one player's action shows on both screens). */
export const motionBoth = (pair, step, fn, watch, settleMs) => motion(pair.host, step, () => motion(pair.joiner, step, fn, watch, settleMs), watch, settleMs);

// ---------------------------------------------------------------- pair lifecycle

let current = null;

/** Has this player's page sent its socket `identify` (the app connects once the user is loaded)? */
async function waitIdentified(p, timeout = 20_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (p.cap.frames('identify', { dir: 'out' }).length) return true;
    await sleep(150);
  }
  throw new Error(`${p.label} (${p.username}): the page never sent a socket identify (not logged in, or no socket)`);
}

const visible = (loc) => loc.first().isVisible({ timeout: 300 }).catch(() => false);
async function clickIf(page, key) {
  const loc = L(page, key).first();
  if (!(await visible(loc))) return false;
  await loc.click({ timeout: 5000 }).catch(() => {});
  return true;
}

/** One step out of whatever room / search / match the player is in, through the app's own controls. */
async function leaveStep(p, s) {
  const page = p.page;
  switch (s) {
    case 'searching': return clickIf(page, 'multiplayer.searchingCancel');
    case 'ended': return clickIf(page, 'multiplayer.endedExit');
    case 'intro': await page.waitForTimeout(1500); return false; // the VS intro has no controls: it turns into playing
    case 'playing':
    case 'waiting':
      return (await clickIf(page, 'multiplayer.stopMatch')) || (await clickIf(page, 'multiplayer.exitGameLink')) || clickIf(page, 'multiplayer.leaveRoomLink');
    case 'results':
      return (await clickIf(page, 'multiplayer.closeRoomLink')) || (await clickIf(page, 'multiplayer.exitGameLink')) || clickIf(page, 'multiplayer.leaveRoomLink');
    case 'lobby':
      if (await visible(L(page, 'multiplayer.mini'))) { await clickIf(page, 'multiplayer.expand'); await page.waitForTimeout(500); }
      return (await clickIf(page, 'multiplayer.closeRoom')) || clickIf(page, 'multiplayer.leaveRoom');
    case 'friend-menu': return clickIf(page, 'multiplayer.back');
    default: return false;
  }
}

/** Bring one player back to the idle game card (Multiplayer choice view), leaving anything left over. */
export async function ensureIdle(p, { path = null, rounds = 10 } = {}) {
  for (let i = 0; i < rounds; i++) {
    const s = await mpState(p.page);
    if (s === 'idle') return true;
    if (s === 'closed') return false;
    if (s === 'unknown' && path) { await p.page.goto(path).catch(() => {}); await sleep(1500); continue; }
    await leaveStep(p, s);
    await sleep(700);
  }
  return (await mpState(p.page)) === 'idle';
}

/**
 * Open the pair on a game page: both logged in (fresh minted tokens), socket identified, any room or search a previous
 * failed test left on the relay resumed and left through the UI, both on the idle card. Remembered for releasePair().
 */
export async function openPair(mp, path) {
  const pair = await mp.pair();
  current = pair;
  pair.path = path;
  await Promise.all([pair.host, pair.joiner].map((p) => p.audit.goto(path, { waitFor: '.stage-col' })));
  await Promise.all([pair.host, pair.joiner].map((p) => waitIdentified(p)));
  await sleep(1500); // a resumeMatch / roomLeft for a seat the relay still holds arrives right after identify
  for (let round = 0; round < 2; round++) {
    for (const p of [pair.host, pair.joiner]) await ensureIdle(p, { path });
  }
  for (const p of [pair.host, pair.joiner]) {
    if ((await mpState(p.page)) !== 'idle') throw new Error(`${p.label} (${p.username}) is not on the idle card of ${path} (screen: ${await mpState(p.page)})`);
    p.cap.clear(); // frames from here on belong to this test
  }
  return pair;
}

/**
 * afterEach: leave every room / search / match both players are in (UI controls only), so a failed test never
 * holds a seat into the next one. Best effort, never throws; anything left is resumed and left by the next openPair.
 */
export async function releasePair() {
  const pair = current;
  current = null;
  if (!pair) return;
  for (let round = 0; round < 3; round++) {
    for (const p of [pair.host, pair.joiner]) {
      if (p.page.isClosed()) continue;
      await ensureIdle(p, { rounds: 4 }).catch(() => {});
    }
  }
}

/** Run `fn(p)` for host then joiner; both always run, errors are thrown together afterwards. → [hostResult, joinerResult] */
export async function both(pair, fn) {
  const out = [], errors = [];
  for (const p of [pair.host, pair.joiner]) {
    try { out.push(await fn(p)); } catch (e) { out.push(undefined); errors.push(`${p.label} (${p.vp.id}): ${e.message}`); }
  }
  if (errors.length) throw new Error(errors.join('\n'));
  return out;
}

/**
 * `slow-api` allowance: both players restore their session (`GET /api/me/`) at the same moment on one local runserver,
 * and the first test of a run also boots the token minter (manage.py shell, ~6 s of CPU) against the same sqlite file:
 * 2-3 s answers then, ~0.1-0.3 s otherwise (same cause as the games suite's GAMES_LOCAL_LOAD).
 */
export const MP_LOCAL_LOAD = [/^slow GET \S+\/api\/me\/$/];

/** Console check and done() on BOTH audits (each attaches even if the other throws), then fail once with both messages. */
export async function finishBoth(pair, { allow = MP_LOCAL_LOAD } = {}) {
  const errors = [];
  for (const p of [pair.host, pair.joiner]) {
    try { await p.audit.console({ allow }); } catch (e) { errors.push(e.message); }
    try { await p.audit.done(); } catch (e) { errors.push(e.message); }
  }
  if (errors.length) throw new Error(errors.join('\n\n'));
}

/** Shot named `name` on both sides. */
export const shotBoth = (pair, name) => both(pair, (p) => p.audit.shot(name));

/** Layout scan of both players' stage column and Multiplayer card. */
export const layoutBoth = (pair) => both(pair, async (p) => {
  await p.audit.layout({ scope: 'section.stage-col' });
  await p.audit.layout({ scope: 'aside.game-aside' });
});

/** The players' own ids (public ids from the minted /me/ payload). */
export const uidOf = (p) => p.user && p.user.id;

/**
 * The name the OTHER player sees for `p`: in a random 1v1 match the relay shows a 13-15 year-old (and an account of
 * unknown age, which counts as one: backend users/consent.py is_teen) as "Player" with no photo (multiplayer_server
 * publicUser / maskedForStrangers); friend rooms show the real name. The test accounts never gave an age, so they are
 * masked in 1v1 matches by design.
 */
export const shownName = (p, type) => (type === 'match' && p.user && p.user.is_teen !== false ? 'Player' : p.username);

// ---------------------------------------------------------------- friend rooms

/** The 6 digits shown in the lobby's code tiles. */
export async function lobbyCode(p) {
  const t = await L(p.page, 'multiplayer.lobbyCode').innerText({ timeout: 5000 });
  return t.replace(/\D/g, '');
}

/** Host: Play with a friend → (stepper to `size`) → Generate code → lobby. → the room code. */
export async function createRoom(host, { size = null } = {}) {
  const page = host.page;
  await L(page, 'multiplayer.friendBtn').click();
  await expect(L(page, 'multiplayer.generateBtn')).toBeVisible();
  if (size != null) {
    for (let i = 0; i < 4; i++) {
      const n = Number((await L(page, 'multiplayer.menuSizeNum').innerText()).trim());
      if (n === size) break;
      await page.locator(`aside.game-aside .fp-body > .fp-size button[aria-label^='${n < size ? 'More' : 'Fewer'} players']`).click();
      await page.waitForTimeout(350);
    }
  }
  await L(page, 'multiplayer.generateBtn').click();
  await waitState(host, 'lobby');
  await expect(L(page, 'multiplayer.lobbyCode')).toBeVisible();
  return lobbyCode(host);
}

/** Joiner: Play with a friend → Enter code → type → Join room → lobby. */
export async function joinRoom(joiner, code) {
  const page = joiner.page;
  if ((await mpState(page)) === 'idle') await L(page, 'multiplayer.friendBtn').click();
  await L(page, 'multiplayer.enterCodeBtn').click();
  await expect(L(page, 'multiplayer.codeInput')).toBeVisible();
  await L(page, 'multiplayer.codeInput').fill(code);
  await expect(L(page, 'multiplayer.joinBtn')).toBeEnabled();
  await L(page, 'multiplayer.joinBtn').click();
  await waitState(joiner, 'lobby');
}

/** Host presses Start game; both reach the playing screen (via the VS intro). */
export async function startRoom(pair) {
  await expect(L(pair.host.page, 'multiplayer.startBtn')).toBeVisible();
  await L(pair.host.page, 'multiplayer.startBtn').click();
  pair.type = 'friend';
  await both(pair, (p) => waitState(p, ['intro', 'playing'], 20_000));
  await both(pair, (p) => waitState(p, 'playing', 30_000));
}

/** A full friend room with both seated, on the pair's current game page. → code */
export async function roomWithBoth(pair) {
  const code = await createRoom(pair.host);
  await joinRoom(pair.joiner, code);
  await expect(L(pair.host.page, 'multiplayer.seats')).toHaveCount(2);
  return code;
}

// ---------------------------------------------------------------- 1v1 matchmaking

/** The 1v1 button's visible label (its SwapText also holds the hidden alternatives). */
export const play1v1Label = (p) => L(p.page, 'multiplayer.play1v1').innerText({ timeout: 3000 }).then((t) => t.trim());

/** Host searches first (on the queue alone), then the joiner: the relay pairs them at once (the only two players). */
export async function startMatch(pair) {
  await L(pair.host.page, 'multiplayer.play1v1').click();
  await waitState(pair.host, 'searching');
  await L(pair.joiner.page, 'multiplayer.play1v1').click();
  pair.type = 'match';
  await both(pair, (p) => waitState(p, ['intro', 'playing'], 20_000));
  await both(pair, (p) => waitState(p, 'playing', 30_000));
}

/**
 * The first player to finish (the host) waits: "Your score <n>", "Waiting for <joiner>…", the opponent chip still
 * Playing; the other player's chip for them turns Finished. Shots `<tag>waiting` / `<tag>opponent-finished`.
 */
export async function checkWaiting(pair, score, { tag = '' } = {}) {
  const { host, joiner } = pair;
  if ((await waitState(host, ['waiting', 'results'])) !== 'waiting') {
    host.audit.metrics.push({ kind: 'note', label: 'waiting screen skipped (the other player had finished)', value: 0, unit: '', route: host.audit.route });
    return;
  }
  const bad = (p, sel, measured, expected) => p.audit.violation('waiting', { selector: sel, measured, expected });
  const num = ((await L(host.page, 'multiplayer.waitingScore').innerText({ timeout: 3000 }).catch(() => '')) || '').trim();
  if (score != null && num !== String(score)) bad(host, '.om-yourscore-num', `"Your score" shows ${num}`, String(score));
  const label = await host.page.locator('.stage-inner .om-stage [role="status"]').first().getAttribute('aria-label', { timeout: 3000 }).catch(() => null);
  const jName = shownName(joiner, pair.type);
  if (label !== `Waiting for ${jName}...`) bad(host, '.om-stage [role=status]', `"${label}"`, `"Waiting for ${jName}..."`);
  const hostChip = (await L(host.page, 'multiplayer.playbarChip').locator('.om-chip-state').first().innerText({ timeout: 3000 }).catch(() => '')).trim();
  if (hostChip !== 'Playing') bad(host, '.om-chip-state', `opponent chip "${hostChip}"`, 'Playing (the joiner has not finished)');
  await host.audit.layout({ scope: 'section.stage-col' });
  await host.audit.shot(`${tag}waiting`);
  const finished = await expect(L(joiner.page, 'multiplayer.playbarChip').first()).toHaveClass(/\bis-finished\b/, { timeout: 6000 }).then(() => true, () => false);
  if (!finished) bad(joiner, '.om-chip', 'the host\'s chip never turned Finished', 'opponentFinished → the chip reads Finished');
  await joiner.audit.shot(`${tag}opponent-finished`);
}

// ---------------------------------------------------------------- results

/** The results screen as the player sees it (2-player matchup cards). */
export function readResults(page) {
  return page.evaluate(() => {
    const r = document.querySelector('.stage-inner .om-stage--results');
    if (!r) return null;
    const h = r.querySelector('.om-headline');
    const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
    const cards = [...r.querySelectorAll('.om-matchup .om-pc')].map((c) => {
      const col = c.closest('.om-pc-col');
      return {
        side: txt(c.querySelector('.om-pc-side')), name: txt(c.querySelector('.om-pc-name')), tag: txt(c.querySelector('.om-pc-tag')),
        score: txt(c.querySelector('.om-pc-score')), time: col ? txt(col.querySelector('.om-pc-time')) : null,
        win: c.classList.contains('is-win'), tie: c.classList.contains('is-tie'), crown: !!c.querySelector('.om-pc-crown'),
      };
    });
    return { headline: txt(h), headlineClass: h ? h.className : null, timeNote: txt(r.querySelector('.om-time-note')), cards, standings: r.querySelectorAll('.om-standings .om-strow').length };
  });
}

/** Wait for the results screen and its AnimatedNumber scores to land (the same reading twice, 300 ms apart). */
export async function settledResults(p, timeout = 45_000) {
  await waitState(p, 'results', timeout);
  let last = null;
  const until = Date.now() + 8000;
  while (Date.now() < until) {
    const r = await readResults(p.page);
    const key = JSON.stringify(r);
    if (r && r.cards.length && key === last) return r;
    last = key;
    await sleep(300);
  }
  return readResults(p.page);
}

const HEADLINE = { win: 'You win!', loss: 'You lost', tie: "It's a draw" };

/**
 * Results on both sides (Rule: each screen tells its own outcome; the two screens mirror each other).
 * want = { host: { outcome, score }, joiner: { outcome, score }, timeTie: bool (equal scores, the clock decided), times: false
 * for a turn duel (no play times) }.
 * Records `results` violations (never throws on a wrong value). → { host, joiner } readings
 */
export async function checkResults(pair, want) {
  const [h, j] = await both(pair, (p) => settledResults(p));
  const read = { host: h, joiner: j };
  for (const role of ['host', 'joiner']) {
    const p = pair[role], r = read[role], w = want[role], other = role === 'host' ? 'joiner' : 'host';
    const o = read[other];
    const bad = (measured, expected) => p.audit.violation('results', { selector: '.om-stage--results', measured, expected });
    if (r.headline !== HEADLINE[w.outcome]) bad(`headline "${r.headline}"`, `"${HEADLINE[w.outcome]}" (${w.outcome})`);
    if (!new RegExp(`\\bis-${w.outcome}\\b`).test(r.headlineClass || '')) bad(`headline class "${r.headlineClass}"`, `is-${w.outcome}`);
    if (r.cards.length !== 2) { bad(`${r.cards.length} player cards`, 'You + Opponent cards'); continue; }
    const [you, opp] = r.cards;
    if (you.side !== 'You' || opp.side !== 'Opponent') bad(`card sides ${you.side} / ${opp.side}`, 'You, then Opponent');
    if (you.name !== p.username) bad(`own card names "${you.name}"`, p.username);
    const oppName = shownName(pair[other], pair.type);
    if (opp.name !== oppName) bad(`opponent card names "${opp.name}"`, `${oppName}${oppName !== pair[other].username ? ` (${pair[other].username} is of unknown age: masked in a random match)` : ''}`);
    if (w.score != null && Number(you.score) !== w.score) bad(`own score ${you.score}`, `${w.score} (from the answers given)`);
    if (want[other].score != null && Number(opp.score) !== want[other].score) bad(`opponent score ${opp.score}`, `${want[other].score}`);
    // Mirror: my card on my screen = my card on the other screen.
    if (o && o.cards.length === 2) {
      const mine = o.cards[1];
      if (mine.tag !== you.tag || mine.score !== you.score || mine.time !== you.time) bad(`own card ${JSON.stringify(you)} vs the ${other}'s view ${JSON.stringify(mine)}`, 'the same player (#id), score and time on both screens');
    }
    // Play times break equal scores; a turn duel's scores come from the board (no times are submitted): want.times false.
    if (want.times !== false && (!you.time || !opp.time || !/^\d+:\d\d$/.test(you.time))) bad(`play times "${you.time}" / "${opp.time}"`, 'm:ss under both cards');
    const winCard = w.outcome === 'win' ? you : w.outcome === 'loss' ? opp : null;
    if (winCard && !(winCard.win && winCard.crown)) bad(`winner card is-win=${winCard.win} crown=${winCard.crown}`, 'the winner\'s card ringed with a crown');
    if (w.outcome === 'tie' && !(you.tie && opp.tie)) bad('draw without both cards marked is-tie', 'both cards is-tie');
    const wantNote = !!want.timeTie && w.outcome !== 'tie';
    if (wantNote && r.timeNote !== 'Same score, faster time wins') bad(`time note "${r.timeNote}"`, '"Same score, faster time wins" (equal scores, the clock decided)');
    if (!wantNote && r.timeNote) bad(`time note "${r.timeNote}" with scores ${you.score} / ${opp.score}`, 'no time note unless equal scores were split by time');
  }
  return read;
}

/** See answers → the answer review modal (score line) → closed with its X; the modal leaves with an exit animation. */
export async function reviewRoundTrip(p, wantScore) {
  const page = p.page;
  const btn = L(page, 'multiplayer.reviewBtn');
  if (!(await btn.isVisible({ timeout: 3000 }).catch(() => false))) {
    p.audit.violation('review', { selector: '.om-review', measured: 'no See answers button after the round', expected: 'See answers once the player has finished (MP-16)' });
    return;
  }
  await btn.click();
  await expect(L(page, 'multiplayer.review')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(400);
  const score = ((await L(page, 'multiplayer.reviewScore').innerText({ timeout: 2000 }).catch(() => '')) || '').replace(/[^\d]/g, '');
  if (wantScore != null && score !== String(wantScore)) p.audit.violation('review', { selector: '.ar-score', measured: `review says "Your score ${score}"`, expected: `Your score ${wantScore}` });
  await p.audit.layout({ scope: '.modal-panel' });
  await p.audit.shot('review');
  await L(page, 'guest.modalClose').click();
  await expect(L(page, 'guest.modalBackdrop')).toHaveCount(0, { timeout: 5000 });
}

/** The newest visible notice bar text in the stage ('' when none). */
export const noticeText = (page) => page.evaluate(() => {
  const n = [...document.querySelectorAll('.stage-inner .om .om-notice')].pop();
  return n ? n.textContent.replace(/\s+/g, ' ').trim() : '';
});

/** Wait for a stage notice (or the Multiplayer card message) matching `re`. → text | null */
export async function waitNotice(p, re, { where = 'stage', timeout = 8000 } = {}) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const t = where === 'stage' ? await noticeText(p.page)
      : ((await L(p.page, 'multiplayer.panelMessage').first().innerText({ timeout: 200 }).catch(() => '')) || '').replace(/\s+/g, ' ').trim();
    if (re.test(t)) return t;
    await sleep(100);
  }
  return null;
}

/** Was this run's relay and Django started by ui-check (so both share RELAY_KEY and 1v1 matches are credited)? */
export function creditsEnabled() {
  const names = (readStack()?.started || []).map((s) => s.name);
  return names.some((n) => n.startsWith('django-')) && names.some((n) => n.startsWith('socket-'));
}
