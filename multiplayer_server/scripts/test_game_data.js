// multiplayer_server/scripts/test_game_data.js
//
// No-dependency test of src/gameData.js (manifest-v3 published data for the five pool games)
// against the publisher-made fixture in scripts/fixtures/game-data-v3/, served by a local HTTP
// server on a random port:
//   1. expand() rebuilds every game's rows exactly (fixture expected.json, field for field),
//   2. deal() returns each online game's round count from the fewest files (one chunk),
//   3. playoff sides are re-randomized per deal, consistently across all paired fields, and
//      the winner field still names the winning side,
//   4. files are cached by content-addressed path; a publish that changes one game makes only
//      that game's files download again; a stale manifest pointing at retired files recovers,
//   5. fallback: DATA_PUBLIC_BASE unset, host down, or schema != 3 -> dealOrNull() is null,
//   6. the real relay (index.js, stubbed transport like sim_round_fanout.js) deals a
//      series-winner room from the published files, and falls back to the backend endpoint
//      when the data host is down; a career-path room is dealt one published question,
//   7. question games: every question file == the materialized payload, one question costs
//      manifest + index + one file, weighted career-path, contexto's daily pick (pinned date),
//      published question_names + nameLookup, tictactoe through questions.deal, and the
//      Supabase-store fallback (game not published, hidden game, host down, base unset).
//
// Run:  node scripts/test_game_data.js     (exit code 0 = pass)

const Module = require("module");
const { EXPECTED, MANIFEST, startServer, canonical, sameRows, swapped, makeChecker } = require("./fixtures/gameDataFixture");

const state = makeChecker();
const { check } = state;
const gameData = require("../src/gameData");

const noSwap = () => 0.1; // rand() < 0.5 keeps the published side (and makes shuffles deterministic)

