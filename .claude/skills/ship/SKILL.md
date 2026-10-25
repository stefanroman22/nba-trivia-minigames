---
name: ship
description: Commit the task, rebase on dev, fast-forward push to dev (no PR), update Notion. A check card with Target = main ships to main instead and back-merges main into dev (a relay change becomes an unmerged PR to main). Final pipeline stage, run from the task worktree.
---

# Ship

Result contract: end with exactly one line — `SHIPPED <full sha>`, `SHIPPED-PR <pr url>` (a Target = main
relay change, left as a PR for the owner) or `SHIP-FAIL <one-line reason>`.
The orchestrator turns `SHIP-FAIL` into the fail procedure (except `SHIP-FAIL back-merge failed: …`, after
which `main` is already shipped); never set Notion status here on failure.

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
Model text and `<pageId>` as in the Target = dev procedure.
1. Commit — same as step 1 above.
2. `git -C <worktree> fetch origin main dev`
3. `git -C <worktree> rebase origin/main`. Conflict → `git rebase --abort` → `SHIP-FAIL rebase conflict with main: <files>`.
4. Post-rebase static checks — same rule as step 4 above, with `origin/main` in place of `origin/dev`.
5. `SHA=$(git -C <worktree> rev-parse HEAD)`. **Relay rule:** if `git -C <worktree> diff --name-only <SHA>^..<SHA>`
   lists any `multiplayer_server/` file → **Relay PR** below; never push such a card to `main` yourself.
6. Notion, BEFORE the push: `node scripts/notion.mjs ship-card <pageId> --commit <SHA> --branch team/<slug> --target main --model "<model text>"`.
   Why first: `main-sync.yml` fires on the push to `main` and marks Done only the cards it finds in QA with a
   commit on `main`; a card moved to QA after the push would wait for the next push to `main`.
6b. Security gate — `main` accepts a commit only with the status `security/pr-scan` = success on it (a ruleset,
   docs/security/README.md): `git -C <worktree> push origin HEAD:refs/heads/security-gate/<slug>` (a stale remote one from
   an earlier attempt: `git push origin --delete security-gate/<slug>` first; never force), then
   `node scripts/security/wait-status.mjs <SHA>` (up to 60 min; security.yml scans the diff against `main`; no auto-fix
   on a gate branch). Exit 0 → step 7. Exit 1 → `git push origin --delete security-gate/<slug>` and
   `SHIP-FAIL security gate: <its output line>` (the gate already commented the findings on the card, so the next attempt
   has them). Exit 3 → the same with `SHIP-FAIL security gate timed out`.
7. `git -C <worktree> push origin HEAD:main`, then `git push origin --delete security-gate/<slug>`. Rejected (main moved)
   → repeat steps 2–5 **once**, re-run steps 6 and 6b with the new `<SHA>`, push again; rejected again →
   `SHIP-FAIL main moved twice during ship`.
   `--force` / `--force-with-lease` are forbidden. After a successful push `main` is shipped: nothing below
   undoes it, and a later failure never runs the fail procedure's `fail-card`.
8. Back-merge `main → dev` (merge commit, auto-merged PR), in the worktree:
   ```
   git -C <worktree> fetch origin dev main
   git -C <worktree> checkout -B backmerge/<slug> origin/dev
   git -C <worktree> merge --no-ff origin/main -m "chore: back-merge main into dev (<slug>)"
   git -C <worktree> push -u origin backmerge/<slug>
   gh pr create --base dev --head backmerge/<slug> --title "chore: back-merge main into dev (<slug>)" --body "Back-merge after check card <card url> shipped <SHA> to main."
   gh pr merge backmerge/<slug> --merge --delete-branch
   ```
   (local: the active `gh` account must be `stefanroman22`, PIPELINE.md §8a — `gh auth switch --user stefanroman22`.)
   **[CLOUD]** without a working `gh`: `git -C <worktree> push origin backmerge/<slug>:dev` (the same merge
   commit, fast-forward) and `git push origin --delete backmerge/<slug>`.
   **Any failure** (merge conflict, push rejected because `dev` moved, `gh pr create`/`merge` error, wrong gh
   account) → `git merge --abort` if a merge is in progress, `git push origin --delete backmerge/<slug>` if it
   was pushed, fix the gh account if that was it, and redo this step from the fetch **once**. Still failing →
   leave `main` shipped and:
   `node scripts/notion.mjs comment <pageId> "⚠️ shipped to main (<SHA7>) but the back-merge main→dev failed: <reason / conflicting files> — merge main into dev by hand" --mention`,
   `node scripts/notion.mjs set-props <pageId> --needs-human`, clean up (step 10), and end with
   `SHIP-FAIL back-merge failed: <reason>` (team-run records it without `fail-card`).
