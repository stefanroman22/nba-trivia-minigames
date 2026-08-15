# Autonomous Agent Team (Stages 0–2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An autonomous pipeline that picks up Notion cards on a schedule, plans/builds/tests/QAs/reviews each task, ships a PR to `dev`, has a cloud CTO agent review + merge it, and notifies Stefan via Notion — all on the Max subscription.

**Architecture:** A `team-run` skill executed by headless `claude -p` (cron via Windows Task Scheduler) orchestrates existing + new subagents per task in isolated git worktrees. All Notion I/O goes through a deterministic Node script (`scripts/notion.mjs`, REST API) — never through the claude.ai connector, which is unreliable in headless runs. The cloud half is a GitHub Actions job authenticated with `CLAUDE_CODE_OAUTH_TOKEN` running the `cto-review` skill, followed by deterministic merge + Notion-update steps.

**Tech Stack:** Claude Code skills/subagents, Node 18+ (built-in `fetch`, zero deps), PowerShell 5.1, Windows Task Scheduler, GitHub Actions, `gh` CLI, Notion REST API (`2022-06-28`).

**Spec:** `docs/superpowers/specs/2026-08-15-autonomous-team-design.md`

**Plan scope:** Spec Stages 0–2 only. Stages 3–4 (parallel worktrees, agent-team escalation, knowledge-refresh routine) get a separate plan after Stage 2's exit criterion passes.

## Global Constraints

- All Claude usage via Max subscription: local = logged-in CLI; CI = `CLAUDE_CODE_OAUTH_TOKEN`. **Never** `ANTHROPIC_API_KEY`.
- Pipeline stops at `dev`. Never touch `dev → main` promotion, Vercel, or Railway.
- Full autonomy: pipeline runs with `--dangerously-skip-permissions`; agent files have **no** `tools:` frontmatter line (full tool inheritance). Role discipline via instructions only.
- Protected paths (CTO never auto-merges): `.github/workflows/**`, `vercel.json`, `package.json`, `package-lock.json`, `backend/requirements.txt`.
- Branch naming: `team/<slug>`. Commits: conventional (`feat:`, `fix:`, `docs:`, `chore:`).
- Secrets live in `.env.team` (gitignored) locally and GitHub repo secrets in CI. Never committed, never echoed into files that get committed.
- The user's main working tree is dirty with WIP — the pipeline NEVER switches branches or builds in the main checkout. All task work happens in worktrees under `C:\Users\stefa\.team-worktrees\` (outside OneDrive).
- Stage 0 outputs are committed directly to `dev` (commit authority granted); Stefan reviews the committed docs before Stage 1 goes live.
- Notion DB property names (exact, used by scripts and skills): `Name` (title), `Status` (select: `Backlog`, `Ready`, `In Progress`, `In Review`, `Blocked`, `Blocked-approval`, `Done`), `Priority` (select: `P0`, `P1`, `P2`), `Area` (multi-select: `games`, `ui`, `backend`, `multiplayer`, `auth`, `data`), `Difficulty` (select: `trivial`, `standard`, `hard`), `Branch` (rich_text), `PR` (url), `Paused` (checkbox — CONTROL row only).

---

## Stage 0 — Bootstrap scan

### Task 1: Team scaffolding

**Files:**
- Create: `docs/team/DECISIONS.md`, `docs/team/RETRO.md`, `docs/team/designs/.gitkeep`, `docs/constraints/.gitkeep`, `.claude/team/config.json`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `.claude/team/config.json` — read by `team-run` skill and `scripts/notion.mjs` (`notionDbId`, `notionUserId`, `maxTasksPerRun`, `maxRunMinutes`, `worktreeRoot`, `qaPorts`).

- [ ] **Step 1: Create directory seeds**

`docs/team/DECISIONS.md`:
```markdown
# Team Decisions Log

Append-only. One entry per architectural/design decision made by the planner or a design round.
Format: `## YYYY-MM-DD — <title>` then Context / Decision / Consequences (2–3 lines each).
```

`docs/team/RETRO.md`:
```markdown
# Parked-Task Post-Mortems

Append-only. The planner-architect MUST read this file before classifying any new task.
Format: `## YYYY-MM-DD — <task title> (<Notion page id>)` then What was tried / Why it failed / Suggested next step.
```

`docs/team/designs/.gitkeep` and `docs/constraints/.gitkeep`: empty files.

`.claude/team/config.json`:
```json
{
  "notionDbId": "",
  "notionUserId": "",
  "maxTasksPerRun": 3,
  "maxRunMinutes": 90,
  "worktreeRoot": "C:\\Users\\stefa\\.team-worktrees",
  "qaPorts": { "django": 8100, "socket": 4100, "vite": 5273 }
}
```

- [ ] **Step 2: Gitignore runtime files**

Append to `.gitignore`:
```
# team pipeline runtime
.claude/team/journal.json
.claude/team/run.lock
.claude/team/logs/
.claude/team/qa/
.env.team
```

- [ ] **Step 3: Verify**

Run: `git status --short docs/team docs/constraints .claude/team .gitignore`
Expected: exactly the new files above listed; `git check-ignore .env.team .claude/team/run.lock` prints both paths.

- [ ] **Step 4: Commit**

```bash
git add docs/team docs/constraints .claude/team/config.json .gitignore
git commit -m "chore(team): scaffold team pipeline directories and config"
```

### Task 2: Constraint doc — UI shell

**Files:**
- Create: `docs/constraints/UI_SHELL_CONSTRAINTS.md`

**Interfaces:**
- Produces: numbered rules `UI-1`, `UI-2`, … cited by `classify`, engines, `code-reviewer`, and `cto-review`.

- [ ] **Step 1: Audit the UI shell (dispatch a subagent with this exact brief)**

> Read, in full: `src/App.tsx`, `src/components/Navigation.tsx`, every file in `src/pages/`, `src/components/modals/`, `src/components/ui/`, `src/styles/ui.css`, `src/styles/MiniGame.css`, `tailwind.config.js`, and `docs/GAME_DESIGN_CONSTRAINTS.md` (for format only — games stay ITS territory).
> Produce `docs/constraints/UI_SHELL_CONSTRAINTS.md` covering NON-game UI: layout shell, navigation, pages, modals, shared ui/ components, styling conventions (Tailwind vs page CSS files — document the actual split you observe), responsive breakpoints, z-index/stacking, toast/popup patterns.
> Format — mirror GAME_DESIGN_CONSTRAINTS exactly: `## Rule UI-<n>: <imperative title>` , 1–3 sentence rationale citing real file paths, then a ❌ wrong / ✅ right pair of real-code examples (taken or adapted from this codebase, not invented idioms). 10–20 rules. End with a `## Acceptance checks` section: concrete DevTools/console checks a QA agent can execute.
> Every file path cited must exist. Do not invent conventions the code doesn't show; where the code is inconsistent, document the DOMINANT pattern and note the exception.

- [ ] **Step 2: Verify format and citations**

Run: `grep -c "^## Rule UI-" docs/constraints/UI_SHELL_CONSTRAINTS.md` → ≥ 10.
Run: `grep -o 'src/[A-Za-z0-9_/ .-]*\.\(tsx\|ts\|css\)' docs/constraints/UI_SHELL_CONSTRAINTS.md | sort -u` and spot-check 5 paths exist with `ls`.
Expected: rules present, cited paths real, ❌/✅ pair under every rule.

