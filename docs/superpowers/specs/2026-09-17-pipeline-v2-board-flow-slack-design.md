# Pipeline v2 — Board, Status Flow, Git Flow, Slack — Design

**Date:** 2026-09-17
**Status:** approved design, pending implementation plan
**Scope:** the autonomous team pipeline (`team-run`, `ship`, `classify` skills; `scripts/notion.mjs`, `scripts/slack.mjs`; `.github/workflows/{dev-ci,claude,team-reports}.yml`; the `NBA Team Board` Notion database; `docs/team/PIPELINE.md`).
**Supersedes:** the status vocabulary, PR-per-task flow and `#pipeline` reaction loop from `2026-08-15-autonomous-team-design.md` and `2026-08-22-slack-reporting-layer-design.md`. Everything not mentioned here (classify rubric, design round, model policy, QA protocol, park post-mortems in `RETRO.md`, cloud routine, report crons) is unchanged.

**Revision (2026-09-19), supersedes this doc's §5/§6/§8 promotion mechanism:** discovered mid-implementation that another concurrent session had opened PR #29 narrowing `dev-ci.yml`'s existing auto-promote job to `workflow_dispatch` only, and that the pipeline/agents must never push to `main` themselves. Owner's directive: "all coding agents and pipeline push to dev only. Push to prod can only be done if explicitly asked within prompting or via triggering the manual action on GitHub." This replaces the batch `dev → main` PR + CTO-review + owner-merge design below with:
- `dev-ci.yml`'s `promote` job is **kept**, not deleted — only its trigger changes, from `push` to `workflow_dispatch` (adopting PR #29's mechanism, avoiding the conflict).
- `claude.yml`'s `cto-review`/`cto-act` jobs are **retired entirely** — with no per-task PR (already gone, §5 below) and no batch dev→main PR, there is nothing left for a PR-triggered review job to attach to. Quality before `dev` stays the in-run `code-reviewer` (fable) step in `team-run`, unchanged.
- `main-sync.yml` is unaffected — it triggers on any push to `main`, whatever the mechanism.
- `scripts/promote.mjs` is **not built** — its only purpose was managing the batch PR, which no longer exists. `team-run`'s end-of-run step drops any promotion call; promotion to `main` is entirely the owner's action (run the workflow, or explicitly ask an agent to push).
Read §5/§6/§8 below for the original (now superseded) PR-based design's rationale on everything else — the board, git-flow-into-dev, Slack cards, and split tasks are unchanged by this revision.

## 1. Goal

Make the board the single source of truth for where every task is, make `dev` a
review-free preview branch the pipeline pushes to directly, gate production on one
human-merged `dev → main` PR, and move every actionable Slack message into the agent
channels with the model/effort that did the work. Also: pull images from wherever the
owner puts them (card body, `Attachments` property, comments), and let the number of
tasks per run be bounded only by time, never by count (`maxTasksPerRun` is already 50).

Non-goals: changing the run cadence (02:00 / 10:00 cloud firings — separate decision),
parallel task execution, a mobile client for the board, per-task PRs of any kind.

## 2. Where we start (2026-09-17)

- Statuses: `Backlog, Ready, In Progress, In Review, Blocked, Blocked-approval, Done`
  (select). `Area` multi-select (games/ui/backend/multiplayer/auth/data/frontend).
- Flow: `team/<slug>` → PR to `dev` → CTO review (fable, `claude.yml`) → auto-merge →
  card `Done`. `dev-ci.yml` auto-promotes every push to `dev` into `main` (does not
  fire for pipeline merges because they use the Actions token).
- Slack: `#pipeline` gets the batch overview + one card per task with the ✅/🔄
  reaction loop; `#agent-frontend`/`#agent-backend` get twice-daily digests only.
- Images: only `image` blocks in the card body are read (`notion.mjs get-spec`).
- Observed failure (2026-09-15/16): cards created with a blank Status were never
  claimed; a run cut off mid-task leaves the card `In Progress` until the journal resumes it.

## 3. Notion board

**Statuses (select, in column order):** `Backlog` → `To Do` → `In progress` → `QA` → `Done`.
- `Backlog` — drafts; pipeline ignores.
- `To Do` — ready; the only status the pipeline claims from.
- `In progress` — a run owns it (journal entry exists).
- `QA` — commit is on `dev`; owner checks the dev site; reacts in Slack.
- `Done` — commit is on `main` (production).

**Properties:**

