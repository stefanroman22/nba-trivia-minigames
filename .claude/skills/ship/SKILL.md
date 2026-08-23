---
name: ship
description: Commit, push, open the PR to dev, update Notion. Final pipeline stage, run from the task worktree.
---

# Ship

## Pre-flight (abort ship if any fails)
1. Working tree in the WORKTREE is clean except intended changes; `git -C <worktree> status`.
2. verify stage passed; QA verdict.json (if QA ran) has `"pass": true`.

## Procedure
1. Commit (conventional): `<type>: <task title>` + body line `Notion: <card url>`.
2. Push: `git push -u origin team/<slug>`.
3. PR: `gh pr create --base dev --head team/<slug> --title "<type>: <task title>" --body <file>`.
   Body template (exact — claude.yml greps Notion-Task):

   ## Summary
   <what changed, 3–6 lines>

   ## Test evidence
   - lint/tsc/build: pass
   - Django tests: pass|n/a
   - Browser QA: pass|skipped (<link to .claude/team/qa/<slug>/ evidence if run>)

   Notion-Task: <pageId>
   Design-Doc: <docs/team/designs/... or "none">
   Risk: <low|medium|high>

   ## Agent notes
   - agent: <frontend-engine|backend-engine>
     did: <≤20 words on what changed>
     assumed: <≤20 words on any assumption, or "none">

   Emit one `- agent:` bullet per engine that contributed (a frontend+backend task has two). The orchestrator fills `did`/`assumed` from each engine's build report.

4. Notion: `node scripts/notion.mjs set-props <pageId> --branch team/<slug> --pr <prUrl>`
   then `set-status <pageId> "In Review"` then
   `comment <pageId> "PR ready for CTO review: <prUrl>" --mention`.
5. Remove the worktree: `git worktree remove <path> --force` (branch stays pushed).
