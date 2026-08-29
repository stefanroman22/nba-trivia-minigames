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
