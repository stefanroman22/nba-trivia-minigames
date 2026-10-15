// Helpers shared by the guest specs (specs/guest/*.spec.mjs). Locators live in pagemap/guest.json
// and pagemap/common.json; this file holds only behaviour: opening modals/drawer, frame samplers.
import { expect } from '@playwright/test';
import { L } from './pagemap.mjs';
import { activePorts } from '../../check-core/lib/ports.mjs';
import { visibleGames } from './games-catalog.mjs';

/** Nav switches desktop links -> hamburger at <=900px (Navigation.css hide-md); rail -> chips at <=820px. */
export const drawerMode = (vp) => vp.width <= 900;
export const chipsMode = (vp) => vp.width <= 820;

/** Visible games that have a page of their own (everything but the "coming-soon" tile). */
export const playableGames = () => visibleGames().filter((g) => g.id !== 'coming-soon');

/** One playable game by id (throws when the catalogue changed). */
export function gameById(id) {
  const g = playableGames().find((x) => x.id === id);
  if (!g) throw new Error(`games-catalog: no playable game "${id}" (have ${playableGames().map((x) => x.id).join(', ')})`);
  return g;
}

/** The landing card of a game, found by its link. */
export const tileFor = (page, g) => page.locator(`#games-grid .gtile[href="${g.path}"]`);

/** The rail item (above 820px) or chip (820px and below) of a game, found by its exact name. */
const escRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function railTarget(page, vp, g) {
  const exact = new RegExp('^\\s*' + escRe(g.name) + '\\s*$');
  return chipsMode(vp)
    ? L(page, 'guest.railChips').filter({ hasText: exact })
    : L(page, 'guest.railItems').filter({ has: page.locator('.rail-name', { hasText: exact }) });
}


/**
 * A game's rail item / chip / card is disabled. Explained: coming-soon (always) and Wordle when its
 * daily-status call said locked (today's play is used). Anything else is a `disabled-game` violation.
 * Explained skips are recorded as the soft warning `skip-explained` (shown under Warnings in the digest). Returns true when the caller may skip.
 */
export async function explainDisabled(audit, cap, g, where) {
  if (g.id === 'coming-soon') return true;
  if (g.id === 'wordle') {
    const st = await cap.json(/daily-status/).catch(() => undefined);
    if (st && st.locked === true) {
      audit.violation('skip-explained', { selector: `${where}: wordle`, measured: 'disabled, skipped', expected: 'explained: daily play already used (daily-status locked)' });
      return true;
    }
  }
  audit.violation('disabled-game', { selector: `${where}: ${g.id}`, measured: 'disabled', expected: 'enabled (only coming-soon, or Wordle after the daily play, may be disabled)' });
  return false;
}

export const IS_PROD = () => process.env.UI_CHECK_MODE === 'prod';
export const apiBase = () => `http://localhost:${activePorts().django}/api`;

