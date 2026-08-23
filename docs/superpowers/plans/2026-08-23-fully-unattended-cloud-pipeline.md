# Fully-Unattended Cloud Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the pipeline worker to an Anthropic Routine (cloud, PC off), add window-scoped Slack reports on a GitHub Actions cron, and retire the local scheduled tasks — so the whole system runs unattended.

**Architecture:** `team-run` gains a `TEAM_CLOUD=1` cloud mode (branch-per-task in the clone, skip browser QA, tokens from env). A new deterministic `slack.mjs digest-window` command posts gapless per-session reports, driven by a `team-reports.yml` GitHub Actions cron (07:30 / 17:30). A one-time unregister script retires the two local Windows tasks. The worker routine and the Slack secret are user-created (guided).

**Tech Stack:** Node 18 (built-in fetch, `child_process`), `gh` CLI, GitHub Actions, PowerShell 5.1, Anthropic Routines (claude.ai/code/routines).

**Spec:** `docs/superpowers/specs/2026-08-23-fully-unattended-cloud-pipeline-design.md`

## Global Constraints

- **Fully PC-independent** once live; local Windows scheduled tasks are retired.
- **Max subscription, no API key** everywhere (worker routine = subscription; CTO = `CLAUDE_CODE_OAUTH_TOKEN`; reports = no Claude).
- **No GitHub-Actions minutes for the worker** — it runs on routine compute. Only the CTO and the tiny report crons use Actions.
- **Browser QA is dropped in cloud mode**; `verify` (lint/tsc/build/Django tests) + `code-review` still gate every task; human Slack review substitutes for QA.
- **Cloud mode switch:** env var `TEAM_CLOUD=1` (set only in the routine environment). Absent → today's exact local behavior is preserved.
- **Cloud-mode tokens:** `notion.mjs`/`slack.mjs` already fall back to `process.env` when `.env.team` is absent — the routine sets `NOTION_TOKEN`, `SLACK_BOT_TOKEN`, `TEAM_CLOUD=1`.
- **Execute on `dev` directly, surgical `git add <path>`** (never `-A`); the working tree holds ~95 files of the user's WIP that must not be swept in.
- **gh account:** `gh auth switch --user stefanroman22` before any push (jimmedeknatel8 is READ-only).
- **Report windows are gapless:** each covers `[previous report time, this report time)` — 07:30 → `[17:30 yesterday, 07:30 today)` label `Night session (01:00–07:00 work)`; 17:30 → `[07:30 today, 17:30 today)` label `Day session (10:00–17:00 work)`. No merge is missed, no stored state.
- **Report crons are UTC:** `30 5 * * *` and `30 15 * * *` (07:30 / 17:30 at UTC+2). DST caveat documented, not solved.
- **Slack channel ids / Notion db id / devSiteUrl** live in `.claude/team/config.json` (travels with the clone). `#pipeline` = `cfg.slack.generalChannel`; agent channels = `cfg.slack.agentChannels.{frontend,backend}`.
- Commits: conventional (`feat(team):`, `docs(team):`, `chore(team):`).

---

## Stage C0 — team-run cloud mode

### Task 1: Add cloud mode to the team-run skill

**Files:**
- Modify: `.claude/skills/team-run/SKILL.md`

**Interfaces:**
- Produces: a `TEAM_CLOUD` branch in the orchestrator's instructions; consumed by no code (prose skill), but the routine (Stage C3) sets `TEAM_CLOUD=1`.

- [ ] **Step 1: Add a cloud-mode preamble**

In `.claude/skills/team-run/SKILL.md`, immediately after the `# Team Run` heading and its intro paragraph (before `## 0. Preconditions`), insert:
```markdown
## Environment: local vs cloud
Check the `TEAM_CLOUD` environment variable once at the start.
- **`TEAM_CLOUD` unset (local, Windows):** behave exactly as the sections below describe —
  git worktrees under `cfg.worktreeRoot`, browser QA via Chrome, `.env.team` for tokens.
- **`TEAM_CLOUD=1` (cloud routine, Linux):** apply the cloud overrides marked
  **[CLOUD]** below. In short: work on a branch inside the current clone instead of a
  worktree, skip the browser-QA stage, and rely on `NOTION_TOKEN`/`SLACK_BOT_TOKEN` from the
  environment (no `.env.team`). Everything else — classify, build, verify, review, ship, park,
  post-batch, Slack feedback ingestion — is identical.
```

- [ ] **Step 2: Add the [CLOUD] workspace override**

