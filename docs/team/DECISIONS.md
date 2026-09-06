# Team Decisions Log

Append-only. One entry per architectural/design decision made by the planner or a design round.
Format: `## YYYY-MM-DD — <title>` then Context / Decision / Consequences (2–3 lines each).

## 2026-08-29 — Native plan-and-self-review step for hard-task design rounds, not superpowers:writing-plans
Context: asked to have planner-architect use the `superpowers:brainstorming`/`writing-plans`
skills for complex tasks (write a plan, self-review it, hand it to the engine).
Decision: build the same rigor (numbered plan, self-review for coverage/placeholders/
consistency/scope/ambiguity) directly into `design-round`'s procedure instead of invoking those
skills. Two reasons: (1) `superpowers:brainstorming` hard-gates on human approval before any
implementation step — incompatible with an unattended pipeline run; (2) both skills are
machine-local plugins, not committed to this repo, so referencing them would silently no-op on
every cloud routine run (the pipeline's primary execution mode).
Consequences: the plan-and-self-review discipline now runs identically local or cloud, with no
external dependency. If those skills are ever made repo-portable and their approval gate made
optional for headless use, this can be revisited.

## 2026-09-06 — Model policy: cheap implementer, heavy planner and reviewer
Context: the owner wants token spend cut without losing quality. Previously `classify` sent
hard tasks to an opus or fable *engine*; sonnet/haiku only implemented easier tiers. Reviewer
and QA models were fixed by frontmatter/profile, so the `deep`/`max` profile could silently put
browser-qa on opus.
Decision: split the pick in two. `engineModel` is haiku (trivial) or sonnet (everything else,
hard included) — never opus/fable. `planModel` is opus (explicit spec) or fable (thin spec) and
drives the design round, the replan, and code-reviewer. Every design round now produces a
full implementation plan (previously hard-only), explicit enough that sonnet executes it
rather than reasoning it out. test-qa-engine and browser-qa are always sonnet; the CTO gate
is pinned to opus in the workflow (never fable). The orchestrator passes every model
explicitly. Revisits 2026-08-29: `superpowers:writing-plans` may be used for the plan when it
is present in the skill listing (local runs); the native a–c step remains the cloud fallback.
`superpowers:brainstorming` stays excluded — its human-approval gate is still incompatible
with unattended runs.
Consequences: opus/fable spend moves from implementation (the longest stage) to two short
stages (plan, review). Plan quality is now load-bearing for hard tasks — a thin plan will
show up as sonnet build failures and verify fix-cycles, which is the signal to fix the plan,
not to raise the engine model.
