# Slack Reporting & Feedback Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Post concise per-batch overviews to a general Slack channel and richer daily per-agent digests, and turn Stefan's reactions (✅/🔄/reply) into follow-up tasks — a post-merge feedback loop with no new always-on server.

**Architecture:** A deterministic `scripts/slack.mjs` CLI (mirrors `scripts/notion.mjs` exactly — zero-dep Node 18 `fetch`, loads `.env.team`, reads `.claude/team/config.json`) posts to Slack and polls reactions. The `team-run` skill gains a poll step at run start and a post-batch step at run end; a new daily scheduled task posts per-agent digests. Reactions are read by polling (rides the existing 2h cadence), never real-time events.

**Tech Stack:** Node 18 (built-in fetch), Slack Web API (`chat.postMessage`, `conversations.list`, `reactions.get`, `conversations.replies`), `gh` CLI, PowerShell 5.1, Windows Task Scheduler.

**Spec:** `docs/superpowers/specs/2026-08-22-slack-reporting-layer-design.md`

## Global Constraints

- **Subscription auth for Claude is untouched.** Slack uses its own `SLACK_BOT_TOKEN`; no `ANTHROPIC_API_KEY` anywhere.
- **No new always-on server.** Reactions are consumed by polling at each run's start.
- **Autonomy preserved:** Slack is post-merge. It never gates a merge.
- **Deterministic Slack I/O** only, via `scripts/slack.mjs`. Never the interactive Slack MCP connector.
- **Slack failure is non-fatal:** every Slack call is wrapped so a failure logs and the pipeline continues. Notion stays source of truth.
- **Secrets:** `SLACK_BOT_TOKEN` in `.env.team` (gitignored) + optionally a GitHub secret. Never committed, never echoed into committed files.
- **This layer is infrastructure** — built directly on `dev` with surgical `git add <path>` (never `git add -A`); the working tree holds ~90 files of Stefan's WIP that must never be swept into a commit. It is NOT built through the autonomous pipeline.
- **gh account:** run `gh auth switch --user stefanroman22` before any `gh` or push (jimmedeknatel8 is READ-only). 
- **Windows PowerShell** invoked by full path `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe` in any new scheduled task / npm script (machine PATH lacks the WindowsPowerShell dir).
- **Testing convention (repo-consistent):** these are I/O shim scripts whose correctness is only meaningful against the live API — like `notion.mjs`, they are verified by `node --check` + live smoke tests (needs the Slack app from Task 1), not mock unit tests. Do not add a test framework.
- **Config property names (exact):** `.claude/team/config.json` `slack.generalChannel`, `slack.agentChannels.{frontend,backend,qa,review}`, `slack.slackUserId`, top-level `devSiteUrl`.
- **Commit messages:** conventional (`feat(team):`, `docs(team):`, `chore(team):`).

---

## Stage S0 — Slack app + slack.mjs scaffolding

### Task 1: Config, gitignore, slack.mjs skeleton, resolve-channels (+ user Slack setup)

**Files:**
- Modify: `.claude/team/config.json`, `.gitignore`
- Create: `scripts/slack.mjs`

**Interfaces:**
- Produces: `slack.mjs` with `api(method, params)` Slack helper, `.env.team` loader, config reader, and commands `ping <channelId> <text>` and `resolve-channels`. Later tasks append commands to the same dispatch table.

- [ ] **Step 1: USER ACTION — create the Slack app (Claude asks; never invents the token)**

Ask Stefan to:
1. Go to api.slack.com/apps → Create New App → From scratch → name `nba-team-pipeline`, pick his workspace.
2. **OAuth & Permissions** → Bot Token Scopes → add: `chat:write`, `reactions:read`, `channels:history`, `channels:read`, `groups:history`, `groups:read`.
3. **Install to Workspace** → copy the **Bot User OAuth Token** (`xoxb-…`).
4. Add it to `.env.team` on a new line: `SLACK_BOT_TOKEN=xoxb-…` (file is already gitignored).
5. Create 5 channels in Slack: `#pipeline`, `#agent-frontend`, `#agent-backend`, `#agent-qa`, `#agent-review`, and **invite the `nba-team-pipeline` app** to each (`/invite @nba-team-pipeline`).
6. Tell Claude his Slack **member ID**: in Slack, click his profile → ⋯ → Copy member ID (`U…`).

