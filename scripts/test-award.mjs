// Node test for src/store/award.ts (how an award receipt lands on the signed-in user), no dependencies:
//   npm run test:award      (node --experimental-strip-types; Node >= 22.6)
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyReceipt } from "../src/store/award.ts";

const user = () => ({ id: "K7F3QD", username: "Baller", email: "b@example.com", rank: "Rookie", points: 50, profile_photo: null });

test("a full receipt sets the server's totals, rank, progress, streak and a pending rank-up", () => {
  const { user: u, rankUp } = applyReceipt(user(), {
    awarded: 180, points: 230, rank: "Role Player", rank_up: { from: "Rookie", to: "Role Player" },
    progress: { rank: "Role Player", division: null, next_rank: "Sixth Man", next_points: 500, next_days: 0, points_to_next: 270, days_to_next: 0, progress_pct: 32 },
    streak: { days: 1, best: 1, freezes: 1 },
  });
  assert.equal(u.points, 230);
  assert.equal(u.rank, "Role Player");
  assert.equal(u.rank_progress.next_rank, "Sixth Man");
  assert.equal(u.streak_days, 1);
  assert.equal(u.streak_freezes, 1);
  assert.deepEqual(rankUp, { from: "Rookie", to: "Role Player", division: null });
});

test("an old relay payload with only awarded/points/rank still applies", () => {
  const { user: u, rankUp } = applyReceipt(user(), { awarded: 90, points: 140, rank: "Role Player" });
  assert.equal(u.points, 140);
  assert.equal(u.rank, "Role Player");
  assert.equal(u.rank_progress, undefined);
  assert.equal(rankUp, null);
});

test("a receipt without points falls back to adding the delta", () => {
  const { user: u } = applyReceipt(user(), { awarded: 90, rank: "Rookie" });
  assert.equal(u.points, 140);
});

test("a rank_up whose from and to match is not a promotion", () => {
  const { rankUp } = applyReceipt(user(), { awarded: 1, points: 51, rank: "Rookie", rank_up: { from: "Rookie", to: "Rookie" } });
  assert.equal(rankUp, null);
});

test("the division on the pending rank-up comes from the progress", () => {
  const { rankUp } = applyReceipt(user(), {
    awarded: 1, points: 5_001, rank: "All-Star", rank_up: { from: "Starter", to: "All-Star" },
    progress: { rank: "All-Star", division: 3, next_rank: "All-NBA", next_points: 15_000, next_days: 20, points_to_next: 9_999, days_to_next: 13, progress_pct: 0 },
  });
  assert.deepEqual(rankUp, { from: "Starter", to: "All-Star", division: 3 });
});
