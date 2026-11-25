import { test } from "node:test";
import assert from "node:assert/strict";
import { appendSpawn } from "./state.mjs";
import { costFields, formatCost, parseCost, fixRounds, inputRates, tokensByModel, estimateUsd, modelAlias } from "./cost.mjs";

const REGISTRY = {
  aliases: {
    fable: { id: "claude-fable-5-2", name: "Fable 5.2", usdPerMTok: { input: 8, output: 40 } },
    opus: { id: "claude-opus-5-5", name: "Opus 5.5", usdPerMTok: { input: 4, output: 20 } },
    sonnet: { id: "claude-sonnet-5-5", name: "Sonnet 5.5", usdPerMTok: { input: 2, output: 10 } },
    haiku: { id: "claude-haiku-5-5", name: "Haiku 5.5", usdPerMTok: { input: 0.1, output: 0.5 } },
  },
};
const START = "2026-11-25T10:00:00.000Z";
const NOW = Date.parse("2026-11-25T10:23:20.000Z");

function run() {
  let state = { tier: "standard", startedAt: START, fixRounds: { verify: 1, qa: 0, review: 1 }, replanned: false };
  const spawn = (s) => { state = appendSpawn(state, s); };
  spawn({ stage: "classify", agent: "planner-architect", model: "sonnet", tokens: 40000, toolUses: 9, ms: 30000 });
  spawn({ stage: "plan", agent: "planner-architect", model: "sonnet", tokens: 72345, toolUses: 14, ms: 60000 });
  spawn({ stage: "build", agent: "frontend-engine", model: "sonnet", tokens: 400000, toolUses: 60, ms: 600000 });
  spawn({ stage: "fix", agent: "frontend-engine", model: "sonnet", tokens: 100000, toolUses: 20, ms: 120000 });
  spawn({ stage: "review", agent: "code-reviewer", model: "fable", tokens: 120000, toolUses: 12, ms: 90000 });
  spawn({ stage: "review", agent: "code-reviewer", model: "fable", tokens: 80000, toolUses: 8, ms: 70000 });
  return state;
}
const CLASSIFY = { difficulty: "standard", engineModel: "sonnet", engineEffort: "high", planModel: "sonnet", needsDesignRound: false };

test("the trailer of a run is the documented line", () => {
  const line = formatCost(costFields({ state: run(), classify: CLASSIFY, now: NOW }));
  assert.equal(line, "Cost: tier=standard engine=sonnet effort=high plan=sonnet review=fable spawns=6 tokens=812345 models=sonnet:612345,fable:200000 fix=verify:1,qa:0,review:1 minutes=23");
  assert.ok(!/\s{2,}/.test(line) && line.split(" ").slice(1).every((p) => /^[a-z]+=\S+$/.test(p)));
});

test("format and parse round-trip", () => {
  const cases = [
    costFields({ state: run(), classify: CLASSIFY, now: NOW }),
    costFields({ state: { startedAt: START, fixRounds: { verify: 0, qa: 0, review: 0 } }, classify: { difficulty: "trivial", engineModel: "haiku", engineEffort: "low" }, now: NOW }),
    costFields({ state: appendSpawn(run(), { stage: "qa", agent: "browser-qa", model: "sonnet" }), classify: CLASSIFY, now: NOW }),
    costFields({ state: {}, classify: {}, now: NOW }),
  ];
  for (const fields of cases) assert.deepEqual(parseCost(formatCost(fields)), fields);
  // and inside a commit body, between the header block and the notes
  const body = `Notion: https://app.notion.com/p/x-1\nCategory: frontend\n${formatCost(cases[0])}\n\n## Agent notes\n- agent: frontend-engine\n  did: Cost: not this one\n`;
  assert.deepEqual(parseCost(body), cases[0]);
});

test("tokens are a sum of what was reported; a spawn without a number is counted, not estimated", () => {
  const none = costFields({ state: appendSpawn({ startedAt: START }, { stage: "build", agent: "backend-engine", model: "opus" }), classify: {}, now: NOW });
  assert.equal(none.tokens, null);
  assert.equal(none.models, null);
  assert.equal(none.unmetered, 1);
  assert.equal(none.engine, "opus");
  assert.equal(formatCost(none), "Cost: engine=opus spawns=1 unmetered=1 minutes=23");
  const partial = costFields({ state: appendSpawn(run(), { stage: "qa", agent: "browser-qa", model: "sonnet" }), classify: CLASSIFY, now: NOW });
  assert.equal(partial.tokens, 812345);
  assert.equal(partial.spawns, 7);
  assert.equal(partial.unmetered, 1);
  assert.match(formatCost(partial), / spawns=7 tokens=812345 .* unmetered=1 /);
});

