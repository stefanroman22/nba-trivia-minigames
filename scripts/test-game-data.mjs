// Node test for src/utils/gameData.ts (the website's manifest-v3 loader), no dependencies:
//   npm run test:game-data      (node --experimental-strip-types; Node >= 22.6)
//
// Serves the publisher-made fixture shared with the multiplayer twin
// (multiplayer_server/scripts/fixtures/game-data-v3/) on a local HTTP server and checks:
// expand() rebuilds every game exactly, chunk economy, playoff side randomization (winner still
// right), localStorage caching by content-addressed path + pruning, a corrupt cache entry, the
// offline fallback to the persisted manifest, and that schema != 3 / no host throws (pool.ts then
// uses the bundled /data copy). Then the question games through src/utils/questions.ts: every
// published question == the materialized payload, picks (weighted, daily contexto agreeing with
// the relay's twin on every day), published question_names, and the Supabase-store fallback.
import { createRequire, register } from "node:module";

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

// 6. Question games through src/utils/questions.ts (v3 first, Supabase store fallback).
// questions.ts imports "./gameData" / "./answerMatch" without extensions (bundler style): a tiny
// resolve hook adds ".ts" and carries this file's ?i=<n> to them, so each load is a fresh page.
register("data:text/javascript," + encodeURIComponent(`
  export async function resolve(spec, ctx, next) {
    if (/^\\.\\.?\\//.test(spec) && !/\\.[cm]?[jt]s$/.test(spec.split("?")[0]) && ctx.parentURL?.includes("/src/")) {
      const q = ctx.parentURL.includes("?") ? ctx.parentURL.slice(ctx.parentURL.indexOf("?")) : "";
      return next(spec + ".ts" + q, ctx);
    }
    return next(spec, ctx);
  }`));
const { RealDate, pinDate } = (() => {
  const Real = Date;
  return {
    RealDate: Real,
    pinDate: (iso) => {
      globalThis.Date = class extends Real {
        constructor(...a) { super(...(a.length ? a : [iso])); }
        static now() { return new Real(iso).getTime(); }
      };
    },
  };
})();
const relay = require("../multiplayer_server/src/gameData.js");
const QGAMES = ["career-path", "who-are-ya", "tictactoe", "contexto"];
const qserver = await startServer();
process.env.VITE_DATA_BASE = qserver.base;
process.env.DATA_PUBLIC_BASE = qserver.base;
// The old store, served by the same test server under /store/ (VITE_QUESTIONS_BASE).
const STORE_INDEX = { schema: 1, game: "who-are-ya", version: "s", dataset: { players: "s" }, items: [["way-store"]] };
Object.assign(qserver.overlay, {
  "store/questions/manifest.json": { schema: 1, version: "s", dataset: { players: "s" }, names: `${qserver.base}/store/names.json`,
    games: { "who-are-ya": { index: `${qserver.base}/store/way/index.json`, count: 1 }, superdraft: { index: `${qserver.base}/store/sd/index.json`, count: 1 } } },
  "store/names.json": [{ id: 9, full_name: "Store Name", aliases: [] }],
  "store/way/index.json": STORE_INDEX,
  "store/way/way-store.json": { schema: 1, game: "who-are-ya", qid: "way-store", player: { full_name: "Store" } },
  "store/sd/index.json": { schema: 1, game: "superdraft", version: "s", dataset: { players: "s" }, items: [["sd-1"]] },
  "store/sd/sd-1.json": { schema: 1, game: "superdraft", qid: "sd-1", slots: [] },
});
process.env.VITE_QUESTIONS_BASE = `${qserver.base}/store`;
const loadQ = () => import(`../src/utils/questions.ts?i=${++instance}`);
store.clear();
let qs = await loadQ();

for (const g of QGAMES) {
  const res = await qs.fetchQuestion(g);
  const ok = res.success && EXPECTED[g].some((r) => canonical(r.question) === canonical(res.data[0]));
  check(`${g}: fetchQuestion() serves a published question in the { success, data: [q] } shape`, ok, JSON.stringify(res).slice(0, 120));
}
gd = await load();
let allSame = true;
for (const g of QGAMES) for (const r of EXPECTED[g]) if (canonical(await gd.fetchQuestion(g, Math.random, r.qid)) !== canonical(r.question)) allSame = false;
check("every published question file == the materialized payload", allSame);
const idx = await gd.fetchQuestionIndex("career-path");
check("fetchQuestionIndex: the snapshot index shape (version = manifest version)",
  idx.version === MANIFEST.version && canonical(idx.items) === canonical(EXPECTED["career-path"].map((r) => r.item)) && idx.dataset.players === EXPECTED["career-path"][0].dataset);
