# Model Reassignment + Queue-State Digest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the pipeline's token spend by putting each stage on the cheapest model/effort the evidence supports, make every such choice measurable, and make the Slack session report say what was done, what is left, and why.

**Architecture:** Three independent strands. (1) A cost log (`scripts/team-cost.mjs`, JSONL in `.team/`) the orchestrator appends to after every subagent spawn, summarised into the end-of-run Slack batch post. (2) Skill/agent edits that move classify to Sonnet `low`, set effort per stage instead of one global `high`, and escalate a failing Sonnet build to Fable before replanning. (3) A queue-state block appended to the session digest — counts and reasons derived from Notion `Status` and GitHub PR labels, no new state.

**Tech Stack:** Node 18+ ESM scripts (zero deps, as `scripts/notion.mjs` / `scripts/slack.mjs`), `node --test` for pure helpers, Notion REST API (`2022-06-28`), Slack Web API, `gh` CLI. Skill files are Markdown instructions read by Claude Code agents.

**Spec:** The research report published 2026-09-06 (Hoops24 Model Playbook artifact, §02 role table and §05 change list) plus the in-chat decisions recorded in `docs/team/DECISIONS.md` (three 2026-09-06 entries). Model policy of record: `docs/team/PIPELINE.md` §14.

## To-do list (the owner's view — one line per deliverable)

- [ ] Cost per task per stage logged to `.team/cost.jsonl`, run total in the Slack batch post (Task 1)
- [ ] Session digest gains a queue-state block: shipped (with origin: new / your 🔄 / CTO fix), parked + reason, awaiting CTO, blocked-approval, Ready left for next session (Tasks 2–3)
- [ ] classify runs on Sonnet 5 `low` (Task 4)
- [ ] Effort set per stage: Sonnet build/verify/QA `medium`, Fable design/review `medium` then raise on misses, Opus 4.8 design `high` (Task 5)
- [ ] Sonnet build that fails verify twice is re-run on Fable `medium` before any replan (Task 6)
- [ ] Fable-facing prompts de-prescribed: autonomy + no-tidying reminders for the orchestrator and planner (Task 7)
- [ ] Owner decision: reviewer on Fable `high` (keep) or Opus 4.8 `high` (Task 8)
- [ ] Owner manual step: confirm the cloud routine's model is Fable 5.1; Haiku 4.5 retirement watch note (Task 9)

## Global Constraints

- Repo `stefanroman22/nba-trivia-minigames`, work on `dev`; `gh` must be on account `stefanroman22`.
- **Opus 5 is banned.** Never write the `opus` alias or `claude-opus-5` anywhere. The only Opus is `claude-opus-4-8`, reached only through `.claude/agents/planner-architect-opus.md`. `settings.json` denies `Agent(model:opus)`.
- Allowed model strings in skills: `fable`, `sonnet`, `haiku`, and the agent name `planner-architect-opus` (never a model param for it). Effort strings: `low`, `medium`, `high`, `xhigh`.
- Scripts stay zero-dependency ESM, Node 18+, matching `scripts/notion.mjs` style (2-space indent, `cmdX` functions, a `run` map at the bottom, `console.log` results, `process.exit(2)` for usage errors).
- `.team/*` is gitignored (except `.team/.gitkeep`); runtime files go there, never under `.claude/` (Claude Code gates writes there — see `docs/team/PIPELINE.md` §7).
- Skill files are instructions, not code: after editing one, re-read the whole file once for internal contradictions (a stage line that names a model the policy block forbids is a defect).
- Commit style: conventional prefixes (`feat(team):`, `docs(team):`); stage explicit paths, never `git add -A`. The main checkout carries the owner's uncommitted UI work — sweeping it in is a serious error. Push `dev` after each task; `dev-ci.yml` promotes to `main`.
- Tokens: `NOTION_TOKEN` / `SLACK_BOT_TOKEN` come from `.env.team` locally; never print them. Slack tests use `--dry-run` where the task provides it; a real post to `#pipeline` is acceptable only where the task says so.
- Do not change what `digest-window` says about shipped tasks or how windows are computed (the duplicate guard matches on the head line — keep it byte-identical).

---

### Task 1: Cost log — `scripts/team-cost.mjs` + orchestrator hook

**Files:**
- Create: `scripts/team-cost.mjs`
- Create: `scripts/team-cost.test.mjs`
- Modify: `scripts/slack.mjs` (function `cmdPostBatch`, ~line 91–110)
- Modify: `.claude/skills/team-run/SKILL.md` (§3 per-task state machine, §5 end of run)
- Modify: `docs/team/PIPELINE.md` (§7 "Where things live")

**Interfaces:**
- Consumes: nothing new; `cfg` pattern from `scripts/notion.mjs`.
- Produces: CLI `node scripts/team-cost.mjs log --task <slug> --stage <classify|design|build|verify|qa|review|replan|ship> --model <fable|sonnet|haiku|claude-opus-4-8> --effort <low|medium|high|xhigh> --seconds <n> [--tokens <n>]` → appends one JSON line to `.team/cost.jsonl`. CLI `node scripts/team-cost.mjs summary [--since <ISO>]` → prints JSON `{ spawns, seconds, tokens, byModel: {model: {spawns, seconds, tokens}}, byStage: {...} }`. Exported pure function `summarize(lines: object[]): Summary` for tests and for Task 2.

