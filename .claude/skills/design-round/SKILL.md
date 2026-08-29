---
name: design-round
description: Written design round for multi-area or hard tasks — proposals, merge, sign-off — before any code. Run by planner-architect.
---

# Design Round

The "meeting" is an artifact. No code until sign-off.

## Procedure
1. For each involved area, dispatch that engine agent with: the task spec, classify JSON,
   relevant constraint docs, CODE_MAP hits. Ask for a proposal, ≤300 words:
   interface/contract it will expose or consume, data shapes, files it will touch, risks.
2. Merge the proposals into ONE design doc: `docs/team/designs/YYYY-MM-DD-<slug>.md` with
   sections: Decision summary / Interfaces (exact names+types) / File plan / Risks / Test plan.
   Where proposals conflict, planner decides and records the decision + reason.
3. One sign-off pass: send the merged doc back to each involved engine — "objection or OK?"
   Fold objections in once. Persistent conflict = planner decides, logs to
   `docs/team/DECISIONS.md`.
4. Hard tasks with unresolved conflicts after step 3: STOP — park the task with status
   Blocked and post-mortem "design deadlock" (v1 has no live agent-team escalation; that is
   Stage 3).
5. **If `classify.difficulty == "hard"`** (a genuinely complex task, not merely multi-area),
   turn the signed-off design into a real implementation plan before handoff — the same
   depth as writing a plan for a human engineer, self-reviewed before anyone builds from it:
   a. Break the work into numbered steps, each naming the exact file(s) it touches and what
      "done" looks like for that step (a test to run, a command to pass, a behavior to check).
      No step may say "handle edge cases" or "add appropriate error handling" without saying
      which edge cases and what the handling actually is.
   b. Self-review the plan against the spec, in this order, fixing anything you find before
      moving on: (i) **coverage** — every requirement in the task's spec maps to a step;
      (ii) **no placeholders** — no TBD/TODO, no step that describes intent without the
      concrete detail to act on it; (iii) **consistency** — a name, type, or file path used in
      one step matches how a later step refers to it; (iv) **scope** — nothing is planned that
      the spec didn't ask for; (v) **ambiguity** — anywhere the spec could be read two ways,
      the plan picks one reading explicitly rather than leaving it for the engine to guess.
   c. Append the reviewed plan to the same design doc under `## Implementation plan`, then hand
      it to the build stage — the engine implements the plan, it does not re-derive one.
   This step is native to this pipeline (always available, local or cloud) rather than a
   dependency on any optional planning skill — see `docs/team/DECISIONS.md` 2026-08-29 for why.
6. Commit the design doc: `docs(team): design for <slug>`.