test("field sources: classify first, the recorded spawns for plan and review", () => {
  const f = costFields({ state: { tier: "hard", spawns: [
    { stage: "design", agent: "planner-architect", model: "fable", tokens: 10 },
    { stage: "review", agent: "code-reviewer", model: "fable", tokens: 5 },
    { stage: "review", agent: "motion-reviewer", model: "opus", tokens: 5 },
    { stage: "build", agent: "frontend-engine", tokens: 7 },
  ] }, classify: { planModel: "sonnet" }, now: NOW });
  assert.equal(f.tier, "hard");
  assert.equal(f.plan, "fable");
  assert.equal(f.review, "fable", "the code reviewer, not the motion reviewer that returned last");
  assert.deepEqual(f.models, { fable: 15, opus: 5, unknown: 7 });
  assert.equal(f.minutes, null);
  assert.equal(f.fix, null);
  // classify's planModel alone is not a plan spawn (a check card never runs one)
  assert.equal(costFields({ state: {}, classify: { planModel: "sonnet" } }).plan, null);
  // a value never carries a space or an "="
  assert.equal(formatCost({ tier: "very hard", engine: "a=b", spawns: 0 }), "Cost: tier=very-hard engine=a-b spawns=0");
});

test("parseCost tolerates what it does not know", () => {
  assert.equal(parseCost("Notion: x\nCategory: frontend\n"), null);
  assert.equal(parseCost(""), null);
  const p = parseCost("Cost: tier=standard tokens=12k fix=verify:1 future=1 spawns=2 spawns=9 minutes=4");
  assert.equal(p.tokens, null);
  assert.equal(p.spawns, 2);
  assert.deepEqual(p.fix, { verify: 1, qa: 0, review: 0 });
  assert.equal(p.minutes, 4);
  assert.equal(p.engine, null);
  assert.equal(fixRounds(p), 1);
  assert.equal(fixRounds(parseCost("Cost: tier=trivial")), null);
  assert.equal(fixRounds(null), null);
});

test("estimate: every token at its model's list input price", () => {
  const rates = inputRates(REGISTRY);
  assert.deepEqual(rates, { fable: 8, opus: 4, sonnet: 2, haiku: 0.1 });
  const cost = parseCost("Cost: engine=sonnet tokens=812345 models=sonnet:612345,fable:200000");
  assert.ok(Math.abs(estimateUsd(cost, rates) - (612345 * 2 + 200000 * 8) / 1e6) < 1e-9);
  // no split: all tokens on the engine model
  const flat = parseCost("Cost: engine=opus tokens=1000000");
  assert.deepEqual(tokensByModel(flat), { opus: 1000000 });
  assert.equal(estimateUsd(flat, rates), 4);
  // no tokens, or a model without a rate: no number
  assert.equal(estimateUsd(parseCost("Cost: engine=opus spawns=3"), rates), null);
  assert.equal(estimateUsd(parseCost("Cost: tokens=5000"), rates), null);
  assert.equal(estimateUsd(parseCost("Cost: tokens=10 models=sonnet:5,gpt:5"), rates), null);
  assert.equal(estimateUsd(null, rates), null);
  assert.deepEqual(inputRates({ aliases: { sonnet: { id: "x" } } }), {});
});

test("modelAlias maps ids and names to the registry alias", () => {
  assert.equal(modelAlias("sonnet", REGISTRY), "sonnet");
  assert.equal(modelAlias("claude-opus-5-5", REGISTRY), "opus");
  assert.equal(modelAlias("Fable 5.2", REGISTRY), "fable");
  assert.equal(modelAlias("Claude Haiku 5.5", REGISTRY), "haiku");
  assert.equal(modelAlias("Fable 5.1", REGISTRY), "Fable 5.1");
  assert.equal(modelAlias("", REGISTRY), null);
  assert.equal(modelAlias(null, null), null);
});
