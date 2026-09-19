# Autonomous Team Pipeline — Operator Manual

## 1. What it is

An autonomous coding pipeline: you write task cards on a Notion board, and unattended
agent runs pick them up, build them (classify → design → build → verify → QA → review),
open a PR, get an independent cloud CTO review, and merge to `dev` on approval. You
mostly interact with it through Notion, not the terminal.

## 2. Daily use

The board has five columns. Write cards in **Backlog** while you're still thinking; drag a card
to **To Do** when it's ready (title = the ticket, Category = one of frontend / backend /
fullstack / CI/CD / pipeline / AI / docs, Priority optional). Put details, mockups and
screenshots in the card body; you can also drop files on the `Attachments` property or add
them later as a comment with an image — the pipeline reads all three. The next run (02:00,
10:00, or `npm run team`) claims To Do cards, works them, and pushes each finished one to
`dev`; the card moves to **QA** and you get a card in `#agent-frontend` / `#agent-backend`
with what to check and the model that did it. React ✅ (fine) or 🔄 + reply (needs work →
a Follow-up card appears in To Do). `dev` is where the pipeline stops on its own — production is
never automatic. Promote when you're ready: run "Promote dev to main" from the Actions tab (or
`gh workflow run dev-ci.yml`), or explicitly ask an agent to push `dev` to `main`; the cards move
to **Done** once their commit lands there. The `CONTROL` row's `Paused` checkbox is the global
kill switch.

## 3. Triggers

- **Windows scheduled task** `nba-team-pipeline` — runs every 2 hours, 08:00–24:00 daily
  (registered via `scripts/register-team-cron.ps1`).
- **Manual**: `npm run team` from the repo root, any time.
- **From your phone**: add or edit a card and set it to Ready — no run needed on your
  end, it's picked up by the next scheduled run.

## 4. Status meanings

- **Backlog** — draft; the pipeline ignores it.
- **To Do** — queued; the next run claims it (unless `Needs human` is checked).
- **In progress** — a run owns it. If a run dies mid-task the card stays here and the next run
  resumes it from `.team/journal.json`.
- **QA** — its commit is on `dev` (and on the dev Vercel site). Waiting for your check and for
  someone to promote `dev` to `main` (manually, or by explicitly asking an agent to).
- **Done** — its commit is on `main` (production). Only `main-sync.yml` sets this.

Card properties the pipeline fills: `Model` (who built it, e.g. `sonnet · high · plan fable`),
`Attempts`, `Needs human`, `Commit`, `Branch`, `Difficulty`. `Priority` (P0/P1/P2) is yours.

## 5. When a task fails

The run posts a ❌ card in the task's agent channel (stage, reason, model, last error) and a
post-mortem comment on the Notion card (also appended to `docs/team/RETRO.md`); the card goes back
to **To Do** with `Attempts` +1 and is retried next run. After the second failure the pipeline
checks **Needs human** and skips the card until you uncheck it. Fix the spec (clarify scope, add
context or a screenshot as a comment), uncheck `Needs human`, and it's back in the queue.

## 6. Protected paths

`.github/workflows/`, `vercel.json`, `package.json`, `package-lock.json`, `backend/requirements.txt`
reach `dev` like any other change (the in-run review still covers them) — there's no separate
gate for them beyond that, since promoting to production is already a deliberate, manual step
you take with your own eyes on `dev` first.

## 7. Where things live

- **Skills** — `.claude/skills/` (e.g. `team-run`, `cto-review`, `ship`, `qa-protocol`).
- **Agents** — `.claude/agents/` (`planner-architect`, `frontend-engine`, `backend-engine`,
  `browser-qa`, `code-reviewer`, `test-qa-engine`).
- **Journal** — `.team/journal.json`: mid-flight task state (stage, fix cycles, split-task halves, resume note), resumed by the next run before anything new is claimed.
- **Logs** — `.team/logs/` (one file per run). Written by PowerShell's
  `Tee-Object`, which defaults to **UTF-16LE** — open with a UTF-16-aware viewer, not a
  plain `cat`/UTF-8 tool, or the text will look mangled.
- **QA evidence** — `.team/qa/<slug>/` (screenshots + `verdict.json` per task).
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