- [ ] **Step 1: Write the failing test**

```javascript
// scripts/team-cost.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { summarize } from "./team-cost.mjs";

test("summarize aggregates by model and stage, tolerating missing tokens", () => {
  const lines = [
    { ts: "2026-09-06T10:00:00Z", task: "a", stage: "classify", model: "sonnet", effort: "low", seconds: 30, tokens: 4000 },
    { ts: "2026-09-06T10:05:00Z", task: "a", stage: "build", model: "sonnet", effort: "medium", seconds: 300 },
    { ts: "2026-09-06T10:20:00Z", task: "a", stage: "review", model: "fable", effort: "high", seconds: 120, tokens: 9000 },
  ];
  const s = summarize(lines);
  assert.equal(s.spawns, 3);
  assert.equal(s.seconds, 450);
  assert.equal(s.tokens, 13000);
  assert.deepEqual(s.byModel.sonnet, { spawns: 2, seconds: 330, tokens: 4000 });
  assert.deepEqual(s.byStage.review, { spawns: 1, seconds: 120, tokens: 9000 });
});

test("summarize of nothing is zeros", () => {
  assert.deepEqual(summarize([]), { spawns: 0, seconds: 0, tokens: 0, byModel: {}, byStage: {} });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/team-cost.test.mjs`
Expected: FAIL — `Cannot find module './team-cost.mjs'`.

- [ ] **Step 3: Write the script**

```javascript
#!/usr/bin/env node
// Cost log for the team pipeline: one JSON line per subagent spawn, so model/effort
// choices can be judged on this pipeline's own numbers. Zero deps (Node 18+).
// Tokens are optional — the orchestrator only knows them when the harness reports them.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOG = resolve(ROOT, ".team/cost.jsonl");
const STAGES = ["classify", "design", "build", "verify", "qa", "review", "replan", "ship"];
const MODELS = ["fable", "sonnet", "haiku", "claude-opus-4-8"];
const EFFORTS = ["low", "medium", "high", "xhigh"];

function arg(args, name) { const i = args.indexOf(`--${name}`); return i > -1 ? args[i + 1] : undefined; }

export function summarize(lines) {
  const add = (bucket, key, l) => {
    const b = bucket[key] ??= { spawns: 0, seconds: 0, tokens: 0 };
    b.spawns += 1; b.seconds += l.seconds || 0; b.tokens += l.tokens || 0;
  };
  const s = { spawns: 0, seconds: 0, tokens: 0, byModel: {}, byStage: {} };
  for (const l of lines) {
    s.spawns += 1; s.seconds += l.seconds || 0; s.tokens += l.tokens || 0;
    add(s.byModel, l.model, l); add(s.byStage, l.stage, l);
  }
  return s;
}

export function readLog(since) {
  if (!existsSync(LOG)) return [];
  const t = since ? Date.parse(since) : -Infinity;
  return readFileSync(LOG, "utf8").split(/\r?\n/).filter(Boolean)
    .map(x => JSON.parse(x)).filter(l => Date.parse(l.ts) >= t);
}

function cmdLog(args) {
  const rec = {
    ts: new Date().toISOString(),
    task: arg(args, "task"), stage: arg(args, "stage"), model: arg(args, "model"),
    effort: arg(args, "effort"), seconds: Number(arg(args, "seconds")),
  };
  const tokens = arg(args, "tokens");
  if (tokens !== undefined) rec.tokens = Number(tokens);
  const bad = !rec.task || !STAGES.includes(rec.stage) || !MODELS.includes(rec.model)
    || !EFFORTS.includes(rec.effort) || !Number.isFinite(rec.seconds);
  if (bad) {
    console.error(`usage: log --task <slug> --stage <${STAGES.join("|")}> --model <${MODELS.join("|")}> --effort <${EFFORTS.join("|")}> --seconds <n> [--tokens <n>]`);
    process.exit(2);
  }
  mkdirSync(dirname(LOG), { recursive: true });
  appendFileSync(LOG, JSON.stringify(rec) + "\n");
  console.log("logged");
}

function cmdSummary(args) {
  console.log(JSON.stringify(summarize(readLog(arg(args, "since"))), null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...args] = process.argv.slice(2);
  const run = { "log": () => cmdLog(args), "summary": () => cmdSummary(args) }[cmd];
  if (!run) { console.error(`Unknown command: ${cmd}`); process.exit(2); }
  run();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/team-cost.test.mjs`
Expected: `# pass 2`, `# fail 0`.

- [ ] **Step 5: Smoke the CLI end to end**

```bash
node scripts/team-cost.mjs log --task smoke --stage classify --model sonnet --effort low --seconds 12
node scripts/team-cost.mjs log --task smoke --stage build --model haiku --effort low --seconds 40 --tokens 2500
node scripts/team-cost.mjs summary
node scripts/team-cost.mjs log --task smoke --stage build --model opus --effort high --seconds 1
```
Expected: two `logged` lines; a summary with `spawns: 2`, `tokens: 2500`, `byModel.sonnet` and `byModel.haiku`; the last command exits 2 with the usage line (`opus` is not an allowed model). Then delete the smoke rows: `rm .team/cost.jsonl`.

