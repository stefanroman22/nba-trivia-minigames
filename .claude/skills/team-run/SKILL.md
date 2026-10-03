---
name: team-run
description: One queue-drain run of the autonomous team pipeline (v2) — scripts do intake/brief/verify/QA/review-package, agents do classify/plan/build/review, failures resume the same engine, up to two lanes. Invoked headless by scripts/team-run.ps1, npm run team, or the cloud routine.
---

# Team Run (v2)

You are the orchestrator. You never write product code. You call the `scripts/team/*.mjs` nodes,
spawn agents with **file pointers** (never pasted docs) and an **explicit model**, and relay
failures back to the engine that wrote the code. Notion only via `node scripts/notion.mjs`,
Slack only via `node scripts/slack.mjs`. Design: `docs/team/designs/2026-10-03-pipeline-v2-loop-architecture.md`.

## Environment
`TEAM_CLOUD` unset = local Windows (worktrees under `cfg.worktreeRoot`, tokens from `.env.team`).
`TEAM_CLOUD=1` = cloud routine, Linux: deps, Chromium, venv and the dev sqlite are pre-installed by
`infra/routine/setup.sh` — **install nothing**. Worktrees live next to the clone (`../wt-<slug>`).

## Model policy (every spawn names its model)
| Who | Model | When |
|---|---|---|
| classify (planner-architect) | `sonnet` | every card |
| plan writer (planner-architect) | `sonnet` | `standard` card whose brief says `needs-plan` |
| design round (planner-architect, `design-round` skill) | `fable` | `hard` only; one pass, 10 min |
| replan | plan's model (`sonnet` standard / `fable` hard) | after 2 failures at one gate, once |
| frontend-engine / backend-engine | `haiku` trivial · `sonnet` default · `opus` motion core, risk high, non-trivial P0, `[opus]` steps | build |
| escalation engine | one model up (`sonnet`→`opus`; `opus` stays `opus` + design doc) | fix round 3 |
| browser-qa | `sonnet` | only when the brief's QA assertions contain `"flow"` |
| code-reviewer | `reviewModel` printed by `review-package.mjs` (`sonnet`, or `fable` for P0/risk high/hard/protected paths) | review |
| motion-reviewer | `opus` | only when `review-package.mjs` prints `motion: true` |

## 0. Run start
1. Read `.claude/team/config.json` → cfg. Note the start time; `remaining = cfg.maxRunMinutes − elapsed`.
2. `node scripts/team/intake.mjs --remaining <remaining> [--running <slug,...>]` → `{paused?, picks, leftTodo}`.
   Exit 3 / `paused:true` → say "paused" and STOP. It already swept stale cards, ingested Slack
   reactions and wrote `.team/run/<slug>/card.json` per pick. `TEAM_ONLY=<pageId>` in the env restricts
   the queue to one card (smoke runs). `shipped = []`, `failed = []`.
3. Each pick is a lane (max 2; intake guarantees disjoint areas; a `hard` card is alone). You drive both
   lanes yourself, interleaving: start lane A's build, then lane B's, then poll. A pick with
   `resumed:true` restarts at its `state.stage`.
4. When a lane finishes (shipped or failed), call intake again with `--running <other slug>` and the
   new `remaining`; it returns the next fitting card or nothing. Stop when nothing fits.

## 1. Workspace (per card)
- `git fetch origin dev`; `baseSha = git rev-parse origin/dev`.
- Local: `git worktree add <cfg.worktreeRoot>\<slug> -b team/<slug> origin/dev`, then share deps:
  `cmd /c mklink /J <wt>\node_modules <repo>\node_modules` (and `<wt>\backend\.venv` → `<repo>\backend\.venv`
  if present). Never `npm ci` in a worktree.
