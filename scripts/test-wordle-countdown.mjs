// Node test for src/utils/wordleCountdown.ts (the home Wordle card's countdown label), no dependencies:
//   npm run test:wordle-countdown      (node --experimental-strip-types; Node >= 22.6)
import { test } from "node:test";
import assert from "node:assert/strict";
import { wordleCountdownText } from "../src/utils/wordleCountdown.ts";

const NOW = Date.parse("2026-10-03T12:00:00.000Z");
const at = (ms) => new Date(NOW + ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;

test("hours and minutes", () => {
  assert.equal(wordleCountdownText(at(5 * HOUR + 12 * MIN), NOW), "Next Wordle in 5h 12m");
});

test("exactly one hour drops the minutes part", () => {
  assert.equal(wordleCountdownText(at(HOUR), NOW), "Next Wordle in 1h");
});

test("under an hour shows minutes only", () => {
  assert.equal(wordleCountdownText(at(59 * MIN), NOW), "Next Wordle in 59m");
});

test("61 minutes is 1h 1m", () => {
  assert.equal(wordleCountdownText(at(61 * MIN), NOW), "Next Wordle in 1h 1m");
});

test("30 seconds left rounds up to 1m", () => {
  assert.equal(wordleCountdownText(at(30_000), NOW), "Next Wordle in 1m");
});

test("zero is null", () => {
  assert.equal(wordleCountdownText(at(0), NOW), null);
});

test("past is null", () => {
  assert.equal(wordleCountdownText(at(-5 * MIN), NOW), null);
});

test("invalid date is null", () => {
  assert.equal(wordleCountdownText("not-a-date", NOW), null);
  assert.equal(wordleCountdownText("", NOW), null);
});