9. Production check — read-only and cloud-safe; never roll back, never fix forward here:
   - poll `gh api repos/stefanroman22/nba-trivia-minigames/commits/<SHA>/statuses --jq '.[] | "\(.context)|\(.state)"'`
     every 30 s, up to 15 min, until the newest state of both contexts `Vercel – nba-minigames` and
     `Vercel – backend` is `success` (`failure`/`error` → stop polling: a failure);
   - then `curl -fsS https://swishquest.com/ -o /dev/null` and `curl -fsS https://backend-kappa-one-42.vercel.app/api/health/`.
   Any failure or timeout → `node scripts/notion.mjs set-props <pageId> --needs-human`,
   `node scripts/notion.mjs comment <pageId> "⚠️ <SHA7> is on main but production did not check out: <what failed> — please look" --mention`,
   `node scripts/slack.mjs post-text general "⚠️ production check failed after shipping <SHA7> to main (<card title>): <what failed>"`
   (non-fatal), and still finish with `SHIPPED <SHA>` after the line `NOTE production check failed: <what failed>`.
10. Clean up — step 8 of the Target = dev procedure, plus `git branch -D backmerge/<slug>` if it still exists.
11. Print `SHIPPED <SHA>`.

### Relay PR (a fix that touches `multiplayer_server/`)
The relay runs on Railway (billed) and a relay change reaches production only through the owner's merge: such a
card ships as an **unmerged PR to `main`**. Merging it deploys the relay by itself (`.github/workflows/relay-deploy.yml`:
after the production frontend of the commit, then `railway up`, a /health check and a report on the card).
1. `git -C <worktree> push -u origin HEAD:team/<slug>` (a stale remote `team/<slug>` from an earlier attempt:
   `git push origin --delete team/<slug>` first; never force).
2. `gh pr create --base main --head team/<slug> --title "<type>: <task title>" --body "Check card: <card url>
   relay change: merge this PR with a merge commit (not squash/rebase); the merge deploys the relay by itself (relay-deploy.yml). A squash or rebase rewrites the SHA: then set the card Done by hand."` → `<url>`.
   Do NOT merge it. **[CLOUD]** without a working `gh`: skip the PR, keep the same bookkeeping (step 3: `ship-card ... --target main --branch team/<slug>`, no `--pr`, then `set-props --needs-human`) plus a card comment "open the PR to main by hand (merge commit); the merge deploys the relay", and end with `SHIPPED-PR <branch>` instead of `<url>`.
3. `node scripts/notion.mjs ship-card <pageId> --commit <SHA> --branch team/<slug> --target main --pr <url> --model "<model text>"`
   (status QA with the PR's head SHA: `main-sync` marks the card Done once the owner merges the PR; its
   comment says "merge with a merge commit, not squash/rebase; the merge deploys the relay; do not untick Needs human" — a
   squash or rebase rewrites the SHA and the card must then be set Done by hand), then
   `node scripts/notion.mjs set-props <pageId> --needs-human`.
4. Clean up the worktree and the local branch; keep the remote `team/<slug>` (the PR needs it). No back-merge:
   the owner's merge to `main` reaches `dev` with the next back-merge or promotion.
5. Print `SHIPPED-PR <url>`.
