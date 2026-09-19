---
name: ship
description: Commit the task, rebase on dev, fast-forward push to dev (no PR), update Notion. Final pipeline stage, run from the task worktree.
---

# Ship

Result contract: end with exactly one line — `SHIPPED <full sha>` or `SHIP-FAIL <one-line reason>`.
The orchestrator turns `SHIP-FAIL` into the fail procedure; never set Notion status here on failure.

## Pre-flight (SHIP-FAIL if any fails)
1. `git -C <worktree> status --porcelain` shows only intended files. **Never stage `__pycache__`/`*.pyc`.**
2. verify stage passed; QA verdict.json (if QA ran) has `"pass": true`; code review has no blocker/major left.

## Procedure
1. Commit (one commit, conventional): subject `<type>: <task title>`; body:

   Notion: <card url>
   Category: <card Category>

   ## Agent notes
   - agent: <frontend-engine|backend-engine>
     did: <≤20 words on what changed>
     assumed: <≤20 words, or "none">

   One `- agent:` bullet per engine that contributed (a fullstack task has two).
   Use `git commit -F <file>` so the body is verbatim.
2. `git -C <worktree> fetch origin dev`
3. `git -C <worktree> rebase origin/dev`. Conflict → `git rebase --abort` → `SHIP-FAIL rebase conflict with dev: <files>`.
4. If `origin/dev` advanced since the branch was cut (`git rev-list --count <old base>..origin/dev` > 0):
   re-run the static checks only — `npm run lint`, `npx tsc --noEmit`, `npm run build`, and
   `cd backend && .venv/<bin>/python manage.py test` when `backend/` changed. Any failure →
   `SHIP-FAIL post-rebase check failed: <which>`. Browser QA is not repeated.
5. Push fast-forward: `git -C <worktree> push origin HEAD:dev`. Rejected (non-fast-forward)
   → repeat steps 2–4 **once**; rejected again → `SHIP-FAIL dev moved twice during ship`.
   `--force` and `--force-with-lease` are forbidden.
6. `SHA=$(git -C <worktree> rev-parse HEAD)`.
7. Notion: `node scripts/notion.mjs ship-card <pageId> --commit <SHA> --branch team/<slug> --model "<model text>"`.
   Model text = `<engineModel> · <engineEffort>` (+ ` · plan <planModel>` if a design round ran;
   fullstack: `backend <m> · <e> / frontend <m> · <e>`).
8. Clean up: `git worktree remove <path> --force`; `git branch -D team/<slug>`;
   if the branch was ever pushed: `git push origin --delete team/<slug>`.
   **[CLOUD]** no worktree: `git checkout dev && git branch -D team/<slug>`.
9. Print `SHIPPED <SHA>`.
