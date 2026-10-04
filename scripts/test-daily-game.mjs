// Node test for src/utils/dailyGame.ts ("Play today's game" pick), no dependencies:
//   npm run test:daily-game      (node --experimental-strip-types; Node >= 22.6)
// Run it under different machine time zones: TZ=UTC and TZ=Asia/Tokyo must both pass.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DAILY_EXCLUDED_IDS, dailyGameId, parisDateKey } from "../src/utils/dailyGame.ts";

const GAMES = [
  "series-winner", "name-logo", "guess-mvps", "starting-five", "wordle", "fan-favorites",
  "career-path", "who-are-ya", "tictactoe", "contexto", "who-would-win", "coming-soon",
].map((id) => ({ id }));
const ELIGIBLE = GAMES.filter((g) => !DAILY_EXCLUDED_IDS.includes(g.id)).map((g) => g.id);
const at = (iso) => new Date(iso);

test("same date gives the same game", () => {
  const a = dailyGameId(GAMES, at("2026-10-04T00:00:01+02:00"));
  const b = dailyGameId(GAMES, at("2026-10-04T23:59:59+02:00"));
  assert.equal(a, b);
  assert.equal(a, dailyGameId(GAMES, at("2026-10-04T12:00:00Z")));
});

const nextKey = (key) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
};

test("3650 consecutive Paris dates never repeat back to back", () => {
  let key = "2026-10-04";
  let prev = null;
  for (let i = 0; i < 3650; i++) {
    const id = dailyGameId(GAMES, at(`${key}T12:00:00Z`));
    assert.notEqual(id, prev, `repeat on ${key}`);
    prev = id;
    key = nextKey(key);
  }
});

test("every eligible game appears within 60 consecutive dates, from many start dates", () => {
  let start = "2026-10-04";
  for (let s = 0; s < 40; s++) {
    const seen = new Set();
    let key = start;
    for (let i = 0; i < 60; i++) {
      seen.add(dailyGameId(GAMES, at(`${key}T12:00:00Z`)));
      key = nextKey(key);
    }
    assert.deepEqual([...seen].sort(), [...ELIGIBLE].sort(), `window from ${start}`);
    start = nextKey(start);
  }
});

const boundaries = [
  ["normal day 2026-06-15", "2026-06-14T21:59:59Z", "2026-06-14T22:00:00Z", "2026-06-14", "2026-06-15"],
  ["DST end, into 2026-10-25", "2026-10-24T21:59:59Z", "2026-10-24T22:00:00Z", "2026-10-24", "2026-10-25"],
  ["DST end, into 2026-10-26", "2026-10-25T22:59:59Z", "2026-10-25T23:00:00Z", "2026-10-25", "2026-10-26"],
  ["DST start, into 2027-03-28", "2027-03-27T22:59:59Z", "2027-03-27T23:00:00Z", "2027-03-27", "2027-03-28"],
  ["DST start, into 2027-03-29", "2027-03-28T21:59:59Z", "2027-03-28T22:00:00Z", "2027-03-28", "2027-03-29"],
];
for (const [name, before, after, keyBefore, keyAfter] of boundaries) {
  test(`flips exactly at 00:00 Paris: ${name}`, () => {
    assert.equal(parisDateKey(at(before)), keyBefore);
    assert.equal(parisDateKey(at(after)), keyAfter);
    assert.notEqual(dailyGameId(GAMES, at(before)), dailyGameId(GAMES, at(after)));
  });
}

test("excluded ids are never returned; degenerate lists are safe", () => {
  let key = "2026-01-01";
  for (let i = 0; i < 400; i++) {
    const id = dailyGameId(GAMES, at(`${key}T12:00:00Z`));
    assert.ok(!DAILY_EXCLUDED_IDS.includes(id), `${id} on ${key}`);
    key = nextKey(key);
  }
  assert.equal(dailyGameId([], at("2026-10-04T12:00:00Z")), "");
  assert.equal(dailyGameId([{ id: "wordle" }, { id: "coming-soon" }], at("2026-10-04T12:00:00Z")), "");
  assert.notEqual(dailyGameId([{ id: "a" }, { id: "b" }], at("2026-10-04T12:00:00Z")), dailyGameId([{ id: "a" }, { id: "b" }], at("2026-10-05T12:00:00Z")));
  assert.equal(dailyGameId([{ id: "a" }], at("2026-10-04T12:00:00Z")), "a");
});
