// Shared building blocks for game adapters (games/<id>.mjs). The adapter contract and the driver
// that calls it live in games/index.mjs and lib/game-driver.mjs; this file only knows how to read a
// round's data and how to act on the shared shell (autocomplete input, round label, end screens).
//
// Where an adapter gets the right answer (spec §7): ctx.cap first, ctx.fiber as the fallback.
//   capPool(ctx, key)       the game's whole pool as the client received it, from captured JSON:
//                           the bundled `/data/<key>.json` (raw rows) or the manifest-v3 data host
//                           (`<host>/manifest.json` schema 3 + its chunk/single files + lookups,
//                           expanded exactly like src/utils/gameData.ts expand()).
//   fiberRound(ctx, prop)   { rows, index } from the renderer's own props/state (React fiber): the
//                           component whose props hold `prop` (e.g. 'seriesList'), hook 0 = round index.
// The pool is sampled client-side (Math.random), so a round is identified from what the DOM shows
// (season, team names, logo file) and looked up in the captured pool; fiber is used only when that
// lookup finds nothing. answerFrom() returns which one answered (ctx.state.sources counts them).
import { L } from '../lib/pagemap.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** THE expand() contract of src/utils/gameData.ts (publish_v3.py): "<prefix>@<lookup>" index → prefix+suffix fields. */
export function expand(rows, lookups) {
  return rows.map((row) => {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) return row;
    const out = {};
    for (const [key, value] of Object.entries(row)) {
      const at = key.indexOf('@');
      if (at < 0) { out[key] = value; continue; }
      const prefix = key.slice(0, at), name = key.slice(at + 1);
      const entry = lookups[name] && lookups[name][value];
      if (!entry || typeof entry !== 'object') return null; // lookup not captured: unusable row
      for (const [suffix, v] of Object.entries(entry)) out[prefix + suffix] = v;
    }
    return out;
  }).filter(Boolean);
}

/**
 * Every row of pool `key` (pool.ts / gameData.ts game key, e.g. 'playoff', 'name-logo', 'mvps') that
 * this page has received so far, or [] when nothing was captured. Rows are in the renderer's shape
 * except for the per-round side swap of SIDE_GAMES (match on the pair, not on team_a/team_b).
 */
export async function capPool(ctx, key) {
  const rows = [];
  // Bundled copy: /data/<key>.json is a raw array; the Django /trivia/pool/ wrapper is { pool }.
  for (const body of await ctx.cap.all(new RegExp(`/data/${key}\\.json(\\?|$)`))) {
    if (Array.isArray(body)) rows.push(...body);
    else if (body && Array.isArray(body.pool)) rows.push(...body.pool);
  }
  // Manifest-v3 data host.
  const manifests = (await ctx.cap.entries(/\/manifest\.json(\?|$)/)).filter((e) => e.body && e.body.schema === 3 && e.body.games);
  for (const m of manifests) {
    const entry = m.body.games[key];
    if (!entry) continue;
    const base = m.url.replace(/\/manifest\.json(\?.*)?$/, '');
    const fileBody = async (p) => {
      const hits = await ctx.cap.entries(`${base}/${p}`);
      return hits.length ? hits[hits.length - 1].body : undefined;
    };
    const lookups = {};
    for (const [name, p] of Object.entries(entry.lookups || {})) {
      const b = await fileBody(p);
      if (Array.isArray(b)) lookups[name] = b;
    }
    const files = entry.file ? [entry.file] : entry.chunks || [];
    for (const p of files) {
      const b = await fileBody(p);
      if (Array.isArray(b)) rows.push(...expand(b, lookups));
    }
  }
  return rows;
}

/**
 * Fallback: the round data the renderer itself holds. Walks up from the game root (`.playing-wrap > .gf`)
 * to the first component whose props have `prop`; its first hook is the round index in every renderer
 * the adapters cover. Props shape only (component names are minified in prod). → { rows, index } | null
 */