| Property | Type | Set by | Notes |
|---|---|---|---|
| Name | title | owner | the ticket |
| Category | select: `frontend`, `backend`, `fullstack`, `CI/CD`, `pipeline`, `AI`, `docs` | owner | routes Slack + engines (§7) |
| Priority | select P0/P1/P2 | owner (optional) | queue order; default P2 |
| Attachments | files & media | owner (optional) | images/files; read by `get-spec` |
| Attempts | number | pipeline | failed runs so far |
| Needs human | checkbox | pipeline | set after the 2nd failure; pipeline skips while set |
| Model | rich_text | pipeline | `sonnet · high` (+ ` · plan fable` when a design round ran) |
| Difficulty | select trivial/standard/hard | pipeline (owner override allowed) | unchanged |
| Commit | rich_text | pipeline | sha on `dev` |
| Branch | rich_text | pipeline | `team/<slug>` |
| SlackTs | rich_text | pipeline | `<channelId>:<ts>` of the QA card (was ts only) |
| Paused | checkbox | owner | CONTROL row only — global kill switch, unchanged |

Dropped: `Area`, `PR`. The **Notes** the owner writes are the card body (Notion has no
image-capable field; the body already supports text + pasted images). `PR` is dropped
because tasks no longer have PRs; the `dev → main` PR is batch-level.

**View:** a `Board` view named "Board", `GROUP BY "Status"`, showing Category, Priority,
Model, Attempts, Needs human. The existing table view stays as "All".

**Spec assembly (`notion.mjs get-spec <pageId>`)** concatenates, in this order:
1. card body blocks (text, headings, bullets; `image` blocks downloaded as now);
2. `Attachments` property files (downloaded; `[Image attached: <path>]` for images,
   `[File attached: <path>]` otherwise);
3. comments on the page (`GET /v1/comments?block_id=<pageId>`), oldest first, as
   `## Comment (<author>, <date>)` + text, with each `attachments[]` entry downloaded
   the same way. Pipeline-authored comments (`🤖 …`, post-mortems) are skipped by an
   author check against the integration's own bot user id.
`Notion-Version` is bumped to the version that exposes `attachments` (verify at
implementation; `2022-06-28` may not return it). Download failures produce the existing
"DOWNLOAD FAILED — ask the owner" line, never a crash.

**Migration of existing cards:** `Ready`→`To Do`, `In Progress`→`In progress`,
`In Review`→`QA`, `Done`→`QA` if the commit is not on `main` (all three current Done cards),
`Blocked`/`Blocked-approval`→`To Do` with `Needs human` checked. `Area` values are dropped;
Category is set by hand for the 6 live cards (frontend ×3, backend ×0, fullstack ×2, ui-only
tasks → frontend). The three cards moved to `QA` get their `Commit` set to the squash sha
already on `dev` (`1d023cf`, `a495b08`, `3e250ee`) so `main-sync` can promote them later.

## 4. Status state machine (pipeline-enforced)

```
To Do ──claim──▶ In progress ──ship (commit on dev)──▶ QA ──commit reaches main──▶ Done
   ▲                  │
   └──fail (Attempts+1, post-mortem)──┘         (Attempts ≥ 2 → Needs human ✔, skipped)
```

- **claim**: `set-status In progress`, comment `🤖 started · <engineModel> · <engineEffort>`,
  journal entry written. Runs resume journal entries **before** claiming new cards (existing rule).
- **ship**: see §5. Sets `Commit`, `Branch`, `Model`; `set-status QA`; comment with the dev
  URL and sha; posts the Slack QA card (§6) and stores `SlackTs`.
- **fail** (fix cycles exhausted after the one allowed replan, design deadlock, rebase
  conflict, or any unrecoverable stage error): `Attempts` +1; post-mortem comment
  (what was tried / why it failed / suggested next step — unchanged content, now also
  the last error summary); `RETRO.md` entry as today; `set-status To Do`; if
  `Attempts ≥ 2` also `Needs human` ✔; Slack failure card (§6). Worktree removed; branch
  left pushed only if it has commits (unchanged).
- **queue filter** (`notion.mjs list-todo`): `Status = To Do AND Needs human = false`,
  sorted P0→P2 then created time. The CONTROL row is excluded as today.
- **Done**: only `main-sync.yml` (§5) moves a card to `Done`. No other code path may.
- **Run killed mid-task**: nothing changes — journal resume, card stays `In progress`.
- **Consistency sweep** at run start: any card `In progress` with **no** journal entry
  and no live lock is stale (a previous run died before writing the journal) → treated as
  a fail with reason "run died before journal" (does not count toward Attempts).

## 5. Git flow

- Work happens on `team/<slug>` in a worktree (local) or branch (cloud), from
  `origin/dev`, unchanged.
