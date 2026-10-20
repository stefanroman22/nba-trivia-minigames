// Node test for src/utils/ladder.ts (the ladder's copy helpers), no dependencies:
//   npm run test:ladder      (node --experimental-strip-types; Node >= 22.6)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  percentileHeadline, aheadCopy, sameRankCopy, toTopCopy, nextRankCopy, gateCopy, streakBonusCopy, freezeCopy,
  ladderCacheFresh,
} from "../src/utils/ladder.ts";
import { RANK_TAGLINES, RANK_ORDER, percentileShareText } from "../src/utils/ranks.ts";

const you = { rank: "Starter", division: null, position: 287, percentile: 23.1, ahead_of_pct: 76.9, same_rank_pct: 18, next_rank: "All-Star", points_to_next: 1240, days_to_next: 2, to_top: { "1": 39800, "10": 3000, "25": 0 } };
const rules = { first_game_bonus: 100, streak_milestones: { "10": 500, "25": 1500, "100": 10000 }, max_freezes: 1, freeze_every_days: 7, guest_carryover_max: 1000 };

test("headline: top x % with one decimal, early adopter under 20 players", () => {
  assert.equal(percentileHeadline(you, 1240), "Top 23.1%");
  assert.equal(percentileHeadline({ ...you, percentile: 0.04 }, 1240), "Top 0.1%");
  assert.equal(percentileHeadline(you, 19), "Early adopter");
});

test("ahead / same-rank copy use whole numbers", () => {
  assert.equal(aheadCopy(you), "You're ahead of 77% of players");
  assert.equal(sameRankCopy(you), "18% share your rank");
});

test("never ahead of 100 %, a sliver of a share reads <1%", () => {
  assert.equal(aheadCopy({ ...you, ahead_of_pct: 99.9 }), "You're ahead of 99% of players");
  assert.equal(aheadCopy({ ...you, ahead_of_pct: 100 }), "You're ahead of 99% of players");
  assert.equal(sameRankCopy({ ...you, same_rank_pct: 0.3 }), "<1% share your rank");
  assert.equal(sameRankCopy({ ...you, same_rank_pct: 0 }), "0% share your rank");
  assert.equal(sameRankCopy({ ...you, same_rank_pct: 0.5 }), "1% share your rank");
});

test("ladder cache: fresh only for the same identity within its TTL", () => {
  const ttl = 600_000, errorTtl = 30_000, now = 1_000_000;
  const ok = { userKey: "7:120:Role Player", fetchedAt: now - 1000, error: false };
  assert.equal(ladderCacheFresh(ok, "7:120:Role Player", now, ttl, errorTtl), true);
  assert.equal(ladderCacheFresh(ok, "7:620:Sixth Man", now, ttl, errorTtl), false);
  assert.equal(ladderCacheFresh(ok, null, now, ttl, errorTtl), false);
  assert.equal(ladderCacheFresh({ ...ok, fetchedAt: now - ttl }, "7:120:Role Player", now, ttl, errorTtl), false);
  assert.equal(ladderCacheFresh({ ...ok, error: true, fetchedAt: now - 31_000 }, "7:120:Role Player", now, ttl, errorTtl), false);
  assert.equal(ladderCacheFresh({ ...ok, error: true, fetchedAt: now - 1000 }, "7:120:Role Player", now, ttl, errorTtl), true);
  assert.equal(ladderCacheFresh({ ...ok, userKey: null }, null, now, ttl, errorTtl), true);
  assert.equal(ladderCacheFresh(null, null, now, ttl, errorTtl), false);
});

test("to-top copy", () => {
  assert.equal(toTopCopy(10, 5200, 3000), "Top 10% · 5,200 pts (+3,000 for you)");
  assert.equal(toTopCopy(25, 1800, 0), "Top 25% · 1,800 pts (you're in)");
  assert.equal(toTopCopy(10, 5200, null), "Top 10% · 5,200 pts");
});

test("next-rank copy", () => {
  assert.equal(nextRankCopy(you), "1,240 pts to All-Star");
  assert.equal(nextRankCopy({ ...you, next_rank: null }), "Top of the ladder");
  assert.equal(nextRankCopy({ ...you, points_to_next: 0 }), "You're about to rank up to All-Star");
});

test("gate and rules copy", () => {
  assert.equal(gateCopy({ name: "Starter", points: 1500 }), "1,500 pts");
  assert.equal(gateCopy({ name: "Rookie", points: 0 }), "Start here");
  assert.equal(gateCopy({ name: "Role Player", points: 100 }), "100 pts");
  assert.equal(streakBonusCopy(rules), "10 days +500 · 25 days +1,500 · 100 days +10,000");
  assert.equal(freezeCopy(rules), "Missed a day? A freeze saves your streak. You earn one every 7 days of streak and can hold 1");
});

test("every rank has a tagline and the share line names the percentile", () => {
  for (const r of RANK_ORDER) assert.ok(RANK_TAGLINES[r]?.length > 0, r);
  const t = percentileShareText(23.1, "Starter");
  assert.match(t, /top 23\.1%/);
  assert.match(t, /Starter/);
  assert.match(t, /swishquest\.com/);
});
