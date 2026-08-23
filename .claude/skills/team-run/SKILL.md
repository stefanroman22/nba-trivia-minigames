---
name: team-run
description: One queue-drain run of the autonomous team pipeline — pull Ready Notion cards, execute each through classify→design→build→verify→QA→review→ship, park failures. Invoked headless by scripts/team-run.ps1 or npm run team.
---

# Team Run

You are the orchestrator. You delegate ALL heavy work to subagents; you never write
product code yourself. Notion I/O ONLY via `node scripts/notion.mjs ...` — never the
Notion MCP connector (absent in headless runs).

## Environment: local vs cloud
Check the `TEAM_CLOUD` environment variable once at the start.
- **`TEAM_CLOUD` unset (local, Windows):** behave exactly as the sections below describe —
  git worktrees under `cfg.worktreeRoot`, browser QA via Chrome, `.env.team` for tokens.
- **`TEAM_CLOUD=1` (cloud routine, Linux):** apply the cloud overrides marked
  **[CLOUD]** below. In short: work on a branch inside the current clone instead of a
  worktree, skip the browser-QA stage, and rely on `NOTION_TOKEN`/`SLACK_BOT_TOKEN` from the
  environment (no `.env.team`). Everything else — classify, build, verify, review, ship, park,
  post-batch — is identical.
  **[CLOUD] caveat:** the Slack reaction→follow-up loop (§0b) depends on
  `.claude/team/slack-state.json`, which does not persist across fresh-clone routine
  firings, so in cloud mode reactions on cloud-posted cards are NOT ingested into
  follow-up Notion cards. The reports still work (they read merged PRs, not local state).
  To act on a 🔄 reaction in cloud-only operation, run a manual local `npm run team`
  (local mode reads the state), or treat reaction-follow-ups as a local-run feature for
  now.

## 0. Preconditions
- Read `.claude/team/config.json` → cfg. Note start time; enforce cfg.maxRunMinutes overall.
- `node scripts/notion.mjs check-pause` — exit code 3 → say "paused" and STOP.
- Read `.claude/team/journal.json` (may be absent → `{}`).

## 0b. Slack feedback ingestion
Run `node scripts/slack.mjs poll-reactions` (non-fatal: on error, log and skip to §1).
Parse the JSON array. For each item:
- `action:"followup"` → `node scripts/notion.mjs create-card "Follow-up: <title>" --body "Slack feedback on <pr>: <note>"`. If the item has a non-empty `areas`, pass `--area <areas joined by comma>` to route it directly (e.g. `create-card "Follow-up: <title>" --area <areas.join(",")> --body "Slack feedback on <pr>: <note>"`); if `areas` is empty, omit `--area` as before and classify re-derives areas from the spec. This new Ready card is picked up in this same run's queue (§2 reads Ready after this).
- `action:"ack"` and the item has a pageId → `node scripts/notion.mjs archive-card <pageId>`.
This runs BEFORE §2 so follow-ups drain in the same batch.

## 1. Fix-tasks first (changes-requested PRs)
`gh pr list --base dev --label cto-changes-requested --json number,headRefName,title,url`
Each is a fix task: recreate the worktree from its branch
(`git worktree add <cfg.worktreeRoot>\<slug> <branch>` (slug = headRefName with the team/ prefix stripped)), fetch CTO review comments
(`gh pr view <n> --json reviews,comments`), dispatch the matching engine agent(s) to fix,
then verify → QA → ship stages as below (ship = push to same branch, comment on PR
`CTO findings addressed: <summary>`, remove label `cto-changes-requested`). Counts toward
cfg.maxTasksPerRun.
   **[CLOUD]** No worktree — recreate the branch in the clone: `git fetch origin <branch>`
   then `git checkout -B <branch> origin/<branch>`; run verify/QA(skip)/ship as in cloud
   mode; `git checkout dev` before the next task.

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
   **[CLOUD]** Do NOT create a worktree. Instead, in the single clone:
   `git fetch origin dev` then `git checkout -B team/<slug> origin/dev`. Build/verify/review
   happen in the clone on this branch. After ship (or park), `git checkout dev` before the next
   task so each task starts clean from `origin/dev`. There is no `cfg.worktreeRoot` and no
   worktree to remove in cloud mode.

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
   **[CLOUD]** Skip the browser-QA stage entirely (no Chrome in the cloud). Rely on the
   verify stage (lint/tsc/build/Django tests) and code-review; the human reviews the shipped
   result via the Slack `#pipeline` card and the dev link. Do not spawn browser-qa in cloud mode.

**review** → spawn code-reviewer (model opus) on the worktree diff
(`git -C <worktree> diff dev...HEAD`). Findings of severity "blocker" or "major" → build
(counts toward fixCycles). "minor"/"nit" findings are noted in the PR body but do not block ship. journal stage=ship.

**ship** → follow ship skill. On success: remove journal entry. On success, append to
an in-run `shipped[]` list: `{n, title, areas, pr, prNum, look, pageId}`. `look` is an
EXPLICIT verification line the orchestrator writes: where to navigate → what to do →
the expected result, pitched for someone who knows the app (e.g. "Open the Leaderboard
from the nav; rows should be ordered by total wins, highest first; ties break by most
recent win"). Not just the expected end-state — include the navigate/action. The card
shows one Dev link at the parent (from `cfg.devSiteUrl`); no per-card PR/CTO/deep-link.
`pr`/`prNum` are stored for the feedback loop's follow-up context, not displayed.
   **[CLOUD]** Ship is unchanged (commit → `git push -u origin team/<slug>` → `gh pr create
   --base dev`), but there is no worktree to remove — just `git checkout dev` for the next task.
   Tokens for the Notion/Slack calls in the ship + post-batch steps come from the environment.

## 4. Park procedure (any stage)
1. `node scripts/notion.mjs set-status <id> Blocked`
2. `comment <id> "<post-mortem: what was tried / why it failed / suggested next step>" --mention`
3. Append the same post-mortem to `docs/team/RETRO.md` in the MAIN checkout, commit it
   there on dev: `docs(team): retro for <slug>`.
4. Leave the branch pushed if any commits exist; remove the worktree; remove journal entry.
   **[CLOUD]** No worktree to remove — just `git checkout dev` for the next task; the branch stays pushed if it has commits.

## 5. End of run
Log a one-line summary per task (shipped/parked/deferred). If nothing was in the queue,
exit silently. Never touch cards that are not Ready/In Progress-by-you. If `shipped[]`
is non-empty, write it to `.claude/team/last-batch.json` as `{count: shipped.length,
shipped}` and run `node scripts/slack.mjs post-batch .claude/team/last-batch.json`
(wrap in a try/catch equivalent — if it fails, log "slack post failed (non-fatal)" and
continue). This is the batch overview to Slack. Composition happens in the local run
per spec §7; the CTO merges later in the cloud, so the CTO ✅ is visible on the PR, not
the card.

## Hard rules
- NEVER run git commands in the main checkout except: committing RETRO.md/DECISIONS.md
  updates and `git fetch`/`git worktree` management. The user's WIP there is sacred.
- NEVER push to dev or main directly. Ship = PR only.
- One task's failure never aborts the run — park and continue.