- [ ] **Step 2: Add the config block**

In `.claude/team/config.json`, add these keys (keep existing keys byte-identical):
```json
  "slack": {
    "generalChannel": "",
    "agentChannels": { "frontend": "", "backend": "", "qa": "", "review": "" },
    "slackUserId": ""
  },
  "devSiteUrl": ""
```
Then set `slack.slackUserId` to the `U…` id Stefan gave, and `devSiteUrl` to the dev-branch Vercel preview URL (ask Stefan for it; if unknown yet, leave `""` — the batch card falls back to the PR link only).

- [ ] **Step 3: Gitignore the runtime state**

Append to `.gitignore` (do not touch existing lines):
```
.claude/team/slack-state.json
```

- [ ] **Step 4: Write `scripts/slack.mjs` skeleton**

```javascript
#!/usr/bin/env node
// Deterministic Slack I/O for the team pipeline. Zero deps (Node 18+ fetch).
// Env: SLACK_BOT_TOKEN (from .env.team or process env). Config: .claude/team/config.json
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = resolve(ROOT, ".claude/team/config.json");
const ENV_PATH = resolve(ROOT, ".env.team");
const STATE_PATH = resolve(ROOT, ".claude/team/slack-state.json");

function loadEnvTeam() {
  if (!process.env.SLACK_BOT_TOKEN && existsSync(ENV_PATH)) {
    for (const line of readFileSync(ENV_PATH, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  }
}
loadEnvTeam();
const TOKEN = process.env.SLACK_BOT_TOKEN;
if (!TOKEN) { console.error("SLACK_BOT_TOKEN missing (set in .env.team or env)"); process.exit(2); }
const cfg = existsSync(CONFIG_PATH) ? JSON.parse(readFileSync(CONFIG_PATH, "utf8")) : {};

// Slack Web API. GET-style methods pass params as query; write methods POST JSON.
async function api(method, params = {}, post = false) {
  const url = `https://slack.com/api/${method}`;
  let res;
  if (post) {
    res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(params),
    });
  } else {
    const qs = new URLSearchParams(params).toString();
    res = await fetch(`${url}?${qs}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  }
  const json = await res.json();
  if (!json.ok) { console.error(`Slack ${method} error: ${json.error}`); process.exit(1); }
  return json;
}

function readState() { return existsSync(STATE_PATH) ? JSON.parse(readFileSync(STATE_PATH, "utf8")) : { cards: [], lastPoll: null }; }
function writeState(s) { writeFileSync(STATE_PATH, JSON.stringify(s, null, 2)); }

async function cmdPing(channel, ...text) {
  const r = await api("chat.postMessage", { channel, text: text.join(" ") || "ping from nba-team-pipeline" }, true);
  console.log(`posted ts=${r.ts} channel=${r.channel}`);
}

async function cmdResolveChannels() {
  // Map the 5 channel names to ids and write them into config.
  const want = { "pipeline": ["slack", "generalChannel"], "agent-frontend": ["slack", "agentChannels", "frontend"],
    "agent-backend": ["slack", "agentChannels", "backend"], "agent-qa": ["slack", "agentChannels", "qa"],
    "agent-review": ["slack", "agentChannels", "review"] };
  const found = {};
  let cursor;
  do {
    const r = await api("conversations.list", { limit: "200", types: "public_channel,private_channel", ...(cursor ? { cursor } : {}) });
    for (const c of r.channels) if (want[c.name]) found[c.name] = c.id;
    cursor = r.response_metadata?.next_cursor || "";
  } while (cursor);
  const conf = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  conf.slack = conf.slack || { agentChannels: {} };
  conf.slack.agentChannels = conf.slack.agentChannels || {};
  for (const [name, id] of Object.entries(found)) {
    if (name === "pipeline") conf.slack.generalChannel = id;
    else conf.slack.agentChannels[name.replace("agent-", "")] = id;
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(conf, null, 2) + "\n");
  const missing = Object.keys(want).filter(n => !found[n]);
  console.log(`resolved: ${Object.keys(found).join(", ") || "none"}`);
  if (missing.length) console.error(`MISSING (invite the bot to these): ${missing.join(", ")}`);
}

const [cmd, ...args] = process.argv.slice(2);
const run = {
  "ping": () => cmdPing(args[0], ...args.slice(1)),
  "resolve-channels": cmdResolveChannels,
}[cmd];
if (!run) { console.error(`Unknown command: ${cmd}`); process.exit(2); }
await run();
```

- [ ] **Step 5: Verify (live, after Step 1 done)**

Run: `node --check scripts/slack.mjs` → no output (syntax OK).
Run: `node scripts/slack.mjs resolve-channels` → prints `resolved: pipeline, agent-frontend, ...`; config now has channel ids. If any MISSING, Stefan invites the bot and re-runs.
Run: `node scripts/slack.mjs ping <generalChannelId> hello from the pipeline` → a "hello" message appears in `#pipeline`.

- [ ] **Step 6: Commit** (config channel ids are safe to commit; token stays in .env.team)

```bash
git add scripts/slack.mjs .gitignore .claude/team/config.json
git commit -m "feat(team): slack.mjs skeleton, channel resolution, config block"
```

---

## Stage S1 — Batch overview

### Task 2: `slack.mjs post-batch`

**Files:**
- Modify: `scripts/slack.mjs`

**Interfaces:**
- Consumes: a batch JSON file: `{ "shipped": [ { "n": 1, "title": "...", "areas": ["frontend"], "pr": "https://.../pull/34", "prNum": 34, "look": "<explicit navigate→action→expected verification line>", "pageId": "<notion-page-id>" } ], "count": 3 }`. (`cto`/`checkUrl` are NOT used — final format shows one Dev link at the parent from `cfg.devSiteUrl`, no per-card PR/CTO/deep-link.)
- Produces: `post-batch <batchJsonPath>` — posts parent + one threaded card per task; appends each card `{ts, channel, pageId, pr, prNum, title, resolved:false}` to `slack-state.json` `cards[]`. Adds `chat.postMessage` calls.

- [ ] **Step 1: Add `cmdPostBatch` and register it**

Insert this function above the dispatch table:
```javascript
async function cmdPostBatch(jsonPath) {
  const batch = JSON.parse(readFileSync(jsonPath, "utf8"));
  const chan = cfg.slack?.generalChannel;
  if (!chan) { console.error("no generalChannel in config"); process.exit(1); }
  if (!batch.shipped?.length) { console.log("empty batch, nothing to post"); return; }
  const now = new Date().toISOString().slice(11, 16);
  const devLine = cfg.devSiteUrl ? `\nDev: ${cfg.devSiteUrl}` : "";
  const parent = await api("chat.postMessage",
    { channel: chan, text: `🟢 Batch complete — ${batch.count} shipped to dev · ${now}${devLine}` }, true);
  const state = readState();
  for (const t of batch.shipped) {
    const body =
      `${t.n}.  *_${t.title}_*   ·   *${(t.areas || []).join("+")}*\n\n` +
      `*Check:*  ${t.look || "verify the change"}\n\n` +
      `✅ approve      ·      🔄 needs work — reply to say what\n​`;
    // Top-level (no thread_ts) so a human reply threads under THIS task — notes
    // stay unambiguously per-task even when a batch has several tasks.
    const card = await api("chat.postMessage", { channel: chan, text: body }, true);
    state.cards.push({ ts: card.ts, channel: chan, pageId: t.pageId || null, pr: t.pr, prNum: t.prNum, title: t.title, resolved: false });
  }
  writeState(state);
  console.log(`posted batch: parent ts=${parent.ts}, ${batch.shipped.length} cards`);
}
```
Add to the dispatch table: `"post-batch": () => cmdPostBatch(args[0]),`

- [ ] **Step 2: Verify (live)**

Create a sample batch file in the scratchpad:
```json
{ "count": 1, "shipped": [ { "n": 1, "title": "Sample task", "areas": ["frontend"], "pr": "https://github.com/stefanroman22/nba-trivia-minigames/pull/12", "prNum": 12, "cto": "✅CTO", "checkUrl": "https://example.com/x", "look": "sample marker", "pageId": null } ] }
```
Run: `node scripts/slack.mjs post-batch <that file>` → `#pipeline` shows the parent line and one threaded card with the check link and react legend; `.claude/team/slack-state.json` has one card entry with `resolved:false`.

- [ ] **Step 3: Commit**

```bash
git add scripts/slack.mjs
git commit -m "feat(team): slack post-batch (parent + threaded task cards)"
```

### Task 3: Wire post-batch into team-run

**Files:**
- Modify: `.claude/skills/team-run/SKILL.md`

**Interfaces:**
- Consumes: `slack.mjs post-batch`.
- Produces: team-run composes the batch JSON at run end and posts it.

(Note: an earlier draft added a `classify.checkPath` field for per-card deep-links. The final format dropped per-card links in favor of one Dev link at the parent, so classify is NOT modified — the navigation lives in the `look` line the orchestrator writes at ship time.)

- [ ] **Step 1: team-run accumulates shipped tasks and posts at run end**

In `.claude/skills/team-run/SKILL.md`:
- In `## 3` per-task state machine, at the **ship** step, add: "On success, append to an in-run `shipped[]` list: `{n, title, areas, pr, prNum, look, pageId}`. `look` is an EXPLICIT verification line the orchestrator writes: where to navigate → what to do → the expected result, pitched for someone who knows the app (e.g. 'Open the Leaderboard from the nav; rows should be ordered by total wins, highest first; ties break by most recent win'). Not just the expected end-state — include the navigate/action. The card shows one Dev link at the parent (from `cfg.devSiteUrl`); no per-card PR/CTO/deep-link. `pr`/`prNum` are stored for the feedback loop's follow-up context, not displayed."
- In `## 5. End of run`, add: "If `shipped[]` is non-empty, write it to `.claude/team/last-batch.json` as `{count: shipped.length, shipped}` and run `node scripts/slack.mjs post-batch .claude/team/last-batch.json` (wrap in a try/catch equivalent — if it fails, log 'slack post failed (non-fatal)' and continue). This is the batch overview to Slack. Composition happens in the local run per spec §7; the CTO merges later in the cloud, so the CTO ✅ is visible on the PR, not the card."

- [ ] **Step 2: Add last-batch.json to gitignore (WITHOUT re-sweeping user WIP)**

The working tree has the user's persistent uncommitted `.gitignore` edits (`local deployment/`, `docs/games/PLAYERS_DATA.md`). A plain `git add .gitignore` would sweep those into this commit. Instead: append `.claude/team/last-batch.json` to `.gitignore` in the working tree, then commit ONLY that one added line by reconstructing the committed baseline — `git show HEAD:.gitignore > /tmp/base`, append the new line to `/tmp/base`, `cp` it over `.gitignore`, `git add .gitignore`, commit; then restore the user's WIP working-tree version (`cp` the saved working copy back, leave unstaged). Verify `git diff HEAD~1 HEAD -- .gitignore` shows ONLY the last-batch.json line and `git status` shows `.gitignore` still modified (user WIP intact).

- [ ] **Step 3: Verify**

`head -4 .claude/skills/team-run/SKILL.md` (frontmatter intact). Grep team-run for `post-batch` and `shipped` → present. `git check-ignore .claude/team/last-batch.json` → prints the path.

- [ ] **Step 4: Commit** (team-run only; .gitignore already committed in Step 2)

```bash
git add .claude/skills/team-run/SKILL.md
git commit -m "feat(team): team-run composes and posts batch overview to Slack at run end"
```

---

## Stage S2 — Feedback loop

### Task 4: notion.mjs `create-card` + `archive-card`

**Files:**
- Modify: `scripts/notion.mjs`

**Interfaces:**
- Produces: `create-card <title> [--area a,b] [--body text]` → creates a Ready card, prints its page id; `archive-card <pageId>` → archives the page. Used by team-run's feedback ingestion.

- [ ] **Step 1: Add the two functions**

Insert above the dispatch table:
```javascript
async function cmdCreateCard(title, args) {
  const props = {
    Name: { title: text(title) },
    Status: { select: { name: "Ready" } },
    Priority: { select: { name: "P1" } },
  };
  const ai = args.indexOf("--area");
  if (ai > -1 && args[ai + 1]) props.Area = { multi_select: args[ai + 1].split(",").map(n => ({ name: n.trim() })) };
  const page = { parent: { database_id: DB }, properties: props };
  const bi = args.indexOf("--body");
  if (bi > -1 && args[bi + 1]) {
    page.children = [{ object: "block", type: "paragraph", paragraph: { rich_text: text(args[bi + 1]) } }];
  }
  const r = await api("pages", "POST", page);
  console.log(r.id);
}

async function cmdArchiveCard(pageId) {
  await api(`pages/${pageId}`, "PATCH", { archived: true });
  console.log("archived");
}
```
Add to the dispatch table:
```javascript
  "create-card": () => cmdCreateCard(args[0], args.slice(1)),
  "archive-card": () => cmdArchiveCard(args[0]),
```

- [ ] **Step 2: Verify (live)**

Run: `ID=$(node scripts/notion.mjs create-card "Test follow-up" --area frontend --body "created by test")` → prints a page id; the card appears Ready in Notion with Area=frontend.
Run: `node scripts/notion.mjs archive-card "$ID"` → "archived"; card leaves the board.

- [ ] **Step 3: Commit**

```bash
git add scripts/notion.mjs
git commit -m "feat(team): notion create-card and archive-card commands"
```

### Task 5: `slack.mjs poll-reactions`

> **Refinement vs spec §6:** the spec said "🔄 *or any reply* → follow-up." Because Slack threads are one-level (a reply attaches to the batch parent, not a specific card), a bare reply can't be attributed to one task. This plan makes the **per-card 🔄 reaction the sole trigger**, with the reply as attached detail — so a casual comment never spawns work, and a 🔄 always targets the right task. This matches the "give a key per task" intent better; flag to Stefan if he wants reply-alone to also create a (batch-level) card.

**Files:**
- Modify: `scripts/slack.mjs`

**Interfaces:**
- Consumes: `slack-state.json` `cards[]`, `cfg.slack.slackUserId`.
- Produces: `poll-reactions` — prints a JSON array of feedback items `[{ action:"followup"|"ack", pageId, pr, prNum, title, note }]` for unresolved cards where Stefan reacted; marks those cards `resolved:true`. Adds `reactions.get` + `conversations.replies`.

- [ ] **Step 1: Add `cmdPollReactions`**

```javascript
async function cmdPollReactions() {
  const me = cfg.slack?.slackUserId;
  const state = readState();
  const items = [];
  // Each task is its own top-level message, so a human reply threads under THAT
  // task. Read replies on the card's OWN ts → the note is per-task, not shared.
  // (apiTry never throws; guard on rep.ok — see fix round 1.)
  const noteCache = {};
  async function noteFor(cardTs, channel) {
    if (cardTs in noteCache) return noteCache[cardTs];
    let note = "";
    const rep = await apiTry("conversations.replies", { channel, ts: cardTs });
    if (rep.ok) {
      const mineReplies = (rep.messages || []).filter(m => m.user === me);
      if (mineReplies.length) note = mineReplies.map(m => m.text).join(" | ");
    }
    noteCache[cardTs] = note;
    return note;
  }
  for (const card of state.cards) {
    if (card.resolved) continue;
    // Reactions on this specific card (per-message, reliable). apiTry is non-fatal
    // (fix round 1): one deleted card can't abort the whole poll. Regexes anchored.
    let reacted = { fix: false, ok: false };
    const rr = await apiTry("reactions.get", { channel: card.channel, timestamp: card.ts, full: "true" });
    if (rr.ok) {
      for (const rx of (rr.message?.reactions || [])) {
        const mine = !me || (rx.users || []).includes(me);
        if (!mine) continue;
        if (/^(x|heavy_multiplication_x|repeat|arrows_counterclockwise|no_entry|hammer)$/.test(rx.name)) reacted.fix = true;
        if (/^(white_check_mark|heavy_check_mark|\+1|ok_hand)$/.test(rx.name)) reacted.ok = true;
      }
    }
    // TRIGGER is the per-card 🔄 reaction (unambiguous). The reply note is DETAIL
    // attached to the flagged card — a note alone never spawns a follow-up.
    // ✅ (without 🔄) acknowledges.
    if (reacted.fix) {
      const note = await noteFor(card.ts, card.channel);
      items.push({ action: "followup", pageId: card.pageId, pr: card.pr, prNum: card.prNum, title: card.title,
        note: note || "reviewer flagged 🔄 with no note — re-examine" });
      card.resolved = true;
    } else if (reacted.ok) {
      items.push({ action: "ack", pageId: card.pageId, pr: card.pr, prNum: card.prNum, title: card.title, note: "" });
      card.resolved = true;
    }
  }
  // Prune: drop acted cards, bound growth (unreacted cards linger up to 100).
  state.cards = state.cards.filter(c => !c.resolved).slice(-100);
  writeState(state);
  console.log(JSON.stringify(items, null, 2));
}
```
Note: `new Date()` is used only for a human-readable `lastPoll` stamp; if the runtime forbids argless `new Date()`, replace with `Date.now()` guarded, or drop the stamp — it is not load-bearing (dedup is via the per-card `resolved` flag).
Add to dispatch: `"poll-reactions": cmdPollReactions,`

- [ ] **Step 2: Verify (live)**

With the card posted in Task 2 still unresolved: in Slack, react 🔄 on that card and reply in its thread "fix the sort order".
Run: `node scripts/slack.mjs poll-reactions` → prints a JSON array with one `{action:"followup", note:"fix the sort order", ...}`; `slack-state.json` shows that card `resolved:true`. Re-running prints `[]` (dedup works).

- [ ] **Step 3: Commit**

```bash
git add scripts/slack.mjs
git commit -m "feat(team): slack poll-reactions (per-card reactions + thread notes, filtered to owner)"
```

### Task 6: Wire poll-reactions into team-run run start

**Files:**
- Modify: `.claude/skills/team-run/SKILL.md`

**Interfaces:**
- Consumes: `slack.mjs poll-reactions`, `notion.mjs create-card`/`archive-card`.

- [ ] **Step 1: Add the ingestion step**

In `.claude/skills/team-run/SKILL.md`, add a new section **`## 0b. Slack feedback ingestion`** right after `## 0. Preconditions` and before `## 1`:
```markdown
## 0b. Slack feedback ingestion
Run `node scripts/slack.mjs poll-reactions` (non-fatal: on error, log and skip to §1).
Parse the JSON array. For each item:
- `action:"followup"` → `node scripts/notion.mjs create-card "Follow-up: <title>" --body "Slack feedback on <pr>: <note>"` (omit `--area`; classify re-derives areas from the spec). This new Ready card is picked up in this same run's queue (§2 reads Ready after this).
- `action:"ack"` and the item has a pageId → `node scripts/notion.mjs archive-card <pageId>`.
This runs BEFORE §2 so follow-ups drain in the same batch.
```

- [ ] **Step 2: Verify**

Grep team-run for `poll-reactions`, `create-card`, `archive-card` → all present; section `0b` sits between `0.` and `1.`. Frontmatter intact (`head -4`).

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/team-run/SKILL.md
git commit -m "feat(team): team-run ingests Slack feedback into follow-up cards at run start"
```

---

## Stage S3 — Daily per-agent digests

### Task 7: `ship` PR body gains the Agent notes block

**Files:**
- Modify: `.claude/skills/ship/SKILL.md`

**Interfaces:**
- Produces: PR body contains a machine-readable `## Agent notes` block, one bullet per contributing engine, parsed by the digest builder.

- [ ] **Step 1: Extend the PR body template**

In `.claude/skills/ship/SKILL.md`, in the PR body template (after the `Risk:` line), add:
```markdown

   ## Agent notes
   - agent: <frontend-engine|backend-engine>
     did: <≤20 words on what changed>
     assumed: <≤20 words on any assumption, or "none">
```
Add instruction: "Emit one `- agent:` bullet per engine that contributed (a frontend+backend task has two). The orchestrator fills `did`/`assumed` from each engine's build report."

- [ ] **Step 2: Verify**

`head -4 .claude/skills/ship/SKILL.md` (frontmatter intact); grep for `Agent notes` and `assumed:` → present.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/ship/SKILL.md
git commit -m "feat(team): ship emits per-engine Agent notes block for digests"
```

### Task 8: `slack.mjs daily-digests`

**Files:**
- Modify: `scripts/slack.mjs`

**Interfaces:**
- Consumes: `gh` (merged team/* PRs of the day), `cfg.slack.agentChannels`.
- Produces: `daily-digests [YYYY-MM-DD]` — gathers the day's merged `team/*` PRs, parses their `## Agent notes`, groups by agent, posts one digest per agent channel. Uses `child_process` for `gh`.

- [ ] **Step 1: Add the digest builder**

Add near the top (after imports): `import { execSync } from "node:child_process";`
Add function + dispatch:
```javascript
function sh(c) { return execSync(c, { encoding: "utf8" }); }

function parseAgentNotes(body) {
  // Returns [{agent, did, assumed}] from the "## Agent notes" block, or [].
  const out = [];
  const m = body.match(/## Agent notes([\s\S]*?)(?:\n## |\n*$)/);
  if (!m) return out;
  const re = /- agent:\s*(\S+)[\s\S]*?did:\s*(.*?)\s*(?:\n\s*assumed:\s*(.*?))?(?=\n\s*- agent:|\n*$)/g;
  let x;
  while ((x = re.exec(m[1]))) out.push({ agent: x[1].trim(), did: (x[2] || "").trim(), assumed: (x[3] || "none").trim() });
  return out;
}

async function cmdDailyDigests(day) {
  const date = day || sh(`git log -1 --format=%cs`).trim(); // fallback: latest commit date (no argless Date())
  const nameMap = { "frontend-engine": "frontend", "backend-engine": "backend" };
  const buckets = { frontend: [], backend: [], qa: [], review: [] };
  const prs = JSON.parse(sh(`gh pr list --state merged --base dev --search "merged:${date}" --json number,title,body,url,headRefName --limit 100`));
  for (const pr of prs) {
    if (!pr.headRefName.startsWith("team/")) continue;
    const notes = parseAgentNotes(pr.body || "");
    if (notes.length) {
      for (const n of notes) {
        const ch = nameMap[n.agent] || "review";
        buckets[ch].push(`• ${pr.title} (PR#${pr.number}): ${n.did}\n  assumed: ${n.assumed}`);
      }
    } else {
      buckets.review.push(`• ${pr.title} (PR#${pr.number}): (no agent notes)`);
    }
  }
  for (const [agent, lines] of Object.entries(buckets)) {
    const chan = cfg.slack?.agentChannels?.[agent];
    if (!chan || !lines.length) continue;
    const text = `📆 ${agent} · ${date} · ${lines.length} shipped\n${lines.join("\n")}`;
    try { await api("chat.postMessage", { channel: chan, text }, true); console.log(`posted digest to ${agent}`); }
    catch { console.error(`digest post to ${agent} failed (non-fatal)`); }
  }
}
```
Add to dispatch: `"daily-digests": () => cmdDailyDigests(args[0]),`

- [ ] **Step 2: Verify (live)**

Run: `node scripts/slack.mjs daily-digests 2026-08-22` (the smoke PR #12 merged this day; it has no Agent notes so it lands in `#agent-review` as "(no agent notes)"). Confirm a digest posts to `#agent-review`. `node --check scripts/slack.mjs` passes.

- [ ] **Step 3: Commit**

```bash
git add scripts/slack.mjs
git commit -m "feat(team): slack daily-digests (per-agent, parsed from PR agent-notes)"
```

### Task 9: Daily digest scheduled task

**Files:**
- Create: `scripts/team-digest.ps1`, `scripts/register-team-digest-cron.ps1`

**Interfaces:**
- Produces: a `nba-team-digest` scheduled task that runs `slack.mjs daily-digests` nightly.

- [ ] **Step 1: Write `scripts/team-digest.ps1`**

```powershell
# Posts the day's per-agent digests to Slack. Safe, quick, read-mostly.
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $repo ".env.team"
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^([A-Z_]+)=(.*)$') { [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim(), "Process") }
  }
}
Set-Location $repo
node scripts/slack.mjs daily-digests
```

- [ ] **Step 2: Write `scripts/register-team-digest-cron.ps1`**

```powershell
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$name = "nba-team-digest"
$ps = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$action = New-ScheduledTaskAction -Execute $ps `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$repo\scripts\team-digest.ps1`"" `
  -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Daily -At "23:30"
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
try { Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction Stop } catch {}
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings | Out-Null
Write-Output "Registered '$name': daily at 23:30."
Get-ScheduledTask -TaskName $name | Select-Object TaskName, State
```

- [ ] **Step 3: Register + verify**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/register-team-digest-cron.ps1` → `Registered 'nba-team-digest'`, State Ready.
Run: `Start-ScheduledTask -TaskName nba-team-digest`, then confirm a digest posted (or "no digest" if no merges today).

- [ ] **Step 4: Commit**

```bash
git add scripts/team-digest.ps1 scripts/register-team-digest-cron.ps1
git commit -m "feat(team): nightly per-agent digest scheduled task"
```

---

## Task 10: Operator docs

**Files:**
- Modify: `docs/team/PIPELINE.md`

- [ ] **Step 1: Add a Slack section**

Append a `## Slack layer` section to `docs/team/PIPELINE.md` covering: the 5 channels and what each carries; the batch overview format; the ✅/🔄/reply feedback loop (🔄 or reply → follow-up Ready card next run; ✅ → card archived; only your reactions count); that reactions are polled at each run start (not real-time, so up to ~2h latency); the two scheduled tasks (`nba-team-pipeline` every 2h, `nba-team-digest` nightly 23:30); secrets (`SLACK_BOT_TOKEN` in `.env.team`); and the troubleshooting line: "no Slack posts → check the bot is invited to the channel and `slack.slackUserId`/channel ids are set in config; Slack failures are non-fatal and logged, the batch still merged."

- [ ] **Step 2: Commit**

```bash
git add docs/team/PIPELINE.md
git commit -m "docs(team): document the Slack reporting & feedback layer"
```

---

## Exit criteria (from spec §12)

- **S0:** `slack.mjs ping` posts to `#pipeline`; `resolve-channels` fills config.
- **S1:** a real pipeline run posts a concise batch overview with correct check links.
- **S2:** a 🔄 + reply produces a follow-up Ready card that drains the next run; ✅ archives.
- **S3:** end-of-day digests land in the agent channels; scheduled task registered.

## Out of scope (spec §13)

Pre-merge gating; full two-way Slack control; real-time Slack events; per-PR isolated preview URLs; Slack posting from the cloud CTO job (local run composes all Slack output in v1).
