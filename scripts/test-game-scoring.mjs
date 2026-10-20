// Node test for src/utils/gameScoring.ts (the pure scoring rules the renderers import), no dependencies:
//   npm run test:game-scoring      (node --experimental-strip-types; Node >= 22.6)
import { test } from "node:test";
import assert from "node:assert/strict";
import * as scoring from "../src/utils/gameScoring.ts";
import {
  CAREER_PATH_MAX, careerPathScore,
  WHO_ARE_YA_MAX, WHO_ARE_YA_COST, whoAreYaScore,
  FAN_FAVORITES_MAX, fanFavoritesScore,
  WORDLE_MAX_GUESSES, wordlePoints,
  TTT_CELL_POINTS, TTT_CLEAR_BONUS, TTT_SOLO_MAX,
  CONTEXTO_MAX, contextoScore,
} from "../src/utils/gameScoring.ts";

test("career path: 200 minus 40 per miss, never below 40", () => {
  assert.equal(CAREER_PATH_MAX, 200);
  assert.equal(careerPathScore(0), 200);
  assert.equal(careerPathScore(2), 120);
  assert.equal(careerPathScore(6), 40);
  assert.equal(careerPathScore(9), 40);
});

test("who are ya: 250 minus 30 per miss, lowest win 40", () => {
  assert.equal(WHO_ARE_YA_MAX, 250);
  assert.equal(WHO_ARE_YA_COST, 30);
  assert.equal(whoAreYaScore(0), 250);
  assert.equal(whoAreYaScore(1), 220);
  assert.equal(whoAreYaScore(4), 130);
  assert.equal(whoAreYaScore(7), 40);
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

test("tic-tac-toe solo: 30 per cell, a 30 clear bonus, 300 for the board", () => {
  assert.equal(TTT_CELL_POINTS, 30);
  assert.equal(TTT_CLEAR_BONUS, 30);
  assert.equal(TTT_SOLO_MAX, 300);
  assert.equal(9 * TTT_CELL_POINTS + TTT_CLEAR_BONUS, TTT_SOLO_MAX);
});

test("starting five: no full-lineup bonus any more", () => {
  assert.equal("STARTING_FIVE_BONUS" in scoring, false);
});

test("contexto: 350 through ten guesses, minus 10 per guess after, floor 100", () => {
  assert.equal(CONTEXTO_MAX, 350);
  assert.equal(contextoScore(1), 350);
  assert.equal(contextoScore(10), 350);
  assert.equal(contextoScore(11), 340);
  assert.equal(contextoScore(40), 100);
  assert.equal(contextoScore(100), 100);
});
