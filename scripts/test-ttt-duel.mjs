// Node test for the Tic-Tac-Toe duel rules shared by local multiplayer (src/utils/tttDuel.ts) and their relay mirror
// (multiplayer_server/src/turnGames.js): lines, winner + its line, full board / draw, turn order, answer judging.
//   npm run test:ttt-duel      (node --experimental-strip-types; Node >= 22.6)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire, register } from "node:module";

// The sources import their siblings without extensions (bundler style): add ".ts", as test-name-lookup.mjs does.
register("data:text/javascript," + encodeURIComponent(`
  export async function resolve(spec, ctx, next) {
    if (/^\\.\\.?\\//.test(spec) && !/\\.[cm]?[jt]s$/.test(spec) && ctx.parentURL?.includes("/src/")) return next(spec + ".ts", ctx);
    return next(spec, ctx);
  }`));
const { TTT_LINES, winningLine, isFull, nextPlayer, starterFor, judgeAnswer, endHoldMs, TTT_END_HOLD_MS, TTT_END_HOLD_REDUCED_MS } =
  await import("../src/utils/tttDuel.ts");
const { buildNameLookup } = await import("../src/utils/questions.ts");
const relay = createRequire(import.meta.url)("../multiplayer_server/src/turnGames.js")._test;

const _ = null;

test("TTT_LINES: the 8 lines of a 3x3 board (3 rows, 3 columns, 2 diagonals)", () => {
  assert.equal(TTT_LINES.length, 8);
  const key = (l) => [...l].sort((a, b) => a - b).join(",");
  const want = ["0,1,2", "3,4,5", "6,7,8", "0,3,6", "1,4,7", "2,5,8", "0,4,8", "2,4,6"];
  assert.deepEqual(TTT_LINES.map(key).sort(), want.sort());
});

test("winningLine: every line wins for its owner, and reports that line", () => {
  for (const line of TTT_LINES) {
    for (const owner of [0, 1]) {
      const board = Array(9).fill(null);
      for (const i of line) board[i] = owner;
      assert.deepEqual(winningLine(board), { winner: owner, line: [...line] });
    }
  }
});

test("winningLine: no line, a mixed line or an empty board is no winner", () => {
  assert.equal(winningLine(Array(9).fill(null)), null);
  assert.equal(winningLine([0, 1, 0, _, _, _, _, _, _]), null);
  assert.equal(winningLine([0, 0, _, 1, 1, _, _, _, _]), null);
  // X O X / X O O / O X X: a full board without a line.
  assert.equal(winningLine([0, 1, 0, 0, 1, 1, 1, 0, 0]), null);
});

test("winningLine: owners can be any value (uids on the relay)", () => {
  assert.deepEqual(winningLine([_, _, "bob", _, "bob", _, "bob", _, _]), { winner: "bob", line: [2, 4, 6] });
});

test("isFull: only a board with all nine cells taken", () => {
  assert.equal(isFull(Array(9).fill(null)), false);
  assert.equal(isFull([0, 1, 0, 0, 1, 1, 1, 0, _]), false);
  assert.equal(isFull([0, 1, 0, 0, 1, 1, 1, 0, 0]), true);
});

test("nextPlayer alternates; starterFor alternates who starts each board", () => {
  assert.equal(nextPlayer(0), 1);
  assert.equal(nextPlayer(1), 0);
  assert.deepEqual([0, 1, 2, 3, 4].map(starterFor), [0, 1, 0, 1, 0]);
});

const NAMES = [
  { id: 1, full_name: "Kobe Bryant", aliases: [] },
  { id: 2, full_name: "LeBron James", aliases: [] },
  { id: 3, full_name: "Shaquille O'Neal", aliases: ["Shaq"] },
  { id: 10, full_name: "Eddie Johnson", aliases: [] },
  { id: 11, full_name: "Eddie Johnson", aliases: [] },
  { id: 12, full_name: "Gary Payton", aliases: [] },
  { id: 13, full_name: "Gary Payton II", aliases: [] },
];
const VALID = [[1, 2], [3], [13], [10], [11], [2], [1], [3], [12]];
const lookup = buildNameLookup(NAMES);

