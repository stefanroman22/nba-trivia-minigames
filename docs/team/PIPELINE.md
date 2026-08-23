# Autonomous Team Pipeline — Operator Manual

## 1. What it is

An autonomous coding pipeline: you write task cards on a Notion board, and unattended
agent runs pick them up, build them (classify → design → build → verify → QA → review),
open a PR, get an independent cloud CTO review, and merge to `dev` on approval. You
mostly interact with it through Notion, not the terminal.

## 2. Daily use

Write cards in the Notion board with a clear title/spec and set `Status = Ready` when
they're ready to be picked up. You don't need to trigger anything — the next scheduled
run (or `npm run team`) claims Ready cards and works them. Results notify you via Notion
@mentions, which show up on both phone and desktop Notion. The `CONTROL` row's `Paused`
checkbox is the global kill switch — check it and no run will claim any card until it's
unchecked (`node scripts/notion.mjs check-pause` exits 3 and the run stops immediately).

## 3. Triggers

- **Windows scheduled task** `nba-team-pipeline` — runs every 2 hours, 08:00–24:00 daily
  (registered via `scripts/register-team-cron.ps1`).
- **Manual**: `npm run team` from the repo root, any time.
- **From your phone**: add or edit a card and set it to Ready — no run needed on your
  end, it's picked up by the next scheduled run.

## 4. Status meanings

- **Backlog** — not ready yet; the pipeline ignores it.
- **Ready** — queued; the next run will claim it.
- **In Progress** — a run has claimed it and is actively working it.
- **In Review** — PR opened, pushed to GitHub, waiting on (or in) CTO review.
- **Blocked** — the pipeline gave up on it; read the post-mortem comment before touching it.
- **Blocked-approval** — a PR needing your manual review/merge (protected path — see §6).
- **Done** — merged to `dev`; nothing left to do.

## 5. When a card goes Blocked

Read the post-mortem comment the pipeline left on the card (what was tried, why it
failed, suggested next step) and the corresponding entry in `docs/team/RETRO.md`. Fix
the spec (clarify scope, add missing context) or split the task into smaller cards, then
set the card back to `Ready`. Don't just flip it back to Ready without addressing the
cause — it will likely fail the same way again.

## 6. Blocked-approval

The CTO's deterministic `cto-act` job flags a PR `Blocked-approval` when its diff touches
a protected path: `.github/workflows/`, `vercel.json`, `package.json`,
`package-lock.json`, or `backend/requirements.txt`. These never auto-merge, regardless of
CTO verdict. Review the PR yourself on GitHub and merge it manually when you're satisfied.

## 7. Where things live

- **Skills** — `.claude/skills/` (e.g. `team-run`, `cto-review`, `ship`, `qa-protocol`).
- **Agents** — `.claude/agents/` (`planner-architect`, `frontend-engine`, `backend-engine`,
  `browser-qa`, `code-reviewer`, `test-qa-engine`).
- **Journal** — `.claude/team/journal.json`: mid-flight task state, resumed by the next run.
- **Logs** — `.claude/team/logs/` (one file per run). Written by PowerShell's
  `Tee-Object`, which defaults to **UTF-16LE** — open with a UTF-16-aware viewer, not a
  plain `cat`/UTF-8 tool, or the text will look mangled.
- **QA evidence** — `.claude/team/qa/<slug>/` (screenshots + `verdict.json` per task).
- **Worktrees** — `C:\Users\stefa\.team-worktrees\<slug>` — isolated checkouts the
  pipeline builds in; your main checkout's working tree is never touched by pipeline git
  commands beyond `fetch`/`worktree add|remove`.

## 8. Prerequisites / environment gotchas (read before troubleshooting anything else)

a. **gh CLI account.** This machine has two `gh` accounts. Ship/merge steps need
   `gh` authenticated as **`stefanroman22`** (ADMIN on origin) —
   `gh auth switch --user stefanroman22`. If the active account is
   **`jimmedeknatel8`** (READ-only), pushes, PR creation, and merges will fail. Check
   `gh auth status` if any ship/merge step errors out.

