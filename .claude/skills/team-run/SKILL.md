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
(`git worktree add <cfg.worktreeRoot>\<slug> <branch>` (slug = headRefName with the team/ prefix stripped)), fetch CTO review comments
(`gh pr view <n> --json reviews,comments`), dispatch the matching engine agent(s) to fix,
then verify → QA → ship stages as below (ship = push to same branch, comment on PR
`CTO findings addressed: <summary>`, remove label `cto-changes-requested`). Counts toward
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
(`git -C <worktree> diff dev...HEAD`). Findings of severity "blocker" or "major" → build
(counts toward fixCycles). "minor"/"nit" findings are noted in the PR body but do not block ship. journal stage=ship.

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
