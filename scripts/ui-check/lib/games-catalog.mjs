// The game catalogue, parsed from src/utils/GameUtils.tsx at run time (no TS import): the single source of
// truth for which games are visible, which are hidden (must 404), and which have an online mode.
//   visibleGames() → [{ id, path, name, online, data }]   non-hidden entries, in catalogue order (incl. coming-soon)
//   hiddenGames()  → [{ id, path, name, online, data }]   entries flagged `hidden: true`
// `data`: how the entry loads its data, from its `fetchData: () => fn("key", n)` line (or `(opts) => …`) → { fn, key } (key null when the
// call has no string argument), or null when the entry has no fetchData (Logic Check's LC-LIVE-03 probes each source).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { appRepo } from './stack.mjs';

// The app under test's catalogue (a checkout of main may list other games than the harness checkout).
const GAME_UTILS = path.join(appRepo(), 'src', 'utils', 'GameUtils.tsx');
const ROOM_SIZES = path.join(appRepo(), 'src', 'utils', 'roomSizes.ts');

let cache = null;

function notOnline() {
  const src = readFileSync(ROOM_SIZES, 'utf8');
  const m = /NOT_ONLINE\s*=\s*new Set\(\[([^\]]*)\]/.exec(src);
  return new Set(m ? [...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]) : []);
}

function parse() {
  if (cache) return cache;
  const src = readFileSync(GAME_UTILS, 'utf8');
  const off = notOnline();
  const all = [];
  // A catalogue entry opens with `  {` + `    id: "…"` at those indents and closes with `  },` at two spaces.
  for (const m of src.matchAll(/^ {2}\{\r?\n {4}id: "([^"]+)"([\s\S]*?)\r?\n {2}\},?\r?$/gm)) {
    const body = m[2];
    const name = /\n {4}name: "([^"]*)"/.exec(body);
    const url = /\n {4}urlPath: "([^"]+)"/.exec(body);
    if (!name || !url) throw new Error(`games-catalog: cannot read name/urlPath of game "${m[1]}" in GameUtils.tsx`);
    const fd = /\n {4}fetchData: \(\w*\) => (\w+)\(\s*(?:"([^"]*)")?/.exec(body);
    const data = fd ? { fn: fd[1], key: fd[2] ?? null } : null;
    all.push({ id: m[1], path: url[1], name: name[1], online: !off.has(m[1]), hidden: /\bhidden:\s*true\b/.test(body), data });
  }
  if (all.length < 10) throw new Error(`games-catalog: parsed only ${all.length} games from GameUtils.tsx, the file layout changed`);
  cache = all;
  return all;
}

const strip = ({ hidden, ...g }) => g;
export const visibleGames = () => parse().filter((g) => !g.hidden).map(strip);
export const hiddenGames = () => parse().filter((g) => g.hidden).map(strip);