In `## 3`, at the **workspace** step (the `git worktree add ...` line), append:
```markdown
   **[CLOUD]** Do NOT create a worktree. Instead, in the single clone:
   `git fetch origin dev` then `git checkout -B team/<slug> origin/dev`. Build/verify/review
   happen in the clone on this branch. After ship (or park), `git checkout dev` before the next
   task so each task starts clean from `origin/dev`. There is no `cfg.worktreeRoot` and no
   worktree to remove in cloud mode.
```

- [ ] **Step 3: Add the [CLOUD] QA skip**

In `## 3`, at the **qa** step, append:
```markdown
   **[CLOUD]** Skip the browser-QA stage entirely (no Chrome in the cloud). Rely on the
   verify stage (lint/tsc/build/Django tests) and code-review; the human reviews the shipped
   result via the Slack `#pipeline` card and the dev link. Do not spawn browser-qa in cloud mode.
```

- [ ] **Step 4: Add the [CLOUD] ship note**

In `## 3`, at the **ship** step, append:
```markdown
   **[CLOUD]** Ship is unchanged (commit → `git push -u origin team/<slug>` → `gh pr create
   --base dev`), but there is no worktree to remove — just `git checkout dev` for the next task.
   Tokens for the Notion/Slack calls in the ship + post-batch steps come from the environment.
```

- [ ] **Step 5: Verify**

Run: `head -4 .claude/skills/team-run/SKILL.md` (frontmatter intact). Run:
`grep -c "\[CLOUD\]" .claude/skills/team-run/SKILL.md` → ≥ 4. Run:
`grep -c "TEAM_CLOUD" .claude/skills/team-run/SKILL.md` → ≥ 2. Confirm the local sections are
otherwise unchanged: `git diff .claude/skills/team-run/SKILL.md` shows only additions (no
deletions of existing local instructions).

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/team-run/SKILL.md
git commit -m "feat(team): team-run cloud mode (TEAM_CLOUD) — branch-per-task, skip browser QA, env tokens"
```

---

## Stage C1 — window report command + retire-local script

### Task 2: `slack.mjs digest-window`

**Files:**
- Modify: `scripts/slack.mjs`

**Interfaces:**
- Consumes: `parseAgentNotes` (exists), `apiTry` (exists, POST-capable), `sh` (exists), `cfg.slack.generalChannel`, `cfg.slack.agentChannels`.
- Produces: `digest-window <startISO> <endISO> <label>` — posts a session line to `#pipeline` (always) and per-engine detail to the agent channels (when there is work).

- [ ] **Step 1: Add `cmdDigestWindow` and register it**

Insert above the dispatch table (near `cmdDailyDigests`):
```javascript
async function cmdDigestWindow(startISO, endISO, label) {
  const start = Date.parse(startISO), end = Date.parse(endISO);
  const chan = cfg.slack?.generalChannel;
  const nameMap = { "frontend-engine": "frontend", "backend-engine": "backend" };
  const buckets = { frontend: [], backend: [] };
  const shipped = [];
  const prs = JSON.parse(sh(`gh pr list --state merged --base dev --json number,title,url,body,headRefName,mergedAt --limit 200`));
  for (const pr of prs) {
    if (!pr.headRefName?.startsWith("team/")) continue;
    const m = Date.parse(pr.mergedAt || "");
    if (!(m >= start && m < end)) continue;
    shipped.push(`• ${pr.title} (<${pr.url}|PR#${pr.number}>)`);
    for (const n of parseAgentNotes(pr.body || "")) {
      const ch = nameMap[n.agent];
      if (ch) buckets[ch].push(`• ${pr.title} (PR#${pr.number}): ${n.did}\n  assumed: ${n.assumed}`);
    }
  }
  // Always post a session line to #pipeline (reflect reality even when empty).
  if (chan) {
    const head = `📋 *${label}* — merges ${startISO.slice(11,16)}–${endISO.slice(11,16)}`;
    const text = shipped.length
      ? `${head}: ${shipped.length} task(s) shipped\n${shipped.join("\n")}`
      : `${head}: no work this session.`;
    const r = await apiTry("chat.postMessage", { channel: chan, text }, true);
    console.log(r.ok ? `posted session line (${shipped.length} shipped)` : `session line failed (non-fatal): ${r.error}`);
  }
  // Per-engine detail only when there is work.
  for (const [agent, lines] of Object.entries(buckets)) {
    const ac = cfg.slack?.agentChannels?.[agent];
    if (!ac || !lines.length) continue;
    const text = `📆 ${agent} · ${label} · ${lines.length} shipped\n${lines.join("\n")}`;
    const r = await apiTry("chat.postMessage", { channel: ac, text }, true);
    console.log(r.ok ? `posted ${agent} detail` : `${agent} detail failed (non-fatal): ${r.error}`);
  }
}
```
Add to the dispatch table: `"digest-window": () => cmdDigestWindow(args[0], args[1], args.slice(2).join(" ")),`

- [ ] **Step 2: Verify syntax**

Run: `node --check scripts/slack.mjs` → passes.

- [ ] **Step 3: Live-test — empty window (the "no work" path)**

Run (a window with no team/* merges, e.g. the far future):
`node scripts/slack.mjs digest-window 2027-01-01T00:00 2027-01-01T01:00 "Test empty"`
Expected: `#pipeline` shows `📋 Test empty — merges 00:00–01:00: no work this session.`; console logs `posted session line (0 shipped)`.

