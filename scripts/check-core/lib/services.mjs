// Services taxonomy (spec §4–§5): every check in scripts/ui-check/CHECKS.md and scripts/logic-check/CHECKS.md tags the
// services it depends on in a `services` column. Logic Check blocks a service when it finds it broken; UI check then
// skips (defers) every check tagged with that service (check-core/lib/channel.mjs).
//   pages, auth, signup, profile, friends, leaderboard, game-data, rooms, matchmaking, relay, plus games.<id>
// A generated family row (`GM-<game>-<scenario>`) may name `games.<game>`: servicesOf fills the placeholder from the id.
// Cell `-` = explicitly none, allowed only for rows that test the harness itself (ST- / LC-ST- selftests, ACCEPT).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './home.mjs';

export const SERVICES = ['pages', 'auth', 'signup', 'profile', 'friends', 'leaderboard', 'game-data', 'rooms', 'matchmaking', 'relay'];
export const UI_CHECKS_MD = path.join(ROOT, 'scripts', 'ui-check', 'CHECKS.md');
export const LOGIC_CHECKS_MD = path.join(ROOT, 'scripts', 'logic-check', 'CHECKS.md');

const GAME = /^games\.([a-z0-9][a-z0-9-]*|<game>)$/;
const NO_SERVICES = /^((LC-)?ST-|ACCEPT)/;
/** A known service name (`games.<id>` with a lower-case slug, or the `games.<game>` placeholder of a family row). */
export const isService = (s) => SERVICES.includes(s) || GAME.test(s);

const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

/**
 * CHECKS.md text → Map<checkId, string[]> of every table row whose first cell is a backticked id. Each such row's
 * table must have a `services` header column, and the cell must list known services (comma-separated) or `-` for a
 * harness row (ST-, ACCEPT). Throws one error naming every bad row.
 */
export function parseServices(checksMd, { file = 'CHECKS.md' } = {}) {
  const out = new Map();
  const errs = [];
  let col = -1; // index of `services` in the current table's header, -1 when the table has none
  let prevTable = false;
  String(checksMd).split(/\r?\n/).forEach((line, i) => {
    const isRow = /^\s*\|/.test(line);
    if (!isRow) { prevTable = false; col = -1; return; }
    const cs = cells(line);
    if (!prevTable) { col = cs.findIndex((c) => c.toLowerCase() === 'services'); prevTable = true; return; } // header row
    if (/^:?-{3,}/.test(cs[0])) return; // separator row
    const m = /^`([^`]+)`$/.exec(cs[0]);
    if (!m) return;
    const id = m[1];
    const at = `${file}:${i + 1} ${id}`;
    if (col < 0) { errs.push(`${at}: its table has no services column`); return; }
    const cell = (cs[col] || '').replace(/`/g, '').trim();
    if (!cell) { errs.push(`${at}: services cell is empty`); return; }
    if (cell === '-') {
      if (NO_SERVICES.test(id)) out.set(id, []);
      else errs.push(`${at}: "-" (no services) is only for ST-/ACCEPT rows (and LC-ST- selftests)`);
      return;
    }
    const list = cell.split(',').map((s) => s.trim()).filter(Boolean);
    const bad = list.filter((s) => !isService(s));
    if (bad.length) { errs.push(`${at}: unknown service(s) ${bad.join(', ')} (known: ${SERVICES.join(', ')}, games.<id>)`); return; }
    if (list.some((s) => s === 'games.<game>') && !id.includes('<game>')) { errs.push(`${at}: games.<game> needs a <game> placeholder in the id`); return; }
    if (out.has(id)) { errs.push(`${at}: listed twice`); return; }
    out.set(id, list);
  });
  if (errs.length) throw new Error(`services: ${errs.length} problem(s)\n- ${errs.join('\n- ')}`);
  return out;
}