- **Ship** (replaces PR creation):
  1. Pre-flight unchanged (clean tree, verify passed, QA verdict pass, review clean).
  2. Commit: `<type>: <title>` + body `Notion: <card url>` + the `## Agent notes` block
     (moved from the PR body into the commit body so digests can still parse it via
     `git log`).
  3. `git fetch origin dev`; `git rebase origin/dev`. Conflict → abort rebase, **fail**
     the task (reason "rebase conflict with dev: <files>").
  4. If the rebase changed the base (dev moved): re-run the verify stage's static checks
     only (lint, tsc, build, unit/Django tests) — not browser QA. Fail → fail the task.
  5. `git push origin team/<slug>:dev` (fast-forward only; `--force` is never used).
     Non-fast-forward (dev moved again) → retry from step 3 once, then fail.
  6. Notion + Slack updates (§4 ship). Worktree removed; `team/<slug>` deleted locally
     and on origin if it was pushed (its commits are now on `dev`).
- **Push to dev triggers `dev-ci.yml`**: lint + gitleaks only. The `promote` job is
  **removed**. A red `dev-ci` on `dev` does not roll anything back; it is reported in
  the next `#pipeline` run summary line ("dev-ci red on <sha>: <job>") and blocks the
  `dev → main` PR from being opened/updated until green (the PR body says why).
- **`dev → main` PR (batch)**: at end of run, if `origin/dev` is ahead of `origin/main`
  and `dev-ci` is green on `dev`'s head: `gh pr list --base main --head dev`; if none,
  `gh pr create --base main --head dev --title "Promote dev → main (<N> tasks)"`; else
  `gh pr edit` the body. Body = one bullet per QA card (`- <title> · <Category> · <sha>`),
  then `Notion-Tasks: <id>,<id>,…`. Label `promote`.
- **CTO review** (`claude.yml`): trigger changes from `pull_request` on `branches: [dev]`
  with `head_ref team/*` to `pull_request` on `branches: [main]` with `head_ref == dev`.
  `cto-review` runs `/cto-review <n>` unchanged (fable, read-only). `cto-act` no longer
  merges: on `APPROVE` it adds label `cto-approved` and comments; on `REQUEST_CHANGES` it
  labels `cto-changes-requested` and comments the findings on the PR **and** as a Notion
  comment on each card listed in `Notion-Tasks`; the next run treats those as fix-tasks
  (existing §1 of `team-run`, now keyed on the label + card ids instead of a per-task PR).
  The protected-paths check stays here (label `needs-human-approval`, no Notion status
  change — the owner is merging by hand anyway).
- **Owner merges on GitHub.** `main-sync.yml` (new, on `push` to `main`): for every card
  in `QA`, if `git merge-base --is-ancestor <Commit> main` → `set-status Done` + comment
  `🚀 in production`. Runs with `NOTION_TOKEN`; read-only on the repo.
- Unchanged: never push to `main`; `git commit` only on task branches (plus
  `RETRO.md`/`DECISIONS.md` on dev by the orchestrator, as today — those commits go
  through the same fetch/rebase/ff-push path).

## 6. Slack

**Channels:** `#pipeline` (overview, no actions), `#agent-frontend` (frontend, docs),
`#agent-backend` (backend, CI/CD, AI, pipeline). `fullstack` (or any task that classify
splits, §7) → one card in each channel describing that half. Category→channel mapping
lives in `config.json` (`slack.categoryChannels`) so it is data, not code.

**QA card** (agent channel, posted at ship; reactions polled here):
```
✅ <title>   ·   <Category> · <Priority>
Model: <engineModel> · effort <engineEffort>  ·  design round: <no|yes (planModel)>  ·  fix cycles: <n>
Did: <engine `did` line(s)>
Check: <orchestrator's navigate → action → expected-result line>
Dev: <cfg.devSiteUrl>   ·   commit <sha7>
✅ approve   ·   🔄 needs work — reply to say what
```
`SlackTs` stores `<channelId>:<ts>`; `poll-reactions` reads the channel from it. ✅ →
ack (card stays `QA`; the `Done` transition is `main-sync`). 🔄 (+ reply) → follow-up
card in `To Do` (`Follow-up: <title>`, same Category, body = reply text + link to the
original card), as today.

**Failure card** (agent channel, posted at fail):
```
❌ <title>   ·   <Category> · attempt <Attempts>/2
Model: <engineModel> · effort <engineEffort> · design round: <…>
Failed at: <stage> — <one-line reason, e.g. "Django tests: 2 failing (test_photos …)">
Tried: <n> fix cycles[, 1 replan]. Last error: <≤3 lines>
Post-mortem: <Notion card url>
<"Back in To Do — retries next run." | "Needs human ✔ — pipeline will skip it until you uncheck.">
```

**Run summary** (`#pipeline`, once per run, at end, replaces `post-batch`):
```
🟢 Run done · <start>–<end> · <s> shipped to dev, <f> failed, <t> left in To Do
<category> <n> · <category> <n>          ← only categories with n > 0
• <title>                                 ← one per shipped task
Failed: <title> (<stage>, attempt <a>/2 → details in #agent-<x>)   ← one per failure
dev → main PR: #<n> (<N> tasks waiting for your merge) | "dev-ci red on <sha>, PR not opened"
```
If nothing was in the queue the run posts nothing (unchanged).