- [ ] **Step 4: Live-test — window containing PR #12**

PR #12 merged on 2026-08-22. Run a window spanning that day:
`node scripts/slack.mjs digest-window 2026-08-22T00:00 2026-08-23T00:00 "Test day"`
Expected: `#pipeline` shows `📋 Test day — ...: 1 task(s) shipped` with the PR #12 line. (PR #12 has no Agent notes, so no agent-channel detail — that's correct.)

- [ ] **Step 5: Commit**

```bash
git add scripts/slack.mjs
git commit -m "feat(team): slack digest-window (gapless per-session report, no-work message)"
```

### Task 3: Retire-local scheduled-tasks script

**Files:**
- Create: `scripts/unregister-team-cron.ps1`

**Interfaces:**
- Produces: idempotent unregistration of both local tasks.

- [ ] **Step 1: Write the script**

```powershell
# Retires the local scheduled tasks — the cloud routine + report crons replace them.
# Idempotent: silently ignores tasks that are already gone.
$ErrorActionPreference = "Stop"
foreach ($name in "nba-team-pipeline", "nba-team-digest") {
  try {
    Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction Stop
    Write-Output "Unregistered '$name'."
  } catch {
    Write-Output "'$name' not present (nothing to do)."
  }
}
Write-Output "Local scheduled tasks retired. The cloud routine is now the scheduled worker; report crons run in GitHub Actions."
```