b. **PowerShell PATH gap.** This machine's PATH does not include the WindowsPowerShell
   directory, so bare `powershell` fails when spawned from a plain child process (e.g.
   npm → cmd.exe). Both the npm `"team"` script and the registered scheduled task
   call PowerShell by its full path,
   `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`, to work around this.
   Don't "simplify" either back to bare `powershell` — it will break non-interactive runs.

c. **`package.json`'s `"team"` script edit is intentionally uncommitted.** `package.json`
   is a protected path (see §6), so the local fix in (b) is applied to the working tree
   only and deliberately never committed/pushed — committing it would route it through
   manual `Blocked-approval` review every time. It must stay uncommitted, working-tree-only.

## 9. Secrets rotation

- **`CLAUDE_CODE_OAUTH_TOKEN`** — subscription auth for the `cto-review` job and the
  `@claude` mention responder. Mint it with `claude setup-token` (browser flow), then
  `gh secret set CLAUDE_CODE_OAUTH_TOKEN` (paste when prompted). It expires
  periodically — when cloud runs start failing auth, re-run both commands.
- **`NOTION_TOKEN`** — used by `scripts/notion.mjs` both locally and in CI. Update via
  `gh secret set NOTION_TOKEN`. Locally, the same value lives in `.env.team`
  (`scripts/team-run.ps1` loads it into the process before invoking `claude`).

## 10. Security model (from the CTO review design)

The CTO gate is split into two GitHub Actions jobs on purpose. `cto-review` runs the LLM
(`/cto-review`) with a **read-only** token — it can read the diff, read the spec, and
post a PR comment, but it cannot merge, push, label, or edit the PR. It writes its
verdict to `cto-verdict.json` and uploads it as an artifact. `cto-act`, gated on
`cto-review` via `needs:`, is pure deterministic Bash (no LLM) with the **write-capable**
token — it downloads the verdict artifact and is the only place `gh pr merge`, `gh pr
edit --add-label`, and Notion status writes happen. Practically: a prompt-injected PR
(e.g. malicious text in a file trying to manipulate the reviewing LLM) can at most get
`cto-review` to post a misleading comment or attempt a relabel via its own limited scope
— it can never merge or push, because the job actually holding merge/push power runs no
LLM step at all. Auto-merge only lands changes on `dev`; the existing `dev-ci.yml`
promotion (dev → main → production) is unchanged by any of this.