check("names: loadNames() is the published question_names list", canonical(await qs.loadNames()) === canonical(EXPECTED["question-names"]));
check("names: buildNameLookup works on them", (() => {
  const n = EXPECTED["question-names"][0];
  return qs.buildNameLookup(EXPECTED["question-names"]).toId(n.full_name) === n.id;
})());

// Weighted / random picks are the same functions as before (re-exported from gameData.ts).
const weighted = { items: [["a", 1], ["b", 3]] };
check("pickWeighted honours weights", qs.pickWeighted(weighted, () => 0.2) === "a" && qs.pickWeighted(weighted, () => 0.3) === "b");
check("pickRandom picks by index", qs.pickRandom({ items: [["x"], ["y"]] }, () => 0.9) === "y");

// contexto: the site and the relay pick the same question for every day, scheduled or not.
const cindex = { items: EXPECTED.contexto.map((r) => r.item) };
let agree = true;
for (let d = new RealDate("2026-09-20T00:00:00Z"); d < new RealDate("2026-11-10T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1)) {
  const day = d.toISOString().slice(0, 10);
  if (gd.pickDaily(cindex, day) !== relay.pickDaily(cindex, day)) agree = false;
  if (EXPECTED.contexto.some((r) => r.item[1] === day) && gd.pickDaily(cindex, day) !== `ctx-${day}`) agree = false;
}
check("contexto: site and relay pickDaily agree on every day (scheduled day = that day's question)", agree);
pinDate("2026-10-04T08:00:00Z");
const siteToday = await qs.fetchQuestion("contexto");
relay._resetForTest();
const relayToday = await relay.fetchQuestion("contexto");
globalThis.Date = RealDate;
check("contexto: on 2026-10-04 the site and the relay both serve ctx-2026-10-04",
  siteToday.data?.[0]?.qid === "ctx-2026-10-04" && relayToday.qid === "ctx-2026-10-04", `${siteToday.data?.[0]?.qid} / ${relayToday.qid}`);

// One question = the index (cached after) + one file; a second play costs one file at most.
store.clear();
gd = await load();
qserver.log.length = 0;
await gd.fetchQuestion("tictactoe");
check("tictactoe: manifest + index + one question file", qserver.log.length === 3 && qserver.log.some((p) => p.startsWith("tictactoe/index.")), qserver.log.join(", "));
check("question files cached in localStorage by path", [...store.keys()].some((k) => k.startsWith("gamedata:f:tictactoe/ttt-")));

// Fallbacks to the Supabase store.
const warnings = [];
const realWarn = console.warn;
console.warn = (msg) => warnings.push(String(msg));
qserver.overlay["manifest.json"] = { ...MANIFEST, games: Object.fromEntries(Object.entries(MANIFEST.games).filter(([g]) => g !== "who-are-ya")) };
store.clear();
qs = await loadQ();
const f1 = await qs.fetchQuestion("who-are-ya");
const f2 = await qs.fetchQuestion("who-are-ya");
check("fallback: a game the v3 manifest doesn't publish comes from the store", f1.data?.[0]?.qid === "way-store" && f2.data?.[0]?.qid === "way-store");
check("fallback: logged once", warnings.filter((w) => w.includes("who-are-ya")).length === 1, warnings.join(" | "));
const sd = await qs.fetchQuestion("superdraft");
check("hidden game (superdraft): store, no warning", sd.data?.[0]?.qid === "sd-1" && !warnings.some((w) => w.includes("superdraft")));
qserver.overlay["manifest.json"] = { ...MANIFEST, question_names: undefined };
qs = await loadQ();
check("fallback: no question_names published -> store names", (await qs.loadNames())[0].full_name === "Store Name");
qserver.overlay["manifest.json"] = 404;
store.clear();
qs = await loadQ();
const fdown = await qs.fetchQuestion("who-are-ya");
check("fallback: data host has no manifest -> the store", fdown.data?.[0]?.qid === "way-store");
delete qserver.overlay["manifest.json"];
delete process.env.VITE_DATA_BASE;
warnings.length = 0;
qs = await loadQ();
const funset = await qs.fetchQuestion("who-are-ya");
check("fallback: VITE_DATA_BASE unset -> the store, silently", funset.data?.[0]?.qid === "way-store" && warnings.length === 0, warnings.join(" | "));
console.warn = realWarn;
await qserver.close();

console.log(state.failures === 0 ? "\nAll gameData.ts checks passed." : `\n${state.failures} check(s) failed.`);
process.exit(state.failures === 0 ? 0 : 1);
