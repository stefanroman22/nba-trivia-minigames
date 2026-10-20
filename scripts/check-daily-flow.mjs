// Node test for src/utils/dailyFlow.ts (solo Contexto's start order: status -> load the day's question -> record):
//   npm run check:daily-flow      (also run by `npm run lint`, so CI covers it on Node 20)
//
// dailyFlow.ts has no imports, so it is transpiled here with the project's own TypeScript (Node 20 has no
// --experimental-strip-types) and imported from a data: URL, like check-seen.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../src/utils/dailyFlow.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const { startDailyQuestion } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

/** Fake gate + data host that log every call in order. */
function fakes({ status = { locked: false, day: "2026-10-18" }, questions = { "2026-10-18": "Q18", "2026-10-19": "Q19" }, record = { kind: "ok", day: "2026-10-18" } } = {}) {
  const calls = [];
  return {
    calls,
    deps: {
      status: async () => { calls.push("status"); return status; },
      load: async (day) => { calls.push(`load ${day}`); return questions[day] ?? null; },
      record: async () => { calls.push("record"); return record; },
    },
  };
}

test("the play is recorded only after the day's question loaded", async () => {
  const f = fakes();
  assert.deepEqual(await startDailyQuestion(f.deps), { kind: "ok", question: "Q18" });
  assert.deepEqual(f.calls, ["status", "load 2026-10-18", "record"]);
});

test("a failed load records nothing: the day is not used up", async () => {
  const f = fakes({ questions: {} });
  assert.deepEqual(await startDailyQuestion(f.deps), { kind: "unavailable" });
  assert.deepEqual(f.calls, ["status", "load 2026-10-18"]);
});

test("already played: locked, nothing loaded or recorded", async () => {
  const f = fakes({ status: { locked: true, day: "2026-10-18" } });
  assert.deepEqual(await startDailyQuestion(f.deps), { kind: "locked" });
  assert.deepEqual(f.calls, ["status"]);
});

test("another tab or device recorded first: the record answers locked", async () => {
  const f = fakes({ record: { kind: "locked" } });
  assert.deepEqual(await startDailyQuestion(f.deps), { kind: "locked" });
  assert.deepEqual(f.calls, ["status", "load 2026-10-18", "record"]);
});

test("no server: an error, nothing loaded", async () => {
  for (const status of [null, { locked: false }]) {
    const f = fakes({ status });
    assert.deepEqual(await startDailyQuestion(f.deps), { kind: "error" });
    assert.deepEqual(f.calls, ["status"]);
  }
});

test("the record fails: no play", async () => {
  const f = fakes({ record: { kind: "error" } });
  assert.deepEqual(await startDailyQuestion(f.deps), { kind: "error" });
});

test("Paris midnight between status and record: the new day's question is dealt", async () => {
  const f = fakes({ record: { kind: "ok", day: "2026-10-19" } });
  assert.deepEqual(await startDailyQuestion(f.deps), { kind: "ok", question: "Q19" });
  assert.deepEqual(f.calls, ["status", "load 2026-10-18", "record", "load 2026-10-19"]);
});