/** Both catalogues' maps (the logic one is empty while scripts/logic-check/CHECKS.md does not exist). */
export function loadServiceMaps({ ui = UI_CHECKS_MD, logic = LOGIC_CHECKS_MD } = {}) {
  const read = (f) => { try { return readFileSync(f, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
  const maps = [];
  for (const f of [ui, logic]) { const md = read(f); if (md !== null) maps.push(parseServices(md, { file: path.basename(path.dirname(f)) + '/CHECKS.md' })); }
  return maps;
}

// Placeholders in family ids: <game> is a lower-case game slug, <scenario> one of the games driver's scenarios.
const PLACEHOLDER = {
  game: '[a-z0-9][a-z0-9-]*',
  scenario: '(?:perfect|wrong|partial|timeout|giveup|daily-lock)',
};
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function familyRe(key) {
  let re = '';
  let last = 0;
  for (const m of key.matchAll(/<([a-z]+)>/g)) {
    re += esc(key.slice(last, m.index)) + `(?<${m[1]}>${PLACEHOLDER[m[1]] || '[\\w.-]+'})`;
    last = m.index + m[0].length;
  }
  return new RegExp(`^${re}${esc(key.slice(last))}$`);
}

/**
 * Services of one concrete check id (`G-MODAL-01`, `GM-wordle-perfect`, `MP-GAME-wordle`) from the maps of
 * parseServices/loadServiceMaps: an exact row first, else the family row with the most literal characters that matches
 * (so `GM-LATENCY-wordle` is `GM-LATENCY-<game>`, not `GM-<game>-<scenario>`), with `games.<game>` filled in.
 * → string[] (null when no row matches).
 */
export function servicesOf(checkId, maps) {
  const list = Array.isArray(maps) ? maps : [maps];
  for (const m of list) if (m.has(checkId)) return [...m.get(checkId)];
  let best = null;
  for (const m of list) {
    for (const [key, services] of m) {
      if (!key.includes('<')) continue;
      const hit = familyRe(key).exec(checkId);
      if (!hit) continue;
      const literal = key.replace(/<[a-z]+>/g, '').length;
      if (!best || literal > best.literal) best = { literal, services, groups: hit.groups || {} };
    }
  }
  if (!best) return null;
  return best.services.map((s) => s.replace(/<([a-z]+)>/g, (all, k) => best.groups[k] ?? all));
}

/**
 * Check ids of `maps` tagged with any of `services` (a Set or list) → string[]. A family row comes back as its pattern
 * (`GM-<game>-<scenario>`) when it is hit by a plain service, or narrowed to the blocked game (`GM-wordle-<scenario>`)
 * when only its `games.<game>` tag is hit by `games.wordle`.
 */
export function checksForServices(services, maps) {
  const want = new Set(services);
  const games = [...want].filter((s) => GAME.test(s) && s !== 'games.<game>').map((s) => s.slice('games.'.length));
  const out = [];
  for (const m of Array.isArray(maps) ? maps : [maps]) {
    for (const [id, list] of m) {
      if (list.some((s) => want.has(s))) { out.push(id); continue; }
      if (list.includes('games.<game>')) for (const g of games) out.push(id.replace(/<game>/g, g));
    }
  }
  return [...new Set(out)];
}

// ---------------------------------------------------------------------------------------------
// No-overlap lint (spec §5): Logic Check never measures layout/motion/a11y/perf; UI check never imports the Logic lib.

const AUDIT_CALL = /\baudit\s*\.\s*(layout|motion|a11y|perf)\s*\(/g;
const LOGIC_IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*)['"`]([^'"`]*logic-check\/lib\/[^'"`]*)['"`]/g;

/**
 * Overlap problems of one spec file's source → string[]. `checker`: 'logic' (an LC- spec must not call
 * audit.layout/motion/a11y/perf) or 'ui' (a G-/AC-/GM-/MP- spec must not import scripts/logic-check/lib).
 */
export function overlapErrors(src, { checker, file = 'spec' }) {
  const errs = [];
  const lineOf = (i) => String(src).slice(0, i).split('\n').length;
  if (checker === 'logic') {
    for (const m of String(src).matchAll(AUDIT_CALL)) errs.push(`${file}:${lineOf(m.index)} calls audit.${m[1]}() — Logic Check never asserts layout, motion, a11y or perf (spec §5)`);
  } else {
    for (const m of String(src).matchAll(LOGIC_IMPORT)) errs.push(`${file}:${lineOf(m.index)} imports ${m[1]} — UI check never uses the Logic Check lib (spec §5)`);
  }
  return errs;
}
