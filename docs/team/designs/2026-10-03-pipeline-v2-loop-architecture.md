# Pipeline v2 — a cheap, deterministic loop with talking agents

Status: **proposal, waiting for the owner's decision** (2026-10-03). Nothing in this document is built yet.
Keeps the two routine schedules (00:00 and 08:00 UTC). Goal: a 90-minute run ships 4–6 cards instead of 1–2, at roughly half the tokens per card.

## 1. What the logs say (evidence, 2026-10-03 08:00 UTC run)

One P0 frontend card ("Career Path result at the top"), start to ship:

| Stage | Wall time | Tokens (where logged) | Note |
|---|---|---|---|
| Boot + queue + spec | 1.5 min | — | sandbox allocate, `list-todo`, `get-spec`, `poll-reactions` |
| Classify (fable) | 0.6 min | 56k | fine |
| Workspace (`npm ci`, Chromium check) | 3 min | — | runs every run; nothing is cached between runs |
| **Design round (fable)** | **17 min** | **204k** | one agent wrote "proposals", "sign-off" and the plan itself — the ceremony had no second party |
| Build, 3 spawns (sonnet, opus, sonnet) | ~25 min | 103k + ~300k + ~100k | each spawn re-read the 885-line game constraints, the 624-line shell constraints and the 434-line design doc |
| Verify (lint, typegen+tsc, build) | **0.7 min** | small | **not a problem** |
| **Browser QA (sonnet)** | **~30 min + ~10 min re-QA** | large | Chromium/CDN friction, mock servers rebuilt, 30 s timeouts, retries |
| Review (fable) + motion review (opus) | 3.5–8 min each | ~200k | reviewer re-ran lint/build that verify had already run |
| Ship | 2 min | — | fine |

Per card: **~80–110 min, ~1.0–1.3M tokens.** The run stops starting new cards at minute 72, so a run ships 1–2 cards. Cards added in the evening wait for the 02:00 run; whatever that run cannot finish waits until 10:00. That is the "5-hour gap": the schedule plus one slow card per run.

Secondary friction: a Stop hook in the routine environment (`~/.claude/stop-hook-git-check.sh`) fires "uncommitted changes" on every orchestrator turn while a build agent is mid-edit, adding turns; the `subagent` prompt cache bucket is 5 minutes, so a design round that takes 17 minutes invalidates the cache for the build spawns that follow.

## 2. Goals and non-goals

Goals
1. A 90-minute run finishes 4–6 standard cards (or 2–3 hard ones).
2. Half the tokens per card (target ≤ 500k for a standard card, ≤ 800k for hard).
3. Tests at the points that matter: after build (static), after QA (behavior), after review (judgment) — and never pay for a later gate when an earlier one failed.
4. Agents hand work to each other with files and messages, not by re-reading the repo.
5. Every loop has a hard cap and a visible exit.

