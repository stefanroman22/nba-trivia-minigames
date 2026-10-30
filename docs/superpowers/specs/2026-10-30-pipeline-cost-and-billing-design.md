# Pipeline cost and billing: move Claude automation onto the API credits, cut what each run spends

Date: 2026-10-30 · Status: draft for owner approval · Owner: Stefan

## 1. Why now

On 2026-10-29 the Tic-Tac-Toe Question Checker drain ran 376 Claude jobs on GitHub Actions in
about five hours. They were billed to the owner's Max 20x subscription (the `CLAUDE_CODE_OAUTH_TOKEN`
secret) and moved the weekly meter from ~30% to ~75%. Measured from the jobs' own `total_cost_usd`:
**≈ $710 API-equivalent**, 97% of it Tic-Tac-Toe boards, $0.46–2.28 per job of 10 boards.

The same subscription also pays for the cloud routine ("NBA team pipeline"), the CTO review, the
weekly security and SEO runs, and the owner's own coding in VS Code. They all compete for one meter.

The owner's Max 20x plan includes **$200 of API credits every month** (claude.ai → Billing → API
credits, linked to the Console org "Stefan's Individual Org", next credit 2026-11-11). Today nothing
uses them. They expire monthly with no rollover.

Goal: automation runs on the $200 first, falls back to the subscription automatically when the
credits are gone, and spends a fraction of what it spends today. The owner keeps the subscription for
interactive coding.

## 2. Goals, non-goals, anti-goals

**Goals**
1. Every unattended Claude run (team pipeline, Question Checker, CTO review, security, SEO, factory,
   doctor, editorial) draws on the API credits first and on the subscription only when the credits
   are exhausted, with no owner action in between.
2. The pipeline keeps every agent role it has today (classify, planner/architect, frontend engine,
   backend engine, browser QA, code reviewer, motion reviewer, checker). Roles may change shape; none
   is removed.
3. Spend per card and per Checker drain drops by an order of magnitude where the measurements say it
   can (targets in §9).
4. Every run reports what it cost and which wallet paid.

**Non-goals**
- Redesigning what the agents do or how tickets are written. The owner will revisit the agent set
  later; this design optimises the current set.
- Changing the question content, the games or the data model beyond the one verification table in §6.

**Anti-goals (failure even if it "works")**
- Anything that can charge the owner's card. The Console org must keep **no payment method and
  auto-reload off**, so the $200 is a hard ceiling by construction. No step of this design adds
  purchased credits, raises the claude.ai usage-credits cap, or turns on auto-reload.
- A fallback that silently drains the subscription at the old rate. When the pipeline is on the
  subscription it must run in a reduced mode (§4.4).
- Losing the "works while the PC is off" property.

## 3. Facts the design rests on (verified 2026-10-30)

