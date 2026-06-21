# Phase 6 — Hardening + activation runbook (final phase)

**Goal:** Close the loose ends from earlier phases and give the owner one place to activate the whole scalable architecture.

**Delivered (account-independent, verified):**
- **Graceful staleness** (`src/utils/pool.ts`): if the manifest can't be fetched, the game now serves the last cached pool (via a new `cachedPool(gameKey)` helper) instead of erroring — so a brief backend blip doesn't break play. (The Phase 3 deferred item.)
- **Lint scope fix** (`eslint.config.js`): `globalIgnores` now excludes `backend` (Python + its venv) and `multiplayer_server`, so `npm run lint` lints only the frontend. Previously it walked `backend/venv` and reported dozens of errors from bundled third-party JS, making the script unusable. Now `npm run lint` is **clean (exit 0)**.
- **Deployment runbook** (`docs/DEPLOYMENT.md`): one checklist consolidating every account (R2 / Supabase / Upstash), every env var per service (Django, multiplayer, frontend, home publish), the weekly refresh+publish workflow, a recommended activation order, and verification commands. Pointer added to the main `README.md`.

**Verification:** `npm run lint` clean; `npm run build` (tsc -b + vite) green; backend suite unaffected (no backend code changed).

**Out of scope (genuinely needs the live accounts or doesn't exist yet):**
- Real load test against the deployed stack; real R2/Postgres/Redis connection checks.
- Full multi-instance multiplayer matchmaking (move match state into Redis).
- The mobile app (not in this repo) — runbook documents pointing it at the same CDN pools + API.

## Plan complete
All six phases of `2026-06-21-nba-data-architecture-design.md` are implemented and merged:
P1 ingestion decoupling, P2 R2 publish, P3 client randomization, P4 settings+DB, P5 Redis+multiplayer, P6 hardening+runbook. Remaining work is account provisioning + the documented follow-ups, all captured in `docs/DEPLOYMENT.md`.