Non-goals
- Changing the two schedules (adding runs is a separate owner decision, see §12).
- Agent teams (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`): not spawnable in `-p`/headless mode and ~7× tokens. Rejected.
- claude-flow/ruflo-style swarms: contested claims, 15–25k tokens of overhead per session. Rejected.
- Making the whole run depend on the `Workflow` tool: no public measurement of a build→test→review→fix pipeline on it, and `claude -p` support is reported but unverified. It stays an optional accelerator (§13), not the backbone.

## 3. Design principles (from the research, applied)

1. **Deterministic edges, LLM nodes.** Everything that can be a script is a script (queue, workspace, verify, scoped QA, review package, ship). Agents only do the parts that need judgment: writing code, judging a diff, writing a plan for genuinely hard work. (Anthropic "Building effective agents": start with workflows, add agency only where it pays; Huntley/Ralph: tests are the back-pressure.)
2. **One brief per card, read once.** A generated context pack replaces the 2,500-line re-read. Each agent gets the brief path and only the rule sections that apply. (superpowers `task-brief`, BMAD story files, spec-workflow context loaders — all the same idea.)
3. **Resume, don't respawn.** A fix round continues the same implementer (SendMessage) with the findings verbatim. A fresh spawn only on round 3, with a stronger model. (superpowers subagent-driven-development, rounds 1–3 resume / 4–5 escalate.)
4. **Cheapest gate first.** 40 s of lint/tsc/build before any browser, reviewer or planner spends a token.
5. **Caps everywhere.** 3 fix rounds, 1 replan, per-tier time budgets, circuit breaker on "no file changed" or "same error twice". (ralph-claude-code, superpowers.)
6. **Stable prefix.** No model/effort/MCP changes mid-agent; `subagentPromptCacheTtl: 1h`; CLAUDE.md stays short (it is loaded by every subagent).

## 4. The graph

```
            ┌──────────── scripts (no tokens) ────────────┐   ┌──── agents ────┐
intake ──▶ brief ──▶ [plan?] ──▶ build ──▶ gate-1 verify ──▶ gate-2 QA ──▶ review ──▶ ship
  │          │          │          ▲  ▲          │                │           │
  │          │          │          │  └──resume──┘ fail           │           │
  │          │          │          └───────resume─────────────────┘ fail      │
  │          │          │          └───────────────resume─────────────────────┘ blocker/major
  │          │          └─ fable, only tier=hard (cap 1 round, 10 min)
  │          └─ script + haiku (standard) / fable (hard) — produces brief.md
  └─ script: queue, budgets, claim, workspace (cached), journal
```

Nodes and who runs them:

| Node | Runs as | Model | Budget | Output (file) |
|---|---|---|---|---|
| intake | `scripts/team/intake.mjs` | — | 1 min | `.team/run/<slug>/card.json` (spec, props, attachments, budget tier) |
| brief | `scripts/team/brief.mjs` (+ haiku for rule selection and the short plan on `standard`; on `hard` the brief links the fable plan from the next node) | haiku | 2 min | `.team/run/<slug>/brief.md` |
| plan | design-round v2 | fable | 10 min, 1 round | `docs/team/designs/<date>-<slug>.md` (plan steps with `[opus]/[sonnet]` tags) — only `hard` |
| build | frontend-engine / backend-engine, **kept alive** | per step tag or tier | 10/20/35 min | `.team/run/<slug>/build-report.json` (`did`, `assumed`, `touched[]`, `testsAdded[]`) |
| gate-1 verify | `scripts/team/verify.mjs` | — | 2 min | `verify.json` (pass, failures-only output ≤100 lines) |
| gate-2 QA | `scripts/team/qa.mjs` (deterministic) + browser-qa only for card assertions it cannot script | — / sonnet | 6 min / +6 min | `.team/qa/<slug>/verdict.json`, screenshots |
| review | code-reviewer on a **review package**; motion-reviewer only when the diff touches `src/motion/**`, `framer-motion` imports or `transition`/`animation` CSS | fable / opus | 5 min each, parallel | `review.json` (findings with severity) |
| ship | ship skill, unchanged contract | — | 2 min | commit on dev |

## 5. Edges: how a result moves to the next node

Every edge is a small JSON file in `.team/run/<slug>/` plus one message. The orchestrator never pastes file contents into prompts; it passes paths.

- **brief → build:** the engine is spawned with: the brief path, the plan path (if any), the attachments list, and the sentence "Read the brief. Do not read `docs/GAME_DESIGN_CONSTRAINTS.md` or `docs/constraints/*` in full; the brief quotes the rules that apply and links the sections by heading." The engine ends with `build-report.json`.
- **verify fail → build:** `SendMessage` to the *same* engine: the failures-only output (≤100 lines) and "fix, then write build-report.json again". No respawn, no re-read.
- **QA fail → build:** `SendMessage` with the verdict's failure strings and screenshot paths (the engine can `Read` the image).
- **review → build:** the reviewer writes `review.json`; blocker/major findings are sent verbatim to the engine. Minor/nit go into the commit body as today.
- **Escalation:** round 3 of any loop spawns a fresh engine on the next model up (sonnet → opus; opus → opus with the fable plan re-attached) with the brief + the full finding history. Round 4 does not exist: fail procedure.
- **Circuit breaker (script):** if a fix round changes no file, or the same first failure line repeats twice, stop the loop early and fail the card with that reason. This removes the 80-minute tail.

## 6. The brief (context pack) — the biggest token lever

`scripts/team/brief.mjs <slug>` assembles, in this order:

1. The card spec verbatim (from `get-spec`), attachments as `[Image attached: path]`.
2. The classify JSON.
3. **Rules that apply**, quoted: the "Rules at a glance" table rows whose IDs match the areas and files involved, plus the full text of each matched rule (not the whole doc). This depends on the constraints cleanup card producing a stable rule-ID index; until it ships, the brief selects by the `## Rule` headings that exist today, keyed by the area→doc map that already lives in the engine agents' "Required reading" sections.
4. CODE_MAP hits (≤10) and the first 40 lines of each file the card names.
5. The test plan: which `npm`/`manage.py` commands prove the card, and which QA map entries (§7) apply.
6. For `standard` cards: a 5–12 step plan written by **haiku or sonnet** (not fable) *only when the spec has no numbered steps*. If the spec already has numbered steps with files (the owner's detailed tickets), the steps are copied as the plan. This replaces the design round for ~10 of the 14 queued cards.

Size target: ≤ 400 lines. Every agent downstream reads this file first and is told the full docs are reference, not required reading.

## 7. QA v2 — deterministic first, agent only for what cannot be scripted

`scripts/team/qa.mjs <slug>`:

1. Reads `build-report.json.touched[]` and `.claude/team/qa-map.json`, a hand-maintained map:
   ```json
   { "src/Game Renderers/CareerPath.tsx": { "game": "career-path", "routes": ["/career-path"] },
     "src/components/ScorePanel.tsx":     { "games": "*", "routes": ["/"] },
     "src/views/Leaderboard.tsx":         { "routes": ["/leaderboard"] },
     "backend/users/**":                  { "routes": ["/profile", "/leaderboard"], "backend": true } }
   ```
   Shared components (`components/ui`, `components/motion`, `GameFrame`) expand to **all games** for the ui-audit (that is cheap — it is one script) but to one route for smoke.
2. Brings up the frontend on 5273 (and Django on 8100 only if `backend` is true) using **pre-built mocks and a pre-migrated SQLite** created once in the cloud setup script (§10).
3. Runs, in order, failing fast: `ui-audit.mjs --only <touched games>` (3 viewports); route smoke (page loads, no console errors, one screenshot per route at 390 and 1100); the card's own assertions from `brief.md` §5 if they are expressible as `{route, selector, expect}` triples.
4. Writes `verdict.json`. Total: 4–6 minutes, no tokens.
5. **browser-qa (sonnet) runs only if** the brief has assertions the triple form cannot express (a multi-step flow). It gets the brief, the verdict so far, and a 6-minute budget; it writes one script against `scripts/qa-browser.mjs` as today.

This turns the 40-minute stage into ~5 minutes for most cards and ~12 for flow-heavy ones.

## 8. Planning tiers — the design round becomes the exception

| Tier | When | Who plans | Cost |
|---|---|---|---|
| `trivial` | copy/config/single file | nobody — brief only | 0 |
| `standard` with numbered spec | the card already lists steps and files | the brief copies them | 0 |
| `standard` without steps | one area, existing patterns | haiku/sonnet writes 5–12 steps inside the brief | ~1–2 min |
| `hard` | multi-area, security, protocol, data regen, or owner Difficulty=hard | **fable design round v2**: one pass, plan with per-step tags, self-review — **no proposals/sign-off ceremony** (in cloud the planner cannot spawn, so it wrote both sides itself) | ≤10 min, ≤120k |

Owner action for the current queue: set Difficulty to `standard` on the 10 detailed UI cards; keep `hard` on ban/text moderation, photo moderation, constraints cleanup and the motion audit.

## 9. Model policy (single source of truth for v2)

Rule in one sentence: **scripts do everything mechanical (no model); Haiku assembles; Sonnet is the default worker everywhere; Opus only where feel or judgment lives inside code; Fable only where a wrong call is expensive — hard planning and risky review.**

### 9.1 Every agent

| Agent | Model | Condition | Effort |
|---|---|---|---|
| Orchestrator (`team-run` session) | **sonnet** (today fable) | always; in v2 it calls scripts and relays messages. Set in the routine UI | high |
| planner-architect — classify | **sonnet** (today fable) | every card. A `hard`/`risk: high` verdict routes to Fable in the next node, so a misjudgment is caught there | medium |
| brief-writer (new) | **haiku** | every card: spec + matching rules + CODE_MAP hits + copies the card's numbered steps | low |
| brief-writer — plan step | **sonnet** | only `standard` cards with no numbered steps (writes 5–12 steps with files and done-checks); two-area standard cards: also the interface contract | medium |
| planner-architect — design round | **fable** | only `hard`: security, multiplayer protocol, data regeneration, new patterns/state machines, owner Difficulty=`hard`. One pass, 10-min cap | high |
| planner-architect — replan | plan's model: **sonnet** (standard) / **fable** (hard) | once, after 2 failed fix rounds at the same gate | high |
| frontend-engine / backend-engine | **haiku** | `trivial`: copy/config/single value, zero logic | low |
| | **sonnet** | **default**: clear steps, however many | high |
| | **opus** | motion/animation is the core; `risk: high`; non-trivial P0; plan steps tagged `[opus]` | high |
| | escalation | fix round 3: sonnet → fresh opus; opus → fresh opus with the plan re-attached | high |
| verify | **script** | every card (frontend checks only if `src/` changed; backend suite only if `backend/` changed) | — |
| qa runner | **script** | every card touching `src/` or `backend/` | — |
| browser-qa | **sonnet** | only when the brief has a multi-step flow the `{route, selector, expect}` form cannot express | medium |
| code-reviewer | **sonnet** | `trivial`/`standard`, `risk: low`, P1/P2 | medium |
| | **fable** | P0, `risk: high`, `hard`, security, or the diff touches protected paths (auth, tokens, data pipeline, multiplayer protocol, settings/CACHES, admin API) | high |
| motion-reviewer | **opus** | only when the diff touches `src/motion/**`, imports `framer-motion`, or adds CSS `transition`/`animation`/`@keyframes` | high |
| ship | **script** + orchestrator | every card | — |
| CTO gate (`.github/workflows/claude.yml`) | **fable**, pinned | unchanged; PRs only | — |

Retired: `test-qa-engine` (verify is a script; new tests are written by the engine from the brief's test plan) and the design round's role-played proposals/sign-off.

### 9.2 Every flow step

Run flow: intake (script) → pick the next card whose tier budget fits (script; trivial 10 / standard 25 / hard 45 min) → open lane 2 if a disjoint card exists (script decides) → card flow per lane → run summary (script).

Card flow: classify **sonnet** → brief **haiku** (+ **sonnet** plan/contract when needed) → plan **fable** only `hard` → build (engine per 9.1; two engines in parallel when the plan's files are disjoint) → gate 1 verify (script) → gate 2 QA (script; **sonnet** browser-qa only for flows) → review (**sonnet**/**fable** per risk; **opus** motion-reviewer only on motion diffs; in parallel) → ship (script).

