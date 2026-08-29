# Three-Environment Strategy (local / dev / production) — Design Spec

**Date:** 2026-08-29
**Status:** Approved design, pending implementation plan
**Repo:** nba-minigames
**Owner:** Stefan

## 1. Goal

Make `npm run dev` always produce a working app: when the local Django backend or the local
Socket.IO server isn't running, the local frontend automatically falls back to the deployed
service instead of failing. Define what `local`, `dev` and `production` each mean, keep every
endpoint working in all three, and add no Supabase cost.

## 2. Decisions taken (with the user)

1. **Dev data lives locally.** No second Supabase project. Local/dev use the existing sqlite
   default (optionally local Postgres for parity); production keeps its Supabase project.
   Cost: unchanged. No free-tier project can auto-pause on us.
2. **Fallback target is production.** When a local service is down, the local frontend points at
   the deployed production backend/socket.
3. **The deployed dev-branch frontend uses the production backend.** There is no separate
   deployed dev backend, because a deployed backend needs a hosted DB and that reintroduces the
   cost/pause problem decision 1 avoids. "Isolated backend work" happens locally.
4. **Safety = loud warning, no blocking.** Local writes may reach production data; the design
   makes that impossible to miss but never blocks it.
5. **Approach A**: a pre-`dev` probe script writes a gitignored `.env.local`. No app code
   participates in choosing URLs.

## 3. Environment matrix

| | Frontend | Backend | Socket | Database |
|---|---|---|---|---|
| **local** | Vite `:5173` | local `:8000`, else **prod fallback** | local `:4000`, else **prod fallback** | sqlite (default) or local Postgres |
| **dev** | dev-branch Vercel URL | production backend | production socket | production Supabase |
| **production** | `nba-minigames.vercel.app` | `backend-kappa-one-42.vercel.app/api` | production socket | production Supabase |

`dev` and `production` differ only in which frontend build is served — deliberately, per decision 3.

## 4. Blocking prerequisites (verified, not assumed)

Both were confirmed empirically while designing this; neither is optional.

### 4.1 Production CORS rejects localhost — MUST be fixed for any fallback to work
A request to the production backend with `Origin: http://localhost:5173` returns **no**
`Access-Control-Allow-Origin` header, while the same request with the production frontend origin
returns one. `settings.py` defaults include localhost, but production sets
`CORS_ALLOWED_ORIGINS` via env, which *replaces* the defaults.

**Fix:** add `http://localhost:5173` (and `http://127.0.0.1:5173`) to the backend Vercel
project's `CORS_ALLOWED_ORIGINS` **and** `CSRF_TRUSTED_ORIGINS` env vars, then redeploy.

**Tradeoff, stated explicitly:** this permanently allows any page served from localhost to call
the production API with credentials. The backend exposes game data and per-user score endpoints,
no admin surface. Judged acceptable; it is a real loosening of production and **requires the
owner's explicit approval before it is applied** — no implementation step may change production
env vars without that yes.

### 4.2 The production multiplayer server does not exist
`VITE_SOCKET_URL` in `.env.production` is
`https://nba-multiplayer-production.up.railway.app`, which returns Railway's
`{"status":"error","code":404,"message":"Application not found"}` — the app is gone, not
cold-starting. Consequences:
- **Multiplayer is currently broken in production** ("Play Online" / "Play with a friend").
  This is a pre-existing defect surfaced by this work, not caused by it.
- There is therefore **nothing to fall back to** for the socket.

**This spec now fixes it** — redeploying the multiplayer server to Railway is in scope (§5.7),
added at the owner's request so the end state has working production multiplayer. Until that
deploy lands, §5.3 governs the socket's behaviour.

## 5. Design

### 5.1 Env-file layering
Vite loads `.env`, `.env.local`, `.env.${mode}`, `.env.${mode}.local` and merges them with
**later winning** — so `.env.local` only beats `.env` because nothing later exists today.
`.env.production` outranks `.env.local` in a production build, which is what makes E0/E1 safe:
a stray `.env.local` can never override a deployed build. The same rule cuts the other way for
local dev, though: **if anyone ever adds a `.env.development` file, it will silently outrank the
probe's `.env.local` and the whole fallback stops working with no error anywhere.**

| File | Committed? | Role |
|---|---|---|
| `.env` | yes | shared defaults |
| `.env.local` | **no — gitignored** | written by the probe; wins locally |
| `.env.production` | yes | every Vercel build (dev branch and prod) |

No app code reads anything new: `src/configurations/backend.tsx` and `src/socket.ts` continue to
read `VITE_BACKEND_URL` / `VITE_SOCKET_URL` unchanged.

### 5.2 The probe (`scripts/dev-env.mjs`)
Runs as npm `predev`, so plain `npm run dev` keeps working.

1. TCP-connect (not HTTP) to `localhost:8000` and `localhost:4000`, 300 ms timeout each — fast
   and immune to a service returning 404 on `/`.
2. Resolve each service independently:
   - backend up → `http://localhost:8000/api`; down → the production backend URL
   - socket up → `http://localhost:4000`; down → the remote socket fallback, which is governed by
     a single explicit constant in the script, `REMOTE_SOCKET_URL` (§5.3) — currently `null`
3. Write `.env.local` with the two resolved vars plus `VITE_ENV_SOURCE_BACKEND` /
   `VITE_ENV_SOURCE_SOCKET` set to `local` or `remote` (the badge in §5.4 reads these).
4. Print a banner naming each service's mode, with a `⚠ PRODUCTION DATA` marker on any remote one.

Per-service resolution is required, not incidental: running the backend locally while the socket
falls back (or vice versa) must work.

