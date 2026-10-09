---
name: promote-to-prod
description: Runbook for promoting dev to main/production for nba-minigames — trigger the promote workflow, watch the frontend and backend Vercel deploys, verify production, fix forward or roll back. Use ONLY after the owner explicitly asks to promote/ship to production in the conversation; merging to dev is never itself a request to ship.
---

# Promote dev → main (production)

Precondition: the owner explicitly asked for promotion in this conversation ("promote this",
"ship it to prod", "push dev to main"), or already ran the "Promote dev to main" workflow
themselves. Without that, stop — see CLAUDE.md "Shipping".

1. Trigger it (`gh workflow run dev-ci.yml`, then `gh run list --workflow dev-ci.yml` / `gh run
   watch <id>`) or confirm the owner already ran it. `main` deploys the frontend AND the backend
   Vercel projects.
2. Watch both production deployments to READY (Vercel MCP `list_deployments` / `get_deployment`,
   `get_deployment_build_logs` on failure). The backend build runs `manage.py migrate` — read it.
3. Verify production, not just the build: fetch https://swishquest.com and the routes
   you touched (real content, right status codes), hit the API for JSON (e.g.
   https://backend-kappa-one-42.vercel.app/api/get-users/), and run a browser pass when the UI changed.
4. Anything broken is yours to fix forward immediately — never leave production broken and just
   report it. If the fix will take more than a few minutes, roll back first (`vercel rollback`
   pins the domain until `vercel promote`; see docs/DEPLOYMENT.md).