Fix loop: rounds 1–2 `SendMessage` to the same engine with failure lines only; round 3 fresh engine one model up; no round 4. Breaker: zero files changed or the same first error twice → fail early. Two failures at the same gate → one replan (plan's model), counter reset once.

Fail flow: post-mortem by the orchestrator (**sonnet**), `fail-card`, RETRO entry, Slack card. No extra agent.

### 9.3 Worked lineups

| Card | classify | brief | plan | build | QA agent | review | motion |
|---|---|---|---|---|---|---|---|
| Friends text swap (P1, standard, steps in spec) | sonnet | haiku | — | sonnet | — | sonnet | **opus** (SwapText import) |
| Leaderboard rank endpoint (P1, standard) | sonnet | haiku | — | sonnet | — | sonnet | — |
| Daily game, two areas (P1, standard) | sonnet | haiku + sonnet contract | — | sonnet ∥ sonnet | — | sonnet | — |
| Ban + text moderation (P1, hard, security) | sonnet | haiku | **fable** | opus steps 1–4, sonnet 5–9 | sonnet (flow) | **fable** | — |

Fable appears twice on the security card and nowhere on the other three; today it appears 3–4 times on every card (orchestrator, classify, design, review).

### 9.4 Where models are set
Orchestrator: routine UI (claude.ai/code/routines). Every spawn: the skill passes `model:` explicitly; agent frontmatter is the fallback. `CLAUDE_CODE_SUBAGENT_MODEL=sonnet` stays as the safety net. Effort: high for fable/opus and implementers, medium for sonnet classify/brief/review, low for haiku. Settings: `subagentPromptCacheTtl: "1h"`. CLAUDE.md stays ≤ 120 lines.

## 10. Cloud environment — pay setup once

The routine's setup script (cached as a filesystem snapshot if it finishes in ~5 min) does: `npm ci`; `playwright-core install chromium` (CDN domains allowlisted in the routine's network settings); `python -m venv backend/.venv && pip install -r backend/requirements-web.txt`; `manage.py migrate` into a SQLite fixture with the QA seed; build the mock data for QA. `scripts/team/workspace.mjs` then only does `git fetch && git checkout -B team/<slug> origin/dev` (seconds). The Stop hook in that environment is removed or guarded with `[ "$TEAM_CLOUD" = 1 ] && exit 0`.

