// Node test for src/utils/whoWouldWinPoints.ts (Who Would Win's crowd points), no dependencies:
//   npm run test:www-points      (node --experimental-strip-types; Node >= 22.6)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pointsFor,
  WWW_MAX_POINTS,
  WWW_POINTS_MAJORITY,
  WWW_POINTS_MINORITY,
} from "../src/utils/whoWouldWinPoints.ts";

test("constants match the spec", () => {
  assert.equal(WWW_POINTS_MAJORITY, 20);
  assert.equal(WWW_POINTS_MINORITY, 5);
  assert.equal(WWW_MAX_POINTS, 200);
});

test("majority earns 20", () => {
  assert.equal(pointsFor("a", { a: 5, b: 3 }), 20);
  assert.equal(pointsFor("b", { a: 1, b: 7 }), 20);
});

test("tie earns 20", () => {
  assert.equal(pointsFor("a", { a: 4, b: 4 }), 20);
});

test("first voter earns 20", () => {
  assert.equal(pointsFor("a", { a: 1, b: 0 }), 20);
  assert.equal(pointsFor("b", { a: 0, b: 1 }), 20);
});

test("minority earns 5", () => {
  assert.equal(pointsFor("b", { a: 6, b: 2 }), 5);
  assert.equal(pointsFor("a", { a: 2, b: 3 }), 5);
});

test("skip earns 0", () => {
  assert.equal(pointsFor(null, { a: 9, b: 1 }), 0);
  assert.equal(pointsFor(null, undefined), 0);
  assert.equal(pointsFor(null, "error"), 0);
});

test("failed or pending tally counts as majority", () => {
  assert.equal(pointsFor("a", "error"), 20);
  assert.equal(pointsFor("a", undefined), 20);
});
