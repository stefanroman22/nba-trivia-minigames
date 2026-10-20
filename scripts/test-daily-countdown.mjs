// Node test for src/utils/dailyCountdown.ts (the home cards' daily-lock countdown label), no dependencies:
//   npm run test:daily-countdown      (node --experimental-strip-types; Node >= 22.6)
import { test } from "node:test";
import assert from "node:assert/strict";
import { dailyCountdownText } from "../src/utils/dailyCountdown.ts";

const NOW = Date.parse("2026-10-03T12:00:00.000Z");
const at = (ms) => new Date(NOW + ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;

test("hours and minutes", () => {
  assert.equal(dailyCountdownText("Wordle", at(5 * HOUR + 12 * MIN), NOW), "Next Wordle in 5h 12m");
});

test("the game's name goes in the label", () => {
  assert.equal(dailyCountdownText("Contexto", at(5 * HOUR + 12 * MIN), NOW), "Next Contexto in 5h 12m");
  assert.equal(dailyCountdownText("Contexto", at(12 * MIN), NOW), "Next Contexto in 12m");
});

test("exactly one hour drops the minutes part", () => {
  assert.equal(dailyCountdownText("Wordle", at(HOUR), NOW), "Next Wordle in 1h");
});

test("under an hour shows minutes only", () => {
  assert.equal(dailyCountdownText("Wordle", at(59 * MIN), NOW), "Next Wordle in 59m");
});

test("61 minutes is 1h 1m", () => {
  assert.equal(dailyCountdownText("Wordle", at(61 * MIN), NOW), "Next Wordle in 1h 1m");
});

test("30 seconds left rounds up to 1m", () => {
  assert.equal(dailyCountdownText("Wordle", at(30_000), NOW), "Next Wordle in 1m");
});

test("zero is null", () => {
  assert.equal(dailyCountdownText("Wordle", at(0), NOW), null);
});

test("past is null", () => {
  assert.equal(dailyCountdownText("Contexto", at(-5 * MIN), NOW), null);
});

test("invalid date is null", () => {
  assert.equal(dailyCountdownText("Wordle", "not-a-date", NOW), null);
  assert.equal(dailyCountdownText("Wordle", "", NOW), null);
});