## 11. Two lanes — throughput without more tokens per card

The orchestrator may run **two cards at once** when their `areas` are disjoint (frontend vs backend, or two different games with no shared-component edits in the plan). Each lane is a git worktree (worktrees work on the Linux clone too; the single-branch cloud mode was a convenience, not a constraint). `node_modules` is shared via a symlink from the clone. Gate-2 QA uses lane-specific ports (5273/8100 and 5274/8101). Ship is serialized through the existing fast-forward rebase. Lanes are capped at 2; a card whose plan touches a shared component runs alone.

Per-tier budgets replace the flat 72-minute rule: a card is started only if `remaining ≥ budget(tier)` (trivial 10, standard 25, hard 45 min). The orchestrator stops starting cards when nothing fits.

## 12. Expected result

| | Today | v2 (estimate) |
|---|---|---|
| Standard UI card | 60–80 min, ~1M tokens | **15–25 min, ~350–500k** |
| Hard card | 90–110 min, ~1.3M | **35–45 min, ~700–800k** |
| Cards per 90-min run | 1–2 | **4–6** (two lanes, mixed tiers) |
| Where the time goes | QA 40, design 17, re-reads, fix respawns | build + one capped review |

The schedules stay at 00:00/08:00 UTC. If the queue regularly exceeds ~8 cards, the cheapest extra throughput is a third run (`0 0,8,16 * * *`) — a one-line RemoteTrigger change, owner decision.

