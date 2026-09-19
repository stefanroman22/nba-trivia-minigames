---
name: team-run
description: One queue-drain run of the autonomous team pipeline — resume unfinished cards, claim To Do cards, run each through classify→design→build→verify→QA→review→ship (fast-forward push to dev), fail cards back to To Do, post Slack cards. Invoked headless by scripts/team-run.ps1 or npm run team.
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
- `followup` → `node scripts/notion.mjs create-card "Follow-up: <title>" --category <category> --body "Slack feedback on <title>: <note> (original card: <pageId>)"`. It is `To Do` and joins this run's queue (§1 reads To Do after this).
- `ack` → nothing (the card stays in QA until its commit reaches main).

## 1. Queue
Resume every journal entry FIRST, at its recorded stage (skip claim). Then
`node scripts/notion.mjs list-todo` → queue (P0 first). Process serially; stop starting new
tasks at 80% of cfg.maxRunMinutes; always finish or fail the current one. `maxTasksPerRun`
is a safety net, not a target — time is the limit.

## 2. Per task — state machine (update journal after EVERY stage transition)
slug = kebab-case title, ≤30 chars. Journal entry: `{slug, title, category, stage, fixCycles,
replanned, startedAt, classify, subtasks?, resumeNote}`.

**claim** → `node scripts/notion.mjs claim <id> --model "<engineModel> · <engineEffort>"`
(fill after classify if you claim before it — re-run `claim` is idempotent for the Model text).
journal stage=classify.

**classify** → spawn planner-architect (model fable) with the classify skill, the card
title/Category, and `get-spec` output (it already contains body text, `[Image attached]`
lines from the body, the Attachments property and owner comments). Parse its JSON.
If `areas` contains both `frontend` and `backend` → this is a **split task** (§2b).
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

### 2b. Split tasks (frontend + backend in one card)
Journal `subtasks: {backend:{stage,fixCycles,did}, frontend:{stage,fixCycles,did}}`. Same
branch/worktree. Run **backend** build→verify first, then **frontend** build→verify, then ONE
qa + ONE review over the whole diff, then ONE ship (one commit, two `- agent:` bullets). A failing
half fails the whole card (fail procedure names the half in `stage`, e.g. `verify (frontend)`).
`.team/qa-<slug>.json` gets `halves` so each channel receives its own card.

## 3. Fail procedure (any stage)
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

## 4. End of run
- `leftTodo = (node scripts/notion.mjs list-todo).length`.
- Write `.team/run-summary.json`: `{start, end, shipped, failed, leftTodo}`
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
