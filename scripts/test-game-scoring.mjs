// Node test for src/utils/gameScoring.ts (the pure scoring rules the renderers import), no dependencies:
//   npm run test:game-scoring      (node --experimental-strip-types; Node >= 22.6)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CAREER_PATH_MAX, careerPathScore,
  WHO_ARE_YA_MAX, whoAreYaScore,
  FAN_FAVORITES_MAX, fanFavoritesScore,
  WORDLE_MAX_GUESSES, wordlePoints,
  TTT_CELL_POINTS, TTT_SOLO_MAX,
  STARTING_FIVE_BONUS,
} from "../src/utils/gameScoring.ts";

test("career path: 200 minus 40 per miss, never below 40", () => {
  assert.equal(CAREER_PATH_MAX, 200);
  assert.equal(careerPathScore(0), 200);
  assert.equal(careerPathScore(2), 120);
  assert.equal(careerPathScore(6), 40);
  assert.equal(careerPathScore(9), 40);
});

test("who are ya: 200 minus 25 per miss", () => {
  assert.equal(WHO_ARE_YA_MAX, 200);
  assert.equal(whoAreYaScore(0), 200);
  assert.equal(whoAreYaScore(7), 25);
});

test("fan favorites: proportional to answers found, 200 for a clear", () => {
  assert.equal(FAN_FAVORITES_MAX, 200);
  assert.equal(fanFavoritesScore(8, 8), 200);
  assert.equal(fanFavoritesScore(3, 8), 75);
  assert.equal(fanFavoritesScore(0, 8), 0);
  assert.equal(fanFavoritesScore(0, 0), 0);
});

test("wordle: 500 jackpot solo, 200 online, minus one step per used attempt", () => {
  assert.equal(WORDLE_MAX_GUESSES, 5);
  assert.equal(wordlePoints(0, false), 500);
  assert.equal(wordlePoints(4, false), 100);
  assert.equal(wordlePoints(0, true), 200);
  assert.equal(wordlePoints(4, true), 40);
});

test("tic-tac-toe solo: 20 per cell, 180 for the board", () => {
  assert.equal(TTT_CELL_POINTS, 20);
  assert.equal(TTT_SOLO_MAX, 180);
});

test("starting five bonus", () => {
  assert.equal(STARTING_FIVE_BONUS, 50);
});
