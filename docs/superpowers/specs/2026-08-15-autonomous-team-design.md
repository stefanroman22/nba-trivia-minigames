# Autonomous Agent Team — Design Spec

**Date:** 2026-08-15
**Status:** Approved design, pending implementation plan
**Repo:** nba-minigames
**Owner:** Stefan

## 1. Goal

An autonomous development pipeline for nba-minigames that runs on Stefan's Claude Max (5x)
subscription — never an API key. Tasks are written as Notion cards; the system picks them up
on a schedule, plans, builds, tests, QA-checks, reviews, ships a PR to `dev`, has an
independent CTO agent review and merge it in the cloud, and notifies Stefan through Notion.
No prompting inside VS Code required for routine work.

**Hard constraints**

- All Claude usage draws from the Max subscription (claude.ai login / `claude setup-token`
  OAuth). No `ANTHROPIC_API_KEY` anywhere.
- Pipeline stops at `dev`. Existing CI auto-promotes to `main`; Vercel auto-deploys frontend.
  Django/Railway deploys stay manual. The multiplayer data-sync pause agreement is untouched.
- Scope: nba-minigames only. "Categories" = areas of this app (games, UI shell, backend,
  multiplayer, auth, data), each with its own constraints doc.

## 2. Doctrine: docs vs skills vs agents

| Kind | What it is | Cost | Rule |
|---|---|---|---|
| **Docs** | Facts: constraints, architecture, code map | Free until read | Reference material agents *read*; never instructions |
| **Skills** | Process: how to do a kind of work | Cheap, composable | Any repeatable procedure is a skill |
| **Agents** | Actors: isolated context + perspective | Expensive (own context) | An agent exists only for context isolation, parallelism, or independence of judgment |

Agents are few and stable; skills are many and small; agents load skills and read docs.
The reviewer and CTO are separate actors for *independence*, not convenience: they must not
inherit the builder's assumptions.

## 3. Agent roster (6 local + 1 cloud)

| Agent | Status | Purpose | Default model/effort |
|---|---|---|---|
| `planner-architect` | new | Classify difficulty/areas/risk; run design rounds; merge proposals into one design | opus / high |
| `frontend-engine` | exists, rewrite | React 19 + TS + Tailwind 4 + Vite work in `src/` | sonnet / high |
| `backend-engine` | exists, rewrite | Django/DRF (`backend/`) + Socket.IO (`multiplayer_server/`) | sonnet / high |
| `test-qa-engine` | exists, rewrite | lint, `tsc -b`, build, Django tests; interprets failures | sonnet / medium |
| `browser-qa` | new | Drives real Chrome via CDP (`mcp__chrome__*`); runs DevTools acceptance tests from constraint docs | sonnet / high |
| `code-reviewer` | exists, rewrite | Pre-PR audit in a clean context | opus / high |
| CTO (cloud) | new | GitHub Action running `cto-review` skill; approve + merge or request changes | opus / high |

Per-task overrides: the orchestrator passes `model`/`effort` per spawn based on the
`classify` rubric. The existing profile system (`npm run engine`) remains the fleet floor.

The orchestrator itself is **not an agent** — it is the main-loop session executing the
`team-run` skill.

## 4. Skills

| Skill | Purpose |
|---|---|
| `team-run` | The pipeline: check PAUSE, pull Ready cards, drain queue, per-task state machine, journal, quota governor |
| `classify` | Difficulty rubric → model/effort tier, areas touched, risk tag, relevant CODE_MAP + constraint-doc excerpts |
| `design-round` | Written proposal → merged design doc → sign-off protocol; escalation criteria to live agent-team session |
| `qa-protocol` | Browser QA procedure: dev-server bring-up in worktree, acceptance tests, screenshot evidence |
| `ship` | Commit conventions, branch naming (`team/<slug>`), PR body template, Notion status updates |
| `cto-review` | CI-side review rubric: correctness, constraints compliance, reuse check, protected-path scan |
| `knowledge-refresh` | Weekly: diff merged PRs vs constraint docs + CODE_MAP; open docs PR |
| `bootstrap-audit` | One-time deep scan producing constraint docs, CODE_MAP, rewritten agent instructions |

