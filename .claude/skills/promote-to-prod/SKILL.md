---
name: promote-to-prod
description: Runbook for promoting dev to main/production for nba-minigames — trigger the promote workflow, watch the frontend and backend Vercel deploys, verify production, fix forward or roll back. Use ONLY after the owner explicitly asks to promote/ship to production in the conversation; merging to dev is never itself a request to ship.
---

# Promote dev → main (production)

Precondition: the owner explicitly asked for promotion in this conversation ("promote this",
"ship it to prod", "push dev to main"), or already ran the "Promote dev to main" workflow
themselves. Without that, stop — see CLAUDE.md "Shipping".

Pre-flight:
- **One-off tasks, before-part.** Read `docs/team/NEXT_PROMOTION.md` now; run any "before promoting" command on its
  lines (e.g. the migrations diff `git fetch origin && git diff --name-only origin/main origin/dev -- '*/migrations/*.py'`)
  before triggering step 1, and keep the output for the report.
- **Legal version dates.** If the promotion carries a new terms/privacy version (`TERMS_VERSION` in
  `backend/users/consent.py` differs from production's), on the day the production frontend is promoted set
  `updated`/`updatedIso`/`changeNotice.effective` in `src/configurations/legal.ts`
  (+ the version in both `consent.py` and `legal.ts`) to that day; promote the backend + relay no earlier than
  `effective`, or record an owner waiver (docs/legal/OPEN_ITEMS.md).

1. Trigger it (`gh workflow run dev-ci.yml --ref dev`, then `gh run list --workflow dev-ci.yml` / `gh run
   watch <id>`) or confirm the owner already ran it. `main` deploys the frontend AND the backend
   Vercel projects. `--ref dev` makes dev's promote job (with the security gate) run.
2. Watch both production deployments to READY (Vercel MCP `list_deployments` / `get_deployment`,
   `get_deployment_build_logs` on failure). The backend build runs `manage.py migrate` — read it.
3. Verify production, not just the build: fetch https://swishquest.com and the routes
   you touched (real content, right status codes), hit the API for JSON (e.g.
   https://backend-kappa-one-42.vercel.app/api/get-users/), and run a browser pass when the UI changed.
4. Anything broken is yours to fix forward immediately — never leave production broken and just
   report it. If the fix will take more than a few minutes, roll back first (`vercel rollback`
   pins the domain until `vercel promote`; see docs/DEPLOYMENT.md).
5. **One-off tasks.** Once production is verified, run the unticked `- [ ]` tasks of `docs/team/NEXT_PROMOTION.md`
   in order, each with the command on its line, and report each task's result. Outcomes:
   - ran and its check passed: done, to be ticked (`- [x]`) when the file is committed (below);
   - ran and failed: stop and report; never skip a failed migration;
   - blocked (a precondition on its line is not met, e.g. a card has not landed) or marked "Owner-only": not a
     failure. Run nothing for it, leave it unticked, continue with the next task and list it in the report.
   Default is report-only: do not commit, push or open a PR (CLAUDE.md "Shipping"). Report which tasks ran, their
   results and what remains; ticking in the file is deferred until the owner asks. Only when the owner asked for it
   in this conversation: commit the ticked file with the results on a branch and open a PR to dev
   (`gh pr create --base dev`; merge only on their ask). When every task is ticked or handed to the owner in the
   report, reset the file to its title and header paragraph in that same commit.