test("judgeAnswer: a name the game does not know is unknown", () => {
  assert.deepEqual(judgeAnswer("Nobody Here", 0, VALID, new Set(), lookup), { kind: "unknown" });
  assert.deepEqual(judgeAnswer("", 0, VALID, new Set(), lookup), { kind: "unknown" });
});

test("judgeAnswer: a player who fits the square and is not on the board is right (alias canonicalised by id)", () => {
  assert.deepEqual(judgeAnswer("Kobe Bryant", 0, VALID, new Set(), lookup), { kind: "right", id: 1 });
  assert.deepEqual(judgeAnswer("shaq", 1, VALID, new Set(), lookup), { kind: "right", id: 3 });
});

test("judgeAnswer: a player already on the board is used, even where he fits", () => {
  assert.deepEqual(judgeAnswer("LeBron James", 5, VALID, new Set([2]), lookup), { kind: "used", id: 2 });
  assert.deepEqual(judgeAnswer("LeBron James", 1, VALID, new Set([2]), lookup), { kind: "used", id: 2 });
});

test("judgeAnswer: a known player who does not fit the square is wrong", () => {
  assert.deepEqual(judgeAnswer("Kobe Bryant", 1, VALID, new Set(), lookup), { kind: "wrong", id: 1 });
});

test("judgeAnswer: namesakes — the one who fits and is free counts; an exact name never becomes his son", () => {
  assert.deepEqual(judgeAnswer("Eddie Johnson", 3, VALID, new Set(), lookup), { kind: "right", id: 10 });
  assert.deepEqual(judgeAnswer("Eddie Johnson", 4, VALID, new Set([10]), lookup), { kind: "right", id: 11 });
  assert.deepEqual(judgeAnswer("Gary Payton", 2, VALID, new Set(), lookup), { kind: "wrong", id: 12 });
  assert.deepEqual(judgeAnswer("Gary Payton II", 2, VALID, new Set(), lookup), { kind: "right", id: 13 });
});

test("endHoldMs: a decided duel board (win or draw) holds before the results; a live or missing one does not", () => {
  assert.ok(TTT_END_HOLD_MS >= 1600 && TTT_END_HOLD_MS <= 2000, `full hold ${TTT_END_HOLD_MS}`);
  assert.ok(TTT_END_HOLD_REDUCED_MS > 0 && TTT_END_HOLD_REDUCED_MS < TTT_END_HOLD_MS, `reduced hold ${TTT_END_HOLD_REDUCED_MS}`);
  const won = { winnerUid: "ann", draw: false, winLine: [0, 4, 8] };
  const drawn = { winnerUid: null, draw: true, winLine: null };
  assert.equal(endHoldMs(won, false), TTT_END_HOLD_MS);
  assert.equal(endHoldMs(drawn, false), TTT_END_HOLD_MS);
  assert.equal(endHoldMs(won, true), TTT_END_HOLD_REDUCED_MS);
  assert.equal(endHoldMs(drawn, true), TTT_END_HOLD_REDUCED_MS);
  assert.equal(endHoldMs({ winnerUid: null, draw: false, winLine: null }, false), 0);
  assert.equal(endHoldMs(null, false), 0);
  assert.equal(endHoldMs(undefined, true), 0);
});

test("relay mirror: the same lines, winner and judging as the client", () => {
  const boards = [
    Array(9).fill(null),
    [0, 0, 0, _, _, _, _, _, _],
    [_, 1, _, _, 1, _, _, 1, _],
    [0, 1, 0, 0, 1, 1, 1, 0, 0],
    [1, _, _, _, 1, _, _, _, 1],
  ];
  for (const b of boards) assert.deepEqual(relay.tttWinLine(b), winningLine(b), JSON.stringify(b));
  const cases = [
    ["Nobody Here", 0, []], ["Kobe Bryant", 0, []], ["shaq", 1, []], ["LeBron James", 5, [2]], ["Kobe Bryant", 1, []],
    ["Eddie Johnson", 4, [10]], ["Gary Payton", 2, []], ["Gary Payton II", 2, []],
  ];
  const relayLookup = createRequire(import.meta.url)("../multiplayer_server/src/questions.js").nameLookup(NAMES);
  for (const [raw, cell, used] of cases) {
    assert.deepEqual(relay.tttJudge(raw, cell, VALID, new Set(used), relayLookup), judgeAnswer(raw, cell, VALID, new Set(used), lookup), raw);
  }
});
