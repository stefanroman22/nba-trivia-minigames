// Node test for src/utils/ranks.ts (display helpers; thresholds live in the backend):
//   npm run test:ranks      (node --experimental-strip-types; Node >= 22.6)
import { test } from "node:test";
import assert from "node:assert/strict";
import { RANK_ORDER, RANK_COLORS, rankLabel, shareText } from "../src/utils/ranks.ts";

test("nine ranks, Rookie to GOAT, each with a colour", () => {
  assert.equal(RANK_ORDER.length, 9);
  assert.equal(RANK_ORDER[0], "Rookie");
  assert.equal(RANK_ORDER[8], "GOAT");
  for (const r of RANK_ORDER) assert.match(RANK_COLORS[r], /^#[0-9a-f]{6}$/i);
});

test("rankLabel adds the roman division only when there is one", () => {
  assert.equal(rankLabel("All-Star", 2), "All-Star II");
  assert.equal(rankLabel("All-Star", 1), "All-Star I");
  assert.equal(rankLabel("Starter", null), "Starter");
  assert.equal(rankLabel("GOAT", undefined), "GOAT");
});

test("shareText names the rank and the site", () => {
  const t = shareText("All-NBA");
  assert.match(t, /All-NBA/);
  assert.match(t, /swishquest\.com/);
  assert.doesNotMatch(t, /undefined/);
});
