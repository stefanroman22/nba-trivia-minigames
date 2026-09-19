# Pipeline v2 — Board, Status Flow, Git Flow, Slack — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the team pipeline to the Backlog → To Do → In progress → QA → Done board, push finished tasks straight to `dev` (never `main` — promotion is a manual, explicit action, see the 2026-09-19 revision below), and put every actionable Slack message (with model/effort) in the agent channels.

**Architecture:** The two zero-dependency CLIs (`scripts/notion.mjs`, `scripts/slack.mjs`) keep being the only I/O the orchestrator uses; their pure logic moves into `scripts/lib/` (status vocabulary, message builders, spec assembly) with `node:test` tests. The `team-run`/`ship`/`classify` skills are rewritten to the new state machine. GitHub Actions lose the per-task CTO merge and the push-triggered auto-promote (gated to `workflow_dispatch` instead); a `main-sync` job flips QA cards to Done whenever a commit reaches `main`, however it got there.

**Revision (2026-09-19):** mid-implementation, this plan's original promotion mechanism (a
`scripts/promote.mjs`-managed batch `dev → main` PR, CTO-reviewed via `.claude/skills/
cto-review/SKILL.md` and `claude.yml`'s `cto-review`/`cto-act` jobs, merged by the owner) was
replaced by **Task 9b** with a simpler design per an explicit owner directive — see Task 9b's own
header and the second `docs/team/DECISIONS.md` entry it adds for the full rationale. Tasks 6, 7,
and 9 below are left in their original, as-written form for historical/implementation-order
reasons (Task 9b runs after them and supersedes their promotion-related content), but **Task 9b's
content is what actually ships** for anything promotion-related. Do not re-derive or re-apply
Task 6/7/9's promote.mjs/CTO-PR instructions on a resume — Task 9b's own "supersedes" note in the
ledger is authoritative.

**Tech Stack:** Node 22 ESM (`"type": "module"`), `node:test`, Notion REST API, Slack Web API, `gh` CLI, GitHub Actions, Claude Code skills (Markdown).

**Spec:** `docs/superpowers/specs/2026-09-17-pipeline-v2-board-flow-slack-design.md`

## Global Constraints

- Scripts stay zero-dependency (Node 18+ `fetch`, no npm packages). Tests use `node:test` only.
- Status strings are exactly: `Backlog`, `To Do`, `In progress`, `QA`, `Done`. Categories exactly: `frontend`, `backend`, `fullstack`, `CI/CD`, `pipeline`, `AI`, `docs`.
- `git push` to `dev` is fast-forward only; `--force`/`--force-with-lease` are never used. Nothing ever pushes to `main`.
- Only `main-sync.yml` may set a card to `Done`.
- Opus 5 (`opus` alias) stays banned; CTO review stays pinned to `fable`.
- `maxAttempts` = 2; `maxTasksPerRun` stays 50 (time is the only run limit).
- Commits in this plan are **local only**. Do not push — the owner pushes the whole batch once.
- Do not edit `package.json` (protected path; its `team` script edit is intentionally uncommitted).
- Slack failures are non-fatal everywhere; Notion failures exit 1 and the orchestrator parks the stage.

---

## File structure

| File | Responsibility |
|---|---|
| `scripts/lib/team-config.mjs` (new) | status/category constants, `.env.team` loader, config loader, category→channel mapping |
| `scripts/lib/slack-format.mjs` (new) | pure text builders: QA card, failure card, run summary, session report, agent-notes parser, category counts |
| `scripts/lib/notion-spec.mjs` (new) | pure spec assembly from body blocks, Attachments files, comments (download is injected) |
| `scripts/lib/*.test.mjs` (new) | `node:test` suites for the three libs |
| `scripts/notion.mjs` (modify) | commands for the new state machine + `migrate-v2` |
| `scripts/slack.mjs` (modify) | per-task cards in agent channels, run summary, reactions across channels, git-based session report |
| `.claude/team/config.json` (modify) | `slack.categoryChannels`, `maxAttempts` |
| `.claude/skills/team-run/SKILL.md`, `ship/SKILL.md`, `classify/SKILL.md` (modify) | orchestrator + stage instructions |
| `.github/workflows/dev-ci.yml`, `claude.yml`, `team-reports.yml` (modify), `main-sync.yml` (new) | CI: promote gated to `workflow_dispatch`; no CTO PR gate; QA→Done on push to `main` |
| `docs/team/PIPELINE.md`, `docs/team/DECISIONS.md` (modify) | operator manual + decision record |

(`scripts/promote.mjs` and `.claude/skills/cto-review/SKILL.md` appear in Tasks 6/9 below as
originally planned, but Task 9b deletes/retires them — see the Revision note above.)

Run all lib tests any time with: `node --test scripts/lib/*.test.mjs` (the bare directory form
doesn't resolve on this Windows/Node 22 setup — see the ledger note from Task 4).

---

### Task 1: Shared config module

**Files:**
- Create: `scripts/lib/team-config.mjs`
- Create: `scripts/lib/team-config.test.mjs`
- Modify: `.claude/team/config.json`

**Interfaces:**
- Produces: `STATUS` (`{BACKLOG,TODO,IN_PROGRESS,QA,DONE}`), `CATEGORIES` (array), `ROOT`, `CONFIG_PATH`, `ENV_PATH`, `loadEnvTeam()`, `loadConfig()`, `channelsFor(category, cfg) → string[]` (values `"frontend"`/`"backend"`), `text(s) → Notion rich_text array`.

- [ ] **Step 1: Write the failing test**

`scripts/lib/team-config.test.mjs`:
```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/lib/team-config.test.mjs`
Expected: FAIL — `Cannot find module './team-config.mjs'`

- [ ] **Step 3: Write the module**

`scripts/lib/team-config.mjs`:
```js
// Shared constants + loaders for the team pipeline scripts. Zero deps.
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const CONFIG_PATH = resolve(ROOT, ".claude/team/config.json");
export const ENV_PATH = resolve(ROOT, ".env.team");

export const STATUS = Object.freeze({
  BACKLOG: "Backlog", TODO: "To Do", IN_PROGRESS: "In progress", QA: "QA", DONE: "Done",
});
export const CATEGORIES = Object.freeze(["frontend", "backend", "fullstack", "CI/CD", "pipeline", "AI", "docs"]);

const DEFAULT_CHANNELS = {
  frontend: "frontend", docs: "frontend",
  backend: "backend", "CI/CD": "backend", AI: "backend", pipeline: "backend",
  fullstack: "both",
};

// Populate process.env from .env.team without overriding values already set.
export function loadEnvTeam() {
  if (!existsSync(ENV_PATH)) return;
  for (const line of readFileSync(ENV_PATH, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

export function loadConfig() {
  return existsSync(CONFIG_PATH) ? JSON.parse(readFileSync(CONFIG_PATH, "utf8")) : {};
}

// Which agent channel key(s) a card's Category posts to: ["frontend"], ["backend"], or both.
export function channelsFor(category, cfg) {
  const map = { ...DEFAULT_CHANNELS, ...(cfg?.slack?.categoryChannels || {}) };
  const v = map[category] || "backend";
  return v === "both" ? ["frontend", "backend"] : [v];
}

export const text = (s) => [{ type: "text", text: { content: String(s).slice(0, 1900) } }];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/lib/team-config.test.mjs`
Expected: PASS (3 tests)

- [ ] **Step 5: Add the config keys**

In `.claude/team/config.json` add two keys (keep everything else):
```json
  "maxAttempts": 2,
  "slack": {
    "generalChannel": "C0BS1F0PVSA",
    "agentChannels": { "frontend": "C0BS3CM7E4A", "backend": "C0BSXQ4SVQ8" },
    "slackUserId": "U0B421ZJDU4",
    "categoryChannels": {
      "frontend": "frontend", "docs": "frontend",
      "backend": "backend", "CI/CD": "backend", "AI": "backend", "pipeline": "backend",
      "fullstack": "both"
    }
  },
```
Verify: `node -e "const c=JSON.parse(require('fs').readFileSync('.claude/team/config.json','utf8')); console.log(c.maxAttempts, c.slack.categoryChannels.fullstack)"` → `2 both`

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/team-config.mjs scripts/lib/team-config.test.mjs .claude/team/config.json
git commit -m "team: shared config module with v2 status vocabulary and category routing"
```

---

### Task 2: Slack message builders

**Files:**
- Create: `scripts/lib/slack-format.mjs`
- Create: `scripts/lib/slack-format.test.mjs`

**Interfaces:**
- Produces: `qaCardText(t)`, `failCardText(t)`, `runSummaryText(r)`, `sessionReportText(s)`, `parseAgentNotes(body)`, `countByCategory(items)`, `sha7(sha)`. Input shapes are the JSON files the orchestrator writes (see Task 5's commands); documented in the module header.

- [ ] **Step 1: Write the failing tests**

`scripts/lib/slack-format.test.mjs`:
```js
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
    leftTodo: 2, pr: { number: 27, count: 4 }, prSkipped: null,
  });
  assert.equal(t,
`🟢 Run done · 10:00–11:40 · 2 shipped to dev, 1 failed, 2 left in To Do
frontend 1 · fullstack 1
• A
• B
Failed: C (verify, attempt 1/2 → details in #agent-backend)
dev → main PR: #27 (4 tasks waiting for your merge)`);
  const u = runSummaryText({ start: "02:00", end: "02:30", shipped: [], failed: [], leftTodo: 0, pr: null, prSkipped: "dev-ci red on 1a2b3c4" });
  assert.match(u, /0 shipped to dev, 0 failed, 0 left in To Do\n/);
  assert.match(u, /dev → main PR: not opened — dev-ci red on 1a2b3c4$/);
  assert.doesNotMatch(u, /\n\n/);
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test scripts/lib/slack-format.test.mjs`
Expected: FAIL — `Cannot find module './slack-format.mjs'`

- [ ] **Step 3: Write the module**

`scripts/lib/slack-format.mjs`:
```js
// Pure Slack message builders for the team pipeline. No I/O.
//
// qaCardText   ({title, category, priority, model, effort, planModel, fixCycles, did, check, devUrl, commit, half?})
// failCardText ({title, category, attempts, maxAttempts, model, effort, planModel, stage, reason, fixCycles, replanned, lastError, cardUrl, needsHuman, half?})
// runSummaryText ({start, end, shipped:[{title,category}], failed:[{title,category,stage,attempts,maxAttempts,channel}], leftTodo, pr:{number,count}|null, prSkipped:string|null})
// sessionReportText ({label, start, end, shipped:[{title,category,sha}], qaWaiting, doneCount}) → {head, text}
import { CATEGORIES } from "./team-config.mjs";

export const sha7 = (sha) => String(sha || "").slice(0, 7);

const designRound = (planModel) => (planModel ? `yes (${planModel})` : "no");
const halfSuffix = (half) => (half ? ` (${half} half)` : "");

export function qaCardText(t) {
  return [
    `✅ ${t.title}${halfSuffix(t.half)}   ·   ${t.category} · ${t.priority || "P2"}`,
    `Model: ${t.model} · effort ${t.effort}  ·  design round: ${designRound(t.planModel)}  ·  fix cycles: ${t.fixCycles ?? 0}`,
    `Did: ${t.did || "see commit"}`,
    `Check: ${t.check || "verify the change"}`,
    `Dev: ${t.devUrl}   ·   commit ${sha7(t.commit)}`,
    `✅ approve   ·   🔄 needs work — reply to say what`,
  ].join("\n");
}

export function failCardText(t) {
  const cycles = `${t.fixCycles ?? 0} fix cycle${t.fixCycles === 1 ? "" : "s"}`;
  const tried = t.replanned ? `${cycles}, 1 replan` : cycles;
  const footer = t.needsHuman
    ? "Needs human ✔ — pipeline will skip it until you uncheck."
    : "Back in To Do — retries next run.";
  return [
    `❌ ${t.title}${halfSuffix(t.half)}   ·   ${t.category} · attempt ${t.attempts}/${t.maxAttempts}`,
    `Model: ${t.model} · effort ${t.effort} · design round: ${designRound(t.planModel)}`,
    `Failed at: ${t.stage} — ${t.reason}`,
    `Tried: ${tried}. Last error: ${t.lastError || "n/a"}`,
    `Post-mortem: ${t.cardUrl}`,
    footer,
  ].join("\n");
}

export function countByCategory(items) {
  const n = {};
  for (const it of items) n[it.category] = (n[it.category] || 0) + 1;
  return CATEGORIES.filter((c) => n[c]).map((c) => `${c} ${n[c]}`).join(" · ");
}

export function runSummaryText(r) {
  const lines = [
    `🟢 Run done · ${r.start}–${r.end} · ${r.shipped.length} shipped to dev, ${r.failed.length} failed, ${r.leftTodo} left in To Do`,
  ];
  const counts = countByCategory(r.shipped);
  if (counts) lines.push(counts);
  for (const s of r.shipped) lines.push(`• ${s.title}`);
  for (const f of r.failed) lines.push(`Failed: ${f.title} (${f.stage}, attempt ${f.attempts}/${f.maxAttempts} → details in #agent-${f.channel})`);
  if (r.pr) lines.push(`dev → main PR: #${r.pr.number} (${r.pr.count} tasks waiting for your merge)`);
  else lines.push(`dev → main PR: not opened — ${r.prSkipped || "dev not ahead of main"}`);
  return lines.join("\n");
}

