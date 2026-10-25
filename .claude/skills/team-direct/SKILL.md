---
name: team-direct
description: Direct mode of the team pipeline — build → verify → review on the CURRENT branch from a run dir that scripts/team/direct.mjs prepared, no Notion, no Slack, no commit, no push. Invoked headless by scripts/security/run.mjs (the security gate's auto-fix on a PR branch). Argument: the run slug.
---

# Team Direct

You are the orchestrator of one card that did not come from Notion. Same rules as `team-run` (you never write product
code; scripts do the mechanical steps; every spawn names its model; failures go back to the engine that wrote the code),
minus everything around the card: **no intake, no Notion, no Slack, no worktree, no QA browser, no commit, no push.**
The caller commits and pushes what you leave in the working tree.

`<slug>` = your argument. `<repo>` = your cwd, which is the checkout of the branch being fixed (work there, never switch
branches). Run state: `<repo>/.team/run/<slug>/` — `card.json`, `classify.json`, `state.json` (`baseSha`, `branch`) and
`brief.md` are already written by `scripts/team/direct.mjs`. Read `state.json` for `<baseSha>`.

## Flow
1. **build** → one `Agent` per area in `classify.json` `areas` (`backend` → `backend-engine`, `frontend` →
   `frontend-engine`), model **opus** (risk high). Prompt: "Branch `<branch>` checked out at `<repo>`; edit files there
   only; do not switch branches, commit or push. Read `<repo>/.team/run/<slug>/brief.md` first and work from it — it is
   a security fix: the `## Plan` steps and the `## Findings` section in the spec are the task, each finding's exploit path
   must be closed at its root (validate/parameterise/scope the query, check the permission, read the secret from the
   environment — never a cosmetic change that only hides the pattern from a scanner). Add the test named under 'How to
   verify' when the area has a test suite. Do NOT add entries to `.security/ignore.json` or weaken any check. Do not run
   lint/typecheck/build routinely. When done write `<repo>/.team/run/<slug>/build-report.json`
   `{did, assumed, touched[], testsAdded[]}` and reply with its contents." Two areas → both at once. Keep each agent id.
2. **gate 1 — verify** → `node scripts/team/verify.mjs <slug> --base <baseSha> --repo <repo>`. Exit 1 → fix round.
3. **review** → `node scripts/team/review-package.mjs <slug> --base <baseSha> --repo <repo>`; spawn
   `Agent(model: fable, code-reviewer)` on `<repo>/.team/run/<slug>/review-package.md` with the extra line "Security
   fix: also confirm every finding in the brief's `## Findings` is actually closed, not just moved." Blocker/major →
   fix round; minor/nit → mention in your final line.
4. No QA stage: the security gate re-scans the branch after you finish, and that scan is the acceptance.

## Fix round (gate g ∈ verify|review)
Round 1–2: `SendMessage(to: <engine agent id>)` with ONLY the failure text (≤100 lines: `verify.json` failures or the
reviewer's blocker/major items verbatim) and "Fix these in the same checkout, then rewrite build-report.json." Re-run
the gate (a review re-run rebuilds the package with `--since <baseSha>`). There is no round 3 here: the caller already
limits the whole auto-fix to 2 rounds and escalates to a human. Breaker: no change in `git status --porcelain` since the
previous round, or verify prints `sameFirstError: true` → stop with `DIRECT-FAIL no progress at <g>`.

## Rules
- NEVER `git commit`, `git push`, `git checkout`/`switch`, `git stash`, or `--force` anything. Never call
  `scripts/notion.mjs` or `scripts/slack.mjs`.
- Install nothing; the caller prepared `node_modules` and `backend/.venv`.
- Money is a human decision: a fix that needs a paid service or plan → `DIRECT-FAIL needs a paid service: <what>`.

## Result contract
End with exactly one line: `DIRECT-DONE <≤20 words on what changed>` or `DIRECT-FAIL <one-line reason>`.
