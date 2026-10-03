---
name: design-round
description: One-pass written design for a hard card (security, protocol, data regeneration, new patterns, owner Difficulty=hard) — decision, interfaces, file plan, risks, test plan, and a step-by-step implementation plan with per-step model tags. Run by planner-architect on fable. Not used for standard cards.
---

# Design Round (v2 — one pass, hard cards only)

The meeting is an artifact; no code until the plan exists. You are the heavy model here: spend the
thinking on the plan, not on ceremony. v1's "proposals from each engine" and "sign-off pass" are gone —
in a headless run there was no second party, the planner wrote both sides itself (log evidence,
2026-10-03). Budget: **10 minutes**, one document.

## Input
The brief at the absolute path the orchestrator gives you (`<repo>/.team/run/<slug>/brief.md`: spec,
attachments, classify JSON, the rules that apply, CODE_MAP hits, files named). Read it first. Open a
constraint doc only where a quoted rule points you to a section. Read `docs/team/RETRO.md` and the last
60 lines of `docs/team/DECISIONS.md` for prior calls on similar work.

## Output: `<wt>/docs/team/designs/YYYY-MM-DD-<slug>.md` — inside the task worktree, never the main checkout
1. **Decision summary** — the chosen approach in ≤10 lines; `Engine: opus|sonnet|mixed`.
2. **Interfaces** — exact names and types (endpoints, events, props, table columns, env vars).
3. **File plan** — every file touched or created, one line each.
4. **Risks** — what can break, how the plan prevents it.
5. **Test plan** — the commands gate 1 runs, the QA assertions gate 2 runs (as the brief's
   `{route, selector, expect}` triples, or `{"flow": "..."}` for multi-step checks), and any new tests
   the engine must add.
6. **`## Implementation plan`** — numbered steps, each naming its file(s) and what "done" looks like
   (a test to run, a command to pass, a behavior to check). No "handle edge cases" without naming
   them. Tag every step `[opus]` (judgment the plan cannot pin down, security logic, motion) or
   `[sonnet]` (explicit, with a clear done-check). Long-and-vague means the plan failed — fix the plan,
   do not upgrade the engine.

Self-review before saving, in order: coverage (every spec requirement maps to a step) · no
placeholders · consistency of names/paths across steps · scope (nothing the spec did not ask for) ·
ambiguity (where the spec can be read two ways, the plan picks one and says so).

## Finish
- Copy the Test plan's QA triples into the brief's `## QA assertions` JSON block (the brief is regenerated
  with `--design` afterwards and keeps that block).
- Append a short entry to `<wt>/docs/team/DECISIONS.md` only for a genuine judgment call (two defensible
  options, why one won). Commit both files inside `<wt>` on the task branch: `docs(team): design for <slug>`.
- Reply with the design doc path, `Engine: …`, and the step list with tags. If the spec is contradictory
  beyond repair, reply `DESIGN-DEADLOCK: <reason>` instead (the orchestrator fails the card).