**Known limitation:** auto-merges performed by the pipeline use the GitHub Actions token
(`GITHUB_TOKEN`). GitHub deliberately does not fire `on: push` workflows from a
`GITHUB_TOKEN` push (infinite-loop prevention), so the pipeline's own merge into `dev`
does NOT automatically trigger the dev → main promote job in `dev-ci.yml`. Code the
pipeline merges to `dev` reaches `main` on the next manual push to `dev` (or a human "Run
workflow" on the promote job). To make pipeline merges auto-promote to production, mint a
fine-grained PAT with `contents:write` and use it for the merge step in `cto-act` instead
of `GITHUB_TOKEN` — a deliberate security tradeoff. Left human-gated by default.

## 11. Troubleshooting

- **Lockfile stuck** (`team-run already running` but no run is actually happening):
  delete `.claude/team/run.lock`, then retry.
- **Card stuck In Progress with an empty journal** (`.claude/team/journal.json` is `{}`
  or has no entry for it): the run that claimed it died or was killed. Set the card back
  to `Ready`.
- **Scheduled run appears to have done nothing**: check the newest file in
  `.claude/team/logs/` (remember it's UTF-16LE) for what happened, and confirm the
  active `gh` account is `stefanroman22`, not `jimmedeknatel8` (see §8a) — a wrong
  account fails silently from Notion's point of view since the card never gets past
  ship.
- **In-Review orphan** (card stuck `In Review` with a failed CTO GitHub Actions run): the
  `cto-review` job didn't produce `cto-verdict.json`, so `cto-act` was skipped and no
  label was set. Re-run the failed workflow from the GitHub Actions tab; if it keeps
  failing, read the run log, and as a fallback set the card back to `Ready` to re-ship
  from a fresh run.

## 12. Slack layer

The pipeline mirrors its work into Slack via `scripts/slack.mjs` (zero-dep, Node 18+
fetch; commands: `ping`, `resolve-channels`, `post-batch`, `poll-reactions`,
`daily-digests`). The app is installed as **`hoops-24-team`** in the **Roman
Technologies** workspace.

**Channels.** Three channels: **#pipeline** gets one post per run — the batch overview
below — and the two implementation-agent channels, **#agent-frontend** and
**#agent-backend**, get the nightly digests. Those two are the agents that write
`## Agent notes` in their PRs, so the digests carry what each engine actually did and
assumed. A merged PR with no parsed frontend/backend notes (e.g. a docs-only change)
simply produces no digest line — no fallback channel. (The earlier `#agent-qa` /
`#agent-review` channels were dropped; enriching them would require the QA/review agents
to emit their own notes — a possible future enhancement.)

**Batch overview format.** At end of run (§5), if any tasks shipped, `slack.mjs
post-batch` posts to #pipeline: a parent message — `🟢 Batch complete — <count> shipped
to dev · <HH:MM>` plus the Dev link (`cfg.devSiteUrl`) — followed by **one top-level
message per shipped task** (not a thread reply under the parent). Each task gets its own
message so a reply threads unambiguously under that task, not the whole batch:
`<n>.  *_<title>_*   ·   *<areas>*` (title bold-italic, areas bold), then `*Check:*
<look>` (the orchestrator's explicit navigate → action → expected-result line), then the
react legend `✅ approve · 🔄 needs work — reply to say what`.

**Feedback loop.** React 🔄 on a task's message (optionally with a thread reply giving
detail) → the next run's `## 0b` step (`slack.mjs poll-reactions`) creates a Notion card
`Follow-up: <title>`, status Ready, body = your reply text (or a generic "reviewer
flagged 🔄 with no note — re-examine" if you didn't reply); that card drains in the same
run's queue. React ✅ alone (no 🔄) → the task's Notion card is archived. A thread reply
with no 🔄 does nothing by itself — the reply is only ever detail attached to a 🔄'd card,
never a trigger on its own, so a stray note can't reopen a task. Only reactions from the
user configured as `slack.slackUserId` in config count; anyone else's reactions on the
same message are ignored. Reactions are **polled, not pushed** — `poll-reactions` only
runs at the start of the next pipeline run, so there's up to ~2h of latency (the
`nba-team-pipeline` interval, §3) between reacting and the follow-up card appearing.

**Daily digests.** The `nba-team-digest` Windows scheduled task (daily at 23:30,
registered by `scripts/register-team-digest-cron.ps1`) runs `scripts/team-digest.ps1`,
which loads `.env.team` and calls `node scripts/slack.mjs daily-digests`. That command
lists the day's merged `team/*` PRs into `dev`, parses each PR body's `## Agent notes`
block, buckets the notes by agent channel, and posts one digest message per non-empty
channel.

**Secrets & config.** `SLACK_BOT_TOKEN` lives in `.env.team`. Channel ids
(`slack.generalChannel`, `slack.agentChannels.{frontend,backend,qa,review}`), the
approver's `slack.slackUserId`, and `devSiteUrl` live in `.claude/team/config.json` —
`node scripts/slack.mjs resolve-channels` fills the channel ids in automatically by
channel name, but `slackUserId` must be entered by hand. Runtime state (posted task
cards awaiting a reaction) lives in `.claude/team/slack-state.json`, which is gitignored.

**Troubleshooting.** No Slack posts at all → confirm the bot is invited to the target
channel and that `slack.slackUserId`/the channel ids are set in
`.claude/team/config.json`, then re-run `node scripts/slack.mjs resolve-channels` (it
prints `MISSING: ...` for any channel name it couldn't resolve, usually because the bot
isn't in it). Slack failures anywhere in the pipeline (batch post, digest post, reaction
poll) are non-fatal — logged and skipped; a batch that fails to post to Slack is still
merged to `dev`.
