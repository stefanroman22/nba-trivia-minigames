import { test } from "node:test";
import assert from "node:assert/strict";
import { qaCardText, failCardText, runSummaryText, sessionReportText, parseAgentNotes, countByCategory, sha7 } from "./slack-format.mjs";

test("sha7", () => assert.equal(sha7("3e250ee1234567890"), "3e250ee"));

test("qaCardText renders every line", () => {
  const t = qaCardText({
    title: "Mobile nav avatar-only chip", category: "frontend", priority: "P1",
    model: "sonnet", effort: "high", planModel: null, fixCycles: 1,
    did: "hid username/#id in the mobile chip",
    check: "narrow below 900px → chip shows photo only",
    devUrl: "https://dev.example", commit: "3e250ee1234567890",
  });
  assert.match(t, /^✅ Mobile nav avatar-only chip   ·   frontend · P1\n/);
  assert.match(t, /Model: sonnet · effort high  ·  design round: no  ·  fix cycles: 1\n/);
  assert.match(t, /Did: hid username\/#id in the mobile chip\n/);
  assert.match(t, /Check: narrow below 900px → chip shows photo only\n/);
  assert.match(t, /Dev: https:\/\/dev.example   ·   commit 3e250ee\n/);
  assert.match(t, /✅ approve   ·   🔄 needs work — reply to say what$/);
});

test("qaCardText marks a fullstack half and a design round", () => {
  const t = qaCardText({ title: "Photo upload", category: "fullstack", priority: "P2", model: "sonnet", effort: "high",
    planModel: "fable", fixCycles: 0, did: "x", check: "y", devUrl: "d", commit: "abcdef0123", half: "backend" });
  assert.match(t, /^✅ Photo upload \(backend half\)   ·   fullstack · P2\n/);
  assert.match(t, /design round: yes \(fable\)/);
});

test("failCardText: retry vs needs-human footer", () => {
  const base = { title: "Slow login", category: "backend", attempts: 1, maxAttempts: 2, model: "sonnet", effort: "high",
    planModel: "opus-4.8", stage: "verify", reason: "Django tests: 2 failing", fixCycles: 3, replanned: true,
    lastError: "AssertionError: 500 != 413", cardUrl: "https://notion.so/x", needsHuman: false };
  const a = failCardText(base);
  assert.match(a, /^❌ Slow login   ·   backend · attempt 1\/2\n/);
  assert.match(a, /Model: sonnet · effort high · design round: yes \(opus-4.8\)\n/);
  assert.match(a, /Failed at: verify — Django tests: 2 failing\n/);
  assert.match(a, /Tried: 3 fix cycles, 1 replan\. Last error: AssertionError: 500 != 413\n/);
  assert.match(a, /Post-mortem: https:\/\/notion.so\/x\n/);
  assert.match(a, /Back in To Do — retries next run\.$/);
  const b = failCardText({ ...base, attempts: 2, needsHuman: true, replanned: false, fixCycles: 1 });
  assert.match(b, /Tried: 1 fix cycle\. Last error/);
  assert.match(b, /Needs human ✔ — pipeline will skip it until you uncheck\.$/);
});

test("countByCategory omits zeros and keeps category order", () => {
  const c = countByCategory([{ category: "backend" }, { category: "frontend" }, { category: "frontend" }]);
  assert.equal(c, "frontend 2 · backend 1");
  assert.equal(countByCategory([]), "");
});

test("runSummaryText", () => {
  const t = runSummaryText({
    start: "10:00", end: "11:40",
    shipped: [{ title: "A", category: "frontend" }, { title: "B", category: "fullstack" }],
    failed: [{ title: "C", category: "backend", stage: "verify", attempts: 1, maxAttempts: 2, channel: "backend" }],
    leftTodo: 2,
  });
  assert.equal(t,
`🟢 Run done · 10:00–11:40 · 2 shipped to dev, 1 failed, 2 left in To Do
frontend 1 · fullstack 1
• A
• B
Failed: C (verify, attempt 1/2 → details in #agent-backend)`);
  const u = runSummaryText({ start: "02:00", end: "02:30", shipped: [], failed: [], leftTodo: 0 });
  assert.equal(u, "🟢 Run done · 02:00–02:30 · 0 shipped to dev, 0 failed, 0 left in To Do");
});

test("sessionReportText", () => {
  const head = sessionReportText({ label: "Day session (10:00-17:00 work)", start: "07:30", end: "17:30",
    shipped: [{ title: "A", category: "frontend", sha: "1234567890" }], qaWaiting: 3, doneCount: 1 });
  assert.equal(head.head, "📋 *Day session (10:00-17:00 work)* — dev 07:30–17:30");
  assert.equal(head.text,
`📋 *Day session (10:00-17:00 work)* — dev 07:30–17:30: 1 task(s) shipped
frontend 1
• A (1234567)
QA: 3 waiting · Done: 1 reached main this window`);
  const empty = sessionReportText({ label: "Night", start: "17:30", end: "07:30", shipped: [], qaWaiting: 0, doneCount: 0 });
  assert.equal(empty.text, "📋 *Night* — dev 17:30–07:30: no work this session.\nQA: 0 waiting · Done: 0 reached main this window");
});

test("parseAgentNotes reads the block from a commit body", () => {
  const body = `Notion: https://x\nCategory: fullstack\n\n## Agent notes\n- agent: backend-engine\n  did: added photos.py\n  assumed: none\n- agent: frontend-engine\n  did: imagePrep.ts\n  assumed: max 4.5MB\n`;
  assert.deepEqual(parseAgentNotes(body), [
    { agent: "backend-engine", did: "added photos.py", assumed: "none" },
    { agent: "frontend-engine", did: "imagePrep.ts", assumed: "max 4.5MB" },
  ]);
  assert.deepEqual(parseAgentNotes("no notes here"), []);
});
