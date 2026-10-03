import { test } from "node:test";
import assert from "node:assert/strict";
import { detectSteps } from "./steps.mjs";

test("numbered steps naming files are a plan", () => {
  const r = detectSteps(
    "## What to build\n" +
      "1. Edit `src/views/Friends.tsx`: wrap the label in SwapText\n" +
      "2. In `src/styles/Friends.css` reserve the widest width\n" +
      "   so the row never shifts\n" +
      "3. Add a test in `scripts/lib/x.test.mjs`\n"
  );
  assert.equal(r.hasPlan, true);
  assert.equal(r.steps.length, 3);
  assert.deepEqual(r.steps[0].files, ["src/views/Friends.tsx"]);
  assert.match(r.steps[1].text, /never shifts/);
});

test("prose list without files is not a plan", () => {
  const r = detectSteps("1. we want it nicer\n2. maybe animate\n3. ask the owner");
  assert.equal(r.hasPlan, false);
  assert.equal(r.steps.length, 3);
});

test("two steps are not a plan", () => {
  assert.equal(detectSteps("1. `src/a.ts` x\n2. `src/b.ts` y").hasPlan, false);
});

test("line suffixes are stripped and deduplicated", () => {
  const r = detectSteps("1. `src/styles/Friends.css:70` and `src/styles/Friends.css` again\n2. `src/a.tsx:1-9`\n3. `src/b.tsx`");
  assert.deepEqual(r.steps[0].files, ["src/styles/Friends.css"]);
  assert.deepEqual(r.steps[1].files, ["src/a.tsx"]);
});

test("bare path tokens count as files", () => {
  const r = detectSteps("1. Hook into backend/users/views.py after normalize\n2. Frontend: src/utils/Api.tsx handles 403\n3. Update docs/DEPLOYMENT.md");
  assert.equal(r.hasPlan, true);
  assert.deepEqual(r.steps[0].files, ["backend/users/views.py"]);
});