- [ ] **Step 6: Add the run total to the batch post**

In `scripts/slack.mjs`, at the top of the file add the import:

```javascript
import { readLog, summarize } from "./team-cost.mjs";
```

In `cmdPostBatch`, the parent message is built as
`text: \`🟢 Batch complete — ${batch.count} shipped to dev · ${now}${devLine}\``. Change it to include a cost line derived from the log since the run started. `batch` gets a new optional field `startedAt` (ISO) which the orchestrator writes (Step 7); when absent, summarise the last 3 hours:

```javascript
  const since = batch.startedAt || new Date(Date.now() - 3 * 3600 * 1000).toISOString();
  const cost = summarize(readLog(since));
  const perModel = Object.entries(cost.byModel)
    .map(([m, b]) => `${m} ×${b.spawns}`).join(" · ");
  const costLine = cost.spawns
    ? `\n⏱ ${cost.spawns} agent spawns · ${Math.round(cost.seconds / 60)} min agent time · ${perModel}${cost.tokens ? ` · ~${Math.round(cost.tokens / 1000)}k tokens` : ""}`
    : "";
```
and append `${costLine}` to the parent `text`.

- [ ] **Step 7: Make the orchestrator log every spawn**

In `.claude/skills/team-run/SKILL.md`, in "## 3. Per task — state machine", add immediately after the `slug = ...` line:

