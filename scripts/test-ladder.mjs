// Node test for src/utils/ladder.ts (the ladder's copy helpers), no dependencies:
//   npm run test:ladder      (node --experimental-strip-types; Node >= 22.6)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  percentileHeadline, aheadCopy, sameRankCopy, toTopCopy, nextRankCopy, gateCopy, softCapCopy, streakCopy,
} from "../src/utils/ladder.ts";
import { RANK_TAGLINES, RANK_ORDER, percentileShareText } from "../src/utils/ranks.ts";

const you = { rank: "Starter", division: null, position: 287, percentile: 23.1, ahead_of_pct: 76.9, same_rank_pct: 18, next_rank: "All-Star", points_to_next: 1240, days_to_next: 2, to_top: { "1": 39800, "10": 3000, "25": 0 } };
const rules = { first_game_bonus: 100, daily_full: 1500, daily_half: 1500, daily_tail_rate: 0.1, streak_milestones: { "7": 200, "30": 1000, "100": 5000 }, max_freezes: 1, guest_carryover_max: 1000 };

test("headline: top x % with one decimal, early adopter under 20 players", () => {
  assert.equal(percentileHeadline(you, 1240), "Top 23.1%");
  assert.equal(percentileHeadline({ ...you, percentile: 0.04 }, 1240), "Top 0.1%");
  assert.equal(percentileHeadline(you, 19), "Early adopter");
});

test("ahead / same-rank copy use whole numbers", () => {
  assert.equal(aheadCopy(you), "You're ahead of 77% of players");
  assert.equal(sameRankCopy(you), "18% share your rank");
});

test("to-top copy", () => {
  assert.equal(toTopCopy(10, 5200, 3000), "Top 10% · 5,200 pts (+3,000 for you)");
  assert.equal(toTopCopy(25, 1800, 0), "Top 25% · 1,800 pts (you're in)");
  assert.equal(toTopCopy(10, 5200, null), "Top 10% · 5,200 pts");
});

test("next-rank copy", () => {
  assert.equal(nextRankCopy(you), "1,240 pts to All-Star · 2 more active days");
  assert.equal(nextRankCopy({ ...you, days_to_next: 1 }), "1,240 pts to All-Star · 1 more active day");
  assert.equal(nextRankCopy({ ...you, points_to_next: 0 }), "2 more active days to All-Star");
  assert.equal(nextRankCopy({ ...you, next_rank: null }), "Top of the ladder");
  assert.equal(nextRankCopy({ ...you, points_to_next: 0, days_to_next: 0 }), "You're about to rank up to All-Star");
});

test("gate and rules copy", () => {
  assert.equal(gateCopy({ name: "Starter", points: 1500, days: 3 }), "1,500 pts · 3 days");
  assert.equal(gateCopy({ name: "Rookie", points: 0, days: 0 }), "Start here");
  assert.equal(gateCopy({ name: "Role Player", points: 100, days: 0 }), "100 pts");
  assert.equal(gateCopy({ name: "X", points: 100, days: 1 }), "100 pts · 1 day");
  assert.equal(softCapCopy(rules), "First 1,500 pts a day count in full, the next 1,500 at half, the rest at 10%");
  assert.equal(streakCopy(rules), "One game a day keeps your streak · 1 freeze · +200 / +1,000 / +5,000 at day 7 / 30 / 100");
  assert.equal(streakCopy({ ...rules, max_freezes: 2 }), "One game a day keeps your streak · 2 freezes · +200 / +1,000 / +5,000 at day 7 / 30 / 100");
});

test("every rank has a tagline and the share line names the percentile", () => {
  for (const r of RANK_ORDER) assert.ok(RANK_TAGLINES[r]?.length > 0, r);
  const t = percentileShareText(23.1, "Starter");
  assert.match(t, /top 23\.1%/);
  assert.match(t, /Starter/);
  assert.match(t, /swishquest\.com/);
});
