import { test } from "node:test";
import assert from "node:assert/strict";
import { STATUS, CATEGORIES, channelsFor, text } from "./team-config.mjs";

const cfg = { slack: { categoryChannels: {
  frontend: "frontend", docs: "frontend", backend: "backend", "CI/CD": "backend",
  AI: "backend", pipeline: "backend", fullstack: "both" } } };

test("status vocabulary is exact", () => {
  assert.deepEqual(STATUS, { BACKLOG: "Backlog", TODO: "To Do", IN_PROGRESS: "In progress", QA: "QA", DONE: "Done" });
  assert.deepEqual(CATEGORIES, ["frontend", "backend", "fullstack", "CI/CD", "pipeline", "AI", "docs"]);
});

test("channelsFor routes categories", () => {
  assert.deepEqual(channelsFor("frontend", cfg), ["frontend"]);
  assert.deepEqual(channelsFor("docs", cfg), ["frontend"]);
  assert.deepEqual(channelsFor("AI", cfg), ["backend"]);
  assert.deepEqual(channelsFor("fullstack", cfg), ["frontend", "backend"]);
  assert.deepEqual(channelsFor("unknown", cfg), ["backend"]);
  assert.deepEqual(channelsFor("frontend", {}), ["frontend"]);
});

test("text() truncates to Notion's limit", () => {
  const rt = text("x".repeat(3000));
  assert.equal(rt[0].text.content.length, 1900);
  assert.equal(rt[0].type, "text");
});