## 10. Security model

**Into `dev`:** the run's own verify (lint, tsc, build, tests), browser QA and a fable code
review, then a fast-forward push — no PR, no token with more power than the pipeline's own push
right. `dev-ci.yml` (lint + gitleaks) runs on every push and every PR into `dev`; a red run is
reported in `#pipeline`, non-blocking (nothing rolls back).
**Into `main`:** push to `dev` never promotes, for anyone — not the pipeline, not an interactive
Claude session, not a human. `dev-ci.yml`'s `promote` job only runs on a manual
`workflow_dispatch` ("Run workflow" in the Actions tab, or `gh workflow run dev-ci.yml`), or an
agent pushes `dev` to `main` directly when explicitly asked to in that conversation — never on
its own initiative. On push to `main`, `main-sync.yml` moves every QA card whose commit is now in
`main` to Done. A prompt-injected task can at most reach `dev`; reaching `main` always needs a
human decision, made outside the pipeline's own control flow.

## 11. Troubleshooting

- **Lockfile stuck** (`team-run already running` but no run is actually happening):
  delete `.team/run.lock`, then retry.
- **Card stuck In Progress with an empty journal** (`.team/journal.json` is `{}`
  or has no entry for it): the run that claimed it died or was killed. Set the card back
  to `Ready`.
