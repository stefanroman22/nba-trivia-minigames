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

**SEO rules before dev** (`docs/seo/README.md` "Before dev"). When a plan file is an SEO path
(`scripts/seo/lib/seo-paths.mjs`: pages, layouts, sitemap, robots, `GameUtils.tsx`, the SEO config…), the brief quotes
`docs/constraints/SEO_CONSTRAINTS.md`. Gate 1 runs `npm run check:seo` (inside `npm run lint`, or alone for an
SEO-only config change). Gate 2, on an SEO diff with the production build served, runs the IX audit and the on-page
check against the lane's build as swishquest.com before the browser starts: IX failures are QA failures
(`seo IX-nn: …`); on-page results, infra and transient results are notes; a non-SEO diff runs neither.

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

A run is one `/team-run` session. Three things can start one; which of them fire on a schedule is set outside the
repo (the routine's own settings, Windows Task Scheduler), so check there, not here.

- **Cloud routine** (claude.ai/code/routines, prompt `/team-run`, `TEAM_CLOUD=1`): "Run now", or its cron when
  the schedule is on. See §13.
- **Manual**: `npm run team` from the repo root, any time.
- **Windows scheduled task** `nba-team-pipeline` (`scripts/register-team-cron.ps1` registers it,
  `scripts/unregister-team-cron.ps1` removes it): the original local trigger, kept as a fallback.

Since November 2026 the owner starts runs on demand; nothing about the pipeline's code depends on which trigger
fired. Cards reach the queue by hand, from the checkers (§15), from the security and SEO agents (§16), or from
ticket intake (§17). Cards from player feedback (§18) arrive in Backlog and wait for you.

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

- **The index of every agent, skill and automation** — `.claude/README.md`.
- **Skills** — `.claude/skills/` (e.g. `team-run`, `ship`, `classify`, `qa-protocol`, `ticket-intake`).
- **Agents** — `.claude/agents/` (`planner-architect`, `frontend-engine`, `backend-engine`,
  `browser-qa`, `code-reviewer`, `motion-reviewer`, `ticket-writer`). Verify is a script (`scripts/team/verify.mjs`), not an agent.
- **Run state** — `.team/run/<slug>/`: `card.json` (spec + props), `classify.json`, `brief.md`
  (the context pack every agent reads), `build-report.json`, `verify.json`, `review-package.md`
  and `state.json` (stage, fix rounds per gate, engine agent ids, base sha, the usage of every agent spawned: §19). Deleted on ship or
  fail; a leftover dir means a run died and intake resumes it. (`.team/journal.json` was v1.)
- **Scripts** — `scripts/team/{intake,brief,verify,qa,review-package,tickets,costs}.mjs` with pure libs and
  `node --test` tests under `scripts/team/lib/` (`npm run test:automation` runs every script suite). `.claude/team/qa-map.json` maps touched files to
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

d. **Backend venv = Python 3.12.** Create it with `py -3.12 -m venv backend\.venv` (Linux:
   `python3.12 -m venv backend/.venv`) to match `backend/.python-version`; a 3.11 venv fails
   interpreter-dependent tests. Gate 1 prints one `verify: warning:` line when the venv's version differs (it never fails).

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
One-off tasks that must follow the next promotion (migrations, relay deploy, ruleset) are listed in `docs/team/NEXT_PROMOTION.md`; the promote-to-prod skill runs them after production is verified.
**Security gate on `main`:** a ruleset requires the commit status `security/pr-scan` on every commit
that reaches `main` (`.github/workflows/security.yml`, docs/security/README.md). The promote job
opens a dev → main PR, runs the gate (which may auto-fix `dev`) and pushes exactly the scanned
commit; a `Target = main` ship pushes `security-gate/<slug>` and waits for the gate (ship skill
step 6b) before pushing `main`. PRs to `main` (ui-fix, relay) get the gate like any PR.

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
`infra/routine/setup.sh` verbatim — after every change to the file (latest 2026-10-15: `--with-deps`,
relay deps for check cards, §15) the owner must re-paste it there. It installs `node_modules`, Playwright Chromium (into
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

**Setting the routine up (done once; kept as the checklist for re-creating it):**
1. `gh secret set SLACK_BOT_TOKEN` — the report workflow's own copy of the token.
2. Create the routine at claude.ai/code/routines: prompt `/team-run`, this repo, cron
   02:00 & 10:00, env vars `TEAM_CLOUD=1` / `NOTION_TOKEN` / `SLACK_BOT_TOKEN`, network
   access allowing `api.notion.com` + `slack.com`.
3. Confirm one routine "Run now" ships → merges → reports cleanly end to end.
4. Only then run `scripts/unregister-team-cron.ps1` to retire the local scheduled tasks.

## 14. Model policy

The registry is `.claude/models.json`: the four rolling aliases, the model each resolves to, every agent's default
and the Claude Code version CI installs (an alias resolves to whatever that CLI maps it to, so the pin matters).
`npm run check:ai` fails when an agent file, a workflow pin or this section disagrees with it.

| Alias | Model | Used for |
|---|---|---|
| `fable` | Fable 5.2 | Where a wrong call is expensive: design rounds for hard or multi-area cards, review of P0 / high-risk / hard / protected-path diffs, the weekly security review, the SEO agent. Never an implementer. |
| `opus` | Opus 5.5 | Judgment inside the work itself: implementation a plan cannot fully pin down, motion, the PR security review, ticket writing, the question author and doctor, the in-app game builder. |
| `sonnet` | Sonnet 5.5 | The default worker: the orchestrator, classify, standard plans, clearly specified implementation, standard review, browser flows, the checker judges, feedback triage. |
| `haiku` | Haiku 5.5 | Trivial implementation only (copy or config, zero logic). |

The rule (v2, 2026-10-03): **scripts do everything mechanical; Sonnet is the default worker everywhere; Opus only
where feel or judgment lives inside the work; Fable only where a wrong call is expensive.** The orchestrator passes
every model explicitly, so neither an agent file's frontmatter nor the `npm run engine` profile decides a
pipeline spawn:

| Role | Model |
|---|---|
| Orchestrator (`team-run` session) | **sonnet**: `scripts/team-run.ps1` passes `--model sonnet`; the cloud routine's model is set in its UI. |
| `planner-architect`: classify | **sonnet**. |
| `planner-architect`: short plan and acceptance criteria for a `standard` card whose spec has none | **sonnet**. |
| `planner-architect`: design round (`hard` only: security, protocol, data regeneration, new patterns, owner Difficulty=hard) and its replan | **fable**, one pass, 10-minute cap. |
| Implementer (`frontend-engine`, `backend-engine`) | **haiku** trivial · **sonnet** default · **opus** for motion/animation, `risk: high`, non-trivial P0, and `[opus]`-tagged plan steps. Fix round 3 escalates one model up. |
| verify, qa, review-package | scripts, no model. |
| `browser-qa` | **sonnet**, only for `"flow"` assertions a script cannot express. |
| `code-reviewer` | **sonnet** for trivial/standard risk-low P1/P2; **fable** for P0, `risk: high`, `hard`, security, or protected paths (`review-package.mjs` prints the pick). |
| `motion-reviewer` | **opus**, only when the diff touches `src/motion/**`, `components/motion/**`, a `framer-motion` import, or CSS transitions/animations. |
| `ticket-writer` (§17) | **opus**: a badly scoped ticket costs a whole pipeline run. |
| `feedback-triage` (§18) | **sonnet**: classification and short tickets, reviewed by you in Backlog. |
| `@claude` responder (GitHub Actions) | the session model in `.claude/settings.json` (`fable`), read by `.github/workflows/claude.yml`. |

Haiku 5.5 and Sonnet 5.5 are cheap enough that the cost case for moving more judgment down a tier is worth an
eval, but no role was moved on price alone: a tier change needs a measured pass rate, not a price list. For
classify that measurement is one command (§20).

History: `docs/team/DECISIONS.md` 2026-09-06 (Opus 5 banned for cost), 2026-09-29 (reversal: Opus 5.5 and
Sonnet 5.5), 2026-10-03 (v2). 2026-11-24: Fable 5.2 and Haiku 5.5 replace Fable 5.1 and Haiku 4.5 behind the same
aliases, the Opus 4.8-pinned `planner-architect-opus` (unused since the reversal) was deleted, and CI's Claude
Code pin moved to the release that maps the aliases to those models.

## 15. Check cards

**What they are.** Cards created by `scripts/check-core/notion-push.mjs` from validated UI Check
(later Logic Check) findings — one card per cluster of findings that share files or checks. Name
`[ui-check] …`, Category from the findings' owner, Priority P0 blocker / P1 major / P2 minor,
Difficulty set, `Source` = `ui-check fp:<keys> ids:<ids> run:<runId>` (the dedupe key), `Target` =
`main` (production hotfix) or `dev`, and a `findings.json` attachment holding every finding object
of the cluster. The card body is a summary (it may list only the top findings); the attachment is
the truth. Design: `docs/superpowers/specs/2026-10-15-checks-prod-logic-design.md` §3.3–§3.5.

**How each stage treats them** (detected by `Source` starting `ui-check`/`logic-check`):
- **intake** writes `source`, `target` (default `dev`) and `findingsFile` (the downloaded
  `.team/attachments/<pageId>/findings.json`, or null) into `card.json`.
- **classify** pre-classifies: areas from Category, tier = Difficulty, docs from the findings'
  `fix.rules` prefixes (`UI-`/`RULE`/`MP-`/`AUTH-`/`BE-`), CODE_MAP hits from their `files`. No plan
  writer and no design round, even for a `hard` card.
- **brief** adds `## Check findings` right after `## Spec` (per finding: Current, Expected, Files, How
  to fix, Acceptance — verbatim from the attachment, ≤ 60 lines each, ≤ 400 in all; a check card's
  brief may run to 500 lines), quotes exactly the rule ids `fix.rules` names, and writes the QA
  assertion `{"verify": "<findingsFile>"}`. The engine follows "Fixing a UI-check finding" in its
  agent file and does not run verify itself.
- **QA (gate 2)** runs its usual smoke, then `scripts/ui-check/verify.mjs --from <findingsFile>
  --mode dev --repo <worktree> --ports <lane>` on the lane stack it started (verify reuses Django and
  the web server and starts only the relay; the lane's ui-check processes are stopped before and after).
  Every `FAIL <id> — …` line is a QA failure verbatim; a verify whose verdict lines are missing or do
  not add up to its summary is `verify infra: …`; a check card without its attachment fails. A check
  card (known from card.json, not only the brief) is never "skipped" by QA. QA's Django and the relay
  verify starts share one `MULTIPLAYER_SHARED_SECRET`, so 1v1 points are credited as in production.
- **ship** with `Target = main`: the worktree is cut from `origin/main`, ship rebases on `origin/main`,
  moves the card to QA (`ship-card`) *before* pushing — `main-sync` fires on the push and must find it
  there — fast-forwards `main` (production: frontend and backend deploy from it), then back-merges
  `main → dev` through an auto-merged PR (one retry). A back-merge that still fails leaves `main`
  shipped, comments on the card and sets Needs human. Then a read-only production check: both Vercel
  commit statuses green within 15 min, swishquest.com and the API health answer; a failure only flags the
  card (Needs human, comment, Slack) — the pipeline never rolls back or fixes forward on its own.
  `Target = dev` ships exactly like any other card.

**Check-bug cards** (`[check-bug] <check ids>: …`, Source `check-bug fp:<key> …`, since 2026-10-25). When a judge or
the Logic triage drops a failure because the *check* is wrong — out of date with an on-purpose app change (`spec`) or
broken by its environment (`env`: the check stack, a seed, the runner's network) — it writes `<runDir>/check-bugs/
<writer>.json` and the weekly run files one card per cause with `scripts/check-core/check-bugs.mjs` (Category pipeline,
Priority P1, Target dev: the checker tooling lives on dev). Their Source does not start with `ui-check`/`logic-check`, so
they are ordinary cards (no findings attachment, no verify gate): the body names what went unverified and the
acceptance is the check passing on main while still guarding its rule. The weekly Slack line lists those checks as
`UNVERIFIED`; the same cause next week comments "seen again" on the open card.

**Efficiency.** A check card costs one classify (no judgment left to make), no plan writer, no design
round, one engine pass that starts from file:line pointers, and a QA gate that is the finding's own
acceptance re-run — the same judge the checker used.

**Relay rule.** The relay (`multiplayer_server/`, Railway) is billed, and a relay change reaches
production only through your merge. So a `Target = main` fix whose commit touches
`multiplayer_server/` is never pushed to `main`: ship pushes `team/<slug>`, opens an **unmerged PR to
`main`**, moves the card to QA with the PR's head SHA, sets **Needs human** and comments "merge with a
merge commit; the merge deploys the relay; do not untick Needs human". You merge the PR **with a merge
commit (not squash/rebase)**; the merge deploys the relay by itself: `.github/workflows/relay-deploy.yml`
(any push to `main` that changes `multiplayer_server/`, promotions included) waits for the production
frontend of the commit, lets live rooms drain (10 min at most), runs `railway up` (secret `RAILWAY_TOKEN`),
checks `/health` answers from the new instance and comments the result on the card and in #pipeline.
`main-sync` then marks the card Done. A squash or rebase rewrites the SHA, so main-sync never finds it:
then set the card Done by hand. The run
reports it as `SHIPPED-PR <url>`. In the cloud (no `gh`) ship pushes `team/<slug>`, runs `ship-card --target main --branch team/<slug>` and
`set-props --needs-human`, comments "open the PR to main by hand (merge commit); the merge deploys the relay", and ends with `SHIPPED-PR <branch>`.

**Cloud.** `infra/routine/setup.sh` now installs Chromium with `--with-deps` and runs `npm ci --prefix
multiplayer_server` so `verify.mjs` can start the relay on the VM. **Re-paste `infra/routine/setup.sh`
into the routine's "Setup script" field** (claude.ai/code/routines) — the routine keeps its own copy.

**SEO cards are ordinary cards.** The SEO agent (`scripts/seo/notion-push.mjs`, `docs/seo/README.md`) files cards
with `Source` = `seo-check fp:<key> run:<runId>` (the dedupe key, as above), `Target` = `dev` always (a post-deploy
regression is a P0 card, still Target `dev`) and **never an attachment**: the finding (current, expected, files, how
to fix, acceptance) is in the card body. `seo-check` is not a check-card Source (`isCheckCard` matches only
`ui-check`/`logic-check`), so every stage treats them like any owner card: the usual classify, plan writer and design
round when warranted, the usual QA, and ship to `dev`.

## 16. Security cards and direct mode

**Weekly security card.** `.github/workflows/security.yml` (Fridays 12:00 Europe/Amsterdam) files at most ONE card per
week: `[security] Weekly scan <date>: …`, `Source` = `security-check fp:<keys> run:<id>`, `Target` = `dev`, Priority P0
when anything is high or critical, a `findings.json` attachment. Like SEO cards it is an ordinary card (`isCheckCard`
does not match `security-check`): classify treats it as security work (risk high, design round), and the body's numbered,
file-naming fix steps become the plan. Leaked-secret groups start with owner-only actions (revoke/rotate, history purge);
the pipeline does the code part and never force-pushes. Dedupe lives on the branch `security-state`, not in Notion.

**Direct mode (no Notion).** The security gate on a PR to `main` calls the pipeline directly on the PR branch:
`scripts/team/direct.mjs <slug> --spec-file … --base <sha> --branch <b>` writes `card.json`/`classify.json`/`state.json`
and runs `brief.mjs`; then `claude -p "/team-direct <slug>"` (skill `.claude/skills/team-direct`) runs build (opus
engine) → `verify.mjs` → fable review with the usual fix rounds, and ends with `DIRECT-DONE`/`DIRECT-FAIL`. It never
commits, pushes or touches Notion/Slack: `scripts/security/run.mjs` commits, pushes and re-scans (2 rounds per PR at
most). docs/security/README.md.

## 17. Ticket intake and acceptance criteria

**From a long text to cards.** `.claude/skills/ticket-intake`: the `ticket-writer` agent (read-only, returns JSON)
splits one text into tickets and `scripts/team/tickets.mjs` validates and files them. A ticket is
`{title, category, priority, difficulty?, context, scope[], acceptance[], out_of_scope?[], files?[], depends_on?[]}`.
The validator refuses the whole document when any ticket lacks a checkable acceptance criterion ("it works" is
rejected), so nothing reaches the board without them.

```
node scripts/team/tickets.mjs split notes.txt            # agent -> .team/tickets/<run>/tickets.json (one corrective retry)
node scripts/team/tickets.mjs render <tickets.json>      # read what would be filed
node scripts/team/tickets.mjs create <tickets.json>      # one card each, Status To Do; --status Backlog to park, --dry-run to look
```

Cards carry `Source` = `ticket-intake fp:<title fingerprint> run:<id>`; a ticket whose title already has an open
card is skipped, so `create` is safe to repeat. From GitHub: `ticket-intake.yml` takes the number of an issue
**written by the repository owner** and files its body the same way (Backlog by default).

**How the criteria are used.** The card body has `## Acceptance criteria` with bullets `- AC1: …` (bullets on
purpose: numbered lines are read as plan steps). `brief.mjs` copies them into the brief's
`## Acceptance (what the reviewer checks)`; a card you wrote by hand gets the same treatment when it has that
section, and when it has none the planner writes 2-5 there before any code. The engine reports each id in
`build-report.json` (`acceptance: [{id, met, how}]`), `review-package.mjs` puts the list and the engine's claims in
front of the reviewer, and the reviewer ends with `AC<n>: met | not met | cannot tell`. `not met` is a blocker and
goes through the usual fix rounds. Check cards are unchanged: their acceptance is the findings attachment (§15).

## 18. Feedback triage

`.claude/skills/feedback-triage` turns the in-app feedback form's unread messages into verdicts and, where a builder
could act, cards. Four steps with separate access (the jobs of `feedback-triage.yml`, manual-dispatch):

1. `manage.py feedback_triage export` (database): new, un-triaged messages. Ban appeals and bare ratings are left
   out; no email, name or account id is exported.
2. `scripts/feedback/run.mjs triage` (model only): the `feedback-triage` agent, with Read/Grep/Glob and no
   credentials, gives every item a verdict (`bug`, `content`, `idea`, `praise`, `complaint`, `other`) and writes
   one ticket per actionable cluster, citing the feedback ids as evidence.
3. `scripts/feedback/run.mjs file` (Notion): validates the answer against the batch, then files the tickets.
4. `manage.py feedback_triage apply` (database): stores the verdict on the row (`Feedback.triage`), marks it read.

**The rule that matters:** feedback is text from the public, so a card that comes from it is always filed in
**Backlog**, with `Source` = `feedback fp:… run:…`. It becomes pipeline work only when you move it to To Do. A
repeat report of an open card adds a "seen again" comment instead of a second card. The card body carries counts
and feedback ids, never the players' words.

## 19. Cost ledger

What a card cost is written on the card's own commit. There is no ledger file: two lanes appending to one file would
conflict on every rebase, and the commit is already the one record that survives the run dir.

**What is recorded.** Each time an agent returns to the orchestrator, the harness reports that agent's usage (total
tokens, tool uses, duration). The orchestrator stores it with one command per spawn (`team-run` skill §2):

```
node scripts/team/costs.mjs spawn <slug> --stage build --agent frontend-engine --model sonnet --tokens 123456 --tool-uses 40 --ms 310000
```

It appends `{stage, agent, model, tokens, toolUses, ms}` to `state.spawns` in `.team/run/<slug>/state.json`
(stages: `classify`, `plan`, `design`, `build`, `fix`, `qa`, `review`). A number the harness did not report is stored
as `null`: nothing is estimated. The orchestrator session's own tokens are not in it (a session is not told its own
usage), so the tokens of a card are the tokens of the agents it spawned.

**The trailer.** At ship, `node scripts/team/costs.mjs trailer <slug>` prints one line from `state.json` and
`classify.json`, and the `ship` skill puts it in the commit body right after `Category:`:

```
Cost: tier=standard engine=sonnet effort=high plan=sonnet review=fable spawns=6 tokens=812345 models=sonnet:612345,fable:200000 fix=verify:1,qa:0,review:1 minutes=23
```

`key=value` pairs separated by single spaces, no space inside a value; a key with nothing known is left out.

| Key | Meaning |
|---|---|
| `tier`, `engine`, `effort` | classify's difficulty, engine model and engine effort |
| `plan` | the model of the last plan or design spawn recorded (absent: no plan writer ran) |
| `review` | the model of the last `code-reviewer` spawn recorded |
| `spawns` | how many agent spawns were recorded |
| `tokens` | the sum over the spawns that reported a number (absent when none did) |
| `models` | that sum per model, which is what the estimate is priced from |
| `unmetered` | spawns that reported no token number, when there are any: `tokens` is then a lower bound |
| `fix` | fix rounds per gate, from `state.fixRounds` (a replan resets its gate's counter) |
| `minutes` | from the card's first intake (`startedAt`) to the ship; a card resumed in a later run includes the wait |

A failing `trailer` never blocks a ship: the line is left out and the card shows no numbers. The formatter and the
parser are one pure pair in `scripts/team/lib/cost.mjs`, round-trip tested.

**The report.** `npm run team:costs` (= `node scripts/team/costs.mjs report`) reads `git log origin/dev` (`HEAD` when
that ref is missing), keeps the commits with a `Notion:` line and prints one row per card, then totals per category,
per engine model and per ISO week: cards, tokens, the estimate, the share of cards with any fix round, mean fix rounds.

```
node scripts/team/costs.mjs report --since "4 weeks ago"       # markdown on stdout
node scripts/team/costs.mjs report --ref origin/main --json    # rows and totals as JSON
node scripts/team/costs.mjs report --html costs.html           # one self-contained page: tiles, charts, a sortable table
```

**Old commits have no numbers, and none are invented.** A card shipped before the ledger has no `Cost:` line. Its row
shows what its commit says (date, category, the engines of `## Agent notes`, the source kind from a `[ui-check]`,
`[logic-check]`, `[check-bug]`, `[security]` or `[seo]` title, else from the card's name in the Notion URL, else
`card`) and `n/a` everywhere else; totals count only the cards that have data, and say how many those are. A
`cherry-pick -x` copy of a card that is also in the log (a hotfix on `main` and its copy on `dev`) is one ship: the
copy is dropped, so a card's numbers are never counted twice.

**The dollar figure is an estimate.** A row's dollars are its tokens per model times that model's list input price
(`usdPerMTok.input` in `.claude/models.json`): an upper-bound estimate at list input price; the subscription is not
billed per token. Agent traffic is overwhelmingly input and cache reads, and cache reads cost a fraction of the input
price, which is why pricing every token as fresh input overstates. A row whose model has no price in the registry
shows `n/a`. Use the figure to compare cards, tiers and models with each other, not as a bill.

**Not in the ledger.** Direct mode (§16): its commits are the security gate's own (`security: auto-fix round …`,
no `Notion:` line), so `team-direct` records nothing. Failed cards: they have no commit; their run dir, spawns
included, is deleted by the fail procedure.

## 20. Which model should classify: the tier comparison

`classify` decides every card's route (model tier, design round or not), so its own model is worth measuring instead
of guessing. The eval exists: 36 cases (19 real cards, 17 owner-written) with an owner-verified answer key, and a
runner that replays the real `planner-architect` agent headless and read-only. It lives on the branch `eval/classify`
and must never be merged into `dev`: classify greps the repository and would read the answer key while classifying
real cards (`.gitignore` and `npm run check:ai` both refuse `.claude/hillclimb/` here).

`scripts/team/eval-classify.mjs` borrows it for one comparison and leaves nothing behind in the checkout:

```
npm run team:eval-classify -- run --models sonnet,haiku --reps 2 --at <ref>   # one pass per model
npm run team:eval-classify -- compare                                         # the last run's table again
```

It prints routing accuracy (the design-round call and the model tier both right) and the four component scores per
model, each with a 95 % interval, the cost and time per run, and a verdict: the cheapest model whose routing is not
measurably worse than the best. With a few dozen cases the intervals are about ten points wide, and the verdict says
so; raise `--reps` before changing §14 on a small gap. Results stay in `.team/eval-classify/<stamp>/` (git-ignored).

**`--at <ref>` is needed today.** Each case was recorded at the commit classify saw, and the 2026-10-08 history
clean-up removed those commits from the remote. `--at` replays every case at one commit instead (the first commit of
`dev` is the closest to what the cases saw). Models of one run then see the same repository and compare with each
other, but not with the 88 % / 99 % recorded on the branch for Fable 5.1.

**Cost.** Every run is a real model call on this machine's Claude login: cases × reps × models. One case on Sonnet
5.5 and Haiku 5.5 measured $0.19 and $0.01 API-equivalent (2026-11-25), so a full two-rep pass of both is roughly
$15. `--only r01,u04` keeps a trial small. Running a full pass is the owner's call (CLAUDE.md, money).

