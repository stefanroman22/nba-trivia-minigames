# Fully-Unattended Cloud Pipeline — Design Spec

**Date:** 2026-08-23
**Status:** Approved design, pending implementation plan
**Repo:** nba-minigames
**Owner:** Stefan
**Builds on:** the autonomous pipeline (`2026-08-15-autonomous-team-design.md`) and the Slack layer (`2026-08-22-slack-reporting-layer-design.md`)

## 1. Goal

Move the pipeline **worker** off Stefan's PC so the whole system runs **fully unattended —
computer off, no prompting, no touching**. The worker runs in the cloud on a schedule; the
CTO already runs in the cloud (GitHub Actions); reports run in the cloud on a schedule. Stefan
writes Notion cards and reviews results in Slack; everything else happens by itself.

## 2. Hard constraints

- **Fully PC-independent.** No step depends on the local machine being awake. Local Windows
  scheduled tasks are retired.
- **Max subscription, no API key**, on every surface (worker routine = subscription; CTO =
  `CLAUDE_CODE_OAUTH_TOKEN`; reports = no Claude at all).
- **No GitHub-Actions-minute bill for the long-running worker** — the worker runs on
  Anthropic's routine compute (no per-VM charge), not GitHub runners.
- **Browser QA is dropped in the cloud** (no logged-in Chrome). Human review via the Slack
  `#pipeline` cards + dev link replaces it. Automated `verify` (lint / `tsc -b` / build /
  Django tests) and `code-review` still gate every task.
- **Reuse, don't rebuild:** the existing `team-run` flow, `classify`/model-tiering, `ship`,
  cloud CTO, Notion control surface, and Slack layer stay; only what must change for the
  cloud does.

## 3. Architecture

| Piece | Platform | Trigger | Draws |
|---|---|---|---|
| **Worker** | Anthropic **Routine** (cloud Claude Code session) | cron **01:00** & **10:00** local (machine reported **UTC+2**, Central Europe summer) | Max subscription usage |
| **CTO** | GitHub Actions *(unchanged)* | PR → `dev` from `team/*` | `CLAUDE_CODE_OAUTH_TOKEN` |
| **Reports** | GitHub Actions **cron** (deterministic `node`, no Claude) | cron **07:30** & **17:30** | GitHub Actions minutes (seconds/run) |

The worker ships PRs → CTO reviews + merges to `dev` → reports summarize each work window to
Slack. `dev → main` promotion stays as-is (human-gated per the pipeline spec's I1 note — a
bot merge does not auto-promote; out of scope here).

## 4. Worker: cloud-adapted `team-run`

A **cloud mode** is added to the `team-run` skill, selected by an env var **`TEAM_CLOUD=1`**
set in the routine's environment. In cloud mode:

- **Workspace:** work directly in the routine's fresh clone using a per-task branch
  (`git fetch origin dev`; `git checkout -B team/<slug> origin/dev`; build; ship; `git
  checkout dev` before the next task) — **no git worktree and no Windows `worktreeRoot` path**.
- **Browser QA:** the `qa` stage is **skipped** (no Chrome). `verify` and `code-review` are
  unchanged and still gate ship.
- **Tokens:** `notion.mjs` / `slack.mjs` read `NOTION_TOKEN` / `SLACK_BOT_TOKEN` from
  `process.env` (no `.env.team` in the cloud) — the scripts already fall back to env, so the
  only requirement is that the routine sets those env vars.
- **Ship** uses the routine's own GitHub access (the routine authenticates git/`gh` for the
  cloned repo): commit, `git push -u origin team/<slug>`, `gh pr create --base dev`. The PR then
  triggers the existing CTO GitHub Action exactly as a local-run PR does.
- **No PowerShell / no `team-run.ps1`** — the routine invokes the skill directly (`/team-run`).

Local mode (no `TEAM_CLOUD`) keeps today's exact behavior (worktrees under
`C:\Users\stefa\.team-worktrees`, browser QA, `.env.team`), so `npm run team` still works for
optional manual local runs with full browser QA.

**Routine configuration (created by Stefan; see §9):**
- Prompt: `/team-run`
- Repository: `stefanroman22/nba-trivia-minigames`
- Schedule triggers: cron `01:00` and cron `10:00` (local); each firing is one queue-drain
  session that stops when the `Ready` queue is empty or the cloud session limit is reached
  ("until 07:00 / 17:00" is a soft upper bound, not a hard cutoff).
- Environment variables: `TEAM_CLOUD=1`, `NOTION_TOKEN`, `SLACK_BOT_TOKEN`.
- Network access: default trusted allowlist plus `api.notion.com` and `slack.com` (so the
  scripts can reach Notion + Slack from the routine VM).

## 5. Reports: window-scoped digests

