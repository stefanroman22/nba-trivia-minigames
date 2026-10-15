// Node test for src/utils/seenCore.ts (seen tracking, browser side: no repeats until the pool is exhausted):
//   npm run check:seen      (also run by `npm run lint`, so CI covers it on Node 20)
//
// seenCore.ts has no imports, so it is transpiled here with the project's own TypeScript (no
// --experimental-strip-types, which Node 20 lacks) and imported from a data: URL; every load() is a
// fresh module instance, i.e. a fresh page load. Covers: unseen preferred, reset when exhausted,
// prune drops ids no longer in the pool, localStorage unavailable -> in-memory set, the server merge
// (once per game per load, a reset's ignore list), batching, and that a game start never waits more
// than 1.5 s on a hanging server fetch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../src/utils/seenCore.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
let instance = 0;
const load = () =>
  import(`data:text/javascript;base64,${Buffer.from(`${outputText}\n// load ${++instance}\n`).toString("base64")}`);

// Minimal browser localStorage.
const store = new Map();
const memoryStorage = {
  get length() { return store.size; },
  key: (i) => [...store.keys()][i] ?? null,
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
};
const blocked = () => { throw new Error("SecurityError: storage is disabled"); };
const throwingStorage = { get length() { return blocked(); }, key: blocked, getItem: blocked, setItem: blocked, removeItem: blocked, clear: blocked };
const useStorage = (s) => { globalThis.localStorage = s; };

const ids = (n, p = "q") => Array.from({ length: n }, (_, i) => `${p}${i + 1}`);
const rows = (list) => list.map((id) => ({ id }));
const idOf = (r) => r.id;

test("sampleUnseen prefers unseen items", async () => {
  useStorage(memoryStorage); store.clear();
  const { sampleUnseen } = await load();
  const pool = rows(ids(10));
  const seen = new Set(ids(5)); // q1..q5 seen
  for (let i = 0; i < 50; i++) {
    const picked = sampleUnseen(pool, 5, idOf, seen).map(idOf).sort();
    assert.deepEqual(picked, ["q10", "q6", "q7", "q8", "q9"]);
  }
});

test("sampleUnseen takes all unseen, then fills from the rest", async () => {
  const { sampleUnseen } = await load();
  const pool = rows(ids(10));
  const seen = new Set(ids(8)); // only q9, q10 unseen
  const picked = sampleUnseen(pool, 5, idOf, seen).map(idOf);
  assert.equal(picked.length, 5);
  assert.equal(new Set(picked).size, 5);
  assert.ok(picked.includes("q9") && picked.includes("q10"));
  assert.equal(sampleUnseen(rows(ids(3)), 5, idOf, new Set()).length, 3, "a pool smaller than n is dealt whole");
});

test("dealUnseen: no repeats until the pool is exhausted, then the set resets to what was dealt", async () => {
  useStorage(memoryStorage); store.clear();
  const { dealUnseen, loadSeen } = await load();
  const pool = rows(ids(30)); // Name the Logo: 30 teams, 5 a game
  const dealt = [];
  for (let g = 0; g < 6; g++) dealt.push(...dealUnseen("name-logo", pool, 5, idOf).map(idOf));
  assert.equal(new Set(dealt).size, 30, "six games of five cover all thirty with no repeat");
  assert.equal(loadSeen("name-logo").size, 30);
  const seventh = dealUnseen("name-logo", pool, 5, idOf).map(idOf);
  assert.equal(seventh.length, 5);
  assert.deepEqual([...loadSeen("name-logo")].sort(), [...seventh].sort(), "after a reset the set holds only the deal");
  const eighth = dealUnseen("name-logo", pool, 5, idOf).map(idOf);
  assert.ok(eighth.every((id) => !seventh.includes(id)), "and the next game avoids it again");
});

test("dealUnseen with fewer than n unseen: takes every unseen one, then resets", async () => {
  useStorage(memoryStorage); store.clear();
  const { dealUnseen, markSeen, loadSeen } = await load();
  const pool = rows(ids(6));
  markSeen("guess-mvps", ids(4)); // q5, q6 unseen
  const picked = dealUnseen("guess-mvps", pool, 5, idOf).map(idOf);
  assert.ok(picked.includes("q5") && picked.includes("q6"));
  assert.deepEqual([...loadSeen("guess-mvps")].sort(), [...picked].sort());
});

test("seen sets are per game and persist across page loads", async () => {
  useStorage(memoryStorage); store.clear();
  let core = await load();
  core.markSeen("name-logo", ["1610612737"]);
  core = await load();
  assert.deepEqual([...core.loadSeen("name-logo")], ["1610612737"]);
  assert.equal(core.loadSeen("guess-mvps").size, 0);
  assert.ok(store.has("seen:name-logo"));
});

test("pruneSeen drops ids no longer in the pool", async () => {
  useStorage(memoryStorage); store.clear();
  let core = await load();
  core.markSeen("starting-five", ["a", "b", "retired"]);
  core.pruneSeen("starting-five", ["a", "b", "c"]);
  assert.deepEqual([...core.loadSeen("starting-five")].sort(), ["a", "b"]);
  core = await load();
  assert.deepEqual([...core.loadSeen("starting-five")].sort(), ["a", "b"], "pruned in storage too");
  // dealUnseen prunes when it holds the whole pool, so a retired question doesn't count as seen.
  core.markSeen("starting-five", ["gone"]);
  core.dealUnseen("starting-five", rows(["a", "b", "c", "d"]), 1, idOf);
  assert.ok(!core.loadSeen("starting-five").has("gone"));
});

test("unseenOrAll: a picker game deals from the unseen items, the whole index once exhausted", async () => {
  useStorage(memoryStorage); store.clear();
  const { unseenOrAll, markSeen, loadSeen } = await load();
  const items = [["cp-1", 1], ["cp-2", 3], ["cp-3", 1]];
  const qidOf = (it) => String(it[0]);
  markSeen("career-path", ["cp-1", "cp-3", "cp-old"]);
  assert.deepEqual(unseenOrAll("career-path", items, qidOf).map(qidOf), ["cp-2"]);
  assert.ok(!loadSeen("career-path").has("cp-old"), "pruned to the index");
  markSeen("career-path", ["cp-2"]);
  assert.deepEqual(unseenOrAll("career-path", items, qidOf).map(qidOf), ["cp-1", "cp-2", "cp-3"]);
  assert.equal(loadSeen("career-path").size, 0, "reset");
});

test("localStorage unavailable: the seen set lives in memory for the session", async () => {
  useStorage(throwingStorage);
  try {
    const { dealUnseen, markSeen, loadSeen } = await load();
    markSeen("name-logo", ["x"]);
    assert.deepEqual([...loadSeen("name-logo")], ["x"]);
    const pool = rows(ids(10));
    const first = dealUnseen("name-logo", pool, 5, idOf).map(idOf);
    const second = dealUnseen("name-logo", pool, 5, idOf).map(idOf);
    assert.ok(second.every((id) => !first.includes(id)), "no repeats without storage");
  } finally {
    useStorage(memoryStorage);
  }
  delete globalThis.localStorage; // no localStorage at all (SSR-like): still no throw
  try {
    const { markSeen, loadSeen } = await load();
    markSeen("name-logo", ["y"]);
    assert.deepEqual([...loadSeen("name-logo")], ["y"]);
  } finally {
    useStorage(memoryStorage);
  }
});

test("pending ids are taken once, in batches, and can be put back", async () => {
  useStorage(memoryStorage); store.clear();
  const { markSeen, takePending, requeueSeen, pendingGames, SEEN_BATCH } = await load();
  assert.equal(SEEN_BATCH, 200);
  markSeen("name-logo", ["1", "2"]);
  markSeen("name-logo", ["2", "3"]);
  assert.deepEqual(pendingGames(), ["name-logo"]);
  assert.deepEqual(takePending("name-logo"), ["1", "2", "3"]);
  assert.deepEqual(takePending("name-logo"), [], "taken once");
  requeueSeen("name-logo", ["2"]);
  assert.deepEqual(takePending("name-logo"), ["2"]);
});

test("a game start never waits more than 1.5 s on a hanging server fetch", async () => {
  useStorage(memoryStorage); store.clear();
  const { syncSeen, loadSeen, SEEN_SYNC_TIMEOUT_MS } = await load();
  assert.equal(SEEN_SYNC_TIMEOUT_MS, 1500);
  let calls = 0;
  let answer;
  const hanging = () => { calls++; return new Promise((resolve) => { answer = resolve; }); };
  const t0 = performance.now();
  await syncSeen("name-logo", hanging);
  const waited = performance.now() - t0;
  console.log(`  hanging fetch: game start waited ${Math.round(waited)} ms`);
  assert.ok(waited < 1600, `waited ${waited} ms`);
  assert.ok(waited >= 1400, `timed out early: ${waited} ms`);
  assert.equal(loadSeen("name-logo").size, 0, "browser set alone");
  // The fetch finishes in the background and is merged for the next game.
  answer(["7", "8"]);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual([...loadSeen("name-logo")].sort(), ["7", "8"]);
  await syncSeen("name-logo", hanging);
  assert.equal(calls, 1, "one GET per game per page load");
});

test("a failed server fetch is ignored and retried at the next game start", async () => {
  useStorage(memoryStorage); store.clear();
  const { syncSeen, loadSeen } = await load();
  let calls = 0;
  const t0 = performance.now();
  await syncSeen("guess-mvps", () => { calls++; return Promise.reject(new Error("offline")); });
  assert.ok(performance.now() - t0 < 100, "a failure does not wait for the timeout");
  await syncSeen("guess-mvps", () => { calls++; return Promise.resolve(["1999-00"]); });
  assert.equal(calls, 2);
  assert.deepEqual([...loadSeen("guess-mvps")], ["1999-00"]);
});

test("after a reset, the server's older ids are ignored on later page loads", async () => {
  useStorage(memoryStorage); store.clear();
  const pool = rows(ids(10));
  let core = await load();
  let server = [];
  const get = () => Promise.resolve([...server]);
  await core.syncSeen("series-winner", get);
  const dealt = [];
  dealt.push(...core.dealUnseen("series-winner", pool, 5, idOf).map(idOf));
  dealt.push(...core.dealUnseen("series-winner", pool, 5, idOf).map(idOf));
  server = [...core.takePending("series-winner")]; // flushed at game end
  assert.equal(server.length, 10);
  const afterReset = core.dealUnseen("series-winner", pool, 5, idOf).map(idOf); // exhausted -> reset
  server = [...new Set([...server, ...core.takePending("series-winner")])];
  // Next page load: the server still lists all ten, but they predate the reset.
  core = await load();
  await core.syncSeen("series-winner", get);
  assert.deepEqual([...core.loadSeen("series-winner")].sort(), [...afterReset].sort());
  const next = core.dealUnseen("series-winner", pool, 5, idOf).map(idOf);
  assert.ok(next.every((id) => !afterReset.includes(id)), "no repeat of the post-reset deal");
  // A question new to the pool that another device saw after the reset is still merged.
  server.push("q11");
  core = await load();
  await core.syncSeen("series-winner", get);
  assert.ok(core.loadSeen("series-winner").has("q11"));
});

test("a reset before the server answered: the late answer does not bring the old ids back", async () => {
  useStorage(memoryStorage); store.clear();
  const pool = rows(ids(4));
  let core = await load();
  core.markSeen("who-would-win", ids(4));
  let answer;
  await Promise.race([core.syncSeen("who-would-win", () => new Promise((r) => { answer = r; })), Promise.resolve()]);
  const dealt = core.dealUnseen("who-would-win", pool, 2, idOf).map(idOf); // reset (0 unseen)
  answer(ids(4));
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual([...core.loadSeen("who-would-win")].sort(), [...dealt].sort(), "late answer not merged after the reset");
  core = await load();
  await core.syncSeen("who-would-win", () => Promise.resolve(ids(4)));
  assert.deepEqual([...core.loadSeen("who-would-win")].sort(), [...dealt].sort(), "nor on the next page load");
});
