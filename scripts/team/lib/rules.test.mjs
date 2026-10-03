import { test } from "node:test";
import assert from "node:assert/strict";
import { extractRules, selectRules, ruleIndex } from "./rules.mjs";

const DOC = [
  "# Game Design Constraints",
  "intro text",
  "## RULE 0 — Your root is `<GameFrame>`. This rule outranks every other rule here.",
  "body zero",
  "## 4. Playing shell",
  "section intro",
  "### RULE 4.2 — The three shell distances are identical in every game",
  "body of 4.2 mentions ScorePanel",
  "### RULE 4.2 acceptance test",
  "how to test 4.2",
  "### RULE 4.2a — Never render an empty slot; omit it",
  "body 4.2a",
  "## Rule UI-4: One CSS file per page/feature, imported by its owner",
  "body ui-4 mentions Friends.css",
  "## Accepted deviations",
  "not a rule",
].join("\n");

test("extractRules finds rule headings and skips acceptance tests", () => {
  const rules = extractRules(DOC);
  assert.deepEqual(rules.map((r) => r.id), ["0", "4.2", "4.2a", "UI-4"]);
  const r42 = rules.find((r) => r.id === "4.2");
  assert.match(r42.body, /ScorePanel/);
  assert.doesNotMatch(r42.body, /how to test/);
  assert.equal(rules.find((r) => r.id === "UI-4").heading, "One CSS file per page/feature, imported by its owner");
});

test("selectRules ranks by keyword hits and honors max", () => {
  const rules = extractRules(DOC);
  const picked = selectRules(rules, ["scorepanel", "Friends.css"], { max: 1 });
  assert.equal(picked.length, 1);
  assert.equal(picked[0].id, "4.2");
  const both = selectRules(rules, ["ScorePanel", "friends.css"]);
  assert.deepEqual(both.map((r) => r.id), ["4.2", "UI-4"]);
});

test("ruleIndex is one line per rule", () => {
  const lines = ruleIndex(extractRules(DOC)).split("\n");
  assert.equal(lines.length, 4);
  assert.equal(lines[3], "- RULE UI-4 — One CSS file per page/feature, imported by its owner");
});