- [ ] **Step 3: Commit**

```bash
git add docs/constraints/UI_SHELL_CONSTRAINTS.md
git commit -m "docs(team): add UI shell constraints from codebase audit"
```

### Task 3: Constraint doc — backend

**Files:**
- Create: `docs/constraints/BACKEND_CONSTRAINTS.md`

**Interfaces:**
- Produces: rules `BE-1`, `BE-2`, …

- [ ] **Step 1: Audit backend (dispatch subagent with this brief)**

> Read in full: `backend/backend/settings.py`, `backend/backend/urls.py`, all of `backend/users/` and `backend/trivia/` (models, views, serializers if present, urls, admin, management commands), `backend/trivia/data_pipeline/README.md`, `docs/DATA_PIPELINE.md`, `docs/ARCHITECTURE.md`.
> Produce `docs/constraints/BACKEND_CONSTRAINTS.md`: app layout rules, model conventions (naming, migrations discipline), view/endpoint patterns (DRF usage as actually practiced), URL routing conventions, settings/env-var handling (cite the env pattern in settings.py), data-pipeline boundaries (what task code may/may not touch — defer pipeline internals to DATA_PIPELINE.md), test conventions (`python manage.py test` layout).
> Same format as Task 2: `## Rule BE-<n>`, rationale + real paths, ❌/✅ pairs, 10–20 rules, `## Acceptance checks` (e.g. `python manage.py check` clean, no new endpoints without URL + test).

- [ ] **Step 2: Verify**

Run: `grep -c "^## Rule BE-" docs/constraints/BACKEND_CONSTRAINTS.md` → ≥ 10; spot-check 5 cited `backend/` paths exist.

- [ ] **Step 3: Commit**

```bash
git add docs/constraints/BACKEND_CONSTRAINTS.md
git commit -m "docs(team): add backend constraints from codebase audit"
```

### Task 4: Constraint docs — multiplayer + auth

**Files:**
- Create: `docs/constraints/MULTIPLAYER_CONSTRAINTS.md`, `docs/constraints/AUTH_CONSTRAINTS.md`

**Interfaces:**
- Produces: rules `MP-<n>` and `AUTH-<n>`.

- [ ] **Step 1: Audit multiplayer (dispatch subagent)**

> Read in full: `multiplayer_server/` (all source), `src/socket.ts`, `src/components/MultiPlayer/FriendPlay.tsx`, `src/components/MultiPlayer/OnlineMatch.tsx`, socket-related Redux slices in `src/store/`, `docs/ARCHITECTURE.md` multiplayer sections.
> Produce `docs/constraints/MULTIPLAYER_CONSTRAINTS.md`: event naming conventions, room/lobby lifecycle, client-server state ownership (who is authoritative for what), reconnection handling as implemented, ports/env (`VITE_SOCKET_URL`, server port), the SP-first-but-MP-ready rule (every game must work single-player without the socket server). 8–15 rules `MP-<n>`, same ❌/✅ format, `## Acceptance checks`.

- [ ] **Step 2: Audit auth (dispatch subagent)**

> Read in full: `backend/users/` (models, views, urls, admin), frontend auth flow (`src/context/`, login components, token storage — find them via `grep -ri "token\|login\|auth" src/ --include=*.tsx -l` and read the hits), `src/components/UserProfile.tsx`.
> Produce `docs/constraints/AUTH_CONSTRAINTS.md`: custom user model rules, token/session mechanics as implemented, rank system boundaries, what auth surfaces a task may not touch without `risk: high`. 6–12 rules `AUTH-<n>`, same format, `## Acceptance checks`.

- [ ] **Step 3: Verify both**

Run: `grep -c "^## Rule MP-" docs/constraints/MULTIPLAYER_CONSTRAINTS.md` → ≥ 8 and `grep -c "^## Rule AUTH-" docs/constraints/AUTH_CONSTRAINTS.md` → ≥ 6; spot-check cited paths.

- [ ] **Step 4: Commit**

```bash
git add docs/constraints/MULTIPLAYER_CONSTRAINTS.md docs/constraints/AUTH_CONSTRAINTS.md
git commit -m "docs(team): add multiplayer and auth constraints from codebase audit"
```

### Task 5: CODE_MAP — the reuse catalog

**Files:**
- Create: `docs/team/CODE_MAP.md`

**Interfaces:**
- Produces: the catalog `classify` attaches to tasks; format below is load-bearing (engines grep it).

- [ ] **Step 1: Build the catalog (dispatch subagent)**

> Enumerate every reusable unit in the codebase. For each: one line, format `- \`<path>\` — <what it does, ≤15 words> [used by: <n> files]`. Count usages with grep on the import name.
> Sections (exact headings): `## Components (src/components/)`, `## UI primitives (src/components/ui/)`, `## Hooks (src/hooks/)`, `## Utils (src/utils/)`, `## Store slices (src/store/)`, `## Context (src/context/)`, `## Constants (src/constants/)`, `## Game renderer shared patterns (src/Game Renderers/)` (shared shell pieces like RenderGame, ScorePanel, EndSequence, GameFrame — not every game), `## Backend utilities (backend/)` (management commands, trivia/utils, shared model mixins), `## Motion (src/motion/)`.
> Header block at top, verbatim:
> ```markdown
> # CODE_MAP — Reuse Catalog
>
> **Engines: search here BEFORE writing anything new.** Writing a new util/component/hook
> that duplicates an entry below is a review-reject (reviewer cites this file).
> Regenerated by the bootstrap-audit skill; hand-edits survive until next regeneration.
> ```

- [ ] **Step 2: Verify coverage**

Run: `ls src/hooks src/utils src/components/ui` and confirm every file there has a CODE_MAP line (`grep -c "^- \`" docs/team/CODE_MAP.md` should be ≥ the combined file count of those three dirs).

- [ ] **Step 3: Commit**

```bash
git add docs/team/CODE_MAP.md
git commit -m "docs(team): add CODE_MAP reuse catalog"
```

### Task 6: Rewrite the four engine agents + bootstrap-audit skill

**Files:**
- Modify: `.claude/agents/frontend-engine.md`, `.claude/agents/backend-engine.md`, `.claude/agents/test-qa-engine.md`, `.claude/agents/code-reviewer.md`
- Create: `.claude/skills/bootstrap-audit/SKILL.md`

**Interfaces:**
- Consumes: Tasks 2–5 docs.
- Produces: agents with the doc-reading contract every later task relies on.

- [ ] **Step 1: Rewrite each agent (dispatch one subagent per file, or one for all four)**