### 5.1 New `slack.mjs` command
`digest-window <startISO> <endISO> <label>`:
- Gather merged `team/*` PRs whose `mergedAt` falls in `[start, end)` (via `gh pr list --state
  merged --base dev --json number,title,body,url,headRefName,mergedAt`, filtered client-side by
  `mergedAt` timestamp — precise to the minute, unlike `gh`'s date-only `merged:` search).
- **Always** post a session line to **`#pipeline`**: either
  `📋 <label> (<start>–<end>): N task(s) shipped` + a one-line list, or
  `📋 <label> (<start>–<end>): no work this session.` — this is the "reflect reality even when
  empty" requirement.
- **If N > 0**, additionally post the per-engine detail (parsed `## Agent notes`) to
  **`#agent-frontend`** / **`#agent-backend`** as today's `daily-digests` does.
- All posts via the existing non-fatal `apiTry(..., true)`; failures log and continue.

### 5.2 GitHub Actions cron workflow
`.github/workflows/team-reports.yml`:
- Two schedules (UTC — GitHub cron is UTC): `30 5 * * *` (07:30 local, UTC+2) and
  `30 15 * * *` (17:30 local). *DST caveat: correct for UTC+2 (summer); in UTC+1 they run one
  hour early — documented, adjust if it matters.*
- **Gapless windows so no merge is ever missed.** A PR shipped near a work-session's end may be
  merged by the CTO *after* that session (e.g. shipped 06:55, merged 07:05). Fixed 01:00–07:00 /
  10:00–17:00 windows would drop it. Instead each report covers **[previous report time, this
  report time)** — the two windows abut with no gap and no overlap, need no stored state, and
  every merge is reported exactly once. The labels still name the session they mostly capture:
  - 07:30 job → window **[17:30 yesterday, 07:30 today)**, label `Night session (01:00–07:00 work)`.
  - 17:30 job → window **[07:30 today, 17:30 today)**, label `Day session (10:00–17:00 work)`.
  Each window is computed from the fire time alone (no persistence).
- Runs `node scripts/slack.mjs digest-window <startISO> <endISO> "<label>"`.
- Env: `SLACK_BOT_TOKEN` (new repo secret), `GH_TOKEN: ${{ github.token }}`. No Claude, no
  OAuth token. `permissions: { contents: read, pull-requests: read }`.

## 6. Retire the local scheduled tasks

- Add `scripts/unregister-team-cron.ps1` that unregisters `nba-team-pipeline` **and**
  `nba-team-digest` (idempotent). Run it once (Stefan or controller) to stop the local tasks.
- Keep `scripts/team-run.ps1` and `npm run team` for **optional manual local runs** (local
  mode, browser QA available). Keep `register-team-cron.ps1` in the tree but unused (documented
  as "local manual only; the cloud routine is the scheduled worker now").
- The nightly local `nba-team-digest` is replaced by the two cloud report crons.

## 7. Secrets & config

| Secret / var | Where | Used by |
|---|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | GitHub repo secret *(exists)* | CTO |
| `NOTION_TOKEN` | GitHub repo secret *(exists)* + **routine env var** | CTO notify, worker, — |
| `SLACK_BOT_TOKEN` | **new GitHub repo secret** + **routine env var** | reports, worker |
| `TEAM_CLOUD=1` | **routine env var** | worker cloud-mode switch |

`.claude/team/config.json` (Notion DB id, Slack channel ids, `devSiteUrl`) travels with the
clone — unchanged. `.env.team` remains local-only (gitignored) for manual local runs.

## 8. Timing map

| Local time | What |
|---|---|
| 01:00 | Worker routine fires → drains night queue (soft bound 07:00) |
| 07:30 | Report cron → `Night session` digest for merges in [17:30 yesterday, 07:30), or "no work this session" |
| 10:00 | Worker routine fires → drains day queue (soft bound 17:00) |
| 17:30 | Report cron → `Day session` digest for merges in [07:30, 17:30), or "no work this session" |

## 9. User-gated setup (one time)

Stefan does these once (the controller cannot create routines or paste secrets):
1. **`SLACK_BOT_TOKEN` GitHub secret:** `gh secret set SLACK_BOT_TOKEN` (same `xoxb-…` from
   `.env.team`).
2. **Create the worker routine** at claude.ai/code/routines (or `/schedule`), with the config
   in §4: prompt `/team-run`, the repo, the two cron schedules, the three env vars, the network
   allowlist additions.
3. **Run the unregister script** once to retire the local scheduled tasks.

## 10. What stays the same

Notion is still the control surface (write cards, `Ready`); the Slack feedback loop (🔄/reply →
follow-up card, ✅ → archive) is unchanged; the CTO gate, `classify` model-tiering, constraint
docs, and reuse rule are unchanged. Only the worker's *location* and the report's *cadence/scope*
change.

## 11. Build order

| Stage | Deliverable | Exit criterion |
|---|---|---|
| C0 | `team-run` cloud mode (branch-per-task, skip QA, env tokens) + `TEAM_CLOUD` switch | Local run still passes; cloud-mode instructions coherent |
| C1 | `slack.mjs digest-window` + retire-local script | `digest-window` posts a correct session line (incl. "no work") for a chosen window, verified live |
| C2 | `team-reports.yml` GitHub Actions cron (07:30 / 17:30) | Workflow parses clean; a manual `workflow_dispatch` posts both windows |
| C3 | User setup: Slack secret, routine, unregister local | One real routine firing ships a card → CTO merges → report reflects it |

## 12. Out of scope

Browser QA in the cloud; wake-timer / local-unattended paths; `dev → main` auto-promotion on
bot merges (I1 — still human-gated); parallel multi-task worktrees; migrating the CTO off
GitHub Actions; DST-proof report scheduling (documented caveat).
