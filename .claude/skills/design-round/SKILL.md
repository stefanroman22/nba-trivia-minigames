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
5. **Every design round** — turn the signed-off design into a real implementation plan before
   handoff, the same depth as writing a plan for a human engineer, self-reviewed before anyone
   builds from it. This is not optional and not only for `hard`: the build stage runs on
   sonnet (`classify.engineModel`) and executes the plan rather than reasoning it out, so
   anything the plan leaves implicit is exactly what the engine will get wrong. You are the
   heavy model here (fable) — spend the thinking now.
   If `superpowers:writing-plans` is in your skill listing (local runs only — it is a
   machine-local plugin, absent on cloud routines), load it and write the plan with it at the
   depth it prescribes. Never `superpowers:brainstorming`: it gates on human approval, which an
   unattended run cannot give. Otherwise follow a–c. Either way the plan must pass b.
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
   d. Finalize the engine now that the plan exists — classify's `engineModel` was provisional.
      `sonnet` if the steps are many and each carries an explicit done-check (long-and-explicit);
      `fable` if the plan is short (roughly ≤5 steps) and the steps need judgment the plan cannot
      fully pin down (short-and-hard). Long-and-vague means the plan failed b — fix the plan, do
      not upgrade the engine. Never opus. Write it as `Engine: sonnet|fable` in the design doc's
      Decision summary and echo it in your final reply; the build stage uses it over classify's pick.
   The a–c procedure is native to this pipeline so the discipline holds on cloud runs where
   no planning skill exists — see `docs/team/DECISIONS.md` 2026-08-29 and 2026-09-06.
6. Commit the design doc: `docs(team): design for <slug>`.