**Session reports** (`team-reports.yml` → `slack.mjs digest-window`): unchanged cadence;
"shipped" now means commits on `dev` in the window whose body contains `Notion:` (not
merged PRs); per-category counts added; a final line `QA: <n> waiting · Done: <n> reached
main this window`. Per-engine detail posts keep the `## Agent notes` parse, now from
`git log --format=%B`.

## 7. Multi-area tasks (internal split)

Trigger: classify (or the design round's final plan) lists both `frontend` and `backend`
areas — regardless of the card's Category (an `AI` card can be fullstack).

- Journal entry gains `subtasks: { backend: {stage, fixCycles}, frontend: {stage, fixCycles} }`.
  Order: backend first (API/contract), then frontend consuming it, same branch/worktree.
  Each half runs its own build → verify → (QA once, after both) → review.
- The card moves to `QA` only when both halves passed and the **one combined commit**
  is on `dev`. A failing half fails the whole card (§4 fail); nothing partial is pushed.
- Slack: one QA card per half in its channel, each with that engine's `did` and its own
  model/effort; `#pipeline` counts the task once under the card's Category.
- `Model` property: `backend sonnet · high / frontend sonnet · high`.

## 8. Config, docs, and what is deleted

- `config.json`: add `slack.categoryChannels` (`{frontend: "frontend", docs: "frontend",
  backend: "backend", "CI/CD": "backend", AI: "backend", pipeline: "backend",
  fullstack: "both"}`), `maxAttempts: 2`. Remove nothing else.
- `notion.mjs`: `list-ready` → `list-todo`; new `fail-card <id> --reason <file>`,
  `set-model`, `set-commit`; `get-spec` per §3; `create-card` sets `To Do` and
  `--category`; `set-props --slack-ts` takes `<channel>:<ts>`; `setup` writes the new
  schema. Status names are constants in one place.
- `slack.mjs`: `post-batch` → `post-run-summary`; new `post-qa-card`, `post-fail-card`;
  `poll-reactions` per §6; `digest-window` per §6. `daily-digests` (superseded by
  `digest-window` since 2026-08-30) is deleted.
- Skills: `team-run` (§4, §7, run summary), `ship` (§5), `classify` (reads Category; no
  Area; output unchanged otherwise). `cto-review` prompt: reviews a batch PR — same
  rubric, one verdict for the whole diff.
- Workflows: `dev-ci.yml` promote job removed; `claude.yml` triggers per §5;
  `main-sync.yml` new; `team-reports.yml` unchanged except the label text.
- `PIPELINE.md`: §2 (daily use), §4 (statuses), §5–6 (failures replace Blocked/
  Blocked-approval), §10 (security model: CTO on main PRs), §12 (Slack) rewritten.
  `DECISIONS.md` entry for this change.

## 9. Error handling summary

| Failure | Handling |
|---|---|
| Notion API error mid-run | existing: `notion.mjs` exits 1; orchestrator parks the stage, journal keeps state, next run resumes |
| Slack API error | non-fatal everywhere (log + continue), unchanged |
| Rebase conflict / non-ff push twice | task fails (§5), Attempts +1 |
| `dev-ci` red after push | reported; `dev → main` PR withheld until green; no rollback |
| CTO REQUEST_CHANGES on the batch PR | fix-task on the named cards next run; PR updated by the next ship |
| Card `In progress` with no journal | stale → fail without Attempts increment (§4 sweep) |
| Image download fails | spec line asks owner to re-upload; task continues |
| `Needs human` set | card skipped; visible in `#pipeline` "left in To Do" count |

## 10. Testing

- `notion.mjs`: run `setup` against a throwaway parent page → assert schema; `get-spec`
  on a fixture card with body image + Attachments file + comment image → three
  `[Image attached]` lines; `list-todo` excludes Needs-human and CONTROL.
- `slack.mjs`: unit-test message builders (pure functions) with fixture batch/fail JSON;
  `poll-reactions` against a card whose `SlackTs` is `<chan>:<ts>` in an agent channel.
- Ship: dry run in a worktree with a deliberately moved `dev` → rebase path exercised;
  a synthetic conflict → fail path exercised; ff push verified with `git log origin/dev`.
- Workflows: `act`-free — open a real `dev → main` PR on a test commit and watch
  `cto-review`/`cto-act` label it; push to `main` and confirm `main-sync` flips a QA card.
- End-to-end: one `npm run team` with two To Do cards (one frontend, one fullstack);
  assert board columns, both agent channels, `#pipeline` summary, PR body.