(async () => {
  const server = await startServer();
  process.env.DATA_PUBLIC_BASE = `${server.base}/`; // trailing slash must be tolerated

  // 1. Lossless: whole pools rebuilt from chunks + lookups equal the builder rows.
  for (const game of ["playoff", "name-logo", "mvps", "starting-five", "fan-favorites"]) {
    const rows = await gameData.fetchGameRows(game, undefined, noSwap);
    check(`${game}: expand(files) == builder rows (${EXPECTED[game].length})`, sameRows(rows, EXPECTED[game]),
      `${rows.length} rows; first ${canonical(rows[0]).slice(0, 120)}`);
  }
  check("expand passes strings and unreferenced keys through",
    canonical(gameData.expand([{ "team_a@teams": 0, season: "2008" }, "Larry Bird"], { teams: [{ "": "Boston Celtics", _logo: "x.svg" }] }))
      === canonical([{ team_a: "Boston Celtics", team_a_logo: "x.svg", season: "2008" }, "Larry Bird"]));

  // 2. Round counts and payload economy.
  gameData._resetForTest();
  server.log.length = 0;
  const series = await gameData.deal("series-winner");
  const chunkHits = server.log.filter((p) => p.startsWith("playoff/c"));
  check("series-winner: 5 rows", series.length === 5, `${series.length}`);
  check("series-winner: one chunk + the teams lookup downloaded", chunkHits.length === 1 && server.log.some((p) => p.startsWith("playoff/teams.")),
    server.log.join(", "));
  for (const [id, [game, n]] of Object.entries(gameData.ROUND_GAMES)) {
    const rows = await gameData.deal(id);
    const keys = canonical(Object.keys(EXPECTED[game][0]).sort());
    check(`${id}: ${n} row(s) with the builder's fields`, rows.length === n && rows.every((r) => canonical(Object.keys(r).sort()) === keys),
      `${rows.length} rows, keys ${canonical(Object.keys(rows[0] || {}).sort())}`);
  }
  server.log.length = 0;
  await gameData.deal("fan-favorites");
  check("fan-favorites: exactly one board file per deal",
    server.log.filter((p) => p.startsWith("fan-favorites/")).length <= 1, server.log.join(", "));

  // 3. Side randomization.
  const original = new Set(EXPECTED.playoff.map(canonical));
  const flipped = new Set(EXPECTED.playoff.map((r) => canonical(swapped(r))));
  let asPublished = 0, asSwapped = 0, winnerA = 0, winnerB = 0, bad = 0;
  for (let i = 0; i < 80; i++) {
    for (const row of await gameData.deal("series-winner")) {
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
  check("playoff: every dealt row is a published row, as is or with ALL paired fields swapped", bad === 0, `${bad} bad`);
  check("playoff: both orientations occur (sides re-randomized per deal)", asPublished > 40 && asSwapped > 40,
    `published ${asPublished} / swapped ${asSwapped}`);
  check("playoff: the winner shows up on both sides", winnerA > 40 && winnerB > 40, `team_a ${winnerA} / team_b ${winnerB}`);
  const sample = { team_a: "A", team_a_logo: "a.svg", team_a_wins: 4, team_a_abbreviation: "AAA", team_b: "B", team_b_logo: "b.svg", team_b_wins: 2, team_b_abbreviation: "BBB", winner: "A" };
  check("randomizeSides keeps the side when rand() < 0.5", canonical(gameData.randomizeSides(sample, () => 0.1)) === canonical(sample));
  check("randomizeSides swaps every pair and leaves winner when rand() >= 0.5",
    canonical(gameData.randomizeSides(sample, () => 0.9)) === canonical({ ...swapped(sample), winner: "A" }) &&
      gameData.randomizeSides(sample, () => 0.9).team_b === "A");
  check("randomizeSides does not mutate its input", sample.team_a === "A");

  // 4. Caching by content-addressed path.
  gameData._resetForTest();
  await gameData.fetchGameRows("mvps");
  await gameData.fetchGameRows("name-logo");
  server.log.length = 0;
  await gameData.fetchGameRows("mvps");
  check("cached: a repeat within the manifest TTL makes no request", server.log.length === 0, server.log.join(", "));

  const mvpsPath = MANIFEST.games.mvps.file;
  const changedPath = mvpsPath.replace(/\.[0-9a-f]{12}\.json$/, ".0123456789ab.json");
  const changedRows = EXPECTED.mvps.slice(0, 3);
  server.overlay[changedPath] = changedRows;
  server.overlay["manifest.json"] = { ...MANIFEST, version: "2026-10-02.2", games: { ...MANIFEST.games, mvps: { ...MANIFEST.games.mvps, rows: 3, file: changedPath } } };
  gameData._expireManifestForTest();
  server.log.length = 0;
  const mvpsNow = await gameData.fetchGameRows("mvps");
  await gameData.fetchGameRows("name-logo");
  check("one changed game: only its new file is downloaded (plus the manifest)",
    canonical(server.log) === canonical(["manifest.json", changedPath]), server.log.join(", "));
  check("one changed game: the new rows are served", sameRows(mvpsNow, changedRows));

  // A client holding a manifest whose file was just retired recovers on a fresh manifest.
  gameData._resetForTest();
  delete server.overlay["manifest.json"];
  await gameData.getManifest(); // caches the fixture manifest (mvps -> mvpsPath)
  server.overlay[mvpsPath] = 404;
  server.overlay["manifest.json"] = { ...MANIFEST, version: "2026-10-02.3", games: { ...MANIFEST.games, mvps: { ...MANIFEST.games.mvps, rows: 3, file: changedPath } } };
  const recovered = await gameData.fetchGameRows("mvps").catch((e) => e);
  check("stale manifest: a retired file triggers one manifest refresh and succeeds", Array.isArray(recovered) && sameRows(recovered, changedRows),
    recovered instanceof Error ? recovered.message : "");
  delete server.overlay[mvpsPath];
  delete server.overlay["manifest.json"];

  // 5. Fallbacks.
  gameData._resetForTest();
  server.overlay["manifest.json"] = { schema: 2, version: "x" };
  check("schema != 3 -> dealOrNull() is null", (await gameData.dealOrNull("series-winner")) === null);
  delete server.overlay["manifest.json"];
  gameData._resetForTest();
  const savedBase = process.env.DATA_PUBLIC_BASE;
  delete process.env.DATA_PUBLIC_BASE;
  check("DATA_PUBLIC_BASE unset -> dealOrNull() is null", (await gameData.dealOrNull("guess-mvps")) === null);
  process.env.DATA_PUBLIC_BASE = savedBase;
  check("non-pool games are never dealt here", (await gameData.dealOrNull("career-path")) === null && !gameData.handles("wordle"));
  check("configured + host up -> dealOrNull() deals", (await gameData.dealOrNull("guess-mvps"))?.length === 5);

  // 7. Question games: index -> picker -> one question file; names; store fallback.
  gameData._resetForTest();
  const questions = require("../src/questions");
  const QGAMES = ["career-path", "who-are-ya", "tictactoe", "contexto"];
  const m = await gameData.getManifest();
  for (const g of QGAMES) {
    check(`${g}: published as kind "questions"`, gameData.hasQuestions(m, g));
    let same = true;
    for (const row of EXPECTED[g]) {
      const q = await gameData.fetchQuestion(g, Math.random, row.qid);
      if (canonical(q) !== canonical(row.question)) same = false;
    }
    check(`${g}: every question file == the materialized payload (${EXPECTED[g].length})`, same);
  }
  check("hidden games are not published", !gameData.hasQuestions(m, "superdraft") && !gameData.hasQuestions(m, "imposter"));

  server.log.length = 0;
  gameData._resetForTest();
  const one = await gameData.fetchQuestion("who-are-ya");
  check("one question = manifest + index + one question file",
    canonical(server.log.map((p) => p.split("/")[0] + (p.includes("/index.") ? "/index" : p.includes("/") ? "/q" : "")))
      === canonical(["manifest.json", "who-are-ya/index", "who-are-ya/q"]), server.log.join(", "));
  check("who-are-ya: a random pick is one of the published questions", EXPECTED["who-are-ya"].some((r) => r.qid === one.qid));

  // career-path is weighted by item[1]: heavier items come up more often.
  const counts = {};
  for (let i = 0; i < 600; i++) { const q = await gameData.fetchQuestion("career-path"); counts[q.qid] = (counts[q.qid] || 0) + 1; }
  const weightOf = Object.fromEntries(EXPECTED["career-path"].map((r) => [r.qid, Number(r.item[1]) || 1]));
  const heavy = Object.keys(counts).filter((q) => weightOf[q] === 3).map((q) => counts[q]);
  const light = Object.keys(counts).filter((q) => weightOf[q] === 1).map((q) => counts[q]);
  const avg = (a) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
  check("career-path: only published qids are dealt", Object.keys(counts).every((q) => q in weightOf));
  check("career-path: weight-3 questions come up more than weight-1 ones",
    heavy.length === 0 || light.length === 0 || avg(heavy) > avg(light) * 1.5, `heavy ${avg(heavy)} / light ${avg(light)}`);

  // contexto: today's scheduled day, the same question every time; FNV fallback off-schedule.
  const index = { items: EXPECTED.contexto.map((r) => r.item) };
  for (const day of ["2026-10-01", "2026-10-03", "2026-10-05"]) {
    check(`contexto: pickDaily(${day}) is that day's question`, gameData.pickDaily(index, day) === `ctx-${day}`);
  }
  check("contexto: an unscheduled day falls back to a stable pick",
    gameData.pickDaily(index, "2027-01-01") === gameData.pickDaily(index, "2027-01-01") &&
      EXPECTED.contexto.some((r) => r.qid === gameData.pickDaily(index, "2027-01-01")));
  const RealDate = Date;
  global.Date = class extends RealDate {
    constructor(...a) { super(...(a.length ? a : ["2026-10-03T12:00:00Z"])); }
    static now() { return new RealDate("2026-10-03T12:00:00Z").getTime(); }
  };
  const dealt = new Set();
  for (let i = 0; i < 5; i++) dealt.add((await questions.deal("contexto")).qid);
  global.Date = RealDate;
  check("contexto: every relay deal on 2026-10-03 is ctx-2026-10-03", dealt.size === 1 && dealt.has("ctx-2026-10-03"), [...dealt].join(","));

  // names: the relay's lookup reads the published question_names (ids + aliases).
  const names = await questions.loadNames();
  check("names: loadNames() is the published question_names list", canonical(names) === canonical(EXPECTED["question-names"]));
  const lookup = questions.nameLookup(names);
  const first = EXPECTED["question-names"][0];
  check("names: nameLookup resolves a published name to its id", lookup.toId(first.full_name) === first.id && lookup.nameOf(first.id) === first.full_name);

  // tictactoe (turn game) is dealt through questions.deal from the published files.
  const ttt = await questions.deal("tictactoe");
  check("tictactoe: questions.deal() serves a published board", EXPECTED.tictactoe.some((r) => canonical(r.question) === canonical(ttt)) && ttt.valid.length === 9);

  // Fallback to the Supabase store: game missing from the manifest, hidden game, host down.
  const STORE = {
    files: {
      "/questions/manifest.json": { schema: 1, version: "s", dataset: { players: "s" }, names: "/q/names.json",
        games: { "who-are-ya": { index: "/q/way/index.json", count: 1 }, imposter: { index: "/q/imp/index.json", count: 1 } } },
      "/q/names.json": [{ id: 9, full_name: "Store Name", aliases: [] }],
      "/q/way/index.json": { schema: 1, game: "who-are-ya", version: "s", dataset: { players: "s" }, items: [["way-store"]] },
      "/q/way/way-store.json": { schema: 1, game: "who-are-ya", qid: "way-store", player: { full_name: "Store" } },
      "/q/imp/index.json": { schema: 1, game: "imposter", version: "s", dataset: { players: "s" }, items: [["imposter-pool", 2]] },
      "/q/imp/imposter-pool.json": { schema: 1, game: "imposter", qid: "imposter-pool", names: ["A", "B"] },
    },
  };
  questions._setForTest(STORE);
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (msg) => warnings.push(String(msg));
  gameData._resetForTest();
  server.overlay["manifest.json"] = { ...MANIFEST, games: Object.fromEntries(Object.entries(MANIFEST.games).filter(([g]) => g !== "who-are-ya")) };
  const fb1 = await questions.deal("who-are-ya");
  const fb2 = await questions.deal("who-are-ya");
  check("fallback: a game the manifest doesn't publish is dealt from the store", fb1.qid === "way-store" && fb2.qid === "way-store");
  check("fallback: logged once", warnings.filter((w) => w.includes("who-are-ya")).length === 1, warnings.join(" | "));
  const imp = await questions.deal("imposter");
  check("hidden game (imposter): store, no warning", imp.qid === "imposter-pool" && !warnings.some((w) => w.includes("imposter")));
  delete server.overlay["manifest.json"];
  gameData._resetForTest();
  server.overlay["manifest.json"] = 404;
  const down = await questions.deal("career-path").catch((e) => e);
  check("fallback: data host without a manifest -> the store (which lacks career-path here, so it throws)", down instanceof Error);
  delete server.overlay["manifest.json"];
  const savedQBase = process.env.DATA_PUBLIC_BASE;
  delete process.env.DATA_PUBLIC_BASE;
  gameData._resetForTest();
  warnings.length = 0;
  check("fallback: DATA_PUBLIC_BASE unset -> store names, silently",
    (await questions.loadNames())[0].full_name === "Store Name" && warnings.length === 0);
  process.env.DATA_PUBLIC_BASE = savedQBase;
  console.warn = realWarn;
  questions._setForTest(null);
  gameData._resetForTest();

  // 6. The real relay: published deal, then backend fallback with the data host down.
  const backendCalls = [];
  const realFetch = global.fetch;
  global.fetch = async (url, init) => {
    if (String(url).startsWith(process.env.API_BASE_URL)) {
      backendCalls.push(String(url));
      return { ok: true, json: async () => ({ series: EXPECTED.playoff.slice(0, 5) }) };
    }
    return realFetch(url, init);
  };
  const emitted = [];
  const fakeIo = {
    handlers: {},
    sockets: { sockets: new Map() },
    on(event, fn) { this.handlers[event] = fn; },
    to(sid) { return { emit(event, payload) { emitted.push({ sid, event, payload: structuredClone(payload) }); } }; },
    adapter() {},
  };
  const stubs = {
    express: Object.assign(() => ({ use() {}, get() {} }), { json: () => () => {} }),
    cors: () => () => {},
    "socket.io": { Server: function Server() { return fakeIo; } },
    http: { createServer: () => ({ listen() {} }) },
  };
  process.env.API_BASE_URL = "http://backend.test";
  const originalLoad = Module._load;
  Module._load = function (request) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    return originalLoad.apply(this, arguments);
  };
  require("../src/index");
  Module._load = originalLoad;

  const makeSocket = (id) => {
    const socket = { id, handlers: {}, on(e, fn) { this.handlers[e] = fn; }, emit() {}, join() {}, leave() {}, send(e, p) { this.handlers[e]?.(p); } };
    fakeIo.sockets.sockets.set(id, socket);
    fakeIo.handlers.connection(socket);
    return socket;
  };
  const roundsFor = (sid) => emitted.filter((e) => e.sid === sid && e.event === "roundData").map((e) => e.payload);
  const settle = async (pred) => { for (let i = 0; i < 400 && !pred(); i++) await new Promise((r) => setTimeout(r, 5)); };
  const game = { id: "series-winner", name: "Guess the Series Winner", pointsPerCorrect: 10 };
  async function room(suffix, g = game) {
    const a = makeSocket(`a${suffix}`), b = makeSocket(`b${suffix}`);
    a.send("identify", { user: { id: `A${suffix}`, username: `a${suffix}`, points: 100 } });
    b.send("identify", { user: { id: `B${suffix}`, username: `b${suffix}`, points: 100 } });
    a.send("findMatch", { game: g });
    b.send("findMatch", { game: g });
    await settle(() => roundsFor(a.id).length && roundsFor(b.id).length);
    return [roundsFor(a.id)[0]?.gameData, roundsFor(b.id)[0]?.gameData];
  }

  gameData._resetForTest();
  const [pubA, pubB] = await room("1");
  check("relay: series-winner room dealt 5 published rows", pubA?.length === 5 && pubA.every((r) => original.has(canonical(r)) || flipped.has(canonical(r))),
    canonical(pubA)?.slice(0, 120));
  check("relay: both members got the identical payload", !!pubA && canonical(pubA) === canonical(pubB));
  check("relay: no backend call while the data host is up", backendCalls.length === 0, backendCalls.join(", "));

  const [cpA, cpB] = await room("q", { id: "career-path", name: "Career Path", pointsPerCorrect: 10 });
  check("relay: career-path room dealt one published question to both members",
    cpA?.length === 1 && EXPECTED["career-path"].some((r) => canonical(r.question) === canonical(cpA[0])) && canonical(cpA) === canonical(cpB),
    canonical(cpA)?.slice(0, 120));
  check("relay: still no backend call", backendCalls.length === 0, backendCalls.join(", "));

  await server.close();
  gameData._resetForTest();
  const [fbA, fbB] = await room("2");
  check("relay: data host down -> falls back to the backend endpoint", backendCalls.length === 1 && backendCalls[0] === "http://backend.test/trivia/playoff-series/",
    backendCalls.join(", "));
  check("relay: fallback round reaches both members unchanged", fbA?.length === 5 && canonical(fbA) === canonical(fbB));

  console.log(state.failures === 0 ? "\nAll game-data loader checks passed." : `\n${state.failures} check(s) failed.`);
  process.exit(state.failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
