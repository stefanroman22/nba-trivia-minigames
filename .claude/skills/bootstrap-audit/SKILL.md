---
name: bootstrap-audit
description: Regenerate the codebase-derived knowledge base — per-area constraint docs, CODE_MAP, and agent instruction refresh. Run when docs have drifted or after major refactors.
---

# Bootstrap Audit

Regenerates: `docs/constraints/*.md`, `docs/team/CODE_MAP.md`, and flags stale agent instructions.

## Procedure

1. Dispatch one audit subagent per area with the briefs recorded in
   `docs/superpowers/plans/2026-08-15-autonomous-team-stages-0-2.md` Tasks 2–5
   (they are the canonical audit briefs — reuse them verbatim, updating file lists
   to match the current tree first via `ls`/`glob`).
2. Each audit REPLACES its doc wholesale (append-only history lives in git).
3. Verify every doc: rule-count floors (UI≥10, BE≥10, MP≥8, AUTH≥6), all cited paths exist,
   every rule has a ❌/✅ pair.
4. Diff new docs vs old; if any rule that an agent .md file cites verbatim changed,
   update that agent file in the same commit.
5. Commit as `docs(team): refresh knowledge base via bootstrap-audit`.
