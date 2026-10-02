// Node test for src/utils/gameData.ts (the website's manifest-v3 loader), no dependencies:
//   npm run test:game-data      (node --experimental-strip-types; Node >= 22.6)
//
// Serves the publisher-made fixture shared with the multiplayer twin
// (multiplayer_server/scripts/fixtures/game-data-v3/) on a local HTTP server and checks:
// expand() rebuilds every game exactly, chunk economy, playoff side randomization (winner still
// right), localStorage caching by content-addressed path + pruning, a corrupt cache entry, the
// offline fallback to the persisted manifest, and that schema != 3 / no host throws (pool.ts then
// uses the bundled /data copy).
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { EXPECTED, MANIFEST, startServer, canonical, sameRows, swapped, makeChecker } =
  require("../multiplayer_server/scripts/fixtures/gameDataFixture.js");

const state = makeChecker();
const { check } = state;

// Minimal browser localStorage.
const store = new Map();
globalThis.localStorage = {
  get length() { return store.size; },
  key: (i) => [...store.keys()][i] ?? null,
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
};

const noSwap = () => 0.1;
let instance = 0;
/** A fresh module instance (module state = one page load) reading the current VITE_DATA_BASE. */
const load = () => import(`../src/utils/gameData.ts?i=${++instance}`);

const server = await startServer();
process.env.VITE_DATA_BASE = `${server.base}/`;
let gd = await load();

// 1. Lossless.
for (const game of ["playoff", "name-logo", "mvps", "starting-five", "fan-favorites"]) {
  const rows = await gd.fetchGameRows(game, undefined, noSwap);
  check(`${game}: expand(files) == builder rows (${EXPECTED[game].length})`, sameRows(rows, EXPECTED[game]), `${rows.length} rows`);
}
check("names: the manifest names file is the all-players list", canonical(await gd.fetchNames()) === canonical(EXPECTED["all-players"]));
check("POOL_GAMES is exactly the five pool games",
  canonical([...gd.POOL_GAMES].sort()) === canonical(["fan-favorites", "mvps", "name-logo", "playoff", "starting-five"]));

// 2. Round counts + one chunk per small round.
store.clear();
gd = await load();
server.log.length = 0;
const five = await gd.fetchGameRows("playoff", 5);
check("playoff: 5 rows from one chunk + the teams lookup",
  five.length === 5 && server.log.filter((p) => p.startsWith("playoff/c")).length === 1, server.log.join(", "));
server.log.length = 0;
const board = await gd.fetchGameRows("fan-favorites", 1);
check("fan-favorites: one board from one file",
  board.length === 1 && server.log.filter((p) => p.startsWith("fan-favorites/")).length === 1, server.log.join(", "));
check("starting-five: 1 row with the builder's fields",
  canonical(Object.keys((await gd.fetchGameRows("starting-five", 1))[0]).sort()) === canonical(Object.keys(EXPECTED["starting-five"][0]).sort()));

// 3. Side randomization.
const original = new Set(EXPECTED.playoff.map(canonical));
const flipped = new Set(EXPECTED.playoff.map((r) => canonical(swapped(r))));
let asPublished = 0, asSwapped = 0, winnerA = 0, winnerB = 0, bad = 0;
for (let i = 0; i < 80; i++) {
  for (const row of await gd.fetchGameRows("playoff", 5)) {
    const c = canonical(row);
    if (original.has(c)) asPublished++;
    else if (flipped.has(c)) asSwapped++;
    else bad++;
    if (row.winner === row.team_a) winnerA++;
    else if (row.winner === row.team_b) winnerB++;
    else bad++;
    const winnerWins = row.winner === row.team_a ? row.team_a_wins : row.team_b_wins;
    const loserWins = row.winner === row.team_a ? row.team_b_wins : row.team_a_wins;
    if (!(winnerWins > loserWins)) bad++;
  }
}
check("playoff: every row is a published row, as is or with ALL paired fields swapped", bad === 0, `${bad} bad`);
check("playoff: both orientations occur (sides re-randomized per round)", asPublished > 40 && asSwapped > 40, `published ${asPublished} / swapped ${asSwapped}`);
check("playoff: the winner shows up on both sides", winnerA > 40 && winnerB > 40, `team_a ${winnerA} / team_b ${winnerB}`);
const sample = { team_a: "A", team_a_logo: "a", team_a_wins: 4, team_a_abbreviation: "AAA", team_b: "B", team_b_logo: "b", team_b_wins: 1, team_b_abbreviation: "BBB", winner: "A" };
check("randomizeSides: swap keeps winner, keep leaves row",
  canonical(gd.randomizeSides(sample, () => 0.9)) === canonical(swapped(sample)) &&
    canonical(gd.randomizeSides(sample, () => 0.1)) === canonical(sample));