- **Scheduled run appears to have done nothing**: check the newest file in
  `.team/logs/` (remember it's UTF-16LE) for what happened, and confirm the
  active `gh` account is `stefanroman22`, not `jimmedeknatel8` (see §8a) — a wrong
  account fails silently from Notion's point of view since the card never gets past
  ship.
- **In-Review orphan** (card stuck `In Review` with a failed CTO GitHub Actions run): the
  `cto-review` job didn't produce `cto-verdict.json`, so `cto-act` was skipped and no
  label was set. Re-run the failed workflow from the GitHub Actions tab; if it keeps
  failing, read the run log, and as a fallback set the card back to `Ready` to re-ship
  from a fresh run.

## 12. Slack layer

`scripts/slack.mjs` (zero-dep; commands: `ping`, `resolve-channels`, `post-qa-card`,
`post-fail-card`, `post-run-summary`, `poll-reactions`, `digest-window`). App `hoops-24-team`
in the Roman Technologies workspace.

**Channels.** `#agent-frontend` gets every `frontend` and `docs` task; `#agent-backend` gets
`backend`, `CI/CD`, `AI`, `pipeline`; a `fullstack` task (or any task the classifier splits) gets
one card in each channel describing that half. The mapping is `slack.categoryChannels` in
`.claude/team/config.json`. `#pipeline` is overview only.

**QA card** (agent channel, when a task reaches QA): title · Category · Priority; model, effort,
whether a design round ran, fix cycles; what the engine did; a *Check:* line (navigate → action →
expected result); the dev URL + commit; the legend `✅ approve · 🔄 needs work — reply to say what`.
React 🔄 (+ a reply with detail) → the next run creates `Follow-up: <title>` in To Do, same
Category, body = your reply. ✅ just acknowledges (Done comes from the `main` merge). Only
reactions from `slack.slackUserId` count. Reactions are polled at the start of the next run.

**Failure card** (agent channel): stage and one-line reason, model/effort, fix cycles + replan,
last error, link to the post-mortem, and whether it retries next run or is waiting on you.

**Run summary** (`#pipeline`, once per run): shipped / failed / left-in-To-Do counts, per-category
counts (categories with zero omitted), one line per shipped task, and one line per failure
pointing at its agent channel.

**Session reports** (07:30 / 17:30, `team-reports.yml` → `digest-window`): commits that reached
`dev` in the window (from `git log`, by the `Notion:` line in each commit body), per-category
counts, `QA: n waiting · Done: n reached main this window`, plus per-engine detail from each
commit's `## Agent notes`.

**Troubleshooting.** No Slack posts → check the bot is in all three channels and
`node scripts/slack.mjs resolve-channels` resolves them. Slack failures are non-fatal
everywhere — a task that fails to post is still on `dev`.

## 13. Cloud operation

Once set up (see the go-live steps below), the worker no longer depends on this PC being
on: it runs as an **Anthropic Routine** (cloud), firing at **02:00** and **10:00** with
`TEAM_CLOUD=1` set in its environment. That env var flips the `team-run` skill into its
cloud mode (see `.claude/skills/team-run/SKILL.md` → `## Environment: local vs cloud`):
each task works on a branch (`team/<slug>`) inside the routine's single clone instead of
a worktree, and `NOTION_TOKEN`/`SLACK_BOT_TOKEN` are read from the environment
instead of `.env.team`. Everything else — classify, build, verify, QA, review, ship, park,
the Slack batch post — is unchanged from local runs.

**Browser QA runs in cloud too.** It is headless Playwright driven through
`scripts/qa-browser.mjs`, not the user's Chrome, so it works on a routine VM. The cloud deps
step installs the browser once per run
(`node node_modules/playwright-core/cli.js install --with-deps chromium`); if that install
fails, QA is skipped with a logged line rather than failing the task. Game tasks additionally
run `scripts/ui-audit.mjs`, which measures the GAME_DESIGN_CONSTRAINTS shell contract and
returns named assertion failures — deterministic, no visual judgment required.

The **CTO** review/merge gate (§10) is unaffected by any of this — it already runs in
GitHub Actions and doesn't care where the worker ran.

**Reports.** The nightly/daytime Slack summary is now the `Team Reports` GitHub Actions
workflow (`.github/workflows/team-reports.yml`), on a cron at **05:30 and 15:30 UTC**
(07:30 / 17:30 local in summer). It calls `node scripts/slack.mjs digest-window <start>
<end> <label>`, which lists PRs merged to `dev` with `mergedAt` inside `[start, end)`,
posts one session line to `#pipeline` (`N task(s) shipped` + titles/links, or "no work
this session" when the window was empty), and — only when there's something to say — a
per-engine detail post to `#agent-frontend`/`#agent-backend` from each PR's `## Agent
notes` block. The window for each run is read from `github.event.schedule` — or from the
`session` dispatch input (`night`/`day`) — never guessed from the clock, and the two
windows are back-to-back so no merge falls in a gap or gets reported twice.

**Who actually fires it (since 2026-08-30).** GitHub's own scheduler proved hours late
(3–6h observed), so the punctual trigger is the Cloudflare Worker **`nba-report-cron`**
(`infra/report-cron/`, account `8d0328…`, subdomain `stefanroman.workers.dev`): cron
`30 5 * * *` / `30 15 * * *` UTC → `workflow_dispatch` with the matching `session`. The
GitHub crons stay enabled as a late-firing backup. Double-posting is impossible: the
duplicate guard in `cmdDigestWindow` (`scripts/slack.mjs`) skips the whole run if the
window's report already sits in `#pipeline` history (bot-authored, within `end`+23h — the
same label recurs daily, hence the bound; matching is emoji-free because Slack stores
`📋` as `:clipboard:`). Whichever scheduler fires first posts; the other logs
`already posted, skipping`. The Worker's `GITHUB_TOKEN` secret is a fine-grained PAT
(repo-scoped, Actions R/W) that **expires yearly** — re-enter it with
`wrangler secret put GITHUB_TOKEN -c infra/report-cron/wrangler.toml`. Worker health is
visible only in the Cloudflare dashboard (a failed dispatch throws, marking the
invocation failed).

**Local scheduled tasks — retire only after cutover.** To switch fully to cloud, run
`scripts/unregister-team-cron.ps1` to retire the local `nba-team-pipeline` /
`nba-team-digest` Windows scheduled tasks (idempotent — safe to re-run) — do this ONLY
after a routine run is confirmed working; until then the local scheduled task is still
the live trigger and must keep running, or the pipeline stops entirely. `npm run team`
still works exactly as before for a manual local run, before or after cutover: no
`TEAM_CLOUD` env var means local mode and worktrees (QA itself is headless Playwright in
both modes, so it is no longer a local-only stage).

**Routine configuration.** The routine's environment needs three variables —
`TEAM_CLOUD=1`, `NOTION_TOKEN`, `SLACK_BOT_TOKEN` — and its network access must allow
`api.notion.com` and `slack.com`, or Notion/Slack calls will fail from the cloud
sandbox. The report workflow needs its own copy of the token as a GitHub repo secret,
`SLACK_BOT_TOKEN` (`gh secret set SLACK_BOT_TOKEN`), separate from the routine's env var.

**All crons are UTC.** The report crons (`30 5` / `30 15`) and the routine's schedule are
expressed in UTC, not local time — at UTC+2 that is 07:30/17:30 local for the reports and
02:00/10:00 local for the worker (`0 0,8 * * *`). Shift the numbers if you want different
local times.

**Stateless Slack loop.** The Slack reaction→follow-up loop stores each posted card's
Slack message id on its Notion card (`SlackTs`), so reactions are ingested by any run,
cloud or local — no local state file is involved.

**Go-live (one-time).** None of the above is live yet — until these steps are done, the
pipeline keeps running exactly as before, on the local scheduled tasks:
1. `gh secret set SLACK_BOT_TOKEN` — the report workflow's own copy of the token.
2. Create the routine at claude.ai/code/routines: prompt `/team-run`, this repo, cron
   02:00 & 10:00, env vars `TEAM_CLOUD=1` / `NOTION_TOKEN` / `SLACK_BOT_TOKEN`, network
   access allowing `api.notion.com` + `slack.com`.
3. Confirm one routine "Run now" ships → merges → reports cleanly end to end.
4. Only then run `scripts/unregister-team-cron.ps1` to retire the local scheduled tasks.

## 14. Model policy

**Opus 5 is banned everywhere in this pipeline.** The `opus` alias resolves to it, so the alias
is denied at spawn time in `.claude/settings.json` (`permissions.deny`: `Agent(model:opus)`).
The one permitted Opus is 4.8, pinned by full id in `planner-architect-opus`'s frontmatter and
used only to plan complex tasks whose spec is detailed. The models in play:

| Model | Id | Used for |
|---|---|---|
| Fable 5.1 | alias `fable` | Classify, code review, CTO gate, the orchestrator itself, design rounds for thin/ambiguous specs — and implementation when the task is complex but small. |
| Opus 4.8 | pinned `claude-opus-4-8` (never the `opus` alias) | Design round + replan for complex tasks with a detailed, explicit spec (`classify.planModel = opus-4.8`). |
| Sonnet 5 | alias `sonnet` | The default implementer, plus verify and browser QA. |
| Haiku 4.5 | alias `haiku` | Trivial implementation only (copy/config, zero logic). |

The rule is **fable thinks, sonnet types, haiku does the trivia**. The orchestrator passes every
model explicitly (never relying on agent frontmatter or the `npm run engine` profile):

| Role | Model |
|---|---|
| `planner-architect` (classify) | **fable**. |
| Design round + replan | `classify.planModel`: **Opus 4.8** (`planner-architect-opus`) when the spec is detailed — edge cases and done-criteria stated — **fable** (`planner-architect`) when it is thin. Either way the plan must be explicit enough — numbered steps, each with an acceptance criterion — for sonnet to execute without re-deriving it; `superpowers:writing-plans` is used when present (local), the native plan step otherwise (cloud). |
| Implementer (`frontend-engine`, `backend-engine`) | **haiku** for trivial. Otherwise **sonnet** when the work is clearly defined steps with acceptance criteria — however many — and **fable** when it is complex but small: a few steps that each need judgment a plan cannot pin down. Classify picks provisionally; the design round finalizes it (`Engine:` line in the design doc) once the plan's real shape is known. Long-and-vague is a plan problem, never a reason to upgrade the engine. |
| `code-reviewer` | **fable**, always. |
| `test-qa-engine`, `browser-qa` | **sonnet**, always. Never fable. |
| CTO review (GitHub Actions) | **fable**, pinned in `.github/workflows/claude.yml`. |

The cloud worker routine ("NBA team pipeline" at claude.ai/code/routines) sets its own model in
the routine UI, outside this repo — it must be set to Fable 5.1 by hand; nothing here can
enforce it. Rationale and history: `docs/team/DECISIONS.md` 2026-09-06 (both entries).