- Cloud: `git worktree add ../wt-<slug> -b team/<slug> origin/dev && ln -s "$PWD/node_modules" ../wt-<slug>/node_modules && ln -s "$PWD/backend/.venv" ../wt-<slug>/backend/.venv`.
- Record `baseSha`, `worktree`, `lane` in `.team/run/<slug>/state.json` (merge, don't overwrite).
  All later node commands take `--repo <wt> --base <baseSha> --lane <n>`.

## 2. Card flow
**classify** → `Agent(model: sonnet, planner-architect)`: "Run the `classify` skill for the card in
`.team/run/<slug>/card.json` (spec, attachments and props are inside). Return ONLY the JSON." Save it
as `.team/run/<slug>/classify.json`. `node scripts/notion.mjs claim <id> --model "<engineModel> · <effort>"`.

**brief** → `node scripts/team/brief.mjs <slug> --repo <wt>` → `{hasPlan, needsPlan}`.
- `needsPlan` and tier `standard`: `Agent(model: sonnet, planner-architect)`: "Read `.team/run/<slug>/brief.md`.
  Replace the `## Plan` paragraph with 5–12 numbered steps, each naming its file(s) and a done-check, tag
  each `[sonnet]` or `[opus]` (opus = judgment or motion), and fill `## QA assertions`. Edit the brief in
  place; no code." Then re-read the brief's plan.
- tier `hard` (or classify says `needsDesignRound`): `Agent(model: fable, planner-architect)` with the
  `design-round` skill and the brief path → design doc path → `node scripts/team/brief.mjs <slug> --design <path> --repo <wt>`.

**build** → one `Agent` per area (frontend-engine / backend-engine), model per the table and the plan's
`[opus]/[sonnet]` tags (consecutive same-tag steps = one spawn, "implement steps N–M only"). Prompt:
"Worktree `<wt>` on branch `team/<slug>`; do not switch branches or commit. Read
`.team/run/<slug>/brief.md` first and work from it — the rules that apply are quoted there; do NOT read
the full constraint docs unless a quoted rule points you to a section. Read every attachment listed.
Implement the `## Plan` steps <N–M>. Reuse-first: duplicating a CODE_MAP entry is a review-reject. Do
not run lint/typecheck/build routinely. When done write `.team/run/<slug>/build-report.json`
`{did, assumed, touched[], testsAdded[]}` and reply with its contents." Two areas whose plan files are
disjoint → spawn both at once. **Keep every engine's agent id** in `state.engineAgentIds[area]`.

**gate 1 — verify** → `node scripts/team/verify.mjs <slug> --base <baseSha> --repo <wt>`. Exit 1 → fix round (§3).

**gate 2 — QA** → `node scripts/team/qa.mjs <slug> --base <baseSha> --lane <n> --repo <wt>`. Exit 1 → fix round.
If its output lists `flows`, spawn `Agent(model: sonnet, browser-qa)` with the brief path, the verdict path,
the lane and the flow text; it appends to the verdict. Fail → fix round. Browser unavailable → QA skipped, one log line.

**review** → `node scripts/team/review-package.mjs <slug> --base <baseSha> --repo <wt>` → `{reviewModel, motion}`.
Spawn `Agent(model: <reviewModel>, code-reviewer)` on `.team/run/<slug>/review-package.md`; if `motion`,
also `Agent(model: opus, motion-reviewer)` on the same file, in parallel. Any blocker/major → fix round;
minor/nit/missing → noted in the commit body.

**ship** → `ship` skill from the worktree. `SHIPPED <sha>` → `shipped.push({title, category})`, write
`.team/qa-<slug>.json` `{pageId, title, category, priority, model, effort, planModel|null, fixCycles, did, check, commit}`
(`check` = one line: navigate → action → expected result; `fixCycles` = sum of `state.fixRounds`),
`node scripts/slack.mjs post-qa-card .team/qa-<slug>.json` (non-fatal), then delete `.team/run/<slug>/`.
`SHIP-FAIL <reason>` → fail procedure.

## 3. Fix round (gate g ∈ verify|qa|review)
`state.fixRounds[g] += 1`. Then:
- **Round 1–2:** `SendMessage(to: state.engineAgentIds[area])` with ONLY the failure text (≤100 lines, from
  `verify.json.failures`, the verdict's `failures[]` + screenshot paths, or the reviewer's blocker/major
  items verbatim) and "Fix these in the same worktree, then rewrite build-report.json." Wait, re-run the gate.
- **Round 3:** new `Agent` one model up (`sonnet`→`opus`; `opus`→`opus` with the design doc attached),
  prompt = build prompt + "Previous attempts failed; findings so far: …". Replace the stored agent id.
- **Round 4 does not exist** → fail procedure (`stage: <g>`).
- **Breaker:** after any round, if `git -C <wt> status --porcelain` plus `git -C <wt> diff --stat <baseSha>`
  show no change since the previous round, or the gate's first failure line equals `state.lastFirstError`
  from the previous round → fail now with reason `no progress at <g>`.
- **Replan (once):** the same gate failing twice → `Agent(model: plan's model, planner-architect)` rewrites
  `## Plan` in the brief with the failure history; set `state.replanned=true`, reset `fixRounds[g]` to 0.
A review re-run after a fix uses `review-package.mjs … --since <sha before the fix>` so the reviewer sees
only the fix diff.

## 4. Fail procedure (any stage)
1. `.team/postmortem-<slug>.md`: what was tried / why it failed / suggested next step / last error (≤3 lines).
2. `node scripts/notion.mjs fail-card <id> --stage "<stage>" --reason "<one line>" --postmortem-file .team/postmortem-<slug>.md`
   → `{attempts, needsHuman, maxAttempts}`.
3. Append the post-mortem to `docs/team/RETRO.md` in the MAIN checkout, commit on dev `docs(team): retro for <slug>`,
   fetch/rebase/ff-push; if the push fails, leave it committed and log one line.
4. `.team/fail-<slug>.json` `{title, category, attempts, maxAttempts, model, effort, planModel|null, stage, reason, fixCycles, replanned, lastError, cardUrl, needsHuman}`
   → `node scripts/slack.mjs post-fail-card .team/fail-<slug>.json` (non-fatal). `failed.push({title, category, stage, attempts, maxAttempts, channel})`
   (`channel` = `frontend` for frontend/docs, else `backend`).
5. Remove the worktree (`git worktree remove <wt> --force`), delete `team/<slug>` locally (keep the remote
   branch only if it was pushed), delete `.team/run/<slug>/`.

## 5. End of run
`leftTodo` from the last intake. Write `.team/run-summary.json` `{start, end, shipped, failed, leftTodo}` and
`node scripts/slack.mjs post-run-summary .team/run-summary.json` — only if `shipped`/`failed` is non-empty or a
card was resumed. Log one line per card (shipped/failed/deferred).

## Hard rules
- NEVER run git in the main checkout except `fetch`, worktree add/remove, and the RETRO/DECISIONS doc commits.
- NEVER push to main. NEVER `--force`. Ship = fast-forward push to dev only. Only `main-sync.yml` sets Done.
- One card's failure never aborts the run. Budgets are per tier (trivial 10 / standard 25 / hard 45 min);
  intake enforces them — do not start a card intake did not return.
- NEVER take an action that implies the owner pays money (paid service, plan upgrade, billing, domain,
  add-on, anything beyond a free tier). Fail the card with a note naming the cost. Applies to every agent.
- Agents get paths, not pasted documents. If you catch yourself pasting a constraint doc into a prompt, stop.