## 13. Optional accelerator: the Workflow tool

When the orchestrator runs where the `Workflow` tool exists, `brief` → `build` → `verify` for two disjoint cards can be expressed as a `pipeline()` with `schema` on each agent, which keeps intermediate results out of the orchestrator's context and lets identical-prefix agents share cache. It is not required: the v2 skill works with plain Agent/SendMessage calls, which is what the routine is known to support. Revisit after one measured run.

## 14. Rollout (what to build, in order of savings per hour of work)

**Phase A — settings and scope (half a day, saves ~30 min/card):**
A1 cloud setup script with cached Chromium/deps/SQLite; A2 remove/guard the Stop hook in the routine env; A3 `subagentPromptCacheTtl: 1h`; A4 brief-copies-steps rule + set the 10 detailed cards to `standard`; A5 reviewer reads `verify.json`, never re-runs checks; A6 motion-reviewer trigger narrowed to motion code.

**Phase B — scripts and the loop (2–3 days, saves ~30 min/card and half the tokens):**
B1 `scripts/team/{intake,brief,verify,qa,review-package,ship}.mjs`; B2 `.claude/team/qa-map.json`; B3 team-run v2 skill: thin orchestrator, resume-based fix loop, circuit breaker, per-tier budgets; B4 design-round v2 (hard only, one pass); B5 journal written by scripts (`.team/run/<slug>/state.json`).

**Phase C — lanes (1 day, doubles cards per run):** C1 worktrees in cloud with shared `node_modules`; C2 disjointness check from the plan's file list; C3 lane ports.

Each phase ships as its own card and is measured on one routine run before the next starts (time per stage and tokens per spawn from the run log — the same evidence table as §1).

## 15. Owner decisions needed

1. Approve the direction (deterministic edges, brief, resume loop, scoped QA, hard-only design round).
2. Phase A now, B and C as cards for the pipeline itself — or all three as cards.
3. A third daily run (`0 0,8,16 * * *`) — yes/no (cost: one more routine session per day).
4. Lanes: cap at 2 (recommended) or stay serial.
5. Who edits the routine environment (setup script, network allowlist, Stop hook): it lives at claude.ai/code/routines, outside the repo — the owner, with the exact script provided.

## Sources
Official: code.claude.com/docs/en/{sub-agents, workflows, hooks-guide, hooks, routines, scheduled-tasks, prompt-caching, costs, best-practices, cloud-environments, agent-teams, skills}; anthropic.com/research/building-effective-agents; anthropic.com/engineering/effective-harnesses-for-long-running-agents.
Community (patterns borrowed, numbers treated as unverified): ghuntley.com/ralph; anthropics/claude-code plugins/ralph-wiggum; frankbria/ralph-claude-code (caps, circuit breaker); obra/superpowers (task briefs, resume-then-escalate review loop, diff-only reviewer, ledger); EveryInc/compound-engineering-plugin; Pimzino/claude-code-spec-workflow (context loaders); bmad-code-org/BMAD-METHOD (story files). Rejected: ruvnet/ruflo (claude-flow).
