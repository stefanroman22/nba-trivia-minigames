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
5. Commit the design doc: `docs(team): design for <slug>`.