From Anthropic's docs ([API credits for Max and Team](https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers),
[Help Center article](https://support.claude.com/en/articles/17154008),
[authentication precedence](https://code.claude.com/docs/en/authentication#authentication-precedence),
[routines](https://code.claude.com/docs/en/routines#usage-and-limits)):

| Fact | Consequence |
|---|---|
| Credits cover the Claude API, Message Batches, Managed Agents, the Agent SDK, and **`claude -p` run by you with an API key from the linked org**. | Unattended `claude -p` with `ANTHROPIC_API_KEY` is the path. |
| Credits do **not** cover runs started by the **Claude Code GitHub Action**, IDE extensions or the desktop app, "even with `-p`", nor interactive Claude Code, nor cloud routines (routines always draw subscription usage). | Replace `anthropics/claude-code-action@v1` with our own `claude -p` step. Move the routine worker to a GitHub Actions cron. |
| Precedence in `-p` mode: `ANTHROPIC_API_KEY` beats `CLAUDE_CODE_OAUTH_TOKEN`; there is **no built-in fallback** from key to subscription; `--fallback-model` never fires on billing errors. | We write the fallback ourselves (§4.3). |
| When the org has no credits left, requests return `Your credit balance is too low to access the Anthropic API…`; Claude Code prints `Credit balance too low · Add funds: …`. Usage is never charged to the plan. | Detect that text; it is the only signal we get. |
| The Admin/Cost API is **unavailable for individual accounts**. | No programmatic balance check. Use a probe call plus error detection. |
| `CLAUDE_CODE_SUBAGENT_MODEL` is only a default since v2.1.251; explicit `model` in a spawn or agent frontmatter wins. | The pipeline's haiku/sonnet/opus spawns run as written. |
| `.claude/settings.json` sets `model: "fable"` and `CLAUDE_CODE_EFFORT_LEVEL=high` for the whole project, so they also apply to the owner's VS Code sessions here. The cloud routine logged `init: model=claude-fable-5-1`; `claude.yml` reads the same file for its model. | Every unattended orchestrator and the `@claude` bot run on the most expensive model at the highest effort today. |
| `claude.yml` is the **`@claude` mention bot** (fires on `issue_comment` / `pull_request_review_comment` only). The CTO review jobs were retired (`docs/team/DECISIONS.md:131-136`); `.claude/skills/cto-review/` is empty; `PIPELINE.md:334` is stale. | There is no PR-triggered review to re-wire; only the bot's auth and model change. |
| `security.yml`, `seo-weekly.yml` and `checks-weekly.yml` already install Claude Code and call `claude -p` from their own Node scripts (`scripts/security/lib/detect.mjs:162`, `scripts/seo/run.mjs:453`, `scripts/check-run.mjs`), several calls per job. Only `claude.yml`, `question-checker.yml`, `factory-review.yml`, `doctor-research.yml`, `editorial-author.yml` use the action. | The wrapper must be a library those scripts import, with a CLI and a composite action on top. |
| `--max-budget-usd` counts subagent spend (CLI ≥ 2.1.217) and `total_cost_usd` in the JSON result covers the whole session including subagents. | One budget per `claude -p` process is a run cap, not a card cap; card caps need the deadline mechanism in §5.3. |
| `--max-budget-usd` and `--max-turns` exist for `-p`; `--output-format json` returns `total_cost_usd` and per-model usage. | Hard caps and cost reporting per job come for free. |
| Prompt cache: 1h TTL, minimum cacheable prefix 512 tokens on Haiku/Sonnet/Opus 5.5 and Fable 5.1; Message Batches are 50% off and stack with caching. | The Checker judge (§6) uses both. |

## 4. Part A: billing routing

### 4.1 One wrapper for every unattended run

`scripts/claude/lib/run.mjs` (new) exports `runClaude({prompt, model, maxTurns, maxBudgetUsd, cwd,
env, job})` and is the only way automation starts Claude Code. Three thin layers use it: a CLI
`scripts/claude/run.mjs` for workflows that run one prompt, a composite action for the five
action-based workflows, and direct imports in `scripts/security/lib/detect.mjs`, `scripts/seo/run.mjs`
and `scripts/check-run.mjs`, which replace their own `spawn("claude", …)` calls so every model call
gets the same wallet choice, caps and cost file. For each call it:

1. **Picks the wallet.** If `ANTHROPIC_API_KEY` is set, sends a 1-token Haiku probe through the plain
   Messages API (cost ≈ $0.0001). On success → API key. On the "credit balance is too low" error (or
   HTTP 400/402 with that text) → unsets the key and uses `CLAUDE_CODE_OAUTH_TOKEN`. Any other error
   (network, 5xx) → retry twice, then API key anyway (the run will fail loudly rather than quietly
   burn the subscription).
2. **Runs `claude -p`** with: `--model` from the caller, `--max-turns`, `--max-budget-usd`,
   `--output-format json`, `--dangerously-skip-permissions` only where today's workflow already
   skips them, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`, `DISABLE_AUTOUPDATER=1`.
3. **Handles mid-run exhaustion.** If the result is a billing error after the probe passed (credits
   ran out during the run), it re-runs once with `--resume <session_id>` on the subscription, so the
   turns already paid for are not repeated.
4. **Reports.** Appends one line to `$GITHUB_STEP_SUMMARY` and writes `.team/cost/<job>.json`:
   `{job, model, turns, duration_ms, total_cost_usd, wallet: "api"|"subscription", fallback_reason}`.
   The first fallback of each UTC day posts one Slack line to `#pipeline`:
   "API credits exhausted; pipeline on subscription in reduced mode until <next credit date>".

A composite action `.github/actions/claude-run/action.yml` wraps the install (pinned
`@anthropic-ai/claude-code` version, npm cache) and the CLI, so each action-based workflow swaps one
`uses:` for another and keeps its prompt text. The three script-based workflows keep their own
install step (they already pin `2.1.285`) and gain the library import.

**Model and effort live in the wrapper, not in `.claude/settings.json`.** The project settings file
today forces `model: "fable"` and `CLAUDE_CODE_EFFORT_LEVEL=high` on every session in this repo,
including the owner's VS Code sessions. Phase 0 **removes** both from the project file (the owner's
own user setting then applies interactively) and the wrapper passes `--model` and the effort env to
every automated call. `scripts/team-run.ps1` already passes `--model sonnet`; it gets the effort env
too.

### 4.2 Workflows that change

| Workflow | Today | After |
|---|---|---|
| `claude.yml` (`@claude` mention bot) | action, OAuth, model from settings (fable) | composite action, API key first, `--model sonnet`, `--max-budget-usd 3` |
| `question-checker.yml` | action, OAuth, `--model opus` default, 16-way matrix | replaced by the Checker v2 of §6 for `pending` mode; the agentic path (through the composite action, Sonnet, `--max-turns 40`) stays for `audit` and `corrections` modes and for the two board kinds §6 cannot make deterministic |
| `factory-review.yml`, `doctor-research.yml`, `editorial-author.yml` | action, OAuth | composite action, same prompts, `--max-budget-usd` per job |
| `security.yml`, `seo-weekly.yml`, `checks-weekly.yml` | own install + `claude -p` from Node scripts, OAuth, several calls per job | the scripts import `runClaude`; per-call wallet choice and cost file; their existing `--max-turns` kept |
| **new `team-run.yml`** | cloud routine (subscription, Fable, reinstalls deps every run) | cron `0 1,9 * * *` UTC (≈ 02:00/10:00 Berlin, same slots), `workflow_dispatch`, concurrency group `team-run` (one at a time), CLI wrapper with `--model sonnet -p "/team-run"`, `TEAM_CLOUD=1`, `--max-budget-usd 40` as the run cap, caches for `node_modules`, `multiplayer_server/node_modules`, `backend/.venv` and Playwright browsers keyed on lockfiles, `timeout-minutes: 120` |

**Git identity for `team-run.yml`.** The orchestrator pushes to `dev`, hot-fixes check cards to
`main`, deletes branches and commits RETRO. Pushes made with the workflow's own `GITHUB_TOKEN` do
not trigger other workflows, so `main-sync.yml` (sets Done), `relay-deploy.yml` and dev CI would
stop firing, and the "security-pr-scan on main" ruleset blocks a direct push by that token. The
worker therefore pushes with an owner-created **fine-grained PAT** (`TEAM_BOT_TOKEN`: contents,
pull-requests, workflows on this repo). The owner is the repo admin, so the ruleset's bypass list
needs "repository admin" (or the PAT's owner) added for the one push path that already exists today
for the routine. A GitHub App is the cleaner long-term identity; it is not in this design.

The cloud routine `trig_0153qByJYTbWoxXLy8pFMiR4` is **disabled, not deleted**, and documented as
the manual fallback if GitHub Actions is down. `npm run team` on the PC keeps working as today
(subscription, browser QA).

Secrets added: `ANTHROPIC_API_KEY` (from a new Console **workspace "swish-pipeline"** so the Console
Cost page shows pipeline spend on its own line) and `TEAM_BOT_TOKEN` (the PAT above). No other key
in the org is used by automation.

### 4.3 Fallback semantics

- Wallet choice is per job, at job start, plus the one mid-run resume above.
- Exhaustion is expected near month end; it is not an error. Jobs log `wallet: subscription` and carry
  on in reduced mode (§4.4).
- Credits refresh on the owner's billing date (the 11th). Nothing needs resetting: the next probe
  succeeds and jobs are back on the API key.

### 4.4 Reduced mode on the subscription

When the wallet is the subscription, the wrapper exports `CLAUDE_WALLET=subscription` and the
pipeline scripts read it:

- `intake.mjs` picks at most **one card per run** and only `check` or `standard` tiers (no `hard`).
- Checker v2 **waits** (its work is not urgent) and posts the Slack line once.
- Weekly jobs (security, SEO, checks) run on **Haiku** unless a finding needs escalation.
- The CTO review still runs (a stuck PR costs more than a review) on Sonnet.

### 4.5 Owner steps (not automatable)

1. Console → create workspace "swish-pipeline" → create an API key → paste it as repo secret
   `ANTHROPIC_API_KEY`. Do **not** add a payment method or auto-reload to the org.
2. After the first wrapper run, open Console → Cost and confirm the spend appears under
   promotional credits for that workspace. If it shows "credit balance too low" instead, the help
   centre's "`claude -p` with an API key" reading is wrong for CI, and the fallback plan is the Agent
   SDK (`@anthropic-ai/claude-agent-sdk`, listed as covered) in the same wrapper.
3. Create the fine-grained PAT `TEAM_BOT_TOKEN` (this repo only: contents, pull requests,
   workflows: read and write) and paste it as a repo secret; add repository admins to the bypass
   list of the "security-pr-scan on main" ruleset if they are not already there.
4. Disable the cloud routine once `team-run.yml` has shipped one card.
5. Decide on the claude.ai "usage credits" toggle (currently ON, €0 balance, €120 monthly cap, auto-
   reload off). As long as the balance is €0 nothing is charged; the design does not rely on it.

## 5. Part B: pipeline diet (same agents, less context, bounded loops)

The map of one card (scan of 2026-10-30, file:line in the retro notes) shows four kinds of waste.
Each fix below names what changes and what it saves; nothing removes a role.

### 5.1 Models and effort

| Where | Today | After |
|---|---|---|
| `.claude/settings.json` `model` | `fable` (project default: orchestrator, `@claude` bot, any unspecified spawn, and the owner's own sessions here) | **removed**; automation passes `--model` through the wrapper; interactive sessions follow the owner's user setting |
| `.claude/settings.json` `CLAUDE_CODE_EFFORT_LEVEL` | `high` for everything | **removed** from the project file; the wrapper sets `medium` for automation; engines set `high` themselves on `hard` cards; classify runs `low` |
| Orchestrator (`/team-run`) | Fable in the cloud, Sonnet locally | Sonnet everywhere (wrapper passes `--model sonnet`) |
| Code reviewer | Sonnet, or Fable on P0 / risk-high / hard / protected path | same rule, but Fable re-reviews only the delta (§5.3) |
| `direct.mjs` | hard-codes Opus engine + risk high (Fable review) | tier from `classify` like every other card |
| Classify | Sonnet | **Haiku** first; Sonnet only when Haiku's answer is `hard` or `unsure` |

### 5.2 Context diet (what each agent reads)

| Waste | Fix |
|---|---|
| Classify reads all of `DECISIONS.md` (133 KB ≈ 33k tokens) on every non-check card, and appends to it. The `.claude/hillclimb/classify/` eval (72 runs per version) measures classify at **250–270k input tokens and $0.62–0.72 per card on Fable**, ~10 turns each re-reading that context | `brief.mjs` greps DECISIONS for the card's area/game keywords and inlines ≤ 40 matching lines into the brief; the classify skill stops reading the file. New decisions go to `docs/team/decisions/<yyyy-mm>.md` monthly files; DECISIONS.md becomes an index. |
| `RETRO.md` (13.7 KB) read by every planner job and growing | brief carries the last 10 RETRO entries whose area matches; planner skill stops reading the file |
| `CODE_MAP.md` (25.7 KB) searched or read by classify, both engines, code reviewer, motion reviewer | the brief's `codeMapHits` is the only CODE_MAP exposure; agent files say "do not open CODE_MAP.md; the brief has your hits" |
| Check-card brief 47 KB: the same findings in `spec` and again under `## Check findings` | `brief.mjs` includes findings once; brief capped at **24 KB** with a truncation note listing what was cut |
| Engine agent files carry 7.5–8.5 KB of ui-fix/check-card text on every card | that text moves to `.claude/skills/check-card/SKILL.md`, loaded only when `classify.kind === "check"` |
| `CLAUDE.md` line 100–105 makes the 42 KB `GAME_DESIGN_CONSTRAINTS.md` "mandatory reading" for any renderer work, overriding the brief's excerpt | the mandate becomes "read the sections the brief names; open the full doc only if the brief says `constraints: full`" |
| Review package = whole diff, no cap; untracked files bypass excludes | cap 60 KB (lockfiles, generated, data, screenshots excluded by path; untracked files go through the same filter); above the cap the package lists the files and the reviewer reads what it needs |
| Motion reviewer runs its own `git diff origin/dev...HEAD`, which is empty because engines never commit | engines commit `wip:` in the worktree after every round (squashed at ship); the motion reviewer reads the package like the code reviewer |
| browser-qa skill repeats Chromium install and ui-audit that `qa.mjs` already ran | delete those steps from `qa-protocol/SKILL.md` |

### 5.3 Loops: resume, don't respawn; bound everything

| Waste | Fix |
|---|---|
| Re-review spawns a fresh reviewer (and a fresh motion reviewer) that re-reads brief, CODE_MAP and the whole diff | the orchestrator keeps the reviewer's agent id and **resumes it** with "re-check findings N, M; the delta since your review is `.team/run/<slug>/review-delta.patch`" (possible once engines commit `wip:`) |
| Replan resets `fixRounds` to 0 → up to 11 fix rounds per card | replan grants **one** extra round on the failing gate; total fix rounds per card ≤ 5 |
| Budgets are checked only when a card starts; the last real run took 4 h 54 min against a 90-min cap; a card reached "attempt 3 of 2" | **Per card:** `state.json` gets `deadline` (start + tier budget × 1.5). `verify.mjs`, `qa.mjs`, `review-package.mjs` exit `BUDGET_EXCEEDED` after the deadline and the orchestrator fails the card to Needs human. Per-card dollars are reported, not enforced: the orchestrator records each subagent's token usage (already in the task notifications) into `state.json.cost`. **Per run:** the wrapper's `--max-budget-usd 40` on the single `/team-run` process is the hard backstop (one process runs both lanes, so a process cap cannot be a card cap). The tier figures (check $4 / standard $8 / hard $20) are reporting thresholds that flag a card in the digest; tuned after two weeks of cost files. Resumes count as attempts. |
| Fail procedure could not delete the run dir; the next pick merged stale `fixRounds{qa:3}` and tripped the breaker | fail writes `.team/run/<slug>/TOMBSTONE`; intake treats a tombstoned dir as absent and starts fresh |
| Orchestrator sessions end while background `npm ci`/QA run, each restart paying boot + intake | all long steps run as blocking foreground commands (already the documented workaround; the GH Actions runner has no such ceiling); the cached deps in §4.2 remove the `npm ci` wait entirely |
| QA re-run repeats migrate, servers, ui-audit at three viewports, smoke and the full `verify --from` (14 min) for a one-file fix | `qa.mjs --changed <paths>`: ui-audit only on routes mapped from the changed files (`qa-map.json`), skip `verify --from` when `verify.json` is green for the same touched-tree hash |
| Ship re-runs lint/tsc/build/tests whenever `dev` moved | after rebase, re-run only if the rebase touched any file in the card's touched set or a shared root (package.json, lockfiles, config); otherwise reuse `verify.json` |

### 5.4 Orchestrator does mechanical work itself (on the most expensive model)

New scripts, each printing ≤ 40 lines: `workspace.mjs` (fetch, worktree, deps from cache, state init),
`ship.mjs` (commit from message file, rebase, conditional re-verify, push, Notion `ship-card`, Slack,
cleanup), `fail.mjs` (postmortem skeleton from state + gate JSON, RETRO append + commit, Slack,
tombstone). The `team-run` skill shrinks to: intake → classify → brief → build → gates → ship/fail,
each a script call plus a decision. Expected: orchestrator turns per card roughly halved.

### 5.5 Caching

Claude Code already caches the stable prefix (agent file + CLAUDE.md + skill) within a session and
`subagentPromptCacheTtl: 1h` is set. What this design adds: keep the brief **last** in every spawn
prompt (already so), keep agent files and skills free of per-run content (dates, slugs), and set
`--exclude-dynamic-system-prompt-sections` in the wrapper so consecutive jobs in one workflow share
the cached system prefix.

## 6. Part C: Question Checker v2 — verify players once, derive boards

### 6.1 What the measurements say

- The unit of truth for Tic-Tac-Toe, Who Are Ya, Contexto, Career Path and most Connections is the
  **player row** (`teams[abbr,start,end]`, `awards`, `country`, `draft`, `college`, `career`,
  `position`). Boards are generated from rows by `player_matches`
  (`backend/trivia/games/tictactoe.py:55-126`) and `pair_matches`
  (`backend/trivia/questions/games/tictactoe.py:121-131`, with the team × decade special case and the
  `teammate` criterion at :101-118, a relation between two players' season sets). A board built from
  correct rows is correct by construction, but the fact extractor is not a per-cell lookup: it emits
  **player facts** `(player, field, value)` and **pair facts** `(playerA, playerB, "teammate",
  overlapping stints)`, both resolvable from the rows.
- Yesterday: 4,253 board checks over **576 distinct players**; each player checked ~27 times in wave 1
  alone; ~800 of ~1,000 pages per wave fetched by more than one job; 978 boards re-run with identical
  input and no memory, 70% of them unsure → unsure again.
- Two data contradictions caused most unsures: Kyrie Irving (brief says "From USA", row says not USA,
  NBA.com says born in Australia) in 210 of 372 wave-3 unsures; Moses Malone "undrafted" (ABA
  dispersal draft) in ~30 per wave.
- `export_checker_batches` filters on status only, so boards already flagged `needs_owner` were
  re-exported (217 of them).
- Only fan-favorites completeness and who-would-win team facts are claims about the world rather than
  about a row: 1–2% of yesterday's boards.

### 6.2 Design

**Layer 0, deterministic (no model).** `export_checker_batches --mode facts` walks pending boards and
emits the set of player facts and pair facts each cell depends on, deduplicated across all pending
boards. Label sanity (does "Won MVP" map to `awards.mvp ≥ 1`) is a table lookup and is checked here
too. **Scope:** Phase 2 covers `pending` mode only; `audit` and `corrections` modes
(`checker_jobs.py:245-255`, two-domain rule) keep the agentic path through the wrapper until a
follow-up measures whether they are worth converting (they were not part of yesterday's spend).

**Layer 1, memory.** New table `trivia.PlayerFactVerdict(player_id, field, value_hash, verdict
valid|invalid|unsure, confidence, source_urls[], evidence_excerpt, model, checker_version,
checked_at)`. Facts with a `valid`/`invalid` verdict for the same `value_hash` and `checker_version`
are skipped. A re-wave costs nothing for anything already verified.

**Layer 2, evidence fetch (no model).** For each player with unverified facts, a Python step fetches
the Basketball-Reference player page and the Wikipedia infobox once (the two sites already on the
allow-list), strips them to plain text (~3–6 KB), and stores them in `.checker/cache/<player>.txt`
(GitHub Actions cache keyed on player id + month). Pace ≥ 2.5 s/request to the same host (BR blocked
the agent runs at a few hundred quick calls).

**Layer 3, judge (one model call per player, not an agent).** `scripts/checker/judge.mjs` uses the
Anthropic SDK with `ANTHROPIC_API_KEY`: system prompt = the checker rules (cached, 1h TTL), user turn
= player evidence + the list of facts to judge, output = JSON verdict per fact with confidence and the
evidence line. **Haiku 5.5 first**, submitted through the **Message Batches API** (50% off). Facts
with confidence < 0.8 or where Haiku says the sources disagree go to **Sonnet 5.5** in a second batch
with the same evidence. Still unsure → `unsure`, one row per fact for the owner, not one per board.
Unsure facts surface where the Checker already reports: the Slack checker digest lists them (player ·
field · value · why), and the run uploads `checker/unsure-facts.md` as an artifact. `MAX_UNSURE`
("unsure twice → owner") moves from the question to the fact; a board is `needs_owner` when any of
its facts is.

**Layer 4, derive.** A board is `valid` if every fact it depends on is `valid`; `invalid` if any is
`invalid`; otherwise `unsure`, listing the open facts. Verdicts flow into the existing
`apply` path unchanged (`checker_jobs._apply_one`).

**Agentic remainder.** Fan-favorites completeness and who-would-win team facts keep the current
`claude -p` path through the §4.1 wrapper on Sonnet, `--max-turns 40`, effort medium, with the batch
carrying pre-fetched evidence text so the model does not browse.

**Fixes shipped with it:** export excludes `needs_owner` questions; `unsure` twice stops a fact, not
a board; the Kyrie "From USA" rule and the Moses Malone draft rule are decided by the owner (§10) and
written into both the data and `checker.md`, which today contradict each other.

### 6.3 What stays the same

The Checker remains a stage with its own workflow, the four approved sites, `checker_version`,
quarantine/approve/unsure outcomes and the Slack/Notion reporting. The owner's "checker agent" is now
a judge over evidence instead of a browsing agent; the owner can swap the model or the prompt without
touching the layers around it.

### 6.4 Cost estimate (to be measured, not promised)

576 players × ~6k input tokens (rules cached + evidence + facts) on Haiku batch ≈ $0.20 input +
~$0.30 output; 15% escalation to Sonnet ≈ $1–2. A full drain of yesterday's size: **under $5**,
against $710. Re-waves after owner fixes: cents.

## 7. Measurement and reporting

- Every wrapper run writes `.team/cost/<job>.json` (§4.1). `team-reports.yml` adds a "Cost" line to
  each Slack digest: today's spend by wallet and job, month-to-date on the API key, cards shipped and
  $/card.
- `run-summary.json` gets `cost_usd` per card (from the orchestrator's `--output-format json`
  result plus subagent usage already reported in task notifications).
- Two weeks after rollout: a retro note in `docs/team/RETRO.md` comparing $/card and $/drain before
  and after, and tuning the `--max-budget-usd` tiers.

## 8. Rollout

| Phase | What | Owner needs to do | Risk if skipped |
|---|---|---|---|
| 0 (same day) | remove `model` and `CLAUDE_CODE_EFFORT_LEVEL` from `.claude/settings.json`; `team-run.ps1` and the routine prompt carry Sonnet/medium explicitly; export filter excludes `needs_owner`; keep Question checker disabled | nothing | every run keeps paying Fable prices |
| 1 | `runClaude` library + CLI + composite action; `team-run.yml` with caches; swap the 5 action workflows and the 3 script workflows; disable routine after first shipped card | create workspace + key, PAT, paste both secrets, ruleset bypass, confirm on Console Cost page | nothing moves to the credits |
| 2 | Checker v2 (§6) | decide the two data rules (§10) | next drain costs hundreds again |
| 3 | pipeline diet (§5.2–5.4) | nothing | cards cost 2–5× what they could |
| 4 | measurement + retro (§7) | read the retro | no evidence for the next round |

Phases 1 and 2 are independent of each other; 3 can be split per table row. Each phase ships as its
own PR to `dev` through the normal path (the owner asks for pushes, per the repo rule).

## 9. Expected outcome (estimates from the measurements; verify in Phase 4)

| Item | Today | Target |
|---|---|---|
| Checker full drain (~4,300 boards) | ≈ $710, 5 h, 376 jobs | < $5, < 1 h, 3 batch jobs |
| Pipeline run with 2 cards (cloud) | Fable orchestrator, 92 min, deps reinstalled, ~1.2M tokens on the 2026-10-03 reference run | Sonnet orchestrator, cached deps, half the turns; $4–10 per standard card on the API key |
| Weekly subscription share from automation | ≈ 90% of the week's usage on the Checker day | ≈ 0 until the $200 is spent; reduced mode after |
| Owner follow-up on unsure | 278 boards | a few dozen facts |

## 10. Open for the owner (answers change what gets built)

1. **Retire the cloud routine in favour of `team-run.yml`?** It is the only way the worker can bill to
   the credits, and it also fixes the missing setup script and the blocked data hosts. The routine
   stays disabled as a manual fallback. Recommended: yes.
2. **Reduced mode on the subscription (§4.4):** one card per run, no `hard` tier, Checker waits. Or
   should the pipeline stop entirely on the subscription until the next credit?
3. **Checker as a judge over pre-fetched evidence (§6) instead of a browsing agent.** This is where
   almost all of the saving is. The browsing path remains for the 1–2% it must. OK?
4. **Two data rules:** what does "From USA" mean for a player born abroad who plays for the USA
   (Kyrie Irving: born Melbourne, USA national team)? And is a player taken in the ABA dispersal
   draft "undrafted" (Moses Malone)? The data and the checker brief must say the same thing.
5. **Budget tiers** (check $4 / standard $8 / hard $20 per card as reporting thresholds; $40 hard cap
   per run) are my first guess; they are tuned from the cost files after two weeks. Any ceiling you
   want from day one?
6. **Push identity for the GitHub-hosted worker:** a fine-grained PAT you create (`TEAM_BOT_TOKEN`)
   plus a ruleset bypass for repo admins, as designed; or do you want a GitHub App now?

## 11. Left to the builder

- Exact probe implementation and error matching in `run.mjs`; where the cost JSON lives in the cache.
- Composite-action layout, Claude Code version pin, cache keys.
- Table/migration naming for `PlayerFactVerdict`; evidence text extraction details; batch sizes.
- How `brief.mjs` selects the ≤ 40 DECISIONS lines (keywords from area + game + touched paths).
- Which `qa-map.json` routes map from which paths for `qa.mjs --changed`.

## 12. My calls (made for the owner, flagged)

- One library (`runClaude`) with a CLI and a composite action on top, rather than editing eight
  workflows by hand each time; the three Node scripts that already call `claude -p` import it.
- Model and effort are removed from the project `.claude/settings.json` rather than set to Sonnet
  there, so the owner's interactive sessions in this repo are not forced onto a model by automation.
- `claude.yml` is treated as the `@claude` bot it is; no PR-triggered review is added.
- Checker v2 converts `pending` mode only; `audit`/`corrections` stay agentic for now.
- Per-card dollars are reported; per-card time is enforced; per-run dollars are enforced.
- A dedicated Console workspace, so the Cost page separates pipeline spend from anything else.
- The routine is disabled, not deleted.
- Haiku for classify; Sonnet for the orchestrator everywhere; Fable kept only where the pipeline
  already escalates to it.
- Re-waves of the Checker skip verified facts by `value_hash`, not by board id.
- Slack gets one fallback notice per day, not one per job.
