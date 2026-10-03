import { test } from "node:test";
import assert from "node:assert/strict";
import { tierBudget, areasOf, pickNext } from "./budget.mjs";

const card = (title, category, difficulty, priority = "P1") => ({ id: title, title, category, difficulty, priority });

test("tierBudget", () => {
  assert.equal(tierBudget("trivial"), 10);
  assert.equal(tierBudget("standard"), 25);
  assert.equal(tierBudget("hard"), 45);
  assert.equal(tierBudget(null), 25);
});

test("areasOf derives areas from category and game names", () => {
  assert.deepEqual([...areasOf(card("Fix header", "frontend"))], ["frontend"]);
  assert.deepEqual([...areasOf(card("Throttle photos", "backend"))].sort(), ["backend"]);
  assert.deepEqual([...areasOf(card("Daily game", "fullstack"))].sort(), ["backend", "frontend"]);
  assert.deepEqual([...areasOf(card("Career Path: result at the top", "frontend"))].sort(), ["career-path", "frontend"]);
  assert.deepEqual([...areasOf(card("Tidy docs", "docs"))], ["docs"]);
});

test("a hard card does not start with 40 minutes left; the next fitting card does", () => {
  const q = [card("Ban system", "backend", "hard", "P0"), card("Friends swap", "frontend", "standard")];
  const picks = pickNext(q, 40);
  assert.deepEqual(picks.map((c) => c.title), ["Friends swap"]);
});

test("two frontend cards are not paired; frontend + backend are", () => {
  const q = [card("Hero pill", "frontend", "standard"), card("Wordle card", "frontend", "standard"), card("Rank endpoint", "backend", "standard")];
  assert.deepEqual(pickNext(q, 90).map((c) => c.title), ["Hero pill", "Rank endpoint"]);
});

test("a hard card runs alone", () => {
  const q = [card("Ban system", "backend", "hard", "P0"), card("Hero pill", "frontend", "standard")];
  assert.deepEqual(pickNext(q, 90).map((c) => c.title), ["Ban system"]);
});

test("running lanes block overlapping areas and reduce free lanes", () => {
  const q = [card("Hero pill", "frontend", "standard"), card("Rank endpoint", "backend", "standard")];
  const picks = pickNext(q, 90, { running: [{ areas: ["frontend"] }] });
  assert.deepEqual(picks.map((c) => c.title), ["Rank endpoint"]);
  assert.deepEqual(pickNext(q, 90, { running: [{ areas: ["frontend"] }, { areas: ["backend"] }] }), []);
});

test("lanes:1 returns a single pick", () => {
  const q = [card("Hero pill", "frontend", "standard"), card("Rank endpoint", "backend", "standard")];
  assert.equal(pickNext(q, 90, { lanes: 1 }).length, 1);
});

test("two different games are disjoint; the same game is not", () => {
  const q = [card("Career Path: result", "frontend", "standard"), card("Tic-Tac-Toe: team names", "frontend", "standard"), card("Career Path: header", "frontend", "standard")];
  assert.deepEqual(pickNext(q, 90).map((c) => c.title), ["Career Path: result", "Tic-Tac-Toe: team names"]);
});
