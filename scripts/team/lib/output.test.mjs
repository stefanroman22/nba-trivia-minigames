import { test } from "node:test";
import assert from "node:assert/strict";
import { failuresOnly } from "./output.mjs";

test("empty output stays empty", () => {
  assert.equal(failuresOnly(""), "");
  assert.equal(failuresOnly("✔ all good\n12 files linted\n"), "");
});

test("300 tsc errors are capped at 100 lines with a trailer", () => {
  const lines = [];
  for (let i = 0; i < 300; i++) lines.push(`src/a${i}.tsx(1,2): error TS2322: Type 'x' is not assignable.`);
  const out = failuresOnly(lines.join("\n"));
  const outLines = out.split("\n");
  assert.ok(outLines.length <= 100, `got ${outLines.length}`);
  assert.match(outLines[outLines.length - 1], /^… \(\+\d+ more lines\)$/);
});

test("context lines after a failure are kept, duplicates dropped", () => {
  const txt = ["ok 1", "FAIL tests/x.test.js", "  expected 1", "  got 2", "ok 2", "FAIL tests/x.test.js", "  expected 1", "  got 2"].join("\n");
  const out = failuresOnly(txt);
  assert.deepEqual(out.split("\n"), ["FAIL tests/x.test.js", "  expected 1", "  got 2"]);
});

test("fallbackTail keeps the last lines when nothing matches but the command failed", () => {
  const txt = Array.from({ length: 60 }, (_, i) => `line ${i}`).join("\n");
  const out = failuresOnly(txt, 100, { fallbackTail: true });
  assert.equal(out.split("\n").length, 40);
  assert.equal(out.split("\n")[0], "line 20");
});