- [ ] **Step 2: Verify (parse only — do NOT run yet; the routine isn't live)**

Run: `powershell -NoProfile -Command "[void][System.Management.Automation.PSParser]::Tokenize((Get-Content -Raw 'scripts/unregister-team-cron.ps1'),[ref]$null); 'parse OK'"`
Expected: `parse OK`. (Actual unregistration happens in Stage C3, after the routine is confirmed working.)

- [ ] **Step 3: Commit**

```bash
git add scripts/unregister-team-cron.ps1
git commit -m "chore(team): script to retire local scheduled tasks (cloud takes over)"
```

---

## Stage C2 — report crons in GitHub Actions

### Task 4: `team-reports.yml` workflow

**Files:**
- Create: `.github/workflows/team-reports.yml`

**Interfaces:**
- Consumes: `SLACK_BOT_TOKEN` repo secret (added in Stage C3), `scripts/slack.mjs digest-window`, `gh` (via `GH_TOKEN`).

- [ ] **Step 1: Write the workflow**

```yaml
name: Team Reports
# Posts a gapless per-session Slack report. Deterministic node script, no Claude.
on:
  workflow_dispatch:
    inputs:
      label: { description: "Session label", required: false, default: "Manual" }
  schedule:
    - cron: "30 5 * * *"   # 07:30 local (UTC+2) — Night session
    - cron: "30 15 * * *"  # 17:30 local (UTC+2) — Day session
jobs:
  report:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: read
    env:
      GH_TOKEN: ${{ github.token }}
      SLACK_BOT_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }}
    steps:
      - uses: actions/checkout@v4
      - name: Compute window and post report
        run: |
          set -euo pipefail
          # Windows are gapless: [previous report, this report), local times carry an explicit
          # +02:00 offset so Date.parse yields the correct UTC instant to compare against
          # mergedAt. Which report fired is read from github.event.schedule (robust to cron
          # delay — never guessed from the clock). At 05:30/15:30 UTC the UTC calendar date
          # equals the local date, so `date -u` gives the right day for these report times.
          SCHED="${{ github.event.schedule }}"
          TODAY=$(date -u +%Y-%m-%d)
          YEST=$(date -u -d "yesterday" +%Y-%m-%d)
          if [ "$SCHED" = "30 15 * * *" ]; then
            START="${TODAY}T07:30+02:00"; END="${TODAY}T17:30+02:00"; LABEL="Day session (10:00-17:00 work)"
          else
            # 05:30 cron (Night) or a manual workflow_dispatch (defaults to Night)
            START="${YEST}T17:30+02:00"; END="${TODAY}T07:30+02:00"; LABEL="Night session (01:00-07:00 work)"
          fi
          echo "schedule=[$SCHED]  window: $START .. $END  ($LABEL)"
          node scripts/slack.mjs digest-window "$START" "$END" "$LABEL"
```

Note for executor: `digest-window`'s `startISO.slice(11,16)` still displays `17:30`/`07:30`
(the `+02:00` is past character 16), so the Slack line reads correctly.

- [ ] **Step 2: Verify YAML parses**

Run: `python -c "import yaml; yaml.safe_load(open('.github/workflows/team-reports.yml')); print('YAML OK')"`
Expected: `YAML OK`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/team-reports.yml
git commit -m "feat(team): GitHub Actions cron for gapless per-session Slack reports"
```

---

## Stage C3 — user setup, docs, go-live

### Task 5: Operator docs

**Files:**
- Modify: `docs/team/PIPELINE.md`

- [ ] **Step 1: Add a `## Cloud operation` section**

Append to `docs/team/PIPELINE.md` a section covering (accurate to what's built): the worker
now runs as an **Anthropic Routine** (cloud, PC off) firing at 01:00 and 10:00 with
`TEAM_CLOUD=1` (branch-per-task, no browser QA); the **CTO** is unchanged (GitHub Actions); the
**reports** run as the `Team Reports` GitHub Actions cron at 07:30 / 17:30 posting gapless
per-session digests to `#pipeline` (+ agent channels when there is work), with a "no work this
session" line when empty; the local scheduled tasks are **retired** (`unregister-team-cron.ps1`)
but `npm run team` still works for a manual local run with browser QA; the routine env vars
(`TEAM_CLOUD=1`, `NOTION_TOKEN`, `SLACK_BOT_TOKEN`) and the `SLACK_BOT_TOKEN` GitHub secret;
and the DST caveat on the report crons.

- [ ] **Step 2: Commit + push everything so far**

```bash
git add docs/team/PIPELINE.md
git commit -m "docs(team): document cloud operation (routine worker, report crons, retired local tasks)"
git push origin dev
```
(Push carries C0–C2 code + this doc. Same no-op prod redeploy as prior tooling pushes — no `src/`/`backend/` app code.)

### Task 6: USER-GATED go-live

**Files:** none (user actions + one script run)

- [ ] **Step 1: USER — add the Slack secret**

Ask Stefan to run: `gh secret set SLACK_BOT_TOKEN` and paste the `xoxb-…` value from
`.env.team`. Verify: `gh secret list` shows `SLACK_BOT_TOKEN`.

- [ ] **Step 2: Smoke-test the report cron without waiting for the schedule**

Run: `gh workflow run "Team Reports"` then `gh run watch <id>`; confirm a `#pipeline`
session line posts. (Uses the just-added secret.)

- [ ] **Step 3: USER — create the worker routine**

Ask Stefan to create a routine at claude.ai/code/routines (or `/schedule`) with: prompt
`/team-run`; repository `stefanroman22/nba-trivia-minigames`; two schedule triggers (cron
`01:00` and `10:00` local); environment variables `TEAM_CLOUD=1`, `NOTION_TOKEN=<ntn_…>`,
`SLACK_BOT_TOKEN=<xoxb_…>`; network access = default allowlist **plus** `api.notion.com` and
`slack.com`. (The controller cannot create routines.)

- [ ] **Step 4: Prove one cloud run end-to-end**

Ask Stefan to add a tiny `Ready` Notion card (e.g. a docs-only change) and click **Run now**
on the routine. Expected: the routine ships a `team/*` PR → the CTO Action merges it to `dev`
→ `#pipeline` gets a batch card → the next report cron reflects it. Watch the routine session
on claude.ai/code and the PR on GitHub.

- [ ] **Step 5: Retire the local tasks**

Once the cloud run is confirmed, run:
`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/unregister-team-cron.ps1`
Expected: both `nba-team-pipeline` and `nba-team-digest` unregistered. Verify:
`Get-ScheduledTask -TaskName nba-team-pipeline,nba-team-digest` returns not-found for both.

---

## Exit criteria (spec §11)

- **C0:** cloud-mode instructions in `team-run`; local behavior unchanged (additions only).
- **C1:** `digest-window` posts a correct session line (incl. "no work") for a chosen window, live-verified.
- **C2:** `team-reports.yml` parses; `workflow_dispatch` posts a report.
- **C3:** one real routine firing ships a card → CTO merges → report reflects it; local tasks retired.

## Out of scope (spec §12)

Browser QA in cloud; wake-timer paths; `dev → main` auto-promote on bot merges; parallel worktrees; moving the CTO off GitHub Actions; DST-proof scheduling.