## 5. Task intake: Notion

One Notion database (created via the connected Notion MCP):

- **Status:** `Backlog → Ready → In Progress → In Review → Blocked → Done`
  (plus `Blocked-approval` for protected-path PRs awaiting Stefan's tap)
- **Properties:** Priority, Area (multi-select: games / ui / backend / multiplayer / auth / data),
  Difficulty override (optional), Branch, PR link, Assignee (Stefan — drives notifications)
- **Page body** = the task spec. **Comment thread** = the running log.
- A **PAUSE** toggle page acts as the global kill switch; the orchestrator checks it first.

Only `Ready` cards are picked up. The orchestrator claims a card by setting `In Progress`
and commenting "started".

## 6. Triggers (cron pickup)

| Trigger | Mechanism |
|---|---|
| Scheduled | Windows Task Scheduler, every 2h between 08:00–24:00 (default; configurable): `claude --dangerously-skip-permissions -p "/team-run"` with a lockfile preventing overlap |
| Manual | `npm run team` (same command) |
| Morning batch | Optional Desktop scheduled task (permission mode: bypass) |
| Phone | Add a card in Notion → next scheduled run picks it up |

Empty queue → the run exits in seconds; negligible quota.

## 7. Per-task pipeline

1. **Claim** — card → In Progress, comment.
2. **Classify** — planner-architect: difficulty (trivial/standard/hard), areas, risk
   (low/medium/high), attach CODE_MAP entries + relevant constraint docs. Reads `RETRO.md` first.
3. **Workspace** — git worktree, branch `team/<slug>`.
4. **Design** — multi-area or hard → written design round (each involved engine writes a short
   proposal: interface, data shape, risks; planner merges; engines sign off; doc saved to
   `docs/team/designs/`). Hard tasks or conflicting proposals → escalate to a live
   agent-team session (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`). Single-area standard
   tasks skip straight to build.
5. **Build** — engine agents implement in the worktree. Reuse-first: CODE_MAP entries are in
   their prompt; writing new code that duplicates a catalogued util/component/hook is a
   review-reject.
6. **Verify** — test-qa-engine: `npm run lint`, `npx tsc -b`, `npm run build`, Django tests.
   Fail → back to build (max 2 fix cycles), then 1 full re-plan, then park.
7. **Browser QA** — serialized (one Chrome): bring up dev servers for the worktree, run the
   acceptance tests from the relevant constraint doc, capture evidence.
8. **Review** — code-reviewer in a clean context. Findings → back to build (counts toward
   fix-cycle cap).
9. **Ship** — commit, push, `gh pr create` → `dev`, PR body links the design doc and Notion
   card; card → In Review + comment @Stefan.

**Failure policy: park + report.** Cap = 2 build-fix cycles + 1 re-plan. Then: card →
Blocked, post-mortem comment (what was tried, why it failed, suggested next step, appended
to `RETRO.md`), branch left pushed for inspection, move on.

**Parallelism:** max 2 tasks concurrently (separate worktrees); browser QA and merges to
Notion serialized. Fix-tasks for changes-requested PRs are picked up as first-class queue
items on the next run.

## 8. Cloud half: CTO review + merge + notification

`claude.yml` v2 (GitHub Action), authenticated with `CLAUDE_CODE_OAUTH_TOKEN` repo secret
(generated by `claude setup-token` — Max subscription usage, no API key).

- **Trigger:** PR opened/synchronized targeting `dev` from `team/*` branches.
- **Run:** `cto-review` skill; full permission (`--permission-mode bypassPermissions` via
  `claude_args`) inside the ephemeral runner.
- **Pass + dev-ci green →** merge the PR.
- **Fail →** request changes with specifics; next local run creates a fix task.
- **Protected paths — never auto-merge:** `.github/workflows/**`, deploy configs
  (`vercel.json`, Railway/hosting files), dependency manifests (`package.json`,
  `requirements.txt`). These → card `Blocked-approval`, Stefan merges with one tap.
- **Notion update:** a deterministic script step (curl, not LLM) with a scoped
  `NOTION_API_KEY` integration-token secret sets the card → Done and posts an @Stefan
  comment → Notion push notification on phone + desktop.

**Notifications: Notion is the single pane of glass.** Pushes fire on: shipped to review,
merged to dev (Done), parked (Blocked), awaiting approval (Blocked-approval).

## 9. Permission model: full autonomy

Decided explicitly: agents run without permission prompts, with full tool access.

- **Local pipeline runs:** launched with `--dangerously-skip-permissions` (Task Scheduler,
  `npm run team`). Desktop scheduled task uses bypass-permissions mode.
- **Agents:** no `tools:` restriction in frontmatter — every agent inherits all tools
  (file ops, Bash, all MCP servers). Role discipline (e.g. only `browser-qa` drives Chrome,
  only the orchestrator writes to Notion) is enforced by **instructions**, not tool grants.
- **Cloud:** routines and web sessions are autonomous by design; the CTO action bypasses
  permissions inside its runner.
- **Consequence, accepted:** the guardrails are structural, not prompts — branch protection
  on `main`, `dev-ci` must be green, the independent CTO gate, protected-path rules, the
  quota governor, the PAUSE toggle, and Notion's audit trail.

## 10. Bootstrap: the deep scan (Stage 0)

One supervised run of `bootstrap-audit` before the loop ever turns on:

1. **Per-area constraint docs** — `docs/constraints/`: `UI_SHELL_CONSTRAINTS.md`,
   `BACKEND_CONSTRAINTS.md`, `MULTIPLAYER_CONSTRAINTS.md`, `AUTH_CONSTRAINTS.md` — same
   numbered-rule ❌/✅ format as `GAME_DESIGN_CONSTRAINTS.md` (which stays authoritative
   for games).
2. **`docs/team/CODE_MAP.md`** — reuse catalog: every reusable component, hook, util, store
   slice, endpoint pattern with a one-liner. Attached to tasks at classify time.
3. **Rewritten agent instructions** — all six agent `.md` files grounded in scan findings.

Output ships as one PR that Stefan reviews personally. The foundation must be right.

## 11. Knowledge & memory lifecycle

- **Per task:** design docs → `docs/team/designs/`; decisions → `docs/team/DECISIONS.md`;
  parked post-mortems → `docs/team/RETRO.md` (read by planner at classify time — the system
  learns from its failures).
- **Weekly cloud routine** (`knowledge-refresh`): diff the week's merged PRs against
  constraint docs + CODE_MAP; open a docs PR; reviewed by the same CTO gate.
- All system memory lives **in the repo** (not `~/.claude`) so local and cloud surfaces
  share one brain. `~/.claude` auto-memory remains for Stefan's personal preferences only.

## 12. Quota governor (Max 5x, balanced)

- Check usage between tasks; below ~30% of the 5-hour window remaining: finish current task,
  leave the rest Ready, exit with a Notion comment.
- sonnet-first; opus only for planner classification, hard-task design rounds, code review,
  and CTO review. Escalation to `deep` profile only via the failure policy's re-plan step.
- Max 2 parallel tasks; browser QA serialized.

## 13. Build order

| Stage | Deliverable | Exit criterion |
|---|---|---|
| 0 | Bootstrap scan: constraint docs, CODE_MAP, rewritten agents | Stefan approves the PR |
| 1 | Notion DB + `team-run` single-task serial pipeline, manual trigger | One real task flows card → PR unattended |
| 2 | CTO action (OAuth token), auto-merge, Notion notifications, Task Scheduler cron | One task flows card → merged → phone push, PC untouched |
| 3 | Parallel worktrees, difficulty tiering, agent-team escalation, quota governor | Two tasks drain concurrently within budget |
| 4 | `knowledge-refresh` routine + RETRO feedback loop | First autonomous docs PR merged |

## 14. Out of scope

Jira, multi-project support, Railway/Django deploy automation, multiplayer data-sync
automation, changes to the `dev → main` promotion pipeline.