**Idempotence:** the file is rewritten on every `npm run dev`; it is never read as input, so a
stale value cannot survive a run. Because it is gitignored it can never reach a Vercel build.

### 5.3 Socket handling given §4.2
The script declares one constant:

```js
// null until a production multiplayer server exists again (see spec §4.2).
const REMOTE_SOCKET_URL = null;
```

The probe never network-probes this URL — a dead host would only add latency to every
`npm run dev`. The rule is purely declarative:

- local `:4000` up → `VITE_SOCKET_URL=http://localhost:4000`
- local down, `REMOTE_SOCKET_URL` is `null` → write **no** `VITE_SOCKET_URL` (leaving
  `src/socket.ts`'s existing `http://localhost:4000` default) and print
  `socket : UNAVAILABLE — no local server and none deployed; multiplayer disabled this session`
- local down, `REMOTE_SOCKET_URL` set → use it and mark the service `remote`

Single-player is unaffected either way — it needs only the Django API.

When a production socket is redeployed, the only change is setting that constant (and
`VITE_SOCKET_URL` in `.env.production` for deployed builds). No other code moves.

### 5.4 The `PROD DATA` badge
A small fixed-corner badge, rendered **only** when `import.meta.env.DEV` is true and
`VITE_ENV_SOURCE_BACKEND === "remote"`. Dev-only by construction — the condition is statically
false in a production build, so it cannot ship. Purely visual; it blocks nothing (decision 4).

### 5.5 Production multiplayer server (Railway)
Socket.IO needs a persistent process holding long-lived connections, so Vercel serverless — where
the frontend and Django backend live — cannot host it. It goes on **Railway** (~$5/month Hobby),
chosen over Render's free tier because Render free sleeps after 15 minutes and takes ~1 minute to
wake, which a player clicking "Play Online" would feel, and because Render's own docs say not to
use free instances for production.

The repo is already deploy-ready for Railway: `multiplayer_server/Procfile`
(`web: node src/index.js`), `.railwayignore`, and `engines.node >= 18` all exist from the previous
deployment. **No application code changes are required.**

Configuration on the Railway service:

| Var | Value |
|---|---|
| `API_BASE_URL` | `https://backend-kappa-one-42.vercel.app` (Django backend) |
| `CORS_ORIGINS` | production frontend origin, the dev-branch Vercel origin, and `http://localhost:5173` |
| `PORT` | injected by Railway — do not set |
| `REDIS_URL` | **unset** — the Redis adapter is optional and only needed for multi-instance broadcasting; one instance needs none, and omitting it avoids a paid Redis add-on |

Root directory must be set to `multiplayer_server/` so Railway builds the server, not the repo root.

**This step is owner-gated**: it requires their Railway account, billing, and dashboard access.
The implementation prepares config and verification; the owner performs the deploy and supplies
the resulting URL.

Once the URL exists, three places consume it — and nothing else:
1. `REMOTE_SOCKET_URL` in `scripts/dev-env.mjs` (§5.3), enabling the socket fallback
2. `VITE_SOCKET_URL` in `.env.production` (deployed frontends)
3. `CORS_ORIGINS` on the Railway service (above)

**Verification** (all three must pass before the task is complete):
- `curl "<url>/socket.io/?EIO=4&transport=polling"` returns a Socket.IO handshake payload
  (currently this returns Railway's `Application not found`)
- The deployed production frontend can open a multiplayer room
- `npm run dev` with local `:4000` down reports `socket : REMOTE` rather than `UNAVAILABLE`

### 5.6 Local Postgres (optional, parity only)
A `docker-compose.yml` providing Postgres 16 on `:5432`, plus a documented
`DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres` line for `backend/.env`.
sqlite remains the default and nothing requires Docker; this exists for when a task touches
models or migrations and sqlite's looser typing could mask a real Postgres error.

### 5.7 Backend CORS for local frontends
`settings.py` already defaults to allowing `localhost:5173`, so a **local** backend accepts a
local frontend today. No code change; only the production env vars of §4.1.

## 6. What this does NOT change

Production data flow, the Supabase project, the pipeline, the dev-branch Vercel deployment, and
every existing endpoint contract. `src/configurations/backend.tsx`, `src/socket.ts` and
`src/utils/pool.ts` keep their current logic.

## 7. Build order

| Stage | Deliverable | Exit criterion |
|---|---|---|
| E0 | `scripts/dev-env.mjs` + `predev` wiring + `.gitignore` entry | `npm run dev` with backend down writes `.env.local` pointing at prod and prints the banner |
| E1 | `PROD DATA` badge | Badge visible in fallback mode, absent when local, absent from `npm run build` output |
| E2 | **Owner-gated:** production CORS/CSRF env vars (§4.1) + redeploy | Local frontend fetches real data from the production backend without a CORS error |
| E3 | **Owner-gated:** Railway multiplayer deploy (§5.5), then wire the URL into the three consumers | All three §5.5 verification checks pass — handshake responds, a room opens on the deployed frontend, and the probe reports `socket : REMOTE` |
| E4 | `docker-compose.yml` + docs (`DEPLOYMENT.md`, `CLAUDE.md`) | `docker compose up` serves Postgres; documented switch works |

The two owner-gated stages (E2, E3) both change production and both need money or dashboard
access the implementation cannot supply. Everything else is fully automatable, and E0/E1 deliver
a working fallback on their own — E3 only upgrades the socket from `UNAVAILABLE` to `REMOTE`.

## 8. Out of scope

A second Supabase project, a deployed dev backend, write-blocking, and test-data tagging
(decisions 1–4 exclude them). Redis for the multiplayer server — the adapter is optional and a
single instance does not need it (§5.5).
