---
name: ship
description: Commit the task, rebase on dev, fast-forward push to dev (no PR), update Notion. A check card with Target = main ships to main instead and back-merges main into dev. Final pipeline stage, run from the task worktree.
---

# Ship

Result contract: end with exactly one line — `SHIPPED <full sha>` or `SHIP-FAIL <one-line reason>`.
The orchestrator turns `SHIP-FAIL` into the fail procedure; never set Notion status here on failure.

## Pre-flight (SHIP-FAIL if any fails)
1. `git -C <worktree> status --porcelain` shows only intended files. **Never stage `__pycache__`/`*.pyc`.**
2. verify stage passed; QA verdict.json (if QA ran) has `"pass": true`; code review has no blocker/major left.

## Which path
Read `target` from `<repo>/.team/run/<slug>/card.json`. `"main"` (a check card, see docs/team/PIPELINE.md
§ "Check cards") → **Target = main** below. Anything else → the Procedure below, **unchanged**: rebase on
`origin/dev`, fast-forward push to `dev`.

## Procedure (Target = dev)
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

## Target = main (check cards only — the standing hotfix exception)
A checker finding is a bug in production, so its fix ships to `main` (production) and `main` is then
merged back into `dev` so `dev` stays a superset. The worktree was cut from `origin/main` (team-run §1),
so `<old base>` below is a `main` commit. A push to `main` deploys the frontend AND the backend Vercel
projects to production (both are git-connected, docs/DEPLOYMENT.md); the relay is never deployed here.
1. Commit — same as step 1 above.
2. `git -C <worktree> fetch origin main dev`
3. `git -C <worktree> rebase origin/main`. Conflict → `git rebase --abort` → `SHIP-FAIL rebase conflict with main: <files>`.
4. Post-rebase static checks — same rule as step 4 above, with `origin/main` in place of `origin/dev`.
5. `git -C <worktree> push origin HEAD:main`. Rejected → repeat steps 2–4 **once**; rejected again →
   `SHIP-FAIL main moved twice during ship`. `--force` / `--force-with-lease` are forbidden.
6. `SHA=$(git -C <worktree> rev-parse HEAD)`. From here on `main` is shipped: nothing below undoes it.
7. Back-merge `main → dev` (merge commit, auto-merged PR), in the worktree:
   ```
   git -C <worktree> fetch origin dev main
   git -C <worktree> checkout -B backmerge/<slug> origin/dev
   git -C <worktree> merge --no-ff origin/main -m "chore: back-merge main into dev (<slug>)"
   git -C <worktree> push -u origin backmerge/<slug>
   gh pr create --base dev --head backmerge/<slug> --title "chore: back-merge main into dev (<slug>)" --body "Back-merge after check card <card url> shipped <SHA> to main."
   gh pr merge backmerge/<slug> --merge --delete-branch
   ```
   (local: the active `gh` account must be `stefanroman22`, PIPELINE.md §8a.) **[CLOUD]** without a working
   `gh`: `git -C <worktree> push origin backmerge/<slug>:dev` (the same merge commit, fast-forward) and
   delete the branch with `git push origin --delete backmerge/<slug>`.
   **Merge conflict** → `git merge --abort`; leave `main` shipped; run step 8 anyway (it records the commit), then
   `node scripts/notion.mjs comment <pageId> "⚠️ shipped to main (<SHA7>) but the back-merge main→dev conflicted in <files> — merge main into dev by hand" --mention`
   and `node scripts/notion.mjs set-props <pageId> --needs-human`, clean up (step 9) and end with
   `SHIP-FAIL back-merge conflict: <files>`.
8. Notion: relay rule first — if `git -C <worktree> diff --name-only <old base>..<SHA>` lists any
   `multiplayer_server/` file, the relay (Railway, billed) still runs the old code: do NOT run `ship-card`
   (its QA status would let `main-sync` mark the card Done); instead
   `node scripts/notion.mjs set-props <pageId> --commit <SHA> --branch team/<slug> --needs-human`,
   `node scripts/notion.mjs set-status <pageId> "To Do"` and
   `node scripts/notion.mjs comment <pageId> "relay change — needs owner \`railway up\` (shipped to main <SHA7>; the relay still runs the old code). Mark Done after the deploy." --mention`.
   Otherwise `ship-card` exactly as step 7 above (`main-sync.yml` marks the card Done, the commit is on `main`).
9. Clean up — step 8 above, plus `git branch -D backmerge/<slug>` if it still exists locally.
10. Verify production as `promote-to-prod` steps 2–3 say (both deployments READY, swishquest.com and the API
    answer with real content). A broken production is fixed forward or rolled back per its step 4 — never
    left broken. Then print `SHIPPED <SHA>`.