export async function fiberRound(ctx, prop, selector = '.playing-wrap > .gf') {
  const props = await ctx.fiber.props(selector, 10).catch(() => null);
  const state = await ctx.fiber.state(selector, 10).catch(() => null);
  if (!props || !state) return null;
  // props[0] is the DOM element's own props; props[i] (i ≥ 1) is the same component as state[i - 1].
  const i = props.findIndex((p, k) => k > 0 && p.props && Array.isArray(p.props[prop]));
  if (i < 1) return null;
  const hooks = state[i - 1] && state[i - 1].hooks;
  const index = Array.isArray(hooks) && typeof hooks[0] === 'number' ? hooks[0] : null;
  return { rows: props[i].props[prop], index };
}

/**
 * Resolve a round's answer: `fromCap()` first, `fromFiber()` when it returns nothing. Counts the source in
 * ctx.state.sources. Throws when neither knows the answer — a scenario must never pass by guessing.
 */
export async function answerFrom(ctx, what, fromCap, fromFiber) {
  const src = (ctx.state.sources ||= { cap: 0, fiber: 0 });
  const a = await fromCap();
  if (a != null) { src.cap++; return a; }
  const b = await fromFiber();
  if (b != null) { src.fiber++; return b; }
  throw new Error(`adapter: cannot determine the right answer for ${what} from captured data or React state`);
}

/** `ROUND 2/5` / `MATCHUP 3/10` → { n, total } from the status label, or null. */
export async function roundLabel(page) {
  const t = await L(page, 'games.statusLeft').first().textContent({ timeout: 1000 }).catch(() => null);
  const m = /(\d+)\s*\/\s*(\d+)/.exec(t || '');
  return m ? { n: +m[1], total: +m[2] } : null;
}

/**
 * Wait until the next turn is ready (readKey() returns a key ≠ prevKey, the same on two reads 120 ms
 * apart, so a SwapText mid-swap is never read) or the game is over. → { over, key }
 */
export async function nextTurn(page, readKey, prevKey, isOver, { timeout = 15_000 } = {}) {
  const until = Date.now() + timeout;
  let last = null;
  while (Date.now() < until) {
    if (await isOver(page)) return { over: true, key: null };
    const k = await readKey().catch(() => null);
    if (k && k !== prevKey && k === last) return { over: false, key: k };
    last = k;
    await sleep(120);
  }
  throw new Error(`adapter: the next turn never became ready (last key ${JSON.stringify(last)}, previous ${JSON.stringify(prevKey)})`);
}

/** The shell's end states: a ScorePanel in place, or the full-screen GameResult (no .playing-wrap, end buttons). */
export async function shellIsOver(page) {
  return page.evaluate(() => {
    const vis = (el) => !!el && el.getBoundingClientRect().height > 0 && getComputedStyle(el).visibility !== 'hidden';
    if (vis(document.querySelector('.playing-wrap .scorepanel'))) return true;
    if (document.querySelector('.playing-wrap')) return false;
    const inner = document.querySelector('.stage-inner');
    return !!inner && [...inner.querySelectorAll('button')].some((b) => /Close game/.test(b.textContent || '') && vis(b));
  });
}

/** Type a guess into the game's autocomplete and press Confirm (the click is the submitting input event). */
export async function typeAndConfirm(page, text) {
  const input = L(page, 'games.comboInput');
  await input.fill(text);
  await page.keyboard.press('Escape'); // close the suggestion list so it never covers Confirm
  await L(page, 'games.confirmBtn').click();
}

/** RegExp matching exactly `text` (trimmed), for Playwright `hasText`. */
export const exactly = (text) => new RegExp(`^\\s*${String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);

/** A pool value different from `right` (normalised like src/utils/answerMatch.ts), for a wrong guess. */
export function wrongFrom(values, right) {
  const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’.,-]/g, '').replace(/\s+/g, ' ').trim();
  const r = norm(right);
  const pick = values.find((v) => v && norm(v) !== r);
  if (!pick) throw new Error(`adapter: no wrong answer available besides "${right}"`);
  return pick;
}