Requirements for every agent file:
1. **Remove the `tools:` frontmatter line entirely** (full tool inheritance — spec §9). Keep `name`, `description`, `model`, `effort`, `color`.
2. Add a `## Required reading (before any work)` section mapping Area → doc: games → `docs/GAME_DESIGN_CONSTRAINTS.md`; ui → `docs/constraints/UI_SHELL_CONSTRAINTS.md`; backend/data → `docs/constraints/BACKEND_CONSTRAINTS.md`; multiplayer → `docs/constraints/MULTIPLAYER_CONSTRAINTS.md`; auth → `docs/constraints/AUTH_CONSTRAINTS.md`. Agent reads only the docs for the areas its current task touches.
3. Add a `## Reuse-first` section: search `docs/team/CODE_MAP.md` before writing any new component/hook/util; duplicating a catalogued unit is a review-reject.
4. Ground every stack/convention claim in what Tasks 2–5 actually found (update stale claims; keep the existing rules that still hold, e.g. frontend-engine's GAME_DESIGN_CONSTRAINTS warning).
5. `code-reviewer.md` additionally: verify constraint-rule compliance citing rule IDs (UI-n/BE-n/MP-n/AUTH-n), verify reuse (CODE_MAP), verify tests exist for logic changes. It reviews the DIFF in a clean context; it must not fix code itself.
6. `test-qa-engine.md` additionally: exact command sequence `npm run lint`, `npx tsc -b`, `npm run build`, then if backend touched: activate worktree venv, `python manage.py check`, `python manage.py test`. Reports failures with the failing output verbatim.

- [ ] **Step 2: Write `.claude/skills/bootstrap-audit/SKILL.md`**

```markdown
---
name: bootstrap-audit
description: Regenerate the codebase-derived knowledge base — per-area constraint docs, CODE_MAP, and agent instruction refresh. Run when docs have drifted or after major refactors.
---

# Bootstrap Audit

Regenerates: `docs/constraints/*.md`, `docs/team/CODE_MAP.md`, and flags stale agent instructions.

## Procedure

1. Dispatch one audit subagent per area with the briefs recorded in
   `docs/superpowers/plans/2026-08-15-autonomous-team-stages-0-2.md` Tasks 2–5
   (they are the canonical audit briefs — reuse them verbatim, updating file lists
   to match the current tree first via `ls`/`glob`).
2. Each audit REPLACES its doc wholesale (append-only history lives in git).
3. Verify every doc: rule-count floors (UI≥10, BE≥10, MP≥8, AUTH≥6), all cited paths exist,
   every rule has a ❌/✅ pair.
4. Diff new docs vs old; if any rule that an agent .md file cites verbatim changed,
   update that agent file in the same commit.
5. Commit as `docs(team): refresh knowledge base via bootstrap-audit`.
```

- [ ] **Step 3: Verify**

Run: `grep -L "^tools:" .claude/agents/frontend-engine.md .claude/agents/backend-engine.md .claude/agents/test-qa-engine.md .claude/agents/code-reviewer.md` — all four listed (no `tools:` line). `grep -l "Required reading" .claude/agents/*.md` — all four listed.

- [ ] **Step 4: Commit**

```bash
git add .claude/agents .claude/skills/bootstrap-audit
git commit -m "feat(team): ground engine agents in audited constraints; add bootstrap-audit skill"
```

**STAGE 0 GATE:** Stefan reads `docs/constraints/*` + `docs/team/CODE_MAP.md` and says go before Stage 1 executes.

---

## Stage 1 — Pipeline core

### Task 7: Notion database + integration (user-assisted)

**Files:**
- Modify: `.claude/team/config.json` (fill `notionDbId`, `notionUserId`)
- Create: `.env.team` (NOT committed)

**Interfaces:**
- Produces: live Notion DB matching the Global Constraints schema; `NOTION_TOKEN` in `.env.team`; config IDs used by `scripts/notion.mjs`.

- [ ] **Step 1: USER ACTION — create the integration (Claude asks, never invents the secret)**

Ask Stefan to:
1. Go to notion.so/my-integrations → New integration → name `nba-team-pipeline`, workspace: his, capabilities: Read/Update/Insert content + **Read user information including email**.
2. Copy the secret into a new file `.env.team` at repo root: `NOTION_TOKEN=ntn_...` (file is already gitignored by Task 1).
3. Create (or pick) a parent page for the board, e.g. "NBA Team Board", and share it with the `nba-team-pipeline` integration (page ••• → Connections → nba-team-pipeline).
4. Paste the parent page URL into chat.

- [ ] **Step 2: Create the DB via script setup command (script arrives in Task 8 — execute Tasks 7+8 interleaved: write Task 8's script first, then run this)**

Run: `node scripts/notion.mjs setup <parentPageIdFromUrl>`
Expected output: `DB created: <databaseId>` plus `CONTROL row created`. Then `node scripts/notion.mjs whoami-user stefanromanpers@gmail.com` → prints Stefan's Notion user id.

- [ ] **Step 3: Fill config**

Write `notionDbId` and `notionUserId` into `.claude/team/config.json`.

- [ ] **Step 4: Verify**

Run: `node scripts/notion.mjs list-ready`
Expected: `[]` (empty DB, CONTROL row excluded).

- [ ] **Step 5: Commit**

```bash
git add .claude/team/config.json
git commit -m "chore(team): wire Notion database ids into team config"
```

### Task 8: `scripts/notion.mjs` — deterministic Notion I/O

**Files:**
- Create: `scripts/notion.mjs`

**Interfaces:**
- Produces (CLI, used by team-run skill, ship skill, claude.yml):
  - `setup <parentPageId>` → creates DB + CONTROL row, prints ids
  - `whoami-user <email>` → prints user id
  - `check-pause` → exit 0 = run, exit 3 = paused
  - `list-ready` → JSON array `[{id, title, priority, area, difficulty, url}]` sorted P0→P2
  - `get-spec <pageId>` → page body as plain text
  - `claim <pageId>` → Status=In Progress + "🤖 started" comment
  - `set-status <pageId> <status>`
  - `set-props <pageId> [--branch <name>] [--pr <url>]`
  - `comment <pageId> <text> [--mention]` → `--mention` prepends an @Stefan mention (fires phone/desktop push)

- [ ] **Step 1: Write the script**

```javascript
#!/usr/bin/env node
// Deterministic Notion I/O for the team pipeline. Zero deps (Node 18+ fetch).
// Env: NOTION_TOKEN (from .env.team or process env). Config: .claude/team/config.json
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = resolve(ROOT, ".claude/team/config.json");
const ENV_PATH = resolve(ROOT, ".env.team");

function loadEnvTeam() {
  if (!process.env.NOTION_TOKEN && existsSync(ENV_PATH)) {
    for (const line of readFileSync(ENV_PATH, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  }
}
loadEnvTeam();
const TOKEN = process.env.NOTION_TOKEN;
if (!TOKEN) { console.error("NOTION_TOKEN missing (set in .env.team or env)"); process.exit(2); }
const cfg = existsSync(CONFIG_PATH) ? JSON.parse(readFileSync(CONFIG_PATH, "utf8")) : {};
const DB = process.env.NOTION_DB_ID || cfg.notionDbId;
const USER = process.env.NOTION_USER_ID || cfg.notionUserId;

async function api(path, method = "GET", body) {
  const res = await fetch(`https://api.notion.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) { console.error(`Notion ${res.status}: ${json.message}`); process.exit(1); }
  return json;
}

const SCHEMA = {
  Name: { title: {} },
  Status: { select: { options: [
    { name: "Backlog", color: "gray" }, { name: "Ready", color: "blue" },
    { name: "In Progress", color: "yellow" }, { name: "In Review", color: "orange" },
    { name: "Blocked", color: "red" }, { name: "Blocked-approval", color: "pink" },
    { name: "Done", color: "green" },
  ] } },
  Priority: { select: { options: [
    { name: "P0", color: "red" }, { name: "P1", color: "yellow" }, { name: "P2", color: "gray" },
  ] } },
  Area: { multi_select: { options: ["games","ui","backend","multiplayer","auth","data"].map(n => ({ name: n })) } },
  Difficulty: { select: { options: [
    { name: "trivial", color: "gray" }, { name: "standard", color: "blue" }, { name: "hard", color: "red" },
  ] } },
  Branch: { rich_text: {} },
  PR: { url: {} },
  Paused: { checkbox: {} },
};

const text = (s) => [{ type: "text", text: { content: String(s).slice(0, 1900) } }];

async function cmdSetup(parentPageId) {
  const db = await api("databases", "POST", {
    parent: { type: "page_id", page_id: parentPageId },
    title: text("NBA Team Board"),
    properties: SCHEMA,
  });
  console.log(`DB created: ${db.id}`);
  await api("pages", "POST", {
    parent: { database_id: db.id },
    properties: { Name: { title: text("CONTROL — do not delete") }, Paused: { checkbox: false } },
  });
  console.log("CONTROL row created");
}

async function cmdWhoamiUser(email) {
  let cursor, found;
  do {
    const r = await api(`users?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`);
    found = r.results.find(u => u.person?.email === email);
    cursor = r.has_more ? r.next_cursor : null;
  } while (!found && cursor);
  if (!found) { console.error(`No user with email ${email}`); process.exit(1); }
  console.log(found.id);
}

const isControl = (p) =>
  (p.properties?.Name?.title?.[0]?.plain_text || "").startsWith("CONTROL");

async function cmdCheckPause() {
  const r = await api(`databases/${DB}/query`, "POST", {
    filter: { property: "Paused", checkbox: { equals: true } },
  });
  if (r.results.some(isControl)) { console.log("PAUSED"); process.exit(3); }
  console.log("RUNNING");
}

async function cmdListReady() {
  const r = await api(`databases/${DB}/query`, "POST", {
    filter: { property: "Status", select: { equals: "Ready" } },
    page_size: 50,
  });
  const rank = { P0: 0, P1: 1, P2: 2 };
  const rows = r.results.filter(p => !isControl(p)).map(p => ({
    id: p.id,
    title: p.properties.Name.title.map(t => t.plain_text).join(""),
    priority: p.properties.Priority?.select?.name || "P2",
    area: (p.properties.Area?.multi_select || []).map(a => a.name),
    difficulty: p.properties.Difficulty?.select?.name || null,
    url: p.url,
  })).sort((a, b) => rank[a.priority] - rank[b.priority]);
  console.log(JSON.stringify(rows, null, 2));
}

async function cmdGetSpec(pageId) {
  let cursor, out = [];
  do {
    const r = await api(`blocks/${pageId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`);
    for (const b of r.results) {
      const rt = b[b.type]?.rich_text;
      if (rt) out.push((b.type.startsWith("heading") ? "## " : b.type === "bulleted_list_item" ? "- " : "") + rt.map(t => t.plain_text).join(""));
    }
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor);
  console.log(out.join("\n"));
}

async function setStatus(pageId, status) {
  await api(`pages/${pageId}`, "PATCH", { properties: { Status: { select: { name: status } } } });
}

async function cmdComment(pageId, body, mention) {
  const rich = [];
  if (mention && USER) rich.push({ type: "mention", mention: { user: { id: USER } } }, { type: "text", text: { content: " " } });
  rich.push({ type: "text", text: { content: String(body).slice(0, 1900) } });
  await api("comments", "POST", { parent: { page_id: pageId }, rich_text: rich });
  console.log("commented");
}

async function cmdSetProps(pageId, args) {
  const props = {};
  const bi = args.indexOf("--branch"); if (bi > -1) props.Branch = { rich_text: text(args[bi + 1]) };
  const pi = args.indexOf("--pr"); if (pi > -1) props.PR = { url: args[pi + 1] };
  await api(`pages/${pageId}`, "PATCH", { properties: props });
  console.log("props set");
}

const [cmd, ...args] = process.argv.slice(2);
const run = {
  "setup": () => cmdSetup(args[0]),
  "whoami-user": () => cmdWhoamiUser(args[0]),
  "check-pause": cmdCheckPause,
  "list-ready": cmdListReady,
  "get-spec": () => cmdGetSpec(args[0]),
  "claim": async () => { await setStatus(args[0], "In Progress"); await cmdComment(args[0], "🤖 started", false); },
  "set-status": () => setStatus(args[0], args[1]),
  "set-props": () => cmdSetProps(args[0], args.slice(1)),
  "comment": () => cmdComment(args[0], args.filter(a => a !== "--mention").slice(1).join(" "), args.includes("--mention")),
}[cmd];
if (!run) { console.error(`Unknown command: ${cmd}`); process.exit(2); }
await run();
```

- [ ] **Step 2: Test against the live DB (after Task 7 Steps 1–3)**

Run each and check output:
- `node scripts/notion.mjs check-pause` → `RUNNING`, exit 0
- Tick `Paused` on the CONTROL row in Notion UI → `check-pause` → `PAUSED`, exit 3. Untick.
- Create a card "test card" with Status=Ready, Priority=P1 in the Notion UI → `list-ready` → one JSON row.
- `node scripts/notion.mjs claim <id>` → card flips to In Progress, "🤖 started" comment appears.
- `node scripts/notion.mjs comment <id> "merged 🎉" --mention` → Stefan gets a Notion push on phone.
- `node scripts/notion.mjs set-status <id> Backlog` → resets. Delete the test card.

- [ ] **Step 3: Commit**

```bash
git add scripts/notion.mjs
git commit -m "feat(team): deterministic Notion I/O script"
```

### Task 9: Run wrapper + lockfile + npm script

**Files:**
- Create: `scripts/team-run.ps1`
- Modify: `package.json` (add script)

**Interfaces:**
- Produces: `npm run team` and the exact command Task Scheduler calls.

- [ ] **Step 1: Write `scripts/team-run.ps1`**

```powershell
# Launches one queue-drain pipeline run. Safe under cron: lockfile prevents overlap.
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$lock = Join-Path $repo ".claude\team\run.lock"
$logDir = Join-Path $repo ".claude\team\logs"
New-Item -ItemType Directory -Force $logDir | Out-Null

# Lockfile: skip if a previous run is still alive
if (Test-Path $lock) {
  $oldPid = Get-Content $lock -ErrorAction SilentlyContinue
  if ($oldPid -and (Get-Process -Id $oldPid -ErrorAction SilentlyContinue)) {
    Write-Output "team-run already running (pid $oldPid); exiting."
    exit 0
  }
  Remove-Item $lock -Force
}
Set-Content $lock $PID -Encoding ascii

# Load .env.team into this process (NOTION_TOKEN etc.)
$envFile = Join-Path $repo ".env.team"
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^([A-Z_]+)=(.*)$') { [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim(), "Process") }
  }
}

$log = Join-Path $logDir ("run-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".log")
try {
  Set-Location $repo
  claude --dangerously-skip-permissions -p "/team-run" 2>&1 | Tee-Object -FilePath $log
} finally {
  Remove-Item $lock -Force -ErrorAction SilentlyContinue
}
```

- [ ] **Step 2: Add npm script**

In `package.json` `"scripts"`, add (touching nothing else):
```json
"team": "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/team-run.ps1"
```

- [ ] **Step 3: Test lockfile logic without burning quota**

Run: `Set-Content .claude\team\run.lock 99999` then `npm run team` — expected: starts (stale pid cleaned). Ctrl-C it. Then `Set-Content .claude\team\run.lock $PID` (your live shell pid) and `npm run team` — expected: "already running" and exit 0. Remove lock.

- [ ] **Step 4: Commit**

```bash
git add scripts/team-run.ps1 package.json
git commit -m "feat(team): team-run wrapper with lockfile and npm script"
```

### Task 10: `classify` + `design-round` skills

**Files:**
- Create: `.claude/skills/classify/SKILL.md`, `.claude/skills/design-round/SKILL.md`

**Interfaces:**
- Produces: classification JSON contract consumed by team-run: `{difficulty, areas[], risk, engineModel, engineEffort, docs[], codeMapHits[], needsDesignRound}`.

- [ ] **Step 1: Write `.claude/skills/classify/SKILL.md`**

```markdown
---
name: classify
description: Classify a team task — difficulty, areas, risk, model/effort tier, required docs, CODE_MAP hits. Used by planner-architect at pipeline step 2.
---

# Classify a Task

Input: task title + spec text (from `node scripts/notion.mjs get-spec <pageId>`) and Area tags from the card.

## Procedure
1. Read `docs/team/RETRO.md` — if a similar task was parked before, factor its post-mortem in.
2. Confirm/correct the card's Area tags by grepping the codebase for the features named in the spec.
3. Grep `docs/team/CODE_MAP.md` for nouns in the spec; collect up to 10 relevant entries.
4. Apply the rubric. If the card has a Difficulty override, it wins.

## Rubric
- **trivial** — docs/copy/config/single-file change, no logic branches. Engines: haiku / low.
- **standard** — one area, bounded logic, existing patterns cover it. Engines: sonnet / high.
- **hard** — multi-area, new patterns, state machines, migrations, or anything touching
  multiplayer protocol. Engines: opus / high. `needsDesignRound: true`.
- **risk: high** if it touches auth, data pipeline, multiplayer protocol, or anything in
  the protected-paths list — CTO gets a `Risk: high` PR label and extra scrutiny.
- Multi-area at any difficulty → `needsDesignRound: true`.

## Output (exact JSON, nothing else)
{ "difficulty": "standard", "areas": ["ui"], "risk": "low",
  "engineModel": "sonnet", "engineEffort": "high",
  "docs": ["docs/constraints/UI_SHELL_CONSTRAINTS.md"],
  "codeMapHits": ["- `src/hooks/useLeaderboard.ts` — ..."],
  "needsDesignRound": false }
```

- [ ] **Step 2: Write `.claude/skills/design-round/SKILL.md`**

```markdown
---
name: design-round
description: Written design round for multi-area or hard tasks — proposals, merge, sign-off — before any code. Run by planner-architect.
---

# Design Round

The "meeting" is an artifact. No code until sign-off.

## Procedure
1. For each involved area, dispatch that engine agent with: the task spec, classify JSON,
   relevant constraint docs, CODE_MAP hits. Ask for a proposal, ≤300 words:
   interface/contract it will expose or consume, data shapes, files it will touch, risks.
2. Merge the proposals into ONE design doc: `docs/team/designs/YYYY-MM-DD-<slug>.md` with
   sections: Decision summary / Interfaces (exact names+types) / File plan / Risks / Test plan.
   Where proposals conflict, planner decides and records the decision + reason.
3. One sign-off pass: send the merged doc back to each involved engine — "objection or OK?"
   Fold objections in once. Persistent conflict = planner decides, logs to
   `docs/team/DECISIONS.md`.
4. Hard tasks with unresolved conflicts after step 3: STOP — park the task with status
   Blocked and post-mortem "design deadlock" (v1 has no live agent-team escalation; that is
   Stage 3).
5. Commit the design doc: `docs(team): design for <slug>`.
```

- [ ] **Step 3: Verify + commit**

`claude` skill listing should show both (or check files exist and frontmatter parses: `head -5` each).

```bash
git add .claude/skills/classify .claude/skills/design-round
git commit -m "feat(team): classify and design-round skills"
```

### Task 11: `qa-protocol` + `ship` skills

**Files:**
- Create: `.claude/skills/qa-protocol/SKILL.md`, `.claude/skills/ship/SKILL.md`

**Interfaces:**
- Consumes: `qaPorts` from config; chrome MCP (`mcp__chrome__*`).
- Produces: PR body contract — `Notion-Task: <pageId>` line that claude.yml greps (Task 14).

- [ ] **Step 1: Write `.claude/skills/qa-protocol/SKILL.md`**

```markdown
---
name: qa-protocol
description: Browser QA for a task worktree using the real Chrome CDP session. Run by browser-qa agent after verify passes. Skip if the diff touches neither src/ nor backend/.
---

# Browser QA Protocol

Ports come from `.claude/team/config.json` `qaPorts` (defaults: django 8100, vite 5273,
socket 4100) so the user's own dev servers (8000/5173/4000) are never disturbed.

## Bring-up (inside the task worktree)
1. Backend (if the task touches backend or the page needs data):
   `cd backend && .venv\Scripts\python manage.py runserver 8100` (background).
2. Frontend: `$env:VITE_BACKEND_URL="http://localhost:8100"; npm run dev -- --port 5273` (background).
3. Multiplayer server only if the task touches multiplayer.
4. Confirm Chrome CDP is up (`npm run chrome:debug` in the MAIN repo if not already running).

## Test
1. Navigate the real Chrome (mcp__chrome__* tools) to `http://localhost:5273`.
2. Execute the `## Acceptance checks` section of every constraint doc the classify JSON listed.
   For game tasks, run the GAME_DESIGN_CONSTRAINTS DevTools acceptance tests verbatim.
3. Exercise the task's own spec: does the feature do what the card says? Test the happy path
   plus one edge (empty state, wrong input, or refresh mid-flow — whichever applies).
4. Screenshot evidence at each key state → `.claude/team/qa/<slug>/`.

## Verdict
- Write `.claude/team/qa/<slug>/verdict.json`: `{"pass": true|false, "failures": ["..."]}`.
- ALWAYS kill the servers you started (find pids by port, stop them) — even on failure.
- Failures go back to the build stage (they count toward the 2-fix-cycle cap).
```

- [ ] **Step 2: Write `.claude/skills/ship/SKILL.md`**

```markdown
---
name: ship
description: Commit, push, open the PR to dev, update Notion. Final pipeline stage, run from the task worktree.
---

# Ship

## Pre-flight (abort ship if any fails)
1. Working tree in the WORKTREE is clean except intended changes; `git -C <worktree> status`.
2. verify stage passed; QA verdict.json (if QA ran) has `"pass": true`.

## Procedure
1. Commit (conventional): `<type>: <task title>` + body line `Notion: <card url>`.
2. Push: `git push -u origin team/<slug>`.
3. PR: `gh pr create --base dev --head team/<slug> --title "<type>: <task title>" --body <file>`.
   Body template (exact — claude.yml greps Notion-Task):

   ## Summary
   <what changed, 3–6 lines>

   ## Test evidence
   - lint/tsc/build: pass
   - Django tests: pass|n/a
   - Browser QA: pass|skipped (<link to .claude/team/qa/<slug>/ evidence if run>)

   Notion-Task: <pageId>
   Design-Doc: <docs/team/designs/... or "none">
   Risk: <low|medium|high>

4. Notion: `node scripts/notion.mjs set-props <pageId> --branch team/<slug> --pr <prUrl>`
   then `set-status <pageId> "In Review"` then
   `comment <pageId> "PR ready for CTO review: <prUrl>" --mention`.
5. Remove the worktree: `git worktree remove <path> --force` (branch stays pushed).
```

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/qa-protocol .claude/skills/ship
git commit -m "feat(team): qa-protocol and ship skills"
```

### Task 12: `team-run` skill — the orchestrator

**Files:**
- Create: `.claude/skills/team-run/SKILL.md`

**Interfaces:**
- Consumes: everything from Tasks 7–11; journal format `{<pageId>: {stage, slug, branch, worktree, fixCycles, replanned}}`.

- [ ] **Step 1: Write `.claude/skills/team-run/SKILL.md`**

```markdown
---
name: team-run
description: One queue-drain run of the autonomous team pipeline — pull Ready Notion cards, execute each through classify→design→build→verify→QA→review→ship, park failures. Invoked headless by scripts/team-run.ps1 or npm run team.
---

# Team Run

You are the orchestrator. You delegate ALL heavy work to subagents; you never write
product code yourself. Notion I/O ONLY via `node scripts/notion.mjs ...` — never the
Notion MCP connector (absent in headless runs).

## 0. Preconditions
- Read `.claude/team/config.json` → cfg. Note start time; enforce cfg.maxRunMinutes overall.
- `node scripts/notion.mjs check-pause` — exit code 3 → say "paused" and STOP.
- Read `.claude/team/journal.json` (may be absent → `{}`).

## 1. Fix-tasks first (changes-requested PRs)
`gh pr list --base dev --label cto-changes-requested --json number,headRefName,title,url`
Each is a fix task: recreate the worktree from its branch
(`git worktree add <cfg.worktreeRoot>\<slug> <branch>`), fetch CTO review comments
(`gh pr view <n> --json reviews,comments`), dispatch the matching engine agent(s) to fix,
then verify → QA → ship stages as below (ship = push to same branch, comment on PR
`@claude fixed: <summary>`, remove label `cto-changes-requested`). Counts toward
cfg.maxTasksPerRun.

## 2. Queue
`node scripts/notion.mjs list-ready` → queue (already P0-sorted). Also merge in any
journal entries mid-flight (resume them FIRST, at their recorded stage).
Process serially (Stage 1–2 = 1 task at a time), up to cfg.maxTasksPerRun or until
cfg.maxRunMinutes is nearly spent (stop starting new tasks at 80% elapsed; always
finish or park the current one).

## 3. Per task — state machine (update journal after EVERY stage transition)
slug = kebab-case title, ≤30 chars.

**claim** → `node scripts/notion.mjs claim <id>`; journal stage=classify.

**classify** → spawn planner-architect (model opus) with the classify skill, the card
title/areas, and `get-spec` output. Parse its JSON. journal stage=workspace.

**workspace** → `git worktree add <cfg.worktreeRoot>\<slug> -b team/<slug> dev`
(from up-to-date dev: `git fetch origin dev` first; base on origin/dev).
In worktree: `npm ci`. If areas include backend/data/auth:
`cd backend && python -m venv .venv && .venv\Scripts\pip install -r requirements.txt`.
journal stage=design|build.

**design** (only if classify.needsDesignRound) → spawn planner-architect with
design-round skill. If it parks (design deadlock) → park procedure. journal stage=build.

**build** → per involved area spawn the engine agent (frontend-engine and/or
backend-engine) with model=classify.engineModel, effort=classify.engineEffort.
Prompt MUST include: spec text, design doc path (if any), classify.docs (tell them to
read those files first), classify.codeMapHits verbatim, and the line
"Reuse-first: duplicating a CODE_MAP entry is a review-reject." Work happens in the
worktree path. journal stage=verify.

**verify** → spawn test-qa-engine in the worktree. Fail → send failures back to the
engine (fixCycles += 1). fixCycles > 2 → ONE replan: spawn planner-architect with the
failure history, get a revised approach, reset to build (replanned=true). Fails again →
park. journal stage=qa.

**qa** → if diff touches src/ or backend/: spawn browser-qa with qa-protocol skill.
Fail → build (counts toward fixCycles). journal stage=review.

**review** → spawn code-reviewer (model opus) on the worktree diff
(`git -C <worktree> diff dev...HEAD`). Findings of severity "must-fix" → build
(counts toward fixCycles). journal stage=ship.

**ship** → follow ship skill. On success: remove journal entry.

## 4. Park procedure (any stage)
1. `node scripts/notion.mjs set-status <id> Blocked`
2. `comment <id> "<post-mortem: what was tried / why it failed / suggested next step>" --mention`
3. Append the same post-mortem to `docs/team/RETRO.md` in the MAIN checkout, commit it
   there on dev: `docs(team): retro for <slug>`.
4. Leave the branch pushed if any commits exist; remove the worktree; remove journal entry.

## 5. End of run
Log a one-line summary per task (shipped/parked/deferred). If nothing was in the queue,
exit silently. Never touch cards that are not Ready/In Progress-by-you.

## Hard rules
- NEVER run git commands in the main checkout except: committing RETRO.md/DECISIONS.md
  updates and `git fetch`/`git worktree` management. The user's WIP there is sacred.
- NEVER push to dev or main directly. Ship = PR only.
- One task's failure never aborts the run — park and continue.
```

- [ ] **Step 2: Verify frontmatter + dry read**

Run: `head -4 .claude/skills/team-run/SKILL.md` — frontmatter present. Read the skill once end-to-end checking every referenced path exists (`scripts/notion.mjs`, config, agents, skills from Tasks 10–11).

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/team-run
git commit -m "feat(team): team-run orchestrator skill"
```

### Task 13: New agents + Stage-1 smoke test

**Files:**
- Create: `.claude/agents/planner-architect.md`, `.claude/agents/browser-qa.md`, one Notion card (not a file)

**Interfaces:**
- Consumes: classify/design-round skills (planner), qa-protocol skill (browser-qa).

- [ ] **Step 1: Write `.claude/agents/planner-architect.md`**

```markdown
---
name: planner-architect
description: Classifies team tasks (difficulty, areas, risk, model tier) and runs written design rounds for multi-area/hard tasks. The thinking half of the pipeline — never writes product code.
model: opus
effort: high
color: purple
---

You are the planner-architect for the nba-minigames autonomous team.

Your two jobs, each defined by a skill you MUST load and follow exactly:
1. Classification → use the `classify` skill. Output ONLY its JSON contract.
2. Design rounds → use the `design-round` skill.

Ground rules:
- Read `docs/team/RETRO.md` before classifying anything — the pipeline learns from
  its parked tasks through you.
- You never edit product code. Your outputs are JSON (classify) and design docs +
  DECISIONS.md entries (design rounds).
- Bias small: prefer the classification that ships the task with the least machinery.
  When torn between two difficulties, pick the lower and let the failure policy escalate.
```

- [ ] **Step 2: Write `.claude/agents/browser-qa.md`**

```markdown
---
name: browser-qa
description: Real-browser QA for task worktrees — drives the user's Chrome via CDP (mcp__chrome__* tools), runs constraint-doc acceptance checks, produces a pass/fail verdict with screenshot evidence.
model: sonnet
effort: high
color: green
---

You are the browser QA agent for the nba-minigames autonomous team.

Follow the `qa-protocol` skill exactly: bring up servers on the QA ports (8100/5273/4100 —
NEVER 8000/5173/4000, those are the user's), test against the real Chrome CDP session,
write verdict.json, kill your servers.

Judgment rules:
- You test BEHAVIOR against the card's spec and the constraint docs' acceptance checks —
  not code style (that's code-reviewer's job).
- A visual violation of a numbered constraint rule is a FAIL citing the rule id.
- Flaky result? Retry once. Still ambiguous → FAIL with what you observed; the build
  stage gets another look. Never pass on doubt.
- Evidence or it didn't happen: screenshot every claimed state.
```

- [ ] **Step 3: Smoke-test the whole Stage-1 pipeline**

1. Create a Notion card: title `Add pipeline smoke marker doc`, Status=`Ready`, Priority=`P2`, Area=`data` (docs-only), page body: `Create docs/team/SMOKE.md containing exactly one line: "pipeline smoke test — <today's date>". No other changes.`
2. Run: `npm run team`
3. Watch the log in `.claude/team/logs/`.

Expected end state: card = `In Review` with Branch + PR filled; a PR exists on GitHub (`gh pr list --base dev --head team/add-pipeline-smoke-marker`) with the body containing `Notion-Task:`; Stefan got a Notion push; journal empty; no worktree left in `C:\Users\stefa\.team-worktrees`; the main checkout's WIP untouched (`git status` unchanged vs before).

- [ ] **Step 4: Fix what broke, re-run until green, then commit**

```bash
git add .claude/agents/planner-architect.md .claude/agents/browser-qa.md
git commit -m "feat(team): planner-architect and browser-qa agents"
```

(Leave the smoke PR open — it becomes Stage 2's test input.)

---

## Stage 2 — Cloud CTO, notifications, cron

### Task 14: `cto-review` skill

**Files:**
- Create: `.claude/skills/cto-review/SKILL.md`

**Interfaces:**
- Produces: `cto-verdict.json` `{verdict: "APPROVE"|"REQUEST_CHANGES", summary, findings[]}` — read by claude.yml's merge step (Task 15).

- [ ] **Step 1: Write `.claude/skills/cto-review/SKILL.md`**

```markdown
---
name: cto-review
description: Independent CTO review of a team/* PR into dev, run in GitHub Actions. Produces cto-verdict.json consumed by the workflow's merge step. Argument: the PR number.
---

# CTO Review

You are the final independent gate before code reaches dev (and from there, production).
You did NOT build this. Trust nothing in the PR description without checking the diff.

## Procedure
1. `gh pr view <n> --json title,body,files` and `gh pr diff <n>`.
2. Extract `Notion-Task:` from the body; fetch the spec:
   `node scripts/notion.mjs get-spec <pageId>` (NOTION_TOKEN is in the environment).
3. Read the constraint docs for every touched area (map paths→areas: src/Game Renderers→
   GAME_DESIGN_CONSTRAINTS; src/→UI_SHELL; backend/→BACKEND (+AUTH if users/);
   multiplayer_server/ or socket→MULTIPLAYER).
4. Checklist — each item pass/fail with evidence:
   a. Scope: diff does what the Notion spec says — nothing more. Unrequested changes = fail.
   b. Constraints: no violation of any numbered rule in the docs from step 3. Cite rule ids.
   c. Reuse: no new util/component/hook duplicating a `docs/team/CODE_MAP.md` entry.
   d. Tests: logic changes come with test changes, or PR body justifies why not.
   e. Quality: no obvious bugs, no `any` creep, no dead code, no leftover debug output.
   f. Protected paths: if the diff touches any (workflow already checks — double-check):
      verdict is automatically REQUEST_CHANGES with finding "protected path".
5. Write `cto-verdict.json` in the workspace root:
   {"verdict": "APPROVE"|"REQUEST_CHANGES",
    "summary": "<2-3 lines>",
    "findings": [{"severity": "must-fix"|"nit", "file": "...", "issue": "...", "rule": "UI-4|null"}]}
   APPROVE requires: zero must-fix findings AND checklist a–f all pass. Nits alone don't block.
6. Post the review as a PR comment: verdict, summary, findings table. Be specific enough
   that the fix-task engine can act without guessing.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/cto-review
git commit -m "feat(team): cto-review skill"
```

### Task 15: claude.yml v2 — CTO job with merge + Notion update

**Files:**
- Modify: `.github/workflows/claude.yml` (READ IT FIRST; keep the existing @claude-mention job, switch its auth to `claude_code_oauth_token`; add the job below)

**Interfaces:**
- Consumes: `CLAUDE_CODE_OAUTH_TOKEN`, `NOTION_TOKEN` secrets (Task 16); PR body `Notion-Task:` line; `cto-verdict.json`.

- [ ] **Step 1: Add the CTO job to claude.yml**

```yaml
  cto-review:
    if: github.event_name == 'pull_request' && startsWith(github.head_ref, 'team/')
    runs-on: ubuntu-latest
    concurrency:
      group: cto-${{ github.event.pull_request.number }}
      cancel-in-progress: true
    permissions:
      contents: write
      pull-requests: write
      issues: write
      id-token: write
      actions: read
    env:
      GH_TOKEN: ${{ github.token }}
      NOTION_TOKEN: ${{ secrets.NOTION_TOKEN }}
      PR: ${{ github.event.pull_request.number }}
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0

      - name: Extract Notion task id
        id: meta
        run: |
          BODY=$(gh pr view "$PR" --json body -q .body)
          echo "notion_task=$(echo "$BODY" | grep -oP 'Notion-Task: \K\S+' || true)" >> "$GITHUB_OUTPUT"

      - name: Protected paths check
        id: protected
        run: |
          FILES=$(gh pr diff "$PR" --name-only)
          if echo "$FILES" | grep -E '^\.github/workflows/|^vercel\.json$|^package(-lock)?\.json$|^backend/requirements\.txt$'; then
            echo "hit=true" >> "$GITHUB_OUTPUT"
          else
            echo "hit=false" >> "$GITHUB_OUTPUT"
          fi

      - name: CTO review
        uses: anthropics/claude-code-action@v1
        with:
          claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          prompt: "/cto-review ${{ github.event.pull_request.number }}"
          claude_args: '--allowedTools "Bash,Read,Grep,Glob,Write"'

      - name: Act on verdict
        run: |
          VERDICT=$(jq -r .verdict cto-verdict.json)
          NOTION_TASK="${{ steps.meta.outputs.notion_task }}"
          if [ "${{ steps.protected.outputs.hit }}" = "true" ]; then
            gh pr edit "$PR" --add-label "needs-human-approval"
            [ -n "$NOTION_TASK" ] && node scripts/notion.mjs set-status "$NOTION_TASK" "Blocked-approval" \
              && node scripts/notion.mjs comment "$NOTION_TASK" "PR touches protected paths — needs your tap: $(gh pr view $PR --json url -q .url)" --mention
            exit 0
          fi
          if [ "$VERDICT" = "APPROVE" ]; then
            # --required only: this cto job is itself a check on the PR, so watching ALL
            # checks would deadlock waiting on ourselves. dev-ci should be marked required
            # on dev PRs in branch protection; if no required checks exist this returns fast.
            gh pr checks "$PR" --required --watch || { echo "required checks failed"; VERDICT="REQUEST_CHANGES"; }
          fi
          if [ "$VERDICT" = "APPROVE" ]; then
            gh pr merge "$PR" --squash --delete-branch
            [ -n "$NOTION_TASK" ] && node scripts/notion.mjs set-status "$NOTION_TASK" "Done" \
              && node scripts/notion.mjs comment "$NOTION_TASK" "Merged to dev 🎉 $(gh pr view $PR --json url -q .url)" --mention
          else
            gh pr edit "$PR" --add-label "cto-changes-requested"
            [ -n "$NOTION_TASK" ] && node scripts/notion.mjs comment "$NOTION_TASK" "CTO requested changes — next local run will fix. $(gh pr view $PR --json url -q .url)"
          fi
```

Also add to the workflow's top-level `on:` block (preserving existing triggers):
```yaml
  pull_request:
    types: [opened, synchronize, reopened]
    branches: [dev]
```

Note for executor: `notion.mjs` reads `NOTION_TOKEN`/`NOTION_DB_ID` from env before config — env vars are already set; `NOTION_DB_ID` isn't needed for page-scoped commands. Verify existing `claude.yml` mention-job auth line becomes `claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}`.

- [ ] **Step 2: Verify YAML locally**

Run: `npx yaml-lint .github/workflows/claude.yml` (or `python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/claude.yml'))"`)
Expected: parses clean.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/claude.yml
git commit -m "feat(team): CTO review job — review, merge, Notion notify"
```

### Task 16: Secrets (user-assisted) + push + live CTO test

**Files:** none (GitHub secrets + a push)

- [ ] **Step 1: USER ACTION — mint the subscription token**

Ask Stefan to run in his terminal: `claude setup-token` → follow the browser flow → copy the token, then:
```bash
gh secret set CLAUDE_CODE_OAUTH_TOKEN
```
(paste when prompted — token never lands in a file).

- [ ] **Step 2: USER ACTION — set the Notion secret**

Ask Stefan to run `gh secret set NOTION_TOKEN` in the repo and paste the same `ntn_...` value from `.env.team` when prompted.

- [ ] **Step 3: Push dev + verify the smoke PR triggers the CTO**

`git push origin dev` (first push of all pipeline commits). Then push a trivial update to the Task-13 smoke PR branch to fire `synchronize`:
`gh pr checks` / `gh run watch` on the new `cto-review` run.

Expected: CTO reviews the docs-only smoke PR → APPROVE → auto-merge → smoke card flips to Done → Stefan's phone gets the "Merged to dev 🎉" Notion push. If REQUEST_CHANGES: read the verdict comment, fix, iterate.

- [ ] **Step 4: Clean up**

Delete `docs/team/SMOKE.md` via one more Ready card (title `Remove smoke marker doc`) — which doubles as the second end-to-end test, this time fully hands-off from card creation to merged.

### Task 17: Cron registration

**Files:**
- Create: `scripts/register-team-cron.ps1`

- [ ] **Step 1: Write the registration script**

```powershell
# Registers (or replaces) the scheduled task: every 2h, 08:00-24:00, runs team-run.ps1.
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$name = "nba-team-pipeline"
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$repo\scripts\team-run.ps1`"" `
  -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Once -At "08:00" `
  -RepetitionInterval (New-TimeSpan -Hours 2) -RepetitionDuration (New-TimeSpan -Hours 16)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
  -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Hours 3)
try { Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction Stop } catch {}
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings | Out-Null
Write-Output "Registered '$name': every 2h from 08:00 for 16h daily."
Get-ScheduledTask -TaskName $name | Select-Object TaskName, State
```

- [ ] **Step 2: Register + verify**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/register-team-cron.ps1`
Expected: `Registered 'nba-team-pipeline'...`, State `Ready`.
Then: `Start-ScheduledTask -TaskName nba-team-pipeline` and confirm a log appears in `.claude/team/logs/` and (empty queue) exits within ~1 minute.

- [ ] **Step 3: Commit + push**

```bash
git add scripts/register-team-cron.ps1
git commit -m "feat(team): scheduled task registration script"
git push origin dev
```

### Task 18: Documentation + CLAUDE.md wiring

**Files:**
- Create: `docs/team/PIPELINE.md`
- Modify: `CLAUDE.md` (docs map + one section), `.claude/README.md` (fix the API-key line)

- [ ] **Step 1: Write `docs/team/PIPELINE.md`**

Operator manual, sections: What it is (3 lines) / Daily use (write cards → Ready → wait for pushes; PAUSE checkbox = kill switch) / Triggers (cron schedule, `npm run team`, morning) / Status meanings (each of the 7) / When a card goes Blocked (read post-mortem comment, fix the spec or split the task, back to Ready) / Blocked-approval (protected paths — review + merge manually) / Where things live (skills, agents, journal, logs, QA evidence, worktrees) / Secrets rotation (`claude setup-token` expiry → re-run + `gh secret set`; Notion token) / Troubleshooting (lockfile stuck: delete `.claude/team/run.lock`; task stuck In Progress with empty journal: set back to Ready).

- [ ] **Step 2: Wire into CLAUDE.md**

Add docs-map row: `| docs/team/PIPELINE.md | operating or debugging the autonomous team pipeline |` and a short section "## Autonomous team pipeline" (4–5 lines: exists, runs via team-run skill + cron, Notion is the control surface, worktrees under C:\Users\stefa\.team-worktrees, never build in the main checkout).

- [ ] **Step 3: Fix `.claude/README.md`**

Replace the line `GitHub Actions: add the ANTHROPIC_API_KEY repo secret — easiest via claude /install-github-app` with: `GitHub Actions: add the CLAUDE_CODE_OAUTH_TOKEN repo secret (run \`claude setup-token\`, then \`gh secret set CLAUDE_CODE_OAUTH_TOKEN\`) — subscription usage, no API key.`

- [ ] **Step 4: Commit + push**

```bash
git add docs/team/PIPELINE.md CLAUDE.md .claude/README.md
git commit -m "docs(team): pipeline operator manual and CLAUDE.md wiring"
git push origin dev
```

---

## Exit criteria (from spec §13)

- **Stage 0:** Stefan approves the committed constraint docs + CODE_MAP + agent rewrites.
- **Stage 1:** smoke card flowed card → PR unattended (Task 13 Step 3).
- **Stage 2:** a card flowed card → merged → phone push with zero human touches (Task 16 Step 4), and the cron task fires on schedule (Task 17).

## Deferred to the Stage 3–4 plan

Parallel worktrees (maxTasksPerRun concurrency), live agent-team escalation for design
deadlocks, usage-aware quota governor (v1 uses per-run caps), `knowledge-refresh` weekly
cloud routine, RETRO-driven classify tuning.