check("non-side games are not swapped", sameRows(await gd.fetchGameRows("starting-five", undefined, () => 0.9), EXPECTED["starting-five"]));

// 4. localStorage: files cached under their content-addressed path; a new page load reuses them.
const mvpsPath = MANIFEST.games.mvps.file;
await gd.fetchGameRows("mvps");
await gd.fetchGameRows("name-logo");
check("files cached in localStorage by path", store.has(`gamedata:f:${mvpsPath}`) && store.has("gamedata:manifest"));
gd = await load();
server.log.length = 0;
await gd.fetchGameRows("mvps", 5);
check("new page load: only the manifest is fetched, mvps comes from localStorage", canonical(server.log) === canonical(["manifest.json"]), server.log.join(", "));

// Corrupt entry -> dropped and refetched.
store.set(`gamedata:f:${mvpsPath}`, "{not json");
gd = await load();
server.log.length = 0;
const mvps = await gd.fetchGameRows("mvps");
check("corrupt cache entry is refetched", sameRows(mvps, EXPECTED.mvps) && server.log.includes(mvpsPath), server.log.join(", "));

// Prune: a publish that changes mvps drops the old mvps file from localStorage, keeps the rest.
const changedPath = mvpsPath.replace(/\.[0-9a-f]{12}\.json$/, ".0123456789ab.json");
server.overlay[changedPath] = EXPECTED.mvps.slice(0, 2);
server.overlay["manifest.json"] = { ...MANIFEST, version: "2026-10-02.2", games: { ...MANIFEST.games, mvps: { ...MANIFEST.games.mvps, rows: 2, file: changedPath } } };
gd = await load();
server.log.length = 0;
const changed = await gd.fetchGameRows("mvps");
await gd.fetchGameRows("name-logo");
check("one changed game: only its new file downloads", canonical(server.log) === canonical(["manifest.json", changedPath]), server.log.join(", "));
check("one changed game: new rows served, old file pruned, others kept",
  sameRows(changed, EXPECTED.mvps.slice(0, 2)) && !store.has(`gamedata:f:${mvpsPath}`) && store.has(`gamedata:f:${MANIFEST.games["name-logo"].file}`));
delete server.overlay["manifest.json"];

// 5. Fallbacks.
server.overlay["manifest.json"] = { schema: 2, version: "x", games: {} };
gd = await load();
check("schema != 3 throws (pool.ts falls back to /data)", (await gd.fetchGameRows("mvps", 5).catch((e) => e)) instanceof Error);
delete server.overlay["manifest.json"];

gd = await load();
await gd.fetchGameRows("name-logo", 5); // persists the current manifest + file
await server.close();
gd = await load();
const offline = await gd.fetchGameRows("name-logo", 5).catch((e) => e);
check("host down: the persisted manifest + cached files still serve the game", Array.isArray(offline) && offline.length === 5,
  offline instanceof Error ? offline.message : "");
for (const k of [...store.keys()]) if (k.startsWith("gamedata:f:fan-favorites/")) store.delete(k);
check("host down + file never cached: throws (pool.ts falls back to /data)",
  (await gd.fetchGameRows("fan-favorites", 1).catch((e) => e)) instanceof Error);
store.clear();
gd = await load();
check("host down + nothing cached: throws", (await gd.fetchGameRows("mvps", 5).catch((e) => e)) instanceof Error);
delete process.env.VITE_DATA_BASE;
gd = await load();
check("VITE_DATA_BASE unset: not configured, throws", !gd.isConfigured() && (await gd.fetchGameRows("mvps", 5).catch((e) => e)) instanceof Error);

console.log(state.failures === 0 ? "\nAll gameData.ts checks passed." : `\n${state.failures} check(s) failed.`);
process.exit(state.failures === 0 ? 0 : 1);