export const slugOf = (p) => (p === '/' ? 'home' : p.replace(/^\//, '').replace(/[^\w]+/g, '-'));

/** Open the mobile drawer through the hamburger and wait for it. */
export async function openDrawer(page) {
  await L(page, 'common.navMenuButton').click();
  await expect(L(page, 'common.drawer')).toBeVisible();
  // Wait for the slide-in to finish: opaque and the same left edge on three consecutive frames.
  await page.waitForFunction(() => new Promise((resolve) => {
    const el = document.getElementById('nav-drawer');
    let last = null, same = 0;
    const tick = () => {
      const r = el.getBoundingClientRect().left, o = +getComputedStyle(el).opacity;
      same = last !== null && Math.abs(r - last) < 0.1 && o > 0.99 ? same + 1 : 0;
      last = r;
      if (same >= 3) resolve(true); else requestAnimationFrame(tick);
    };
    tick();
  }), null, { timeout: 5000 });
}

/**
 * Open the login modal the way a guest on this viewport would, from a trigger that stays mounted:
 * the nav's Log in button on desktop, the guest panel's CTA on the landing page otherwise.
 * Returns the trigger locator (focus should come back to it).
 */
export async function openLogin(page, vp) {
  const trigger = drawerMode(vp) ? L(page, 'guest.guestPanelCta') : L(page, 'common.navLogin');
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  await expect(L(page, 'guest.modalPanel')).toBeVisible();
  return trigger;
}

/** What the page says about overlays right now. */
export function overlayState(page) {
  return page.evaluate(() => {
    const z = (s) => { const e = document.querySelector(s); return e ? +getComputedStyle(e).zIndex : null; };
    const backdrops = document.querySelectorAll('.modal-backdrop');
    return {
      backdrops: backdrops.length,
      panelsInBackdrop: document.querySelectorAll('.modal-backdrop .modal-panel').length,
      panels: document.querySelectorAll('.modal-panel').length,
      bodyOverflow: getComputedStyle(document.body).overflow,
      htmlOverflow: getComputedStyle(document.documentElement).overflow,
      z: { fab: z('.feedback-fab'), nav: z('.nav3'), modal: z('.modal-backdrop'), drawer: z('.drawer-panel') },
      active: document.activeElement ? (document.activeElement.className || document.activeElement.tagName) : null,
    };
  });
}

/**
 * Record `selector`'s opacity, transform and box on every animation frame from before `fn` runs until
 * `tail` ms after it finishes (so a slow click never falls outside the window).
 * Rows: { t, present, o, tf, w, h, x, y } (t in ms since the sampler started).
 */
export async function recordFrames(page, selector, fn, { tail = 600 } = {}) {
  await page.evaluate(({ selector }) => {
    const rec = (window.__gRec = { rows: [], stop: false, done: false });
    const t0 = performance.now();
    const tick = () => {
      const t = performance.now() - t0;
      const el = document.querySelector(selector);
      if (el) {
        const cs = getComputedStyle(el), r = el.getBoundingClientRect();
        rec.rows.push({ t, present: true, o: +cs.opacity, tf: cs.transform, w: r.width, h: r.height, x: r.left, y: r.top });
      } else rec.rows.push({ t, present: false });
      if (!rec.stop && t < 20000) requestAnimationFrame(tick); else rec.done = true;
    };
    requestAnimationFrame(tick);
  }, { selector });
  await fn();
  await page.waitForTimeout(tail);
  await page.evaluate(() => { window.__gRec.stop = true; });
  await page.waitForFunction(() => window.__gRec.done, null, { timeout: 5000 });
  return page.evaluate(() => window.__gRec.rows);
}

/**
 * Did a fade play? `intermediate` = frames caught with the element part-way (0.03 < opacity < 0.97).
 * A real fade leaves several; an instant mount/unmount leaves none. (Counting distinct values broke when
 * a busy machine dropped frames from a 0.28s animation.)
 */
export function fadeSummary(rows) {
  const present = rows.filter((r) => r.present);
  const ops = present.map((r) => r.o);
  return {
    frames: present.length,
    intermediate: ops.filter((o) => o > 0.03 && o < 0.97).length,
    min: ops.length ? Math.min(...ops) : null,
    first: ops.length ? ops[0] : null,
    last: ops.length ? ops[ops.length - 1] : null,
    vanished: rows.some((r, i) => !r.present && i > 0 && rows[i - 1].present),
  };
}

/**
 * Fade dips in a series of opacities: a zigzag with a minimum swing, so frame noise is ignored but a
 * one-frame jump back to 1 or 0 after an animation ended counts. A clean route change is exactly 1
 * (down to ~0, then back up to 1).
 */
export function valleys(ops, minSwing = 0.4) {
  if (ops.length < 2) return 0;
  let hi = ops[0], lo = ops[0], dir = 0, ext = 0, v = 0;
  for (const o of ops.slice(1)) {
    if (dir === 0) {
      hi = Math.max(hi, o); lo = Math.min(lo, o);
      if (hi - lo >= minSwing) { dir = o === hi ? 1 : -1; ext = o; }
    } else if (dir === -1) {
      if (o < ext) ext = o;
      else if (o - ext >= minSwing) { v++; dir = 1; ext = o; }
    } else if (o > ext) ext = o;
    else if (ext - o >= minSwing) { dir = -1; ext = o; }
  }
  return v;
}

/**
 * `slow-api` on GET /api/get-users/ (the landing leaderboard) is load, not the app: the endpoint answers a
 * 161-byte body in ~0.25s on an idle machine, but the suite runs 4 browsers against one single-process
 * local Django, which pushes it past 1s. Every guest audit.console() allows it.
 */
export const LOCAL_LOAD = [/^slow GET \S+\/api\/get-users\//];

/**
 * Click-to-content latency measured inside the page (no CDP round trips, no polling lag): from the
 * capture-phase click event of `clickFn` until `predicate` (a JS expression string) is true on an
 * animation frame. Returns ms; pushes a timing metric and a slow-action violation when over budget.
 */
export async function routeLatency(audit, label, clickFn, predicate, budgetMs) {
  const { page } = audit;
  const timed = page.evaluate(({ predicate }) => new Promise((resolve, reject) => {
    let t0 = null;
    document.addEventListener('click', () => { t0 = performance.now(); }, { capture: true, once: true });
    const test = new Function(`return (${predicate});`);
    const give = performance.now() + 15000;
    const check = () => {
      if (t0 !== null && test()) resolve(performance.now() - t0);
      else if (performance.now() > give) reject(new Error('route latency: content never appeared'));
      else requestAnimationFrame(check);
    };
    check();
  }), { predicate });
  await clickFn();
  const ms = Math.round(await timed);
  audit.metrics.push({ kind: 'timing', label, value: ms, unit: 'ms', budget: budgetMs, route: audit.route });
  if (ms > budgetMs) audit.violation('slow-action', { selector: label, measured: `${ms}ms`, expected: `<= ${budgetMs}ms` });
  return ms;
}

/**
 * Type into the landing search and time (in the page) until the number of game cards satisfies `until`
 * (a JS expression over `n`, the card count, e.g. 'n < 12').
 */
export async function searchLatency(audit, label, value, until, budgetMs) {
  const { page } = audit;
  const ms = Math.round(await page.evaluate(({ value, until }) => new Promise((resolve, reject) => {
    const input = document.querySelector('input[aria-label="Search games"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    const ok = new Function('n', `return (${until});`);
    const t0 = performance.now();
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const give = t0 + 10000;
    const check = () => {
      const n = document.querySelectorAll('#games-grid .gtile').length;
      if (ok(n)) resolve(performance.now() - t0);
      else if (performance.now() > give) reject(new Error(`search "${value}": card count never satisfied ${until} (now ${n})`));
      else requestAnimationFrame(check);
    };
    check();
  }), { value, until }));
  audit.metrics.push({ kind: 'timing', label, value: ms, unit: 'ms', budget: budgetMs, route: audit.route });
  if (ms > budgetMs) audit.violation('slow-action', { selector: label, measured: `${ms}ms`, expected: `<= ${budgetMs}ms` });
  return ms;
}
