# Autonomous Team Pipeline — Operator Manual

## 1. What it is

An autonomous coding pipeline: you write task cards on a Notion board, and unattended
agent runs pick them up, build them (intake → classify → brief → [plan, hard only] → build →
verify → QA → review), and push each finished one straight to `dev` — no PR, no automated review
gate. Since 2026-10-03 (v2) the mechanical steps are scripts under `scripts/team/` (intake,
brief, verify, qa, review-package); agents do classify, planning, building and reviewing, work
from one generated brief per card (`.team/run/<slug>/brief.md`) instead of re-reading the
constraint docs, and a failed gate resumes the same engine instead of spawning a new one. Up to
two cards with disjoint areas run at once. Design: `designs/2026-10-03-pipeline-v2-loop-architecture.md`. Production
is a separate, deliberate step you (or an agent you explicitly ask) take later. You mostly
interact with it through Notion, not the terminal.

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

**Queue order.** A run takes `P0` cards first, then `P1`, then `P2`, oldest first within a priority.
Notion timestamps only have minute precision, so cards created in the same minute have no
guaranteed order. When order matters (for example one card depends on another), put them in
different priorities, or create them a minute apart. `node scripts/notion.mjs set-props <id>
--priority P0|P1|P2 [--difficulty trivial|standard|hard] [--title "..."]` edits an existing card;
`create-card` takes the same flags plus `--body-file <markdown>` with `![caption](local-image)` lines
(uploaded and embedded in place). A `Difficulty` set on the card overrides classify's own guess.
In PowerShell avoid double quotes inside a title argument (they get stripped); use single quotes.

## 3. Triggers

- **Windows scheduled task** `nba-team-pipeline` — runs every 2 hours, 08:00–24:00 daily
  (registered via `scripts/register-team-cron.ps1`).
- **Manual**: `npm run team` from the repo root, any time.
- **From your phone**: add or edit a card and set it to To Do — no run needed on your
  end, it's picked up by the next scheduled run.

## 4. Status meanings

- **Backlog** — draft; the pipeline ignores it.
- **To Do** — queued; the next run claims it (unless `Needs human` is checked).
- **In progress** — a run owns it. If a run dies mid-task the card stays here and the next run
  resumes it from `.team/run/<slug>/state.json` (intake detects the existing run dir).
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

- **Skills** — `.claude/skills/` (e.g. `team-run`, `ship`, `classify`, `qa-protocol`).
- **Agents** — `.claude/agents/` (`planner-architect`, `frontend-engine`, `backend-engine`,
  `browser-qa`, `code-reviewer`, `motion-reviewer`). Verify is a script (`scripts/team/verify.mjs`), not an agent.
- **Run state** — `.team/run/<slug>/`: `card.json` (spec + props), `classify.json`, `brief.md`
  (the context pack every agent reads), `build-report.json`, `verify.json`, `review-package.md`
  and `state.json` (stage, fix rounds per gate, engine agent ids, base sha). Deleted on ship or
  fail; a leftover dir means a run died and intake resumes it. (`.team/journal.json` was v1.)
- **Scripts** — `scripts/team/{intake,brief,verify,qa,review-package}.mjs` with pure libs and
  `node --test` tests under `scripts/team/lib/`. `.claude/team/qa-map.json` maps touched files to
  the games/routes QA exercises.
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
   only and deliberately never committed/pushed — an automated ship touching a protected
   path deserves a human's own deliberate look, not a walked-past commit. It must stay
   uncommitted, working-tree-only.

## 9. Secrets rotation

- **`CLAUDE_CODE_OAUTH_TOKEN`** — subscription auth for the
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
- **Card stuck In progress with an empty journal** (`.team/journal.json` is `{}`
  or has no entry for it): the run that claimed it died or was killed. Set the card back
  to `To Do`.