export function sessionReportText(s) {
  const head = `📋 *${s.label}* — dev ${s.start}–${s.end}`;
  const tail = `QA: ${s.qaWaiting} waiting · Done: ${s.doneCount} reached main this window`;
  if (!s.shipped.length) return { head, text: `${head}: no work this session.\n${tail}` };
  const lines = [`${head}: ${s.shipped.length} task(s) shipped`];
  const counts = countByCategory(s.shipped);
  if (counts) lines.push(counts);
  for (const t of s.shipped) lines.push(`• ${t.title} (${sha7(t.sha)})`);
  lines.push(tail);
  return { head, text: lines.join("\n") };
}

// Returns [{agent, did, assumed}] from a "## Agent notes" block (commit body or PR body), or [].
export function parseAgentNotes(body) {
  const out = [];
  const m = String(body || "").match(/## Agent notes([\s\S]*?)(?:\n## |\n*$)/);
  if (!m) return out;
  const re = /- agent:\s*(\S+)[\s\S]*?did:\s*(.*?)\s*(?:\n\s*assumed:\s*(.*?))?(?=\n\s*- agent:|\n*$)/g;
  let x;
  while ((x = re.exec(m[1]))) out.push({ agent: x[1].trim(), did: (x[2] || "").trim(), assumed: (x[3] || "none").trim() });
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test scripts/lib/slack-format.test.mjs`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/slack-format.mjs scripts/lib/slack-format.test.mjs
git commit -m "team: pure Slack message builders for QA/failure cards and run summaries"
```

---

### Task 3: Spec assembly (body + Attachments + comments)

**Files:**
- Create: `scripts/lib/notion-spec.mjs`
- Create: `scripts/lib/notion-spec.test.mjs`

**Interfaces:**
- Produces: `async assembleSpec({ blocks, files, comments, botId, download }) → string`. `download(url, index) → Promise<string|null>` is injected (returns a local path or null). `blocks` = Notion block objects; `files` = a page's `Attachments.files` array; `comments` = Notion comment objects (`rich_text`, `attachments`, `created_by`, `created_time`).

- [ ] **Step 1: Write the failing tests**

`scripts/lib/notion-spec.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleSpec } from "./notion-spec.mjs";

const rt = (s) => [{ plain_text: s }];
const download = async (url, i) => (url.includes("fail") ? null : `/tmp/att/${i}.png`);

test("body blocks: headings, bullets, paragraphs, images", async () => {
  const blocks = [
    { type: "heading_2", heading_2: { rich_text: rt("Goal") } },
    { type: "paragraph", paragraph: { rich_text: rt("Make it fast") } },
    { type: "bulleted_list_item", bulleted_list_item: { rich_text: rt("step one") } },
    { type: "image", image: { type: "file", file: { url: "https://n/1.png" } } },
    { type: "image", image: { type: "external", external: { url: "https://n/fail.png" } } },
  ];
  const out = await assembleSpec({ blocks, files: [], comments: [], botId: "bot", download });
  assert.equal(out, [
    "## Goal", "Make it fast", "- step one", "[Image attached: /tmp/att/0.png]",
    "[Image attached: DOWNLOAD FAILED — an image exists on this card but could not be fetched; ask the owner to re-upload it directly in Notion before building]",
  ].join("\n"));
});

test("Attachments property: images vs other files, external urls", async () => {
  const files = [
    { type: "file", name: "mock.png", file: { url: "https://n/mock.png" } },
    { type: "external", name: "brief.pdf", external: { url: "https://x/brief.pdf" } },
  ];
  const out = await assembleSpec({ blocks: [], files, comments: [], botId: "bot", download });
  assert.equal(out, "[Image attached: /tmp/att/0.png]\n[File attached: /tmp/att/1.png (brief.pdf)]");
});

test("comments: owner comments included with attachments, bot comments skipped", async () => {
  const comments = [
    { created_by: { id: "bot" }, created_time: "2026-09-16T10:00:00Z", rich_text: rt("🤖 started"), attachments: [] },
    { created_by: { id: "u1", name: "Stefan" }, created_time: "2026-09-16T11:00:00Z", rich_text: rt("also see this"),
      attachments: [{ category: "image", file: { url: "https://n/c.png" } }] },
  ];
  const out = await assembleSpec({ blocks: [], files: [], comments, botId: "bot", download });
  assert.equal(out, "## Comment (Stefan, 2026-09-16)\nalso see this\n[Image attached: /tmp/att/0.png]");
});

test("download index is continuous across sources", async () => {
  const seen = [];
  const dl = async (url, i) => { seen.push(i); return `/p/${i}`; };
  await assembleSpec({
    blocks: [{ type: "image", image: { type: "file", file: { url: "a" } } }],
    files: [{ type: "file", name: "b.png", file: { url: "b" } }],
    comments: [{ created_by: { id: "u" }, created_time: "2026-01-01T00:00:00Z", rich_text: rt("c"), attachments: [{ category: "image", file: { url: "c" } }] }],
    botId: "bot", download: dl,
  });
  assert.deepEqual(seen, [0, 1, 2]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test scripts/lib/notion-spec.test.mjs`
Expected: FAIL — `Cannot find module './notion-spec.mjs'`

- [ ] **Step 3: Write the module**

`scripts/lib/notion-spec.mjs`:
```js
// Pure spec assembly for a Notion task card: body blocks + Attachments property + comments.
// `download(url, index)` is injected so this stays testable; it returns a local path or null.
const FAILED = "[Image attached: DOWNLOAD FAILED — an image exists on this card but could not be fetched; ask the owner to re-upload it directly in Notion before building]";
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg)(\?|$)/i;

const plain = (rich) => (rich || []).map((t) => t.plain_text).join("");
const fileUrl = (f) => (f.type === "external" ? f.external?.url : f.file?.url);

export async function assembleSpec({ blocks = [], files = [], comments = [], botId, download }) {
  let index = 0;
  const out = [];
  const grab = async (url, label) => {
    const path = await download(url, index++);
    if (!path) return FAILED;
    return label ? `[File attached: ${path} (${label})]` : `[Image attached: ${path}]`;
  };

  for (const b of blocks) {
    if (b.type === "image") { out.push(await grab(fileUrl(b.image))); continue; }
    const rich = b[b.type]?.rich_text;
    if (!rich) continue;
    const prefix = b.type.startsWith("heading") ? "## " : b.type === "bulleted_list_item" ? "- " : "";
    out.push(prefix + plain(rich));
  }

  for (const f of files) {
    const url = fileUrl(f);
    const isImage = IMAGE_EXT.test(f.name || "") || IMAGE_EXT.test(url || "");
    out.push(await grab(url, isImage ? null : f.name || "file"));
  }

  for (const c of comments) {
    if (c.created_by?.id === botId) continue;
    const who = c.created_by?.name || "owner";
    out.push(`## Comment (${who}, ${String(c.created_time || "").slice(0, 10)})`);
    const body = plain(c.rich_text);
    if (body) out.push(body);
    for (const a of c.attachments || []) {
      const isImage = a.category === "image";
      out.push(await grab(a.file?.url, isImage ? null : a.category || "file"));
    }
  }
  return out.join("\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test scripts/lib/notion-spec.test.mjs`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/notion-spec.mjs scripts/lib/notion-spec.test.mjs
git commit -m "team: spec assembly reads card body, Attachments property and comment images"
```

---

### Task 4: `notion.mjs` for the v2 state machine

**Files:**
- Modify: `scripts/notion.mjs` (full rewrite — the file is 234 lines; replace it)

**Interfaces:**
- Consumes: Task 1 (`STATUS`, `loadEnvTeam`, `loadConfig`, `text`, `ROOT`), Task 3 (`assembleSpec`).
- Produces CLI commands (all print to stdout; exit 1 on Notion error):
  - `check-pause` (unchanged: exit 3 when paused)
  - `list-todo` → JSON `[{id,title,priority,category,difficulty,attempts,url}]` P0→P2 then oldest first; excludes CONTROL and `Needs human`
  - `list-qa` → JSON `[{id,title,category,commit,url}]`
  - `list-in-progress` → JSON `[{id,title}]` (for the stale sweep)
  - `get-spec <id>` → text
  - `claim <id> --model "<text>"` → status In progress, Model set, comment `🤖 started · <text>`
  - `ship-card <id> --commit <sha> --branch <b> --model "<text>" --dev-url <url>` → Commit/Branch/Model set, status QA, comment
  - `fail-card <id> --stage <s> --reason "<one line>" --postmortem-file <path>` → Attempts+1; `Needs human` when ≥ `maxAttempts`; status To Do; mention comment; prints JSON `{attempts, needsHuman, maxAttempts}`
  - `mark-done <id>` → status Done + comment `🚀 in production`
  - `set-status <id> <status>`, `comment <id> <text> [--mention]`, `archive-card <id>`, `clear-slack-ts <id>` (unchanged)
  - `set-props <id> [--branch b] [--commit sha] [--slack-ts "<chan>:<ts>[,<chan>:<ts>]"] [--category c]`
  - `list-awaiting-feedback` → `[{id,title,slackTs,category}]`
  - `create-card <title> [--category c] [--body text]` → To Do
  - `migrate-v2 --qa <id>:<sha>,... --category <id>=<cat>,...` (Task 10)
  - `setup <parentPageId>`, `whoami-user <email>` (kept)

- [ ] **Step 1: Replace the file**

`scripts/notion.mjs`:
```js
#!/usr/bin/env node
// Deterministic Notion I/O for the team pipeline. Zero deps (Node 18+ fetch).
// Env: NOTION_TOKEN (from .env.team or process env). Config: .claude/team/config.json
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, STATUS, CATEGORIES, loadEnvTeam, loadConfig, text } from "./lib/team-config.mjs";
import { assembleSpec } from "./lib/notion-spec.mjs";

loadEnvTeam();
const TOKEN = process.env.NOTION_TOKEN;
if (!TOKEN) { console.error("NOTION_TOKEN missing (set in .env.team or env)"); process.exit(2); }
const cfg = loadConfig();
const DB = process.env.NOTION_DB_ID || cfg.notionDbId;
const USER = process.env.NOTION_USER_ID || cfg.notionUserId;
const MAX_ATTEMPTS = Number(cfg.maxAttempts ?? 2);
const VERSION = "2022-06-28";
// The comments endpoint only returns `attachments` on newer API versions; everything
// else stays on the version the rest of this file was written against.
const COMMENTS_VERSION = process.env.NOTION_COMMENTS_VERSION || "2025-09-03";

async function api(path, method = "GET", body, version = VERSION) {
  const res = await fetch(`https://api.notion.com/v1/${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, "Notion-Version": version, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) { console.error(`Notion ${res.status}: ${json.message}`); process.exit(1); }
  return json;
}

const sel = (names, colors = {}) => ({ select: { options: names.map((n) => ({ name: n, ...(colors[n] ? { color: colors[n] } : {}) })) } });
const STATUS_COLORS = { [STATUS.BACKLOG]: "gray", [STATUS.TODO]: "red", [STATUS.IN_PROGRESS]: "blue", [STATUS.QA]: "yellow", [STATUS.DONE]: "green" };
const SCHEMA = {
  Name: { title: {} },
  Status: sel(Object.values(STATUS), STATUS_COLORS),
  Category: sel([...CATEGORIES]),
  Priority: sel(["P0", "P1", "P2"], { P0: "red", P1: "yellow", P2: "gray" }),
  Attachments: { files: {} },
  Attempts: { number: { format: "number" } },
  "Needs human": { checkbox: {} },
  Model: { rich_text: {} },
  Difficulty: sel(["trivial", "standard", "hard"], { trivial: "gray", standard: "blue", hard: "red" }),
  Commit: { rich_text: {} },
  Branch: { rich_text: {} },
  SlackTs: { rich_text: {} },
  Paused: { checkbox: {} },
};

const arg = (args, flag) => { const i = args.indexOf(flag); return i > -1 ? args[i + 1] : undefined; };
const plain = (rich) => (rich || []).map((t) => t.plain_text).join("");
const isControl = (p) => plain(p.properties?.Name?.title).startsWith("CONTROL");
const row = (p) => ({
  id: p.id,
  title: plain(p.properties.Name?.title),
  priority: p.properties.Priority?.select?.name || "P2",
  category: p.properties.Category?.select?.name || "backend",
  difficulty: p.properties.Difficulty?.select?.name || null,
  attempts: p.properties.Attempts?.number || 0,
  commit: plain(p.properties.Commit?.rich_text),
  slackTs: plain(p.properties.SlackTs?.rich_text),
  url: p.url,
});

async function queryAll(filter) {
  let cursor, results = [];
  do {
    const r = await api(`databases/${DB}/query`, "POST", { ...(filter ? { filter } : {}), page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
    results = results.concat(r.results);
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor);
  return results.filter((p) => !isControl(p));
}

async function setStatus(pageId, status) {
  await api(`pages/${pageId}`, "PATCH", { properties: { Status: { select: { name: status } } } });
}

async function comment(pageId, body, mention) {
  const rich = [];
  if (mention && USER) rich.push({ type: "mention", mention: { user: { id: USER } } }, { type: "text", text: { content: " " } });
  rich.push({ type: "text", text: { content: String(body).slice(0, 1900) } });
  await api("comments", "POST", { parent: { page_id: pageId }, rich_text: rich });
}

// ---------- commands ----------

async function cmdSetup(parentPageId) {
  const db = await api("databases", "POST", { parent: { type: "page_id", page_id: parentPageId }, title: text("NBA Team Board"), properties: SCHEMA });
  console.log(`DB created: ${db.id}`);
  await api("pages", "POST", { parent: { database_id: db.id }, properties: { Name: { title: text("CONTROL — do not delete") }, Paused: { checkbox: false } } });
  console.log("CONTROL row created");
}

async function cmdWhoamiUser(email) {
  let cursor, found;
  do {
    const r = await api(`users?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`);
    found = r.results.find((u) => u.person?.email === email);
    cursor = r.has_more ? r.next_cursor : null;
  } while (!found && cursor);
  if (!found) { console.error(`No user with email ${email}`); process.exit(1); }
  console.log(found.id);
}

async function cmdCheckPause() {
  const r = await api(`databases/${DB}/query`, "POST", { filter: { property: "Paused", checkbox: { equals: true } } });
  if (r.results.some(isControl)) { console.log("PAUSED"); process.exit(3); }
  console.log("RUNNING");
}

async function cmdListTodo() {
  const pages = await queryAll({ and: [
    { property: "Status", select: { equals: STATUS.TODO } },
    { property: "Needs human", checkbox: { equals: false } },
  ] });
  const rank = { P0: 0, P1: 1, P2: 2 };
  const rows = pages.map((p) => ({ ...row(p), created: p.created_time }))
    .sort((a, b) => (rank[a.priority] - rank[b.priority]) || a.created.localeCompare(b.created))
    .map(({ created, commit, slackTs, ...r }) => r);
  console.log(JSON.stringify(rows, null, 2));
}

async function cmdListQa() {
  const pages = await queryAll({ property: "Status", select: { equals: STATUS.QA } });
  console.log(JSON.stringify(pages.map((p) => { const r = row(p); return { id: r.id, title: r.title, category: r.category, commit: r.commit, url: r.url }; }), null, 2));
}

async function cmdListInProgress() {
  const pages = await queryAll({ property: "Status", select: { equals: STATUS.IN_PROGRESS } });
  console.log(JSON.stringify(pages.map((p) => ({ id: p.id, title: plain(p.properties.Name?.title) })), null, 2));
}

// Some external image hosts (e.g. Wikimedia) reject requests that carry no User-Agent.
const IMAGE_UA = "nba-minigames-team-pipeline/1.0 (+https://github.com/stefanroman22/nba-trivia-minigames)";
function downloader(pageId) {
  return async (url, index) => {
    if (!url) return null;
    let res;
    try { res = await fetch(url, { headers: { "User-Agent": IMAGE_UA } }); } catch { return null; }
    if (!res.ok) { console.error(`Attachment download failed (${res.status}): ${url}`); return null; }
    const ct = res.headers.get("content-type") || "";
    const ext = ct.includes("png") ? "png" : ct.includes("gif") ? "gif" : ct.includes("webp") ? "webp" : ct.includes("pdf") ? "pdf" : ct.includes("jpeg") ? "jpg" : "bin";
    const dir = resolve(ROOT, ".team/attachments", pageId);
    mkdirSync(dir, { recursive: true });
    const path = resolve(dir, `${index}.${ext}`);
    writeFileSync(path, Buffer.from(await res.arrayBuffer()));
    return path;
  };
}

async function cmdGetSpec(pageId) {
  let cursor, blocks = [];
  do {
    const r = await api(`blocks/${pageId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`);
    blocks = blocks.concat(r.results);
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor);
  const page = await api(`pages/${pageId}`);
  const files = page.properties?.Attachments?.files || [];
  let ccur, comments = [];
  do {
    const r = await api(`comments?block_id=${pageId}&page_size=100${ccur ? `&start_cursor=${ccur}` : ""}`, "GET", undefined, COMMENTS_VERSION);
    comments = comments.concat(r.results);
    ccur = r.has_more ? r.next_cursor : null;
  } while (ccur);
  const me = await api("users/me");
  console.log(await assembleSpec({ blocks, files, comments, botId: me.id, download: downloader(pageId) }));
}

async function cmdClaim(pageId, args) {
  const model = arg(args, "--model") || "";
  await api(`pages/${pageId}`, "PATCH", { properties: { Status: { select: { name: STATUS.IN_PROGRESS } }, Model: { rich_text: text(model) } } });
  await comment(pageId, `🤖 started · ${model}`, false);
  console.log("claimed");
}

async function cmdShipCard(pageId, args) {
  const commitSha = arg(args, "--commit"), branch = arg(args, "--branch"), model = arg(args, "--model") || "", devUrl = arg(args, "--dev-url") || cfg.devSiteUrl || "";
  if (!commitSha) { console.error("--commit required"); process.exit(2); }
  await api(`pages/${pageId}`, "PATCH", { properties: {
    Status: { select: { name: STATUS.QA } },
    Commit: { rich_text: text(commitSha) },
    ...(branch ? { Branch: { rich_text: text(branch) } } : {}),
    Model: { rich_text: text(model) },
  } });
  await comment(pageId, `✅ on dev (${commitSha.slice(0, 7)}) — check ${devUrl}`, true);
  console.log("shipped");
}

async function cmdFailCard(pageId, args) {
  const stage = arg(args, "--stage") || "unknown", reason = arg(args, "--reason") || "";
  const pmPath = arg(args, "--postmortem-file");
  const postmortem = pmPath ? readFileSync(pmPath, "utf8") : reason;
  const page = await api(`pages/${pageId}`);
  const attempts = (page.properties?.Attempts?.number || 0) + 1;
  const needsHuman = attempts >= MAX_ATTEMPTS;
  await api(`pages/${pageId}`, "PATCH", { properties: {
    Status: { select: { name: STATUS.TODO } },
    Attempts: { number: attempts },
    "Needs human": { checkbox: needsHuman },
  } });
  const head = `❌ attempt ${attempts}/${MAX_ATTEMPTS} failed at ${stage}: ${reason}` + (needsHuman ? " — Needs human is set; uncheck it to let the pipeline retry." : " — back in To Do, retries next run.");
  await comment(pageId, `${head}\n\n${postmortem}`, true);
  console.log(JSON.stringify({ attempts, needsHuman, maxAttempts: MAX_ATTEMPTS }));
}

async function cmdMarkDone(pageId) {
  await setStatus(pageId, STATUS.DONE);
  await comment(pageId, "🚀 in production", true);
  console.log("done");
}

async function cmdSetProps(pageId, args) {
  const props = {};
  const b = arg(args, "--branch"); if (b) props.Branch = { rich_text: text(b) };
  const c = arg(args, "--commit"); if (c) props.Commit = { rich_text: text(c) };
  const s = arg(args, "--slack-ts"); if (s) props.SlackTs = { rich_text: text(s) };
  const cat = arg(args, "--category"); if (cat) props.Category = { select: { name: cat } };
  await api(`pages/${pageId}`, "PATCH", { properties: props });
  console.log("props set");
}

async function cmdCreateCard(title, args) {
  const props = { Name: { title: text(title) }, Status: { select: { name: STATUS.TODO } }, Priority: { select: { name: "P1" } } };
  const cat = arg(args, "--category"); if (cat) props.Category = { select: { name: cat } };
  const page = { parent: { database_id: DB }, properties: props };
  const body = arg(args, "--body");
  if (body) page.children = [{ object: "block", type: "paragraph", paragraph: { rich_text: text(body) } }];
  const r = await api("pages", "POST", page);
  console.log(r.id);
}

async function cmdArchiveCard(pageId) { await api(`pages/${pageId}`, "PATCH", { archived: true }); console.log("archived"); }

async function cmdListAwaitingFeedback() {
  const pages = await queryAll({ property: "SlackTs", rich_text: { is_not_empty: true } });
  console.log(JSON.stringify(pages.map((p) => { const r = row(p); return { id: r.id, title: r.title, slackTs: r.slackTs, category: r.category }; }).filter((x) => x.slackTs), null, 2));
}

async function cmdClearSlackTs(pageId) { await api(`pages/${pageId}`, "PATCH", { properties: { SlackTs: { rich_text: [] } } }); console.log("slack-ts cleared"); }

// One-shot migration from the v1 board (Ready/In Progress/In Review/Blocked/…) to v2.
// --qa <id>:<sha>,...       Done cards whose commit is on dev but not main → QA with Commit set
// --category <id>=<cat>,... Category for existing cards (Area is dropped)
async function cmdMigrateV2(args) {
  const qa = Object.fromEntries((arg(args, "--qa") || "").split(",").filter(Boolean).map((s) => s.split(":")));
  const cats = Object.fromEntries((arg(args, "--category") || "").split(",").filter(Boolean).map((s) => s.split("=")));
  const OLD = ["Backlog", "Ready", "In Progress", "In Review", "Blocked", "Blocked-approval", "Done"];
  // 1. add the new options + properties while the old options still exist
  await api(`databases/${DB}`, "PATCH", { properties: {
    Status: sel([...new Set([...OLD, ...Object.values(STATUS)])], STATUS_COLORS),
    Category: SCHEMA.Category, Attachments: SCHEMA.Attachments, Attempts: SCHEMA.Attempts,
    "Needs human": SCHEMA["Needs human"], Model: SCHEMA.Model, Commit: SCHEMA.Commit,
  } });
  // 2. move every row
  const map = { Ready: STATUS.TODO, "In Progress": STATUS.IN_PROGRESS, "In Review": STATUS.QA, Blocked: STATUS.TODO, "Blocked-approval": STATUS.TODO };
  for (const p of await queryAll()) {
    const old = p.properties.Status?.select?.name;
    const props = { Attempts: { number: 0 } };
    if (qa[p.id]) { props.Status = { select: { name: STATUS.QA } }; props.Commit = { rich_text: text(qa[p.id]) }; }
    else if (map[old]) props.Status = { select: { name: map[old] } };
    if (old === "Blocked" || old === "Blocked-approval") props["Needs human"] = { checkbox: true };
    if (cats[p.id]) props.Category = { select: { name: cats[p.id] } };
    await api(`pages/${p.id}`, "PATCH", { properties: props });
    console.log(`migrated ${p.id}: ${old} → ${props.Status?.select?.name || old}`);
  }
  // 3. final option set, drop Area + PR
  await api(`databases/${DB}`, "PATCH", { properties: { Status: SCHEMA.Status, Area: null, PR: null } });
  console.log("schema finalized");
}

const [cmd, ...args] = process.argv.slice(2);
const run = {
  "setup": () => cmdSetup(args[0]),
  "whoami-user": () => cmdWhoamiUser(args[0]),
  "check-pause": cmdCheckPause,
  "list-todo": cmdListTodo,
  "list-qa": cmdListQa,
  "list-in-progress": cmdListInProgress,
  "get-spec": () => cmdGetSpec(args[0]),
  "claim": () => cmdClaim(args[0], args.slice(1)),
  "ship-card": () => cmdShipCard(args[0], args.slice(1)),
  "fail-card": () => cmdFailCard(args[0], args.slice(1)),
  "mark-done": () => cmdMarkDone(args[0]),
  "set-status": () => setStatus(args[0], args[1]).then(() => console.log("status set")),
  "set-props": () => cmdSetProps(args[0], args.slice(1)),
  "comment": () => comment(args[0], args.filter((a) => a !== "--mention").slice(1).join(" "), args.includes("--mention")).then(() => console.log("commented")),
  "create-card": () => cmdCreateCard(args[0], args.slice(1)),
  "archive-card": () => cmdArchiveCard(args[0]),
  "list-awaiting-feedback": cmdListAwaitingFeedback,
  "clear-slack-ts": () => cmdClearSlackTs(args[0]),
  "migrate-v2": () => cmdMigrateV2(args),
}[cmd];
if (!run) { console.error(`Unknown command: ${cmd}`); process.exit(2); }
await run();
```

- [ ] **Step 2: Syntax + read-only smoke test (board is still v1 at this point — only run commands that don't write)**

Run: `node --check scripts/notion.mjs && node scripts/notion.mjs check-pause`
Expected: `RUNNING`

Run: `node scripts/notion.mjs get-spec 3dc2cfb1-c595-8091-8f43-fbb569703a1b`
Expected: the profile-photo card's spec text (currently empty body → the output is only the pipeline's own comments filtered out, i.e. possibly empty) and **no error** from the comments call. If the comments call returns `Notion 400: ... Notion-Version`, set `COMMENTS_VERSION` to `"2022-06-28"` in the file, re-run, and add a comment with an image to any test card to confirm `attachments` is present in the response (`node -e` with fetch, or `curl -H "Notion-Version: 2022-06-28" ...`). Record which version worked in the commit message.

- [ ] **Step 3: Run all lib tests still pass**

Run: `node --test scripts/lib/`
Expected: PASS (15 tests)

- [ ] **Step 4: Commit**

```bash
git add scripts/notion.mjs
git commit -m "team: notion.mjs v2 — To Do/In progress/QA/Done commands, fail-card with attempts, spec from body+attachments+comments, migrate-v2"
```

---

### Task 5: `slack.mjs` for agent-channel cards and run summaries

**Files:**
- Modify: `scripts/slack.mjs` (full rewrite; replace the 255-line file)

**Interfaces:**
- Consumes: Task 1 (`loadEnvTeam`, `loadConfig`, `channelsFor`), Task 2 (all builders), Task 4 (`notion.mjs list-awaiting-feedback`, `set-props --slack-ts`, `clear-slack-ts`, `create-card --category`, `list-qa`).
- Produces CLI commands:
  - `post-qa-card <json-file>` — JSON = `qaCardText` input + `pageId`, `category`; posts to `channelsFor(category)` (fullstack: one card per half with `half`); stores `SlackTs` as `<chan>:<ts>[,<chan>:<ts>]`
  - `post-fail-card <json-file>` — JSON = `failCardText` input + `category`
  - `post-run-summary <json-file>` — JSON = `runSummaryText` input
  - `poll-reactions` → JSON `[{action:"followup"|"ack", pageId, title, category, note}]`
  - `digest-window <startISO> <endISO> <label>` — git-based session report
  - `ping`, `resolve-channels` (kept)

- [ ] **Step 1: Replace the file**

`scripts/slack.mjs`:
```js
#!/usr/bin/env node
// Deterministic Slack I/O for the team pipeline. Zero deps (Node 18+ fetch).
// Env: SLACK_BOT_TOKEN (from .env.team or process env). Config: .claude/team/config.json
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { CONFIG_PATH, loadEnvTeam, loadConfig, channelsFor } from "./lib/team-config.mjs";
import { qaCardText, failCardText, runSummaryText, sessionReportText, parseAgentNotes } from "./lib/slack-format.mjs";

loadEnvTeam();
const TOKEN = process.env.SLACK_BOT_TOKEN;
if (!TOKEN) { console.error("SLACK_BOT_TOKEN missing (set in .env.team or env)"); process.exit(2); }
const cfg = loadConfig();
const sh = (c) => execSync(c, { encoding: "utf8" });
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

async function api(method, params = {}, post = false) {
  const r = await apiTry(method, params, post);
  if (!r.ok) { console.error(`Slack ${method} error: ${r.error}`); process.exit(1); }
  return r;
}
// Non-fatal: returns the json even on ok:false, never exits.
async function apiTry(method, params = {}, post = false) {
  try {
    const url = `https://slack.com/api/${method}`;
    const res = post
      ? await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(params) })
      : await fetch(`${url}?${new URLSearchParams(params).toString()}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    return await res.json();
  } catch { return { ok: false, error: "fetch_failed" }; }
}

const agentChannelId = (key) => cfg.slack?.agentChannels?.[key];

async function cmdPing(channel, ...text) {
  const r = await api("chat.postMessage", { channel, text: text.join(" ") || "ping from nba-team-pipeline" }, true);
  console.log(`posted ts=${r.ts} channel=${r.channel}`);
}

async function cmdResolveChannels() {
  const want = { "pipeline": "generalChannel", "agent-frontend": "frontend", "agent-backend": "backend" };
  const found = {};
  let cursor;
  do {
    const r = await api("conversations.list", { limit: "200", types: "public_channel,private_channel", ...(cursor ? { cursor } : {}) });
    for (const c of r.channels) if (want[c.name]) found[c.name] = c.id;
    cursor = r.response_metadata?.next_cursor || "";
  } while (cursor);
  const conf = readJson(CONFIG_PATH);
  conf.slack = conf.slack || {};
  conf.slack.agentChannels = conf.slack.agentChannels || {};
  for (const [name, id] of Object.entries(found)) {
    if (name === "pipeline") conf.slack.generalChannel = id; else conf.slack.agentChannels[want[name]] = id;
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(conf, null, 2) + "\n");
  const missing = Object.keys(want).filter((n) => !found[n]);
  console.log(`resolved: ${Object.keys(found).join(", ") || "none"}`);
  if (missing.length) console.error(`MISSING (invite the bot to these): ${missing.join(", ")}`);
}

// One QA card per agent channel the Category routes to. Fullstack cards carry `halves`
// ({frontend:{did,model,effort}, backend:{...}}) so each channel gets its own half.
async function cmdPostQaCard(jsonPath) {
  const t = readJson(jsonPath);
  const keys = channelsFor(t.category, cfg);
  const refs = [];
  for (const key of keys) {
    const chan = agentChannelId(key);
    if (!chan) { console.error(`no agentChannels.${key} in config (skipping)`); continue; }
    const half = keys.length > 1 ? key : undefined;
    const h = t.halves?.[key] || {};
    const text = qaCardText({ ...t, ...h, half, devUrl: t.devUrl || cfg.devSiteUrl });
    const r = await apiTry("chat.postMessage", { channel: chan, text }, true);
    if (r.ok) refs.push(`${chan}:${r.ts}`); else console.error(`qa card to ${key} failed (non-fatal): ${r.error}`);
  }
  if (refs.length && t.pageId) {
    try { sh(`node scripts/notion.mjs set-props ${t.pageId} --slack-ts "${refs.join(",")}"`); }
    catch { console.error(`could not store slack ts for ${t.pageId} (non-fatal)`); }
  }
  console.log(`posted qa card to ${refs.length} channel(s)`);
}

async function cmdPostFailCard(jsonPath) {
  const t = readJson(jsonPath);
  for (const key of channelsFor(t.category, cfg)) {
    const chan = agentChannelId(key);
    if (!chan) continue;
    const r = await apiTry("chat.postMessage", { channel: chan, text: failCardText(t) }, true);
    console.log(r.ok ? `posted fail card to ${key}` : `fail card to ${key} failed (non-fatal): ${r.error}`);
  }
}

async function cmdPostRunSummary(jsonPath) {
  const r0 = readJson(jsonPath);
  const chan = cfg.slack?.generalChannel;
  if (!chan) { console.error("no generalChannel in config"); process.exit(1); }
  const r = await apiTry("chat.postMessage", { channel: chan, text: runSummaryText(r0) }, true);
  console.log(r.ok ? `posted run summary ts=${r.ts}` : `run summary failed (non-fatal): ${r.error}`);
}

const FIX_RX = /^(x|heavy_multiplication_x|repeat|arrows_counterclockwise|no_entry|hammer)$/;
const OK_RX = /^(white_check_mark|heavy_check_mark|\+1|ok_hand)$/;

// Reads reactions on every QA card still awaiting feedback (SlackTs = "<chan>:<ts>[,...]").
// Only the configured owner's reactions count. Clearing SlackTs is the dedup marker.
async function cmdPollReactions() {
  const me = cfg.slack?.slackUserId;
  const items = [];
  let awaiting = [];
  try { awaiting = JSON.parse(sh(`node scripts/notion.mjs list-awaiting-feedback`)); }
  catch { console.error("could not list awaiting-feedback cards (non-fatal)"); console.log("[]"); return; }
  for (const card of awaiting) {
    let fix = false, ok = false, notes = [];
    for (const ref of card.slackTs.split(",")) {
      const [chan, ts] = ref.split(":");
      if (!chan || !ts) continue;
      const rr = await apiTry("reactions.get", { channel: chan, timestamp: ts, full: "true" });
      if (!rr.ok) continue;
      for (const rx of rr.message?.reactions || []) {
        if (me && !(rx.users || []).includes(me)) continue;
        if (FIX_RX.test(rx.name)) fix = true;
        if (OK_RX.test(rx.name)) ok = true;
      }
      if (fix) {
        const rep = await apiTry("conversations.replies", { channel: chan, ts });
        if (rep.ok) notes.push(...(rep.messages || []).filter((m) => m.user === me && m.ts !== ts).map((m) => m.text));
      }
    }
    if (!fix && !ok) continue;
    items.push(fix
      ? { action: "followup", pageId: card.id, title: card.title, category: card.category, note: notes.join(" | ") || "reviewer flagged 🔄 with no note — re-examine" }
      : { action: "ack", pageId: card.id, title: card.title, category: card.category, note: "" });
    try { sh(`node scripts/notion.mjs clear-slack-ts ${card.id}`); }
    catch { console.error(`could not clear slack ts for ${card.id} (non-fatal)`); }
  }
  console.log(JSON.stringify(items, null, 2));
}

// Commits on a branch inside [start, end) whose body carries "Notion:" (= shipped tasks).
function shippedCommits(branch, startISO, endISO) {
  sh(`git fetch origin ${branch} --quiet`);
  const raw = sh(`git log origin/${branch} --since="${startISO}" --until="${endISO}" --format=%H%x1f%s%x1f%b%x1e`);
  return raw.split("\x1e").map((rec) => rec.trim()).filter(Boolean).map((rec) => {
    const [sha, subject, body] = rec.split("\x1f");
    return { sha, title: subject, body: body || "" };
  }).filter((c) => /^Notion: /m.test(c.body)).map((c) => ({
    ...c, category: (c.body.match(/^Category: (.+)$/m) || [, "backend"])[1].trim(),
  }));
}

async function cmdDigestWindow(startISO, endISO, label) {
  const chan = cfg.slack?.generalChannel;
  const end = Date.parse(endISO);
  const shipped = shippedCommits("dev", startISO, endISO);
  const doneCount = shippedCommits("main", startISO, endISO).length;
  let qaWaiting = 0;
  try { qaWaiting = JSON.parse(sh(`node scripts/notion.mjs list-qa`)).length; } catch { console.error("list-qa failed (non-fatal)"); }
  const { head, text } = sessionReportText({ label, start: startISO.slice(11, 16), end: endISO.slice(11, 16), shipped, qaWaiting, doneCount });
  // Duplicate guard: two schedulers fire this for the same window; Slack stores 📋 as :clipboard:,
  // so match on the emoji-free head. Fails OPEN on API error (a missing report is worse than a double).
  const matchKey = head.replace("📋 ", "");
  if (chan) {
    const hist = await apiTry("conversations.history", { channel: chan, oldest: String(end / 1000), latest: String(end / 1000 + 23 * 3600), inclusive: "true", limit: "100" });
    if (hist.ok && (hist.messages || []).some((m) => m.bot_id && (m.text || "").includes(matchKey))) { console.log("already posted, skipping"); return; }
    if (!hist.ok) console.error(`duplicate-guard check failed (posting anyway): ${hist.error}`);
    const r = await apiTry("chat.postMessage", { channel: chan, text }, true);
    console.log(r.ok ? `posted session line (${shipped.length} shipped)` : `session line failed (non-fatal): ${r.error}`);
  }
  // Per-engine detail from the commit bodies' Agent notes, only when there is work.
  const nameMap = { "frontend-engine": "frontend", "backend-engine": "backend" };
  const buckets = { frontend: [], backend: [] };
  for (const c of shipped) for (const n of parseAgentNotes(c.body)) {
    const key = nameMap[n.agent]; if (key) buckets[key].push(`• ${c.title} (${c.sha.slice(0, 7)}): ${n.did}\n  assumed: ${n.assumed}`);
  }
  for (const [key, lines] of Object.entries(buckets)) {
    const ac = agentChannelId(key);
    if (!ac || !lines.length) continue;
    const r = await apiTry("chat.postMessage", { channel: ac, text: `📆 ${key} · ${label} · ${lines.length} shipped\n${lines.join("\n")}` }, true);
    console.log(r.ok ? `posted ${key} detail` : `${key} detail failed (non-fatal): ${r.error}`);
  }
}

const [cmd, ...args] = process.argv.slice(2);
const run = {
  "ping": () => cmdPing(args[0], ...args.slice(1)),
  "resolve-channels": cmdResolveChannels,
  "post-qa-card": () => cmdPostQaCard(args[0]),
  "post-fail-card": () => cmdPostFailCard(args[0]),
  "post-run-summary": () => cmdPostRunSummary(args[0]),
  "poll-reactions": cmdPollReactions,
  "digest-window": () => cmdDigestWindow(args[0], args[1], args.slice(2).join(" ")),
}[cmd];
if (!run) { console.error(`Unknown command: ${cmd}`); process.exit(2); }
await run();
```

- [ ] **Step 2: Syntax check + a real post to verify formatting (one message, in `#agent-frontend`)**

Write `.team/smoke-qa.json`:
```json
{ "pageId": null, "title": "SMOKE — ignore", "category": "frontend", "priority": "P2", "model": "sonnet", "effort": "high",
  "planModel": null, "fixCycles": 0, "did": "nothing, this is a format test", "check": "nothing", "commit": "0000000deadbeef" }
```
Run: `node --check scripts/slack.mjs && node scripts/slack.mjs post-qa-card .team/smoke-qa.json`
Expected: `posted qa card to 1 channel(s)`; the message in `#agent-frontend` has 6 lines matching Task 2's format. Delete the Slack message by hand afterwards (or leave it — it has no pageId, so `poll-reactions` ignores it).

- [ ] **Step 3: Commit**

```bash
git add scripts/slack.mjs
git commit -m "team: slack.mjs v2 — QA/failure cards in agent channels, run summary, reactions across channels, git-based session report"
```

---

### Task 6: `promote.mjs` — ensure the `dev → main` PR

**Files:**
- Create: `scripts/promote.mjs`

**Interfaces:**
- Consumes: `notion.mjs list-qa` (Task 4), `gh`.
- Produces: `node scripts/promote.mjs ensure-pr` → JSON `{number, count}` or `{skipped: "<reason>"}`. Exit 0 in both cases; exit 1 only on `gh` failures.

- [ ] **Step 1: Write the script**

`scripts/promote.mjs`:
```js
#!/usr/bin/env node
// Keeps exactly one open PR dev → main, listing the cards waiting in QA. Never merges.
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";
import { ROOT } from "./lib/team-config.mjs";

const sh = (c) => execSync(c, { encoding: "utf8" }).trim();
const out = (o) => { console.log(JSON.stringify(o)); process.exit(0); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function devCiState(sha) {
  // Wait briefly for the dev-ci run on this sha to exist and finish (push → run is seconds).
  for (let i = 0; i < 10; i++) {
    const runs = JSON.parse(sh(`gh run list --workflow dev-ci.yml --branch dev --json headSha,status,conclusion --limit 20`));
    const run = runs.find((r) => r.headSha === sha);
    if (run && run.status === "completed") return run.conclusion;
    await sleep(30_000);
  }
  return "pending";
}

async function ensurePr() {
  sh("git fetch origin main dev --quiet");
  if (sh("git rev-list --count origin/main..origin/dev") === "0") out({ skipped: "dev not ahead of main" });
  const head = sh("git rev-parse origin/dev");
  const ci = await devCiState(head);
  if (ci === "pending") out({ skipped: `dev-ci still running on ${head.slice(0, 7)}` });
  if (ci !== "success") out({ skipped: `dev-ci ${ci} on ${head.slice(0, 7)}` });
  const qa = JSON.parse(sh("node scripts/notion.mjs list-qa"));
  const body = [
    "## Tasks in this promotion",
    ...qa.map((c) => `- ${c.title} · ${c.category} · ${c.commit.slice(0, 7)}`),
    "", `Notion-Tasks: ${qa.map((c) => c.id).join(",")}`,
    "", "Merge this PR on GitHub after checking the dev site. `main-sync` will move the cards to Done.",
  ].join("\n");
  const dir = resolve(ROOT, ".team"); mkdirSync(dir, { recursive: true });
  const bodyFile = resolve(dir, "promote-pr-body.md"); writeFileSync(bodyFile, body);
  const title = `Promote dev → main (${qa.length} task${qa.length === 1 ? "" : "s"})`;
  const open = JSON.parse(sh(`gh pr list --base main --head dev --state open --json number`));
  let number;
  if (open.length) { number = open[0].number; sh(`gh pr edit ${number} --title "${title}" --body-file "${bodyFile}"`); }
  else {
    const url = sh(`gh pr create --base main --head dev --title "${title}" --body-file "${bodyFile}" --label promote`);
    number = Number(url.match(/\/pull\/(\d+)/)?.[1]);
  }
  out({ number, count: qa.length });
}

const cmd = process.argv[2];
if (cmd !== "ensure-pr") { console.error("usage: promote.mjs ensure-pr"); process.exit(2); }
await ensurePr();
```

- [ ] **Step 2: Syntax check and a dry read (do NOT create the PR yet — dev-ci's promote job is still live until Task 7 is pushed)**

Run: `node --check scripts/promote.mjs && git fetch origin main dev --quiet && git rev-list --count origin/main..origin/dev`
Expected: a number ≥ 3 (the three PRs on dev). The `ensure-pr` command itself is exercised in Task 12.

Ensure the `promote` label exists: `gh label list --search promote` → if empty: `gh label create promote --color 0E8A16 --description "dev → main promotion PR"`.

- [ ] **Step 3: Commit**

```bash
git add scripts/promote.mjs
git commit -m "team: promote.mjs keeps one open dev→main PR listing the QA cards"
```

---

### Task 7: GitHub Actions — no auto-promote, CTO on `main` PRs, `main-sync`

**Files:**
- Modify: `.github/workflows/dev-ci.yml` (delete the `promote` job + header comment)
- Modify: `.github/workflows/claude.yml` (triggers + `cto-act` body)
- Create: `.github/workflows/main-sync.yml`
- Modify: `.github/workflows/team-reports.yml` (`fetch-depth: 0`)

- [ ] **Step 1: `dev-ci.yml` — remove promotion**

Replace the header comment (lines 3–5) with:
```yaml
# Runs on pushes to dev and on PRs targeting dev: lint + secret scan only. Promotion to
# main is a human-merged PR (dev → main), see docs/team/PIPELINE.md §10.
```
Delete the whole `promote:` job (lines 50–77). The file ends after the `security` job's `run:` block.

Verify: `node -e "const y=require('fs').readFileSync('.github/workflows/dev-ci.yml','utf8'); if(/promote/.test(y)) throw new Error('promote still present'); console.log('ok')"`

- [ ] **Step 2: `claude.yml` — CTO reviews the batch PR into main**

Change the `pull_request` trigger:
```yaml
  pull_request:
    types: [opened, synchronize, reopened]
    branches: [main]
```
Change the comment above `cto-review` and both `if:` conditions:
```yaml
  # Trust model: the dev → main PR is opened only by the owner's pipeline (scripts/promote.mjs).
  cto-review:
    if: github.event_name == 'pull_request' && github.head_ref == 'dev' && github.base_ref == 'main'
```
```yaml
  cto-act:
    needs: cto-review
    if: github.event_name == 'pull_request' && github.head_ref == 'dev' && github.base_ref == 'main'
```
Replace the `Extract Notion task id` step with:
```yaml
      - name: Extract Notion task ids
        id: meta
        run: |
          BODY=$(gh pr view "$PR" --json body -q .body)
          echo "notion_tasks=$(echo "$BODY" | grep -oP 'Notion-Tasks: \K\S+' || true)" >> "$GITHUB_OUTPUT"
```
Replace the whole `Act on verdict` step with (labels + comments only — **no merge**):
```yaml
      - name: Act on verdict
        run: |
          VERDICT=$(jq -r .verdict cto-verdict.json)
          SUMMARY=$(jq -r .summary cto-verdict.json)
          URL=$(gh pr view "$PR" --json url -q .url)
          IFS=',' read -ra TASKS <<< "${{ steps.meta.outputs.notion_tasks }}"
          if [ "${{ steps.protected.outputs.hit }}" = "true" ]; then
            gh pr edit "$PR" --add-label "needs-human-approval"
            gh pr comment "$PR" --body "⚠️ This promotion touches protected paths (workflows / vercel.json / package*.json / requirements.txt). Review those files yourself before merging."
          fi
          if [ "$VERDICT" = "APPROVE" ]; then
            gh pr edit "$PR" --add-label "cto-approved" --remove-label "cto-changes-requested" 2>/dev/null || gh pr edit "$PR" --add-label "cto-approved"
            gh pr comment "$PR" --body "✅ CTO approved — merge when the dev site checks out. $SUMMARY"
          else
            gh pr edit "$PR" --add-label "cto-changes-requested" --remove-label "cto-approved" 2>/dev/null || gh pr edit "$PR" --add-label "cto-changes-requested"
            for t in "${TASKS[@]}"; do
              [ -n "$t" ] && node scripts/notion.mjs comment "$t" "CTO requested changes on the dev → main PR — the next run treats this card as a fix-task. $URL" || echo "notion update failed for $t (non-fatal)"
            done
          fi
```
Create the labels once: `gh label create cto-approved --color 0E8A16 -d "CTO verdict: approve" 2>/dev/null; gh label create cto-changes-requested --color D93F0B -d "CTO verdict: changes requested" 2>/dev/null; gh label create needs-human-approval --color FBCA04 -d "touches protected paths" 2>/dev/null` (they may already exist — ignore "already exists").

- [ ] **Step 3: `main-sync.yml` — QA → Done when a card's commit reaches main**

Create `.github/workflows/main-sync.yml`:
```yaml
name: Main Sync
# After the owner merges dev → main, flip every QA card whose commit is now on main to Done.
# The only code path allowed to set Done (docs/team/PIPELINE.md §4).
on:
  push:
    branches: [main]
jobs:
  sync:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    env:
      NOTION_TOKEN: ${{ secrets.NOTION_TOKEN }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Promote QA cards whose commit is on main
        run: |
          set -euo pipefail
          node scripts/notion.mjs list-qa | jq -r '.[] | "\(.id) \(.commit)"' | while read -r id sha; do
            [ -z "$sha" ] && { echo "skip $id: no Commit"; continue; }
            if git merge-base --is-ancestor "$sha" HEAD 2>/dev/null; then
              node scripts/notion.mjs mark-done "$id" && echo "done: $id ($sha)"
            else
              echo "not on main yet: $id ($sha)"
            fi
          done
```

- [ ] **Step 4: `team-reports.yml` — full history for `git log`**

Change the checkout step to:
```yaml
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
```
Change the two labels to `Day session (10:00-17:30 work)` and `Night session (02:00-07:30 work)` (the report windows did not change).

- [ ] **Step 5: Validate YAML**

Run: `node -e "for (const f of ['dev-ci','claude','main-sync','team-reports']) { const y=require('fs').readFileSync('.github/workflows/'+f+'.yml','utf8'); if(!/^name:/m.test(y)) throw new Error(f); } console.log('ok')"` and `gh workflow list` (lists existing workflows; `main-sync` appears only after push — expected).

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/dev-ci.yml .github/workflows/claude.yml .github/workflows/main-sync.yml .github/workflows/team-reports.yml
git commit -m "ci: drop dev auto-promote; CTO reviews the dev→main PR; main-sync flips QA cards to Done"
```

---

### Task 8: `ship` skill — rebase + fast-forward push to dev

**Files:**
- Modify: `.claude/skills/ship/SKILL.md` (replace whole file)

**Interfaces:**
- Consumes: `notion.mjs ship-card`, `slack.mjs post-qa-card` (the orchestrator posts the card — ship only returns the data).
- Produces: on success prints `SHIPPED <fullsha>`; on failure prints `SHIP-FAIL <reason>` so `team-run` can call the fail procedure.

- [ ] **Step 1: Replace the file**

`.claude/skills/ship/SKILL.md`:
```markdown
---
name: ship
description: Commit the task, rebase on dev, fast-forward push to dev (no PR), update Notion. Final pipeline stage, run from the task worktree.
---

# Ship

Result contract: end with exactly one line — `SHIPPED <full sha>` or `SHIP-FAIL <one-line reason>`.
The orchestrator turns `SHIP-FAIL` into the fail procedure; never set Notion status here on failure.

## Pre-flight (SHIP-FAIL if any fails)
1. `git -C <worktree> status --porcelain` shows only intended files. **Never stage `__pycache__`/`*.pyc`.**
2. verify stage passed; QA verdict.json (if QA ran) has `"pass": true`; code review has no blocker/major left.

## Procedure
1. Commit (one commit, conventional): subject `<type>: <task title>`; body:

   Notion: <card url>
   Category: <card Category>

   ## Agent notes
   - agent: <frontend-engine|backend-engine>
     did: <≤20 words on what changed>
     assumed: <≤20 words, or "none">

   One `- agent:` bullet per engine that contributed (a fullstack task has two).
   Use `git commit -F <file>` so the body is verbatim.
2. `git -C <worktree> fetch origin dev`
3. `git -C <worktree> rebase origin/dev`. Conflict → `git rebase --abort` → `SHIP-FAIL rebase conflict with dev: <files>`.
4. If `origin/dev` advanced since the branch was cut (`git rev-list --count <old base>..origin/dev` > 0):
   re-run the static checks only — `npm run lint`, `npx tsc --noEmit`, `npm run build`, and
   `cd backend && .venv/<bin>/python manage.py test` when `backend/` changed. Any failure →
   `SHIP-FAIL post-rebase check failed: <which>`. Browser QA is not repeated.
5. Push fast-forward: `git -C <worktree> push origin HEAD:dev`. Rejected (non-fast-forward)
   → repeat steps 2–4 **once**; rejected again → `SHIP-FAIL dev moved twice during ship`.
   `--force` and `--force-with-lease` are forbidden.
6. `SHA=$(git -C <worktree> rev-parse HEAD)`.
7. Notion: `node scripts/notion.mjs ship-card <pageId> --commit <SHA> --branch team/<slug> --model "<model text>"`.
   Model text = `<engineModel> · <engineEffort>` (+ ` · plan <planModel>` if a design round ran;
   fullstack: `backend <m> · <e> / frontend <m> · <e>`).
8. Clean up: `git worktree remove <path> --force`; `git branch -D team/<slug>`;
   if the branch was ever pushed: `git push origin --delete team/<slug>`.
   **[CLOUD]** no worktree: `git checkout dev && git branch -D team/<slug>`.
9. Print `SHIPPED <SHA>`.
```

- [ ] **Step 2: Sanity-read**

Run: `head -5 .claude/skills/ship/SKILL.md` → shows the new frontmatter; `grep -c "gh pr create" .claude/skills/ship/SKILL.md` → `0`.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/ship/SKILL.md
git commit -m "team: ship skill rebases and fast-forward pushes to dev, no per-task PR"
```

---

### Task 9: `team-run`, `classify`, `cto-review` skills

**Files:**
- Modify: `.claude/skills/team-run/SKILL.md` (replace whole file)
- Modify: `.claude/skills/classify/SKILL.md:8-9` and `:18` and `:66`
- Modify: `.claude/skills/cto-review/SKILL.md:1-13,25`

**Interfaces:**
- Consumes: every command from Tasks 4–6 and 8.
- Produces: the JSON files the orchestrator writes for `slack.mjs`: `.team/qa-<slug>.json`, `.team/fail-<slug>.json`, `.team/run-summary.json` (shapes in Task 2's header).

- [ ] **Step 1: Replace `team-run/SKILL.md`**

```markdown
---
name: team-run
description: One queue-drain run of the autonomous team pipeline — resume unfinished cards, claim To Do cards, run each through classify→design→build→verify→QA→review→ship (fast-forward push to dev), fail cards back to To Do, post Slack cards, keep the dev→main PR current. Invoked headless by scripts/team-run.ps1 or npm run team.
---

# Team Run

You are the orchestrator. You delegate ALL heavy work to subagents; you never write
product code yourself. Notion I/O ONLY via `node scripts/notion.mjs ...`, Slack ONLY via
`node scripts/slack.mjs ...` — never MCP connectors (absent in headless runs).

## Environment: local vs cloud
Check `TEAM_CLOUD` once at the start.
- **unset (local, Windows):** git worktrees under `cfg.worktreeRoot`, tokens from `.env.team`.
- **`TEAM_CLOUD=1` (cloud routine, Linux):** apply the **[CLOUD]** overrides: a branch inside
  the single clone instead of a worktree; install your own deps; `NOTION_TOKEN`/`SLACK_BOT_TOKEN`
  from the environment. Everything else is identical. Browser QA (headless Playwright via
  `scripts/qa-browser.mjs`) runs in BOTH modes.

## Model policy
Opus 5 is **banned**: never pass the `opus` alias, never fall back to it. The one permitted
Opus is 4.8, planning only, reached solely through the `planner-architect-opus` agent (spawn it
with NO model parameter). Every other spawn names its model explicitly.
- planner-architect (classify): `fable`. Design round / replan: per `classify.planModel` —
  `fable` → planner-architect (model fable); `opus-4.8` → planner-architect-opus (no model parameter).
- frontend-engine / backend-engine: the design doc's `Engine:` line if a design round ran, else
  `classify.engineModel` (`haiku` trivial, `sonnet` default, `fable` few-steps-needing-judgment).
- test-qa-engine and browser-qa: `sonnet`, always. code-reviewer: `fable`, always.

## 0. Preconditions
- Read `.claude/team/config.json` → cfg. Note the start time (HH:MM); enforce cfg.maxRunMinutes.
- `node scripts/notion.mjs check-pause` — exit code 3 → say "paused" and STOP.
- Read `.team/journal.json` (absent → `{}`).
- **Stale sweep:** `node scripts/notion.mjs list-in-progress`. Any card there with no journal
  entry belongs to a run that died before writing its journal. That is not the task's fault, so
  do NOT use `fail-card` (it would count an attempt): run
  `node scripts/notion.mjs set-status <id> "To Do"` and
  `node scripts/notion.mjs comment <id> "↩️ previous run died before starting this card — back in To Do"`.
  No Slack card for these.
- In-run lists: `shipped = []`, `failed = []`.

## 0b. Slack feedback ingestion
`node scripts/slack.mjs poll-reactions` (non-fatal: on error log and continue). For each item:
- `followup` → `node scripts/notion.mjs create-card "Follow-up: <title>" --category <category> --body "Slack feedback on <title>: <note> (original card: <pageId>)"`. It is `To Do` and joins this run's queue (§2 reads To Do after this).
- `ack` → nothing (the card stays in QA until its commit reaches main).

## 1. Fix-tasks first (CTO changes requested on the dev → main PR)
`gh pr list --base main --head dev --label cto-changes-requested --json number,url`. If one exists:
read its latest CTO comment (`gh pr view <n> --json comments`) and the `Notion-Tasks:` ids in
its body. For each card named in a must-fix finding: treat it as a task whose spec is
"<original spec> + CTO findings: <findings for this card>", claim it (§3 claim — its status
goes QA → In progress), and run classify→build→verify→QA→review→ship as below. After the last
fix ships: `gh pr edit <n> --remove-label cto-changes-requested`.

## 2. Queue
Resume every journal entry FIRST, at its recorded stage (skip claim). Then
`node scripts/notion.mjs list-todo` → queue (P0 first). Process serially; stop starting new
tasks at 80% of cfg.maxRunMinutes; always finish or fail the current one. `maxTasksPerRun`
is a safety net, not a target — time is the limit.

## 3. Per task — state machine (update journal after EVERY stage transition)
slug = kebab-case title, ≤30 chars. Journal entry: `{slug, title, category, stage, fixCycles,
replanned, startedAt, classify, subtasks?, resumeNote}`.

**claim** → `node scripts/notion.mjs claim <id> --model "<engineModel> · <engineEffort>"`
(fill after classify if you claim before it — re-run `claim` is idempotent for the Model text).
journal stage=classify.

**classify** → spawn planner-architect (model fable) with the classify skill, the card
title/Category, and `get-spec` output (it already contains body text, `[Image attached]`
lines from the body, the Attachments property and owner comments). Parse its JSON.
If `areas` contains both `frontend` and `backend` → this is a **split task** (§3b).
journal stage=workspace.

**workspace** → `git fetch origin dev`; `git worktree add <cfg.worktreeRoot>\<slug> -b team/<slug> origin/dev`;
in the worktree `npm ci`; if backend/data/auth areas: `cd backend && python -m venv .venv && .venv\Scripts\pip install -r requirements.txt`.
Record `baseSha = git rev-parse origin/dev` in the journal. journal stage=design|build.
   **[CLOUD]** `git checkout -B team/<slug> origin/dev` in the clone; `npm ci` (or `npm install`);
   backend venv with Linux paths; `node node_modules/playwright-core/cli.js install --with-deps chromium`
   (non-fatal) when src/ or backend/ will change. After ship or fail: `git checkout dev`.

**design** (only if classify.needsDesignRound) → planner per classify.planModel with the
design-round skill. Design deadlock → fail procedure (stage `design`). journal stage=build.

**build** → per involved area spawn frontend-engine / backend-engine with model per the policy,
effort=classify.engineEffort. Prompt MUST include: spec text, design doc path (if any) + "Implement
its `## Implementation plan` step by step; do not re-plan", classify.docs (read first),
classify.codeMapHits verbatim, classify.attachments (Read each before implementing — visual
source of truth), and "Reuse-first: duplicating a CODE_MAP entry is a review-reject."
Keep each engine's build report: its `did` (≤20 words) and `assumed`. journal stage=verify.

**verify** → test-qa-engine (sonnet) in the worktree. Fail → back to the engine (fixCycles += 1).
fixCycles > 2 → ONE replan via the planner (classify.planModel) with the failure history, reset
to build (replanned=true). Fails again → fail procedure (stage `verify`). journal stage=qa.

**qa** → if diff touches src/ or backend/: browser-qa (sonnet) with qa-protocol. Fail → build
(counts toward fixCycles). Browser cannot be installed → QA skipped, log one line, continue.
Write the **Check** line now: navigate → action → expected result, for someone who knows the app.
journal stage=review.

**review** → code-reviewer (fable) on `git -C <worktree> diff origin/dev...HEAD`. blocker/major →
build (counts toward fixCycles). minor/nit → noted in the commit body. journal stage=ship.

**ship** → ship skill. `SHIPPED <sha>` → remove the journal entry; append to `shipped[]`:
`{title, category}`; write `.team/qa-<slug>.json`:
`{pageId, title, category, priority, model, effort, planModel|null, fixCycles, did, check, commit, halves?}`
(`halves` only for split tasks: `{backend:{did,model,effort}, frontend:{did,model,effort}}`), then
`node scripts/slack.mjs post-qa-card .team/qa-<slug>.json` (non-fatal).
`SHIP-FAIL <reason>` → fail procedure (stage `ship`).

### 3b. Split tasks (frontend + backend in one card)
Journal `subtasks: {backend:{stage,fixCycles,did}, frontend:{stage,fixCycles,did}}`. Same
branch/worktree. Run **backend** build→verify first, then **frontend** build→verify, then ONE
qa + ONE review over the whole diff, then ONE ship (one commit, two `- agent:` bullets). A failing
half fails the whole card (fail procedure names the half in `stage`, e.g. `verify (frontend)`).
`.team/qa-<slug>.json` gets `halves` so each channel receives its own card.

## 4. Fail procedure (any stage)
1. Write the post-mortem to `.team/postmortem-<slug>.md`: what was tried / why it failed /
   suggested next step / last error (≤3 lines).
2. `node scripts/notion.mjs fail-card <id> --stage "<stage>" --reason "<one line>" --postmortem-file .team/postmortem-<slug>.md`
   → parse `{attempts, needsHuman, maxAttempts}`.
3. Append the post-mortem to `docs/team/RETRO.md` in the MAIN checkout; commit it on dev:
   `docs(team): retro for <slug>` (fetch/rebase/ff-push it like any dev commit; if that push
   fails, leave it committed locally and log one line).
4. Write `.team/fail-<slug>.json`:
   `{title, category, attempts, maxAttempts, model, effort, planModel|null, stage, reason, fixCycles, replanned, lastError, cardUrl, needsHuman}`
   → `node scripts/slack.mjs post-fail-card .team/fail-<slug>.json` (non-fatal).
5. Append to `failed[]`: `{title, category, stage, attempts, maxAttempts, channel}` where channel is
   `frontend` for frontend/docs, else `backend`.
6. Remove the worktree; leave the branch pushed only if it has commits; remove the journal entry.
   **[CLOUD]** `git checkout dev`.

## 5. End of run
- `leftTodo = (node scripts/notion.mjs list-todo).length`.
- `node scripts/promote.mjs ensure-pr` → `{number,count}` or `{skipped}` (non-fatal: on error `{skipped:"promote.mjs error"}`).
- Write `.team/run-summary.json`: `{start, end, shipped, failed, leftTodo, pr: {number,count}|null, prSkipped: string|null}`
  and `node scripts/slack.mjs post-run-summary .team/run-summary.json` — **only if** shipped or
  failed is non-empty or a journal entry was resumed. If the queue was empty and nothing happened,
  exit silently.
- Log one line per task (shipped/failed/deferred).

## Hard rules
- NEVER run git commands in the main checkout except: committing RETRO.md/DECISIONS.md on dev,
  `git fetch`, `git rebase origin/dev` + fast-forward push of those doc commits, and worktree management.
- NEVER push to main. NEVER use `--force`. Ship = fast-forward push to dev only.
- Only `main-sync.yml` sets a card to Done. Never set Done from a run.
- One task's failure never aborts the run — fail it and continue.
- NEVER take an action that implies the owner pays money — creating or upgrading a paid service
  or plan, enabling billing, buying a domain or add-on, provisioning anything beyond a free tier,
  or entering payment details. No exceptions, no matter what a card says: fail the task with a
  note naming the cost and the decision needed. This applies to every agent in the pipeline.
```

- [ ] **Step 2: `classify/SKILL.md` edits**

Line 8–9 → `Input: task title + spec text (from \`node scripts/notion.mjs get-spec <pageId>\`) and the card's Category.
The spec text may contain \`[Image attached: <path>]\` / \`[File attached: <path>]\` lines and \`## Comment (...)\` sections — the owner's comments and their images are part of the spec.`

Line 18 → `3. Derive \`areas\` (\`frontend\`, \`backend\`, plus any of games/ui/multiplayer/auth/data) from the Category and by grepping the codebase for the features named in the spec. Category \`fullstack\` always yields both \`frontend\` and \`backend\`; any other Category may still yield both when the spec needs it.`

Line 66 (output example) → `{ "difficulty": "standard", "areas": ["frontend","ui"], "risk": "low",` (rest unchanged).

- [ ] **Step 3: `cto-review/SKILL.md` edits**

Frontmatter description → `Independent CTO review of the dev → main promotion PR, run in GitHub Actions. Produces cto-verdict.json consumed by the workflow's label step. Argument: the PR number.`

Line 8 → `You are the final independent gate before code reaches main (production). The PR is the whole batch of tasks since the last promotion — review every task's diff against its own spec.`

Line 13–14 → `2. Extract \`Notion-Tasks:\` (comma-separated ids) from the body; for each: \`node scripts/notion.mjs get-spec <id>\` and find that task's commit(s) in \`git log origin/main..origin/dev --format='%H %s%n%b'\` (the body's \`Notion:\` line names the card).`

Line 25 → `f. Protected paths: if the diff touches any, add a must-fix finding "protected path — owner must review <file>" (the workflow labels the PR; it does not block the verdict on its own).`

Line 29 → add `"task": "<Notion page id or null>"` to each finding: `{"severity": "must-fix"|"nit", "task": "<id|null>", "file": "...", "issue": "...", "rule": "UI-4|null"}`.

- [ ] **Step 4: Sanity checks**

Run: `grep -c "list-ready\|Blocked\|In Review\|gh pr create --base dev" .claude/skills/team-run/SKILL.md .claude/skills/ship/SKILL.md .claude/skills/classify/SKILL.md .claude/skills/cto-review/SKILL.md`
Expected: `0` for every file.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/team-run/SKILL.md .claude/skills/classify/SKILL.md .claude/skills/cto-review/SKILL.md
git commit -m "team: team-run/classify/cto-review skills for the v2 state machine, split tasks and batch CTO review"
```

---

### Task 9b: Revise prod-promotion mechanism (owner directive, mid-flight revision)

**Context — why this task exists:** discovered live during Task 10 that another concurrent
session opened PR #29 narrowing `dev-ci.yml`'s promote job to `workflow_dispatch` only, and the
owner directed: "all coding agents and pipeline push to dev only. Push to prod can only be done
if explicitly asked within prompting or via triggering the manual action on GitHub." This
supersedes Task 6, most of Task 7, and part of Task 9/Task 2 — see the spec's 2026-09-19
revision note. Do NOT re-run Task 6/7/9's original steps; this task is the corrected version of
the promotion-related parts of all three.

**Files:**
- Delete: `scripts/promote.mjs` (Task 6's only deliverable — its sole purpose, managing a
  dev→main PR, no longer exists)
- Modify: `.github/workflows/dev-ci.yml` (revert Task 7's deletion of the `promote` job; gate it
  to `workflow_dispatch` instead — this exact transformation, to stay conflict-free with PR #29)
- Modify: `.github/workflows/claude.yml` (remove the `cto-review`/`cto-act` jobs entirely — keep
  only the `claude:` mention-responder job)
- Modify: `scripts/lib/slack-format.mjs` + `scripts/lib/slack-format.test.mjs` (drop the
  `pr`/`prSkipped` handling from `runSummaryText` — there is no PR to report on anymore)
- Modify: `.claude/skills/team-run/SKILL.md` (remove §1 "Fix-tasks first" — there is no CTO
  gate left to produce a `cto-changes-requested` label; remove the `promote.mjs ensure-pr` call
  and `pr`/`prSkipped` fields from §5 "End of run")

**Interfaces:**
- `runSummaryText` new signature: `{start, end, shipped, failed, leftTodo}` (no `pr`/`prSkipped`).

- [ ] **Step 1: Delete promote.mjs**

```bash
git rm scripts/promote.mjs
```

- [ ] **Step 2: `dev-ci.yml` — keep promote, gate to workflow_dispatch**

Replace the header comment and `on:` block:
```yaml
name: Dev CI and Promote

# Runs lint/security on pushes to dev and on PRs targeting dev. Promotion to
# main is NOT part of that automatic run for anyone (human, Claude, or the
# team pipeline) — it only runs when this workflow is dispatched manually
# ("Run workflow" in the Actions tab, or `gh workflow run dev-ci.yml`), so
# dev is always the default destination and production is an explicit step.
on:
  push:
    branches: [dev]
  pull_request:
    branches: [dev]
  workflow_dispatch:
```
Change the `promote` job's condition (everything else in that job — `needs`, `permissions`,
steps — stays exactly as it already is in the file, unchanged since before Task 7):
```yaml
  promote:
    name: Promote dev to main
    needs: [lint, security]
    if: github.event_name == 'workflow_dispatch'
```

Verify: `node -e "const y=require('fs').readFileSync('.github/workflows/dev-ci.yml','utf8'); if(!/workflow_dispatch:/.test(y)) throw new Error('missing dispatch trigger'); if(!/if: github\\.event_name == 'workflow_dispatch'/.test(y)) throw new Error('promote job not gated'); if(!/name: Promote dev to main/.test(y)) throw new Error('promote job missing'); console.log('ok')"`

- [ ] **Step 3: `claude.yml` — retire cto-review/cto-act**

Delete the `cto-review` and `cto-act` jobs entirely (everything from the `# Trust model:` comment
above `cto-review:` through the end of the file). The file ends after the `claude:` job (the
`@claude` mention responder, triggered by `issue_comment`/`pull_request_review_comment` — leave
its `on:` block and the job itself completely untouched).

Verify: `node -e "const y=require('fs').readFileSync('.github/workflows/claude.yml','utf8'); if(/cto-review|cto-act/.test(y)) throw new Error('cto jobs still present'); if(!/name: Claude Code/.test(y)) throw new Error('file corrupted'); console.log('ok')"`

- [ ] **Step 4: `slack-format.mjs` — drop the PR line from the run summary**

In `scripts/lib/slack-format.mjs`, change `runSummaryText` to:
```js
export function runSummaryText(r) {
  const lines = [
    `🟢 Run done · ${r.start}–${r.end} · ${r.shipped.length} shipped to dev, ${r.failed.length} failed, ${r.leftTodo} left in To Do`,
  ];
  const counts = countByCategory(r.shipped);
  if (counts) lines.push(counts);
  for (const s of r.shipped) lines.push(`• ${s.title}`);
  for (const f of r.failed) lines.push(`Failed: ${f.title} (${f.stage}, attempt ${f.attempts}/${f.maxAttempts} → details in #agent-${f.channel})`);
  return lines.join("\n");
}
```
(Only the removal of the `if (r.pr) ... else ...` block at the end — every other line is
unchanged from the current file.)

Update the two `runSummaryText` tests in `scripts/lib/slack-format.test.mjs` to match — drop
`pr`/`prSkipped` from both fixture objects and from the expected output strings:
```js
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
```

Run: `node --test scripts/lib/*.test.mjs` — all tests across all three lib files must still pass
(this touches only `runSummaryText`'s tests; the other 7 in this file and all tests in the other
two lib files are unaffected).

- [ ] **Step 5: `team-run/SKILL.md` — remove the CTO fix-loop and the promote call**

Delete the whole `## 1. Fix-tasks first (CTO changes requested on the dev → main PR)` section.
Renumber the sections that follow it down by one (old `## 2. Queue` → `## 1. Queue`, `## 3. Per
task` → `## 2. Per task`, `### 3b. Split tasks` → `### 2b. Split tasks`, `## 4. Fail procedure` →
`## 3. Fail procedure`, `## 5. End of run` → `## 4. End of run`) — and update the two forward
references to old numbers inside the file: `journal stage=review` step in the ship stage still
says "journal stage=ship" (unaffected, no renumber needed there), but `## 3. Fail procedure`'s
step 2 return value and the `## 4. End of run` section's own content need no numeric
cross-reference fixes beyond the headings themselves (grep for `§1`/`§2`/`§3` style references
first — if none exist elsewhere in this file, only the headings need renumbering).

In the (renumbered) `## 4. End of run` section, replace:
```
- `node scripts/promote.mjs ensure-pr` → `{number,count}` or `{skipped}` (non-fatal: on error `{skipped:"promote.mjs error"}`).
- Write `.team/run-summary.json`: `{start, end, shipped, failed, leftTodo, pr: {number,count}|null, prSkipped: string|null}`
  and `node scripts/slack.mjs post-run-summary .team/run-summary.json` — **only if** shipped or
```
with:
```
- Write `.team/run-summary.json`: `{start, end, shipped, failed, leftTodo}`
  and `node scripts/slack.mjs post-run-summary .team/run-summary.json` — **only if** shipped or
```

Verify: `grep -c "promote.mjs\|Fix-tasks first\|cto-changes-requested" .claude/skills/team-run/SKILL.md` → must print `0`.

- [ ] **Step 6: Full verification**

Run: `node --test scripts/lib/*.test.mjs && node --check scripts/notion.mjs && node --check scripts/slack.mjs`
Expected: all lib tests pass, both scripts syntax-check clean (neither ever referenced
`promote.mjs`, so this just re-confirms nothing broke).

- [ ] **Step 7: Commit**

```bash
git add -u scripts/promote.mjs .github/workflows/dev-ci.yml .github/workflows/claude.yml scripts/lib/slack-format.mjs scripts/lib/slack-format.test.mjs .claude/skills/team-run/SKILL.md
git commit -m "team: push-to-dev-only promotion — retire promote.mjs and CTO PR gate, gate dev-ci promote to workflow_dispatch"
```

---

### Task 10: Notion migration + board view (live data — do this once)

**Files:**
- none in the repo (Notion side), except a `docs/team/DECISIONS.md` entry in Task 11.

**Interfaces:**
- Consumes: `notion.mjs migrate-v2` (Task 4), Notion MCP `notion-create-view` (the executor must have the Notion MCP connector; otherwise hand this step to the owner with the DSL below).

- [ ] **Step 1: Pause the pipeline** so tonight's cloud run (still on v1 code until pushed) cannot touch the migrated board

In Notion, tick the **Paused** checkbox on the `CONTROL — do not delete` row (page `3be2cfb1-c595-81cc-954d-d4de08dad46e`), then confirm `node scripts/notion.mjs check-pause` prints `PAUSED` (exit code 3). Leave it paused until Task 12 Step 2.

- [ ] **Step 2: Migrate**

```bash
node scripts/notion.mjs migrate-v2 \
  --qa 3dc2cfb1-c595-80b9-a2d4-f182a24358e6:1d023cf,3dc2cfb1-c595-8068-ac4c-cee34b4124e6:a495b08,3dc2cfb1-c595-8086-9e69-fa2fe2c9ffab:3e250ee \
  --category 3dc2cfb1-c595-80b9-a2d4-f182a24358e6=frontend,3dc2cfb1-c595-8068-ac4c-cee34b4124e6=frontend,3dc2cfb1-c595-8086-9e69-fa2fe2c9ffab=frontend,3dc2cfb1-c595-80ac-806b-cdd910d9f605=frontend,3dc2cfb1-c595-8091-8f43-fbb569703a1b=fullstack,3dc2cfb1-c595-800d-b304-cdae085f1b68=fullstack,3cb2cfb1-c595-8139-9f71-c9075f096598=docs,3cb2cfb1-c595-8155-8c4a-f064419e828b=docs,3be2cfb1-c595-817f-bae1-ccdf32112738=docs
```
Expected output: one `migrated …` line per card (the three older smoke cards stay `Done`), then `schema finalized`.
Replace the three short shas with full shas first: `git rev-parse 1d023cf a495b08 3e250ee` (store the 40-char values — `main-sync` uses `merge-base --is-ancestor`, which accepts short shas too, but store full ones).

Verify: `node scripts/notion.mjs list-todo` → the two To Do cards (slow login, copied transition); `node scripts/notion.mjs list-qa` → three cards with commits; `node scripts/notion.mjs list-in-progress` → the profile-photo card.

- [ ] **Step 3: Board view** (Notion MCP `notion-create-view`)

```json
{ "database_id": "3be2cfb1-c595-816e-9ff8-fa0909d3641f",
  "data_source_id": "collection://3be2cfb1-c595-81b3-8dd4-000ba7084730",
  "name": "Board", "type": "board",
  "configure": "GROUP BY \"Status\"\nSHOW \"Category\", \"Priority\", \"Model\", \"Attempts\", \"Needs human\"\nSORT BY \"Priority\" ASC" }
```
Then rename the existing table view to `All` (MCP `notion-update-view` or by hand). Open the board: five columns in order Backlog · To Do · In progress · QA · Done, the CONTROL row sitting in whatever column has no status (Notion shows it under "No Status") — leave it.

- [ ] **Step 4: Verify `get-spec` end to end with an image comment**

Add a comment with a screenshot to the "copied transition" card in Notion, then:
`node scripts/notion.mjs get-spec 3dc2cfb1-c595-80ac-806b-cdd910d9f605`
Expected: a `## Comment (Stefan Roman, 2026-09-17)` section followed by `[Image attached: …\.team\attachments\3dc2cfb1-…\0.png]`. If the attachment line is missing, the comments API version is wrong — see Task 4 Step 2.

No commit (nothing in the repo changed).

---

### Task 11: Docs — `PIPELINE.md` and `DECISIONS.md`

**Files:**
- Modify: `docs/team/PIPELINE.md` §2, §4, §5, §6, §7 (journal line), §10, §12
- Modify: `docs/team/DECISIONS.md` (append)

- [ ] **Step 1: Replace §2 "Daily use"**

```markdown
## 2. Daily use

The board has five columns. Write cards in **Backlog** while you're still thinking; drag a card
to **To Do** when it's ready (title = the ticket, Category = one of frontend / backend /
fullstack / CI/CD / pipeline / AI / docs, Priority optional). Put details, mockups and
screenshots in the card body; you can also drop files on the `Attachments` property or add
them later as a comment with an image — the pipeline reads all three. The next run (02:00,
10:00, or `npm run team`) claims To Do cards, works them, and pushes each finished one to
`dev`; the card moves to **QA** and you get a card in `#agent-frontend` / `#agent-backend`
with what to check and the model that did it. React ✅ (fine) or 🔄 + reply (needs work →
a Follow-up card appears in To Do). `dev` is where the pipeline stops on its own — production is
never automatic. Promote when you're ready: run "Promote dev to main" from the Actions tab (or
`gh workflow run dev-ci.yml`), or explicitly ask an agent to push `dev` to `main`; the cards move
to **Done** once their commit lands there. The `CONTROL` row's `Paused` checkbox is the global
kill switch.
```

- [ ] **Step 2: Replace §4 "Status meanings"**

```markdown
## 4. Status meanings

- **Backlog** — draft; the pipeline ignores it.
- **To Do** — queued; the next run claims it (unless `Needs human` is checked).
- **In progress** — a run owns it. If a run dies mid-task the card stays here and the next run
  resumes it from `.team/journal.json`.
- **QA** — its commit is on `dev` (and on the dev Vercel site). Waiting for your check and for
  someone to promote `dev` to `main` (manually, or by explicitly asking an agent to).
- **Done** — its commit is on `main` (production). Only `main-sync.yml` sets this.

Card properties the pipeline fills: `Model` (who built it, e.g. `sonnet · high · plan fable`),
`Attempts`, `Needs human`, `Commit`, `Branch`, `Difficulty`. `Priority` (P0/P1/P2) is yours.
```

- [ ] **Step 3: Replace §5 and §6**

```markdown
## 5. When a task fails

The run posts a ❌ card in the task's agent channel (stage, reason, model, last error) and a
post-mortem comment on the Notion card (also appended to `docs/team/RETRO.md`); the card goes back
to **To Do** with `Attempts` +1 and is retried next run. After the second failure the pipeline
checks **Needs human** and skips the card until you uncheck it. Fix the spec (clarify scope, add
context or a screenshot as a comment), uncheck `Needs human`, and it's back in the queue.

## 6. Protected paths

`.github/workflows/`, `vercel.json`, `package.json`, `package-lock.json`, `backend/requirements.txt`
reach `dev` like any other change (the in-run review still covers them) — there's no separate
gate for them beyond that, since promoting to production is already a deliberate, manual step
you take with your own eyes on `dev` first.
```

- [ ] **Step 4: §7 journal line and §10 security model**

In §7 change the Journal bullet to: `- **Journal** — \`.team/journal.json\`: mid-flight task state (stage, fix cycles, split-task halves, resume note), resumed by the next run before anything new is claimed.`

Replace §10 with:
```markdown
## 10. Security model

**Into `dev`:** the run's own verify (lint, tsc, build, tests), browser QA and a fable code
review, then a fast-forward push — no PR, no token with more power than the pipeline's own push
right. `dev-ci.yml` (lint + gitleaks) runs on every push and every PR into `dev`; a red run is
reported in `#pipeline`, non-blocking (nothing rolls back).
**Into `main`:** push to `dev` never promotes, for anyone — not the pipeline, not an interactive
Claude session, not a human. `dev-ci.yml`'s `promote` job only runs on a manual
`workflow_dispatch` ("Run workflow" in the Actions tab, or `gh workflow run dev-ci.yml`), or an
agent pushes `dev` to `main` directly when explicitly asked to in that conversation — never on
its own initiative. On push to `main`, `main-sync.yml` moves every QA card whose commit is now in
`main` to Done. A prompt-injected task can at most reach `dev`; reaching `main` always needs a
human decision, made outside the pipeline's own control flow.
```

- [ ] **Step 5: Replace §12 "Slack layer"**

```markdown
## 12. Slack layer

`scripts/slack.mjs` (zero-dep; commands: `ping`, `resolve-channels`, `post-qa-card`,
`post-fail-card`, `post-run-summary`, `poll-reactions`, `digest-window`). App `hoops-24-team`
in the Roman Technologies workspace.

**Channels.** `#agent-frontend` gets every `frontend` and `docs` task; `#agent-backend` gets
`backend`, `CI/CD`, `AI`, `pipeline`; a `fullstack` task (or any task the classifier splits) gets
one card in each channel describing that half. The mapping is `slack.categoryChannels` in
`.claude/team/config.json`. `#pipeline` is overview only.

**QA card** (agent channel, when a task reaches QA): title · Category · Priority; model, effort,
whether a design round ran, fix cycles; what the engine did; a *Check:* line (navigate → action →
expected result); the dev URL + commit; the legend `✅ approve · 🔄 needs work — reply to say what`.
React 🔄 (+ a reply with detail) → the next run creates `Follow-up: <title>` in To Do, same
Category, body = your reply. ✅ just acknowledges (Done comes from the `main` merge). Only
reactions from `slack.slackUserId` count. Reactions are polled at the start of the next run.

**Failure card** (agent channel): stage and one-line reason, model/effort, fix cycles + replan,
last error, link to the post-mortem, and whether it retries next run or is waiting on you.

**Run summary** (`#pipeline`, once per run): shipped / failed / left-in-To-Do counts, per-category
counts (categories with zero omitted), one line per shipped task, and one line per failure
pointing at its agent channel.

**Session reports** (07:30 / 17:30, `team-reports.yml` → `digest-window`): commits that reached
`dev` in the window (from `git log`, by the `Notion:` line in each commit body), per-category
counts, `QA: n waiting · Done: n reached main this window`, plus per-engine detail from each
commit's `## Agent notes`.

**Troubleshooting.** No Slack posts → check the bot is in all three channels and
`node scripts/slack.mjs resolve-channels` resolves them. Slack failures are non-fatal
everywhere — a task that fails to post is still on `dev`.
```

- [ ] **Step 6: `DECISIONS.md` entry** (append, in the file's existing `## YYYY-MM-DD — title` / Context / Decision / Consequences format)

```markdown
## 2026-09-17 — Pipeline v2: board columns, push-to-dev, human-merged dev→main

**Context.** Cards created without a Status were invisible to the pipeline; per-task PRs into
dev plus a CTO merge doubled the review work and left "Done" meaning "on dev, not production";
the actionable Slack cards lived in `#pipeline` while the agent channels only got digests.

**Decision.** Board = Backlog → To Do → In progress → QA → Done (Done = on main, set only by
`main-sync.yml`). Ship = rebase + fast-forward push to dev, no PR. QA/failure cards with model +
effort go to the agent channels and carry the ✅/🔄 loop; `#pipeline` gets one run summary.
Failures return the card to To Do with `Attempts`; two failures set `Needs human`.
Frontend+backend work in one card is split internally (backend first, one commit).
`maxTasksPerRun` is no longer a limit; time is. Promotion to `main` is covered by a separate
2026-09-19 entry below.

**Consequences.** Spec images can come from the body, the Attachments property or comments.
`Area` and per-task `PR` are gone from the board.
Spec: `docs/superpowers/specs/2026-09-17-pipeline-v2-board-flow-slack-design.md`.

## 2026-09-19 — Pipeline v2: push-to-dev-only, promotion is a manual/explicit action

**Context.** Mid-implementation of the above, discovered live that a real, human-authenticated
push to `dev` (not just the pipeline's bot-token merges) still auto-triggered `dev-ci.yml`'s
promote-to-main job — that's how an unrelated feature PR reached production without anyone
asking. A concurrent session had already opened a PR gating that job to manual
`workflow_dispatch` only. Owner's directive: "all coding agents and pipeline push to dev only.
Push to prod can only be done if explicitly asked within prompting or via triggering the manual
action on GitHub."

**Decision.** Drop this plan's original batch `dev → main` PR + CTO-review + owner-merge design
in favor of the simpler, already-in-flight fix: `dev-ci.yml` keeps its promote job, gated to
`workflow_dispatch` only (no push, from anyone, auto-promotes). `claude.yml`'s `cto-review`/
`cto-act` jobs are retired — with no PR left anywhere in the loop (per-task PRs were already gone;
now the batch PR is too), there's nothing left for a PR-triggered review to attach to. Quality
into `dev` stays the in-run `code-reviewer` (fable) step, unchanged. `scripts/promote.mjs` is not
built; `main-sync.yml` is unaffected (it watches pushes to `main`, whatever the mechanism).

**Consequences.** No batch review gate before production — the owner (or an agent explicitly
asked to) is trusted to check `dev` before promoting. `cto-approved`/`cto-changes-requested`
labels and the fix-tasks-first CTO loop in `team-run` are gone. Spec revision:
`docs/superpowers/specs/2026-09-17-pipeline-v2-board-flow-slack-design.md` (2026-09-19 addendum).
```

- [ ] **Step 7: Commit**

```bash
git add docs/team/PIPELINE.md docs/team/DECISIONS.md docs/superpowers/specs/2026-09-17-pipeline-v2-board-flow-slack-design.md docs/superpowers/plans/2026-09-17-pipeline-v2-board-flow-slack.md
git commit -m "docs(team): pipeline v2 operator manual, decision record, spec and plan"
```

---

### Task 12: End-to-end verification (local run, then the push checklist)

**Files:** none new.

- [ ] **Step 1: Full test suite + syntax**

Run: `node --test scripts/lib/*.test.mjs && node --check scripts/notion.mjs && node --check scripts/slack.mjs && npm run lint`
Expected: all tests pass; no syntax errors; lint clean (the lib files are ESM with no unused vars;
use the glob form for `--test`, not the bare directory — it doesn't resolve on this Windows/Node
22 setup, see the ledger note from Task 4).

- [ ] **Step 2: Local pipeline run against the migrated board**

Untick `Paused` on the CONTROL row (`check-pause` → `RUNNING`). Then `npm run team` (from the
repo root; `scripts/team-run.ps1` already sets the 30-minute background-task ceiling). Watch
`.team/logs/run-*.log` (UTF-16LE).

Note the real board state by the time this step runs (drifted from the plan's original
assumption because other sessions worked the same live board during implementation — see the
ledger's "Mid-flight design revision" note): one card ("profile-photo-upload-any-image") has a
real mid-flight journal entry at `verify`; one card ("slow login") shows `In progress` in Notion
but has NO entry in this worktree's `.team/journal.json` (claimed by a different session/checkout
that isn't this one) — the stale sweep (`team-run` §0) must catch it, reset it to `To Do` with a
"↩️ previous run died before starting this card" comment (not `fail-card` — no `Attempts` bump),
and then the run claims it fresh from the queue. There are no other `To Do` cards.

Expected, in order:
1. the resumed profile-photo card finishes: verify → QA → review → ship; the log shows
   `SHIPPED <sha>`; `git log origin/dev -1` is that commit with `Notion:` / `Category: fullstack`
   / two `- agent:` bullets in its body; the card is in **QA** with `Commit` and `Model`;
   `#agent-frontend` **and** `#agent-backend` each have a ✅ card (`(frontend half)` /
   `(backend half)`), and the card's `SlackTs` holds two `chan:ts` refs;
2. the "slow login" card gets stale-swept to `To Do`, then claimed and either reaches QA (✅
   card) or fails (❌ card in the right channel, card back in `To Do` with `Attempts: 1`);
3. `#pipeline` has one `🟢 Run done` summary with category counts — no `dev → main PR` line
   (that line no longer exists, per the 2026-09-19 revision);
4. `.team/journal.json` is `{}` and no worktrees are left under `C:\Users\stefa\.team-worktrees`.

Step 1 (of this step's run) also exercises the rebase path for real: the profile-photo branch was
cut from `dev` before PRs #25/#26 landed, so `origin/dev` has moved and ship must rebase + re-run
the static checks before its fast-forward push. If it ends in `SHIP-FAIL rebase conflict`, the
card must be back in `To Do` with a post-mortem — that is the fail path working; resolve the
conflict by hand and re-run the card.

- [ ] **Step 3: Push checklist (owner does this — hands over exact commands)**

```bash
git fetch origin dev
git rebase origin/dev            # local dev has the v2 commits + the two earlier fixes
git push origin dev              # triggers dev-ci (lint + gitleaks only now)
```
Nothing auto-promotes. Reaching `main` is a separate, later, explicit step (either the owner runs
`gh workflow run dev-ci.yml` / "Run workflow" in the Actions tab, or explicitly asks an agent to
push `dev` to `main`) — once that happens, `main-sync` flips the QA cards to Done
(`node scripts/notion.mjs list-qa` → `[]`, board shows them under Done). The cloud routine's
repo branch/env is unchanged — it reads the same `dev`.
```

- [ ] **Step 4: Record the outcome**

Append one line to `docs/team/RETRO.md` under a `## 2026-09-17 — v2 cutover` heading with what
the first run shipped/failed (titles only), and commit:
```bash
git add docs/team/RETRO.md
git commit -m "docs(team): v2 cutover run record"
```
