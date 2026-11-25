import { test } from "node:test";
import assert from "node:assert/strict";
import { appendSpawn, SPAWN_STAGES } from "./state.mjs";

test("appendSpawn appends a normalized record and leaves the input alone", () => {
  const state = { slug: "hero-pill", fixRounds: { verify: 0, qa: 0, review: 0 } };
  const next = appendSpawn(state, { stage: "build", agent: "frontend-engine", model: "Sonnet", tokens: 123456, toolUses: 40, ms: 310000 });
  assert.deepEqual(next.spawns, [{ stage: "build", agent: "frontend-engine", model: "sonnet", tokens: 123456, toolUses: 40, ms: 310000 }]);
  assert.equal(state.spawns, undefined);
  assert.equal(next.slug, "hero-pill");
  const again = appendSpawn(next, { stage: "review", agent: "code-reviewer", model: "fable", tokens: "200000", toolUses: "12", ms: "95000" });
  assert.equal(again.spawns.length, 2);
  assert.equal(next.spawns.length, 1);
  assert.deepEqual(again.spawns[1], { stage: "review", agent: "code-reviewer", model: "fable", tokens: 200000, toolUses: 12, ms: 95000 });
});

test("a number the harness did not report is stored as null, never guessed", () => {
  const { spawns } = appendSpawn({}, { stage: "classify", agent: "planner-architect", model: "sonnet" });
  assert.deepEqual(spawns[0], { stage: "classify", agent: "planner-architect", model: "sonnet", tokens: null, toolUses: null, ms: null });
  for (const bad of ["", "12k", "about 5000", "-3", 1.5, -1, NaN, null, undefined, {}, "1e6"]) {
    assert.equal(appendSpawn({}, { stage: "qa", tokens: bad, toolUses: bad, ms: bad }).spawns[0].tokens, null, String(bad));
  }
  assert.equal(appendSpawn({}, { stage: "qa", tokens: 0 }).spawns[0].tokens, 0);
  assert.deepEqual(appendSpawn({}, { stage: "qa" }).spawns[0], { stage: "qa", agent: null, model: null, tokens: null, toolUses: null, ms: null });
});

test("an unknown stage is refused; every pipeline stage is accepted", () => {
  assert.throws(() => appendSpawn({}, { stage: "ship", agent: "x" }), /spawn stage must be one of/);
  assert.throws(() => appendSpawn({}, {}), /spawn stage/);
  let state = null;
  for (const stage of SPAWN_STAGES) state = appendSpawn(state, { stage });
  assert.deepEqual(state.spawns.map((s) => s.stage), [...SPAWN_STAGES]);
  assert.deepEqual(appendSpawn({ spawns: "corrupt" }, { stage: "fix" }).spawns.length, 1);
});