- **Scheduled run appears to have done nothing**: check the newest file in
  `.team/logs/` (remember it's UTF-16LE) for what happened, and confirm the
  active `gh` account is `stefanroman22`, not `jimmedeknatel8` (see §8a) — a wrong
  account fails silently from Notion's point of view since the card never gets past
  ship.

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

**Setup script (since 2026-10-03).** The routine's "Setup script" field holds
`infra/routine/setup.sh` verbatim. It installs `node_modules`, Playwright Chromium (into
`/opt/pw-browsers`), the backend venv and migrates the dev sqlite once; the platform caches the
result as a filesystem snapshot (the script must finish in ~5 minutes), so a run starts with
everything in place and the workspace step installs nothing. It also guards the environment's
global Stop hook (`~/.claude/stop-hook-git-check.sh`) with `TEAM_CLOUD=1 → exit 0`, because that
hook fired "uncommitted changes" on every orchestrator turn while an engine was mid-edit. The
script needs these hosts allowed in the routine's network settings: `registry.npmjs.org`,
`pypi.org`, `files.pythonhosted.org`, `playwright.azureedge.net`,
`playwright-akamai.azureedge.net`, `playwright-verizon.azureedge.net`. Routine model: **Sonnet 5.5**
for the orchestrator (v2 — it calls scripts and relays messages; the heavy models are spawned
explicitly where §14 says so).

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

**Opus is no longer banned.** The 2026-09-06 ban targeted Opus 5 specifically for token cost;
Opus 5.5 (released 2026-09-22) and Sonnet 5.5 (released 2026-09-28) are meaningfully faster and,
for Sonnet, cheaper than their 5.x predecessors, which changes that calculus. The rolling aliases
`opus` and `sonnet` now resolve to the 5.5 versions. `planner-architect-opus` (pinned
`claude-opus-4-8`, the workaround used to reach an Opus family model during the ban) is no longer
referenced by this policy and is unused — left in place rather than deleted. The models in play:

| Model | Id | Used for |
|---|---|---|
| Fable 5.1 | alias `fable` | Classify, code review, CTO gate, the orchestrator itself, and design rounds for hard/multi-area tasks. No longer used as an implementer. |
| Opus 5.5 | alias `opus` | Implementation for tasks needing real judgment a plan can't fully pin down — whether or not a design round ran. Replaces Fable's old "complex but small" implementer role. |
| Sonnet 5.5 | alias `sonnet` | The default implementer for clearly-defined steps (however many) or a fully detailed spec, plus verify and browser QA. |
| Haiku 4.5 | alias `haiku` | Trivial implementation only (copy/config, zero logic). |

The v2 rule (2026-10-03): **scripts do everything mechanical; Haiku assembles; Sonnet is the
default worker everywhere; Opus only where feel or judgment lives inside code; Fable only where
a wrong call is expensive — hard planning and risky review.** The single source of truth is
`designs/2026-10-03-pipeline-v2-loop-architecture.md` §9; the orchestrator passes every model
explicitly (never relying on agent frontmatter or the `npm run engine` profile):

| Role | Model |
|---|---|
| Orchestrator (`team-run` session) | **sonnet** — `scripts/team-run.ps1` passes `--model sonnet`; the cloud routine's model is set in its UI. |
| `planner-architect` — classify | **sonnet**. |
| `planner-architect` — short plan for a `standard` card whose spec has no numbered steps | **sonnet**. |
| `planner-architect` — design round (`hard` only: security, protocol, data regeneration, new patterns, owner Difficulty=hard) + its replan | **fable**, one pass, 10-minute cap. |
| Implementer (`frontend-engine`, `backend-engine`) | **haiku** trivial · **sonnet** default · **opus** for motion/animation, `risk: high`, non-trivial P0, and `[opus]`-tagged plan steps. Fix round 3 escalates one model up. |
| verify, qa, review-package | scripts — no model. |
| `browser-qa` | **sonnet**, only for `"flow"` assertions a script cannot express. |
| `code-reviewer` | **sonnet** for trivial/standard risk-low P1/P2; **fable** for P0, `risk: high`, `hard`, security, or protected paths (`review-package.mjs` prints the pick). |
| `motion-reviewer` | **opus**, only when the diff touches `src/motion/**`, `components/motion/**`, a `framer-motion` import, or CSS transitions/animations. |
| CTO review (GitHub Actions) | **fable**, pinned in `.github/workflows/claude.yml`. |

History: `docs/team/DECISIONS.md` 2026-09-06 (Opus ban), 2026-09-29 (reversal), 2026-10-03 (v2).