```
**After EVERY subagent spawn** (classify, design, build, verify, qa, review, replan), run
`node scripts/team-cost.mjs log --task <slug> --stage <stage> --model <model you passed, or
claude-opus-4-8 for planner-architect-opus> --effort <effort you passed> --seconds <wall-clock
seconds the spawn took> [--tokens <n> if the harness reported the subagent's token usage]`.
Non-fatal: if it fails, log one line and continue. This is the only source of truth for
model/effort decisions — a spawn that isn't logged didn't happen, as far as cost tuning goes.
```

In "## 5. End of run", change the sentence that writes `.team/last-batch.json` from
`{count: shipped.length, shipped}` to `{count: shipped.length, shipped, startedAt: <the run's start time as ISO>}`.

- [ ] **Step 8: Document where the log lives**

In `docs/team/PIPELINE.md` §7 "Where things live", add a bullet after **QA evidence**:

```
- **Cost log** — `.team/cost.jsonl`: one line per subagent spawn (task, stage, model, effort,
  seconds, tokens when known). `node scripts/team-cost.mjs summary --since <ISO>` aggregates it;
  the end-of-run batch post carries the run total. This is what model/effort A/Bs are judged on.
```

- [ ] **Step 9: Re-read `team-run/SKILL.md` end to end** for contradictions (the new logging line must not name a forbidden model; §5 must still write `count` and `shipped`).

- [ ] **Step 10: Commit and push**

```bash
git add scripts/team-cost.mjs scripts/team-cost.test.mjs scripts/slack.mjs .claude/skills/team-run/SKILL.md docs/team/PIPELINE.md
git commit -m "feat(team): cost log per subagent spawn, run total in the batch post"
git push origin dev
```

---

### Task 2: `notion.mjs queue-state` — counts and reasons from the board

**Files:**
- Modify: `scripts/notion.mjs` (add `cmdQueueState`, register `"queue-state"` in the `run` map)

**Interfaces:**
- Consumes: existing `api()`, `DB`, `isControl` in the same file.
- Produces: CLI `node scripts/notion.mjs queue-state` → prints JSON
  `{ ready: number, inProgress: number, inReview: [{id,title,pr}], blocked: [{id,title,reason}], blockedApproval: [{id,title,pr}] }`.
  `reason` is the plain text of the most recent comment on the card (the pipeline's post-mortem), truncated to 160 chars, or `""`.

- [ ] **Step 1: Add the command**

Insert after `cmdListAwaitingFeedback` in `scripts/notion.mjs`:

```javascript
async function lastComment(pageId) {
  const r = await api(`comments?block_id=${pageId}&page_size=100`);
  const last = r.results?.[r.results.length - 1];
  return (last?.rich_text || []).map(t => t.plain_text).join("").replace(/\s+/g, " ").slice(0, 160);
}

async function cmdQueueState() {
  const r = await api(`databases/${DB}/query`, "POST", {
    filter: { or: ["Ready", "In Progress", "In Review", "Blocked", "Blocked-approval"]
      .map(s => ({ property: "Status", select: { equals: s } })) },
    page_size: 100,
  });
  const rows = r.results.filter(p => !isControl(p)).map(p => ({
    id: p.id,
    title: p.properties.Name.title.map(t => t.plain_text).join(""),
    status: p.properties.Status?.select?.name,
    pr: p.properties.PR?.url || "",
  }));
  const out = { ready: 0, inProgress: 0, inReview: [], blocked: [], blockedApproval: [] };
  for (const c of rows) {
    if (c.status === "Ready") out.ready += 1;
    else if (c.status === "In Progress") out.inProgress += 1;
    else if (c.status === "In Review") out.inReview.push({ id: c.id, title: c.title, pr: c.pr });
    else if (c.status === "Blocked-approval") out.blockedApproval.push({ id: c.id, title: c.title, pr: c.pr });
    else if (c.status === "Blocked") out.blocked.push({ id: c.id, title: c.title, reason: await lastComment(c.id) });
  }
  console.log(JSON.stringify(out, null, 2));
}
```

Register it in the `run` map: `"queue-state": cmdQueueState,`.

- [ ] **Step 2: Verify against the live board**

Run: `node scripts/notion.mjs queue-state`
Expected today: `{"ready":0,"inProgress":0,"inReview":[],"blocked":[],"blockedApproval":[]}` (the board holds only Done cards and CONTROL). Then create a throwaway card and confirm it counts:

```bash
node scripts/notion.mjs create-card "TEST: queue-state (delete me)" --body "temp"
node scripts/notion.mjs queue-state
```
Expected: `"ready": 1`. Then `node scripts/notion.mjs set-status <id> Blocked && node scripts/notion.mjs comment <id> "parked: design deadlock (test)"` and re-run: expected one `blocked` entry whose `reason` is `parked: design deadlock (test)`. Clean up: `node scripts/notion.mjs archive-card <id>`.

- [ ] **Step 3: Commit and push**

```bash
git add scripts/notion.mjs
git commit -m "feat(team): notion queue-state — counts and park reasons for the digest"
git push origin dev
```

---

### Task 3: Queue-state block + origin tags in the session digest

**Files:**
- Create: `scripts/digest-format.mjs` (pure formatting, testable)
- Create: `scripts/digest-format.test.mjs`
- Modify: `scripts/slack.mjs` (`cmdDigestWindow`, lines ~214–234; add `--dry-run`)
- Modify: `.github/workflows/team-reports.yml` (env: add `NOTION_TOKEN`)

**Interfaces:**
- Consumes: Task 2's `queue-state` JSON; `gh pr list` / `gh pr view` output.
- Produces: `formatQueueState(state, ctoPrs): string` and `originTag(pr): string` exported from `scripts/digest-format.mjs`. The session line keeps its existing head and shipped list byte-identical for the duplicate guard; the new block is appended after it.

- [ ] **Step 1: Write the failing tests**

```javascript
// scripts/digest-format.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { formatQueueState, originTag } from "./digest-format.mjs";

test("originTag: follow-up title, CTO-fix comment, else new", () => {
  assert.equal(originTag({ title: "Follow-up: bingo timer", comments: [] }), "your 🔄");
  assert.equal(originTag({ title: "feat: x", comments: [{ body: "CTO findings addressed: nits" }] }), "CTO fix");
  assert.equal(originTag({ title: "feat: x", comments: [] }), "new");
});

test("formatQueueState renders counts, reasons and next-session line", () => {
  const state = {
    ready: 3, inProgress: 0,
    inReview: [{ id: "1", title: "Elo ratings", pr: "https://g/pr/21" }],
    blocked: [{ id: "2", title: "Bracket mode", reason: "design deadlock: engines disagree on room state" }],
    blockedApproval: [{ id: "3", title: "Bump deps", pr: "https://g/pr/22" }],
  };
  const cto = { "https://g/pr/21": "changes-requested" };
  const out = formatQueueState(state, cto);
  assert.match(out, /1 parked · 1 awaiting CTO · 1 needs your approval · 3 Ready for next session/);
  assert.match(out, /parked: Bracket mode — design deadlock/);
  assert.match(out, /CTO: Elo ratings \(<https:\/\/g\/pr\/21\|PR>\) changes requested — fixed next run/);
  assert.match(out, /approval: Bump deps \(<https:\/\/g\/pr\/22\|PR>\)/);
});

test("formatQueueState is empty when nothing is pending", () => {
  assert.equal(formatQueueState({ ready: 0, inProgress: 0, inReview: [], blocked: [], blockedApproval: [] }, {}), "");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/digest-format.test.mjs`
Expected: FAIL — `Cannot find module './digest-format.mjs'`.

- [ ] **Step 3: Write the formatter**

```javascript
// scripts/digest-format.mjs
// Pure text formatting for the session digest's queue-state block. No I/O.

export function originTag(pr) {
  if ((pr.title || "").startsWith("Follow-up:")) return "your 🔄";
  if ((pr.comments || []).some(c => (c.body || "").startsWith("CTO findings addressed"))) return "CTO fix";
  return "new";
}

// state: output of `node scripts/notion.mjs queue-state`
// ctoPrs: { [prUrl]: "changes-requested" | "pending" }
export function formatQueueState(state, ctoPrs) {
  const parked = state.blocked.length, cto = state.inReview.length, appr = state.blockedApproval.length;
  if (!parked && !cto && !appr && !state.ready && !state.inProgress) return "";
  const lines = [
    `${parked} parked · ${cto} awaiting CTO · ${appr} needs your approval · ${state.ready} Ready for next session${state.inProgress ? ` · ${state.inProgress} in progress` : ""}`,
  ];
  for (const b of state.blocked) lines.push(`  parked: ${b.title}${b.reason ? ` — ${b.reason}` : ""}`);
  for (const r of state.inReview) {
    const why = ctoPrs[r.pr] === "changes-requested" ? "changes requested — fixed next run" : "review pending";
    lines.push(`  CTO: ${r.title}${r.pr ? ` (<${r.pr}|PR>)` : ""} ${why}`);
  }
  for (const a of state.blockedApproval) lines.push(`  approval: ${a.title}${a.pr ? ` (<${a.pr}|PR>)` : ""} — protected path, merge it yourself`);
  return lines.join("\n");
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test scripts/digest-format.test.mjs`
Expected: `# pass 3`.

- [ ] **Step 5: Wire it into `cmdDigestWindow`**

At the top of `scripts/slack.mjs` add:

```javascript
import { formatQueueState, originTag } from "./digest-format.mjs";
```

Change the signature to `async function cmdDigestWindow(startISO, endISO, label, dryRun = false)` and the `run` map entry to:

```javascript
  "digest-window": () => {
    const dry = args.includes("--dry-run");
    const a = args.filter(x => x !== "--dry-run");
    return cmdDigestWindow(a[0], a[1], a.slice(2).join(" "), dry);
  },
```

Replace the shipped-line push (`shipped.push(\`• ${pr.title} (<${pr.url}|PR#${pr.number}>)\`);`) with an origin-tagged version — the PR list query must also fetch comments:

```javascript
  const prs = JSON.parse(sh(`gh pr list --state merged --base dev --json number,title,url,body,headRefName,mergedAt,comments --limit 200`));
```
```javascript
    shipped.push(`• ${pr.title} (<${pr.url}|PR#${pr.number}>) · ${originTag(pr)}`);
```

After the `for (const pr of prs)` loop and before the "Always post a session line" block, gather the queue state (non-fatal — the digest must still post if Notion is unreachable):

```javascript
  let queueBlock = "";
  try {
    const state = JSON.parse(sh(`node scripts/notion.mjs queue-state`));
    const open = JSON.parse(sh(`gh pr list --state open --base dev --json url,labels --limit 100`));
    const ctoPrs = Object.fromEntries(open.map(p => [p.url,
      p.labels.some(l => l.name === "cto-changes-requested") ? "changes-requested" : "pending"]));
    queueBlock = formatQueueState(state, ctoPrs);
  } catch (e) { console.error(`queue-state unavailable (posting without it): ${e.message}`); }
```

Then in the session-line block, build `text` as before and append the queue block:

```javascript
    const text = (shipped.length
      ? `${head}: ${shipped.length} task(s) shipped\n${shipped.join("\n")}`
      : `${head}: no work this session.`) + (queueBlock ? `\n${queueBlock}` : "");
    if (dryRun) { console.log(`[dry-run] would post to #pipeline:\n${text}`); }
    else {
      const r = await apiTry("chat.postMessage", { channel: chan, text }, true);
      console.log(r.ok ? `posted session line (${shipped.length} shipped)` : `session line failed (non-fatal): ${r.error}`);
    }
```

Guard the per-engine detail posts the same way: wrap the `apiTry("chat.postMessage", { channel: ac, text }, true)` call in `if (dryRun) console.log(\`[dry-run] ${agent} detail:\n${text}\`); else { ... }`.

The head line and the duplicate-guard `matchKey` are untouched.

- [ ] **Step 6: Dry-run against a real past window**

```bash
node scripts/slack.mjs digest-window "2026-08-28T17:30+02:00" "2026-08-29T07:30+02:00" "Night session (01:00-07:00 work)" --dry-run
```
Expected: the guard logs `already posted, skipping` (that window's report exists) — so instead test a window with no report:
```bash
node scripts/slack.mjs digest-window "2026-09-05T17:30+02:00" "2026-09-06T07:30+02:00" "Night session (01:00-07:00 work)" --dry-run
```
Expected: `[dry-run] would post to #pipeline:` followed by `📋 *Night session (01:00-07:00 work)* — merges 17:30–07:30: no work this session.` and no queue block (board is empty). Nothing is posted.

- [ ] **Step 7: Give the report workflow the Notion token**

`queue-state` runs inside the digest, which runs in GitHub Actions. In `.github/workflows/team-reports.yml`, under `jobs.report.env`, add:

```yaml
      NOTION_TOKEN: ${{ secrets.NOTION_TOKEN }}
```
(The secret already exists — `claude.yml` uses it.)

- [ ] **Step 8: Commit and push**

```bash
git add scripts/digest-format.mjs scripts/digest-format.test.mjs scripts/slack.mjs .github/workflows/team-reports.yml
git commit -m "feat(team): session digest reports parked/awaiting/ready counts and shipped-task origin"
git push origin dev
```

- [ ] **Step 9: Verify the real 17:30 report**

After the next scheduled report (`gh run list --workflow=team-reports.yml --limit 1`), read `#pipeline`: the session line must still start with the same head and now carry origin tags on shipped items and the queue block when anything is pending.

---

### Task 4: classify on Sonnet 5 `low`

**Files:**
- Modify: `.claude/skills/team-run/SKILL.md` ("## Model policy" bullet for planner-architect; `**classify**` stage line)
- Modify: `docs/team/PIPELINE.md` §14 role table (`planner-architect (classify)` row)
- Modify: `docs/team/DECISIONS.md` (append entry)

**Interfaces:**
- Consumes: nothing.
- Produces: the orchestrator spawns `planner-architect` for classify with `model sonnet, effort low`. Design rounds are unchanged (Task 5 sets their effort).

- [ ] **Step 1: Change the policy bullet**

In `team-run/SKILL.md` "## Model policy", replace the line beginning `- planner-architect (classify): \`fable\`.` so it reads:

```
- planner-architect (classify): `sonnet`, effort `low` — classification is a rubric, not a
  design problem; if RETRO.md shows a misclassification, raise to `fable` for that area.
  Design-round and replan: per `classify.planModel` —
```
(keep the remainder of that bullet as is.)

- [ ] **Step 2: Change the stage line**

Replace `**classify** → spawn planner-architect (model fable) with the classify skill, the card` with `**classify** → spawn planner-architect (model sonnet, effort low) with the classify skill, the card`.

- [ ] **Step 3: Update the operator manual and the decision log**

In `docs/team/PIPELINE.md` §14, change the row `| \`planner-architect\` (classify) | **fable**. |` to `| \`planner-architect\` (classify) | **Sonnet 5 \`low\`** — a rubric application; fable only if RETRO.md shows misclassification. |`.

Append to `docs/team/DECISIONS.md`:

```
## 2026-09-06 — classify moves to Sonnet 5 low
Context: classify runs on every task, so it is the most frequently paid thinking call. It applies a
written rubric to a card (plus attached images) and emits JSON; Anthropic's guidance puts
classification in the Sonnet/Haiku tier.
Decision: spawn planner-architect for classify with model sonnet, effort low. Design rounds keep
their planModel (Opus 4.8 or fable). Revert to fable per area if RETRO.md shows misclassification.
Consequences: every task's first call drops from Fable pricing to Sonnet pricing; misclassification
risk is bounded by the failure policy (a wrongly-standard task parks and gets re-specified).
```

- [ ] **Step 4: Re-read `team-run/SKILL.md`** — the policy block, the stage line and `classify/SKILL.md`'s intro ("`fable` (Fable 5.1: classify, …)") must agree. Edit `classify/SKILL.md`'s Model rubric intro so it no longer lists classify under fable: change `\`fable\` (Fable 5.1: classify, review, the CTO gate, most design rounds, and hard-but-small implementation)` to `\`fable\` (Fable 5.1: review, the CTO gate, most design rounds, and hard-but-small implementation; classify itself runs on sonnet)`.

- [ ] **Step 5: Commit and push**

```bash
git add .claude/skills/team-run/SKILL.md .claude/skills/classify/SKILL.md docs/team/PIPELINE.md docs/team/DECISIONS.md
git commit -m "feat(team): classify on sonnet low"
git push origin dev
```

---

### Task 5: Effort per stage

**Files:**
- Modify: `.claude/skills/team-run/SKILL.md` (stage lines: design, build, verify, qa, review)
- Modify: `.claude/agents/frontend-engine.md`, `backend-engine.md`, `test-qa-engine.md`, `browser-qa.md` (frontmatter `effort: high` → `effort: medium`)
- Modify: `.claude/skills/classify/SKILL.md` (engineModel table: `sonnet (effort high)` → `sonnet (effort medium; xhigh when the plan has more than 8 interlocking steps)`)
- Modify: `docs/team/PIPELINE.md` §14 (add an Effort column to the role table)

**Interfaces:**
- Consumes: nothing.
- Produces: every spawn line in team-run names an effort. Defaults: Sonnet build `medium` (`xhigh` if design doc's Implementation plan has > 8 steps), verify `medium`, qa `medium`, Fable design/review `medium`, Opus 4.8 design `high`, replan inherits the design effort.

- [ ] **Step 1: Stage lines**

In `team-run/SKILL.md`:
- `**design**` line: after `(fable → planner-architect with model fable; opus-4.8 → planner-architect-opus with no model parameter)` insert `, effort medium for fable and high for planner-architect-opus,`.
- `**build**` line: after `classify.engineModel (haiku, sonnet, or fable — never opus),` replace `effort=classify.engineEffort.` with `effort=classify.engineEffort — for sonnet that is medium, or xhigh when the design doc's \`## Implementation plan\` has more than 8 steps; for fable medium; for haiku low.`
- `**verify**` line: `spawn test-qa-engine (model sonnet)` → `spawn test-qa-engine (model sonnet, effort medium)`.
- `**qa**` line: `spawn browser-qa (model sonnet — never\nfable)` → `spawn browser-qa (model sonnet, effort medium — never fable)`.
- `**review**` line: `spawn code-reviewer (model fable — never sonnet:` → `spawn code-reviewer (model fable, effort medium — raise to high only if a blocker slipped through in the last three runs; never sonnet:`.

- [ ] **Step 2: Agent frontmatter defaults**

In each of `frontend-engine.md`, `backend-engine.md`, `test-qa-engine.md`, `browser-qa.md` change `effort: high` to `effort: medium`. Leave `planner-architect.md`, `planner-architect-opus.md`, `code-reviewer.md` at `high` (the orchestrator passes the stage effort explicitly anyway; frontmatter is the fallback).

- [ ] **Step 3: classify rubric + manual**

In `classify/SKILL.md`'s engineModel table change `| **sonnet** (effort high) |` to `| **sonnet** (effort medium; xhigh when the plan has more than 8 interlocking steps) |`.

In `docs/team/PIPELINE.md` §14 role table, add a third column `Effort` with: classify `low`; design round Opus 4.8 `high` / fable `medium`; implementer haiku `low`, sonnet `medium` (`xhigh` for > 8-step plans), fable `medium`; code-reviewer `medium`; verify/QA `medium`; CTO gate (workflow default, `high`). Add one sentence under the table: `Anthropic's measured effort curves: knowledge/research work is nearly flat across effort; long-horizon coding is the one real tradeoff — which is why only the build stage has an xhigh escape hatch.`

- [ ] **Step 4: Re-read `team-run/SKILL.md`** — every spawn line must name both a model and an effort; none may say `high` for a sonnet stage.

- [ ] **Step 5: Commit and push**

```bash
git add .claude/skills/team-run/SKILL.md .claude/skills/classify/SKILL.md .claude/agents/frontend-engine.md .claude/agents/backend-engine.md .claude/agents/test-qa-engine.md .claude/agents/browser-qa.md docs/team/PIPELINE.md
git commit -m "feat(team): effort per stage — medium by default, xhigh only for long build plans"
git push origin dev
```

---

### Task 6: Escalate a failing Sonnet build to Fable before replanning

**Files:**
- Modify: `.claude/skills/team-run/SKILL.md` (`**verify**` stage; journal fields)
- Modify: `docs/team/PIPELINE.md` §14 (one paragraph) and §11 troubleshooting (one bullet)

**Interfaces:**
- Consumes: Task 5's build effort rule.
- Produces: journal entry gains `engineEscalated: true` once the build has been re-run on fable. Replan happens only after the escalated build also fails verify.

- [ ] **Step 1: Rewrite the verify stage**

Replace the `**verify**` paragraph in `team-run/SKILL.md` with:

```
**verify** → spawn test-qa-engine (model sonnet, effort medium) in the worktree. Fail → send
the failures back to the engine (fixCycles += 1). When fixCycles reaches 2 and the engine so
far was sonnet or haiku: re-run the build ONCE on fable (effort medium) with the same prompt
plus the verify failure history — journal `engineEscalated: true` — then verify again. This
is the "run cheap, re-run failures on the stronger model" shape; it is cheaper than starting
on fable and cheaper than a replan. If the escalated build also fails verify → ONE replan:
spawn the same planner the design stage used (classify.planModel) with the failure history,
get a revised approach, reset to build (replanned=true, engine stays fable). Fails again →
park. Log every spawn (`team-cost.mjs log`). journal stage=qa.
```

- [ ] **Step 2: Manual + troubleshooting**

In `docs/team/PIPELINE.md` §14 add after the role table:

```
**Escalation, not pre-payment.** A Sonnet build that fails verify twice is re-run once on Fable
(`medium`) before any replan. Anthropic measured this shape at the same pass rate for about half
the cost of running everything on the stronger model. The journal records `engineEscalated`.
```

In §11 add a bullet: `- **A task shows \`engineEscalated: true\` often**: the plan was too thin for sonnet — fix the design round's plan quality (step 5b self-review), don't raise the default engine.`

- [ ] **Step 3: Re-read `team-run/SKILL.md`** for a consistent fixCycles story: the qa and review stages say "Fail → build (counts toward fixCycles)"; the escalation must only trigger from verify, and `replanned=true` must still reset to build.

- [ ] **Step 4: Commit and push**

```bash
git add .claude/skills/team-run/SKILL.md docs/team/PIPELINE.md
git commit -m "feat(team): escalate a twice-failed sonnet build to fable before replanning"
git push origin dev
```

---

### Task 7: De-prescribe the Fable-facing prompts

**Files:**
- Modify: `.claude/skills/team-run/SKILL.md` (new "## Operating autonomously" block before "## 0. Preconditions")
- Modify: `.claude/agents/planner-architect.md`, `.claude/agents/planner-architect-opus.md`, `.claude/agents/code-reviewer.md` (one paragraph each)

**Interfaces:**
- Consumes: nothing.
- Produces: no contract change — prompt quality only. Scope is deliberately limited to the three reminders Anthropic documents for Fable 5.1 (autonomy/no early stop, no unrequested tidying, report everything in review). A wider A/B that removes the enumerated steps from skills is out of scope until Task 1's cost log has data.

- [ ] **Step 1: Orchestrator autonomy block**

Insert before `## 0. Preconditions` in `team-run/SKILL.md`:

```
## Operating autonomously
You are operating unattended. The owner is not watching and cannot answer questions mid-run,
so never end a turn on a question, a plan, or a promise ("I'll now run X") — do the work with
tool calls, and end your turn only when the queue is drained or you are blocked on something
only the owner can provide (then park, per §4). For minor choices pick a reasonable option and
note it in the journal. Before reporting a stage as done, check the claim against a tool
result from this run; report failures with their output. Do not stop, summarize, or suggest a
new session on account of context limits — continue the work.
```

- [ ] **Step 2: Planner reminders**

Append to both `planner-architect.md` and `planner-architect-opus.md` under "Ground rules":

```
- Plan the simplest thing that works well: no features, abstractions, or "future-proofing"
  the card didn't ask for. A plan step that adds cleanup around the change is a scope defect.
- State the goal and the constraints for each step; don't script the engine's keystrokes.
```

- [ ] **Step 3: Reviewer recall**

Append to `code-reviewer.md` after the "Method:" list:

```
Report everything you find, at every severity — severity is filtered downstream (blocker/major
return to build, minor/nit go in the PR body). Do not self-censor to "only serious issues":
on this model that instruction measurably lowers recall.
```

- [ ] **Step 4: Re-read the three agent files and the skill** for contradictions with the Model policy block.

- [ ] **Step 5: Commit and push**

```bash
git add .claude/skills/team-run/SKILL.md .claude/agents/planner-architect.md .claude/agents/planner-architect-opus.md .claude/agents/code-reviewer.md
git commit -m "feat(team): fable-tuned reminders — autonomy, no tidying, report-everything review"
git push origin dev
```

---

### Task 8: Owner decision — reviewer model (checkpoint, not code)

**Files:**
- Modify (only after the decision): `.claude/skills/team-run/SKILL.md` (`**review**` line), `.claude/agents/code-reviewer.md` (frontmatter), `docs/team/PIPELINE.md` §14, `docs/team/DECISIONS.md`

**Interfaces:**
- Consumes: Task 1's cost log (at least three reviewed tasks' worth) — the decision should be made on numbers.
- Produces: one of two configurations below.

- [ ] **Step 1: Present the two options to the owner with the cost log's `byStage.review` numbers**

Option A — keep: `code-reviewer` on `fable`, effort `medium` (Task 5). Strongest gate; 2× token price.

Option B — switch: `code-reviewer` frontmatter `model: claude-opus-4-8`, and the `**review**` line becomes `spawn code-reviewer (no model parameter — its frontmatter pins claude-opus-4-8; effort high)`. Best review precision per dollar per Anthropic's 4.8 notes; half Fable's price. Add to the Model policy block: `- code-reviewer: pinned claude-opus-4-8 via frontmatter — the second permitted Opus 4.8 use.`

- [ ] **Step 2: Apply the chosen option, update PIPELINE.md §14 and append a DECISIONS.md entry naming both candidates and why one won.**

- [ ] **Step 3: Commit and push**

```bash
git add .claude/skills/team-run/SKILL.md .claude/agents/code-reviewer.md docs/team/PIPELINE.md docs/team/DECISIONS.md
git commit -m "feat(team): reviewer model decided — <fable|opus-4.8>"
git push origin dev
```

---

### Task 9: Owner manual step + retirement watch (docs)

**Files:**
- Modify: `docs/team/PIPELINE.md` §14 (two lines), `docs/CREDENTIALS.md` is NOT touched (no token involved)

**Interfaces:** none.

- [ ] **Step 1: Owner checks the cloud routine**

At claude.ai/code/routines open "NBA team pipeline" and confirm the model selector shows Fable 5.1 (`claude-fable-5-1`). If the selector offers only aliases, pick the Fable option. Record the result in the next step.

- [ ] **Step 2: Document both facts**

In `docs/team/PIPELINE.md` §14, replace the paragraph beginning `The cloud worker routine ("NBA team pipeline"…` with:

```
The cloud worker routine ("NBA team pipeline" at claude.ai/code/routines) sets its own model in
the routine UI, outside this repo — confirmed set to Fable 5.1 on <date>. Re-check it after any
routine edit; nothing here can enforce it, and the settings.json deny rule does not reach it.

**Haiku 4.5 retirement floor is 15 Oct 2026** (no deprecation notice yet). When Anthropic
announces it, change the trivial tier to `sonnet` effort `low` in `classify/SKILL.md` and the
Model policy block; nothing else depends on haiku.
```

- [ ] **Step 3: Commit and push**

```bash
git add docs/team/PIPELINE.md
git commit -m "docs(team): routine model confirmed; haiku retirement watch"
git push origin dev
```

---

## Self-review

**Spec coverage.** Report §05 items → tasks: cost logging (1), queue-state digest (2–3), classify on Sonnet low (4), per-stage effort (5), escalate-on-failure (6), de-prescribe Fable prompts (7), reviewer decision (8), routine model + Haiku watch (9). The Opus 5 trial from §03 is intentionally not a task — it is the owner's call and would need its own DECISIONS.md entry and a temporary lift of the deny rule.

**Placeholder scan.** No TBD/TODO; every code step has the code; skill edits quote the exact replacement text.

**Type consistency.** `summarize`/`readLog` (Task 1) are the names imported in Task 1 Step 6; `formatQueueState`/`originTag` (Task 3) match their tests; `queue-state` JSON keys (`ready`, `inProgress`, `inReview`, `blocked`, `blockedApproval`) in Task 2 match what `formatQueueState` reads in Task 3; `engineEscalated` (Task 6) is the only new journal field.
