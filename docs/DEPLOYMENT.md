# Deployment & Scaling Runbook

This is the single checklist to take the app from "works locally" to "scales to lots of
users." Everything below is **optional and incremental** — the app runs today with none of
it (sqlite, in-memory cache, static `/data/` pools, single multiplayer instance). Each step
"lights up" a piece of the scalable architecture by adding an account + a few env vars.

Design background: `docs/superpowers/specs/2026-06-21-nba-data-architecture-design.md`.

## Current live state

| Piece | Status | Where |
|---|---|---|
| Django API (auth, leaderboard, game data) | **LIVE** | Vercel serverless — `https://backend-kappa-one-42.vercel.app` |
| User database | **LIVE** | Supabase Postgres (migrated; signup/login/leaderboard verified) |
| Frontend + game content | **LIVE** | Vercel CDN (`/data/` pools) |
| Multiplayer ("Play Online") | **Not yet hosted** | needs a persistent Node host (see note) |

**Supabase connection (important):** the project's *direct* host `db.<ref>.supabase.co` is
**IPv6-only and unreachable from Vercel (IPv4)**. You must use the **session pooler**:
```
DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-1-eu-central-1.pooler.supabase.com:5432/postgres
```
(region `eu-central-1`, `aws-1` prefix, user `postgres.<ref>`). This URL is set on the backend
Vercel project; `vercel.json`'s `buildCommand` runs `migrate` on each deploy.

**Multiplayer note:** Vercel serverless functions are short-lived and can't hold the persistent
WebSocket connections / in-memory room state Socket.IO needs, so the multiplayer server in
`multiplayer_server/` must run on a small always-on Node host (Railway/Render/Fly). Once deployed,
set `VITE_SOCKET_URL` on the frontend (+ `API_BASE_URL`/`CORS_ORIGINS` on the host) and redeploy.

## The two lanes (why this scales)

- **Game content** — tiny (<1 MB), identical for everyone, changes weekly. Built off-cloud,
  served as static JSON. Scales to millions for ~$0.
- **User data** — accounts, points, leaderboard; per-user, changes constantly. The only part
  that needs a server + database + cache.

## Services

| Service | Runs on | Repo location |
|---|---|---|
| Frontend + game content | **Vercel** (serves the app *and* the game-data JSON at `/data/` from its CDN) | repo root `src/` |
| Django API | **Vercel** (serverless, Django auto-detected) | `backend/` |
| Multiplayer (Socket.IO) | small always-on Node host (Railway/Render/Fly — **not** Vercel) | `multiplayer_server/` |
| Data refresh | **Your home machine** (residential IP) | `backend/` management commands |

> The NBA blocks data-center IPs, so the data **refresh** must run from home. The cloud only
> ever serves pre-built data.

## One-time accounts (create as you need each phase)

1. **GitHub** — already done (repo pushed).
2. **Vercel** (Phase 2 — hosts the frontend, which also serves the game-data JSON from its CDN;
   the data ships with the build, so **no separate object store is needed**). Cloudflare R2 stays
   an optional alternative for a dedicated data domain — see the R2 note under "Home machine".
3. **Supabase Postgres** (Phase 4 — user DB).
4. **Upstash Redis** (Phase 5 — leaderboard + multiplayer scaling).

## Environment variables by service

### Django API (Vercel) — see `backend/.env.example`
```
DJANGO_SECRET_KEY=<long random secret>
DJANGO_DEBUG=False
DJANGO_ALLOWED_HOSTS=<your-backend>.vercel.app         # *.vercel.app + VERCEL_URL are auto-trusted
CORS_ALLOWED_ORIGINS=https://<your-frontend-domain>
CSRF_TRUSTED_ORIGINS=https://<your-frontend-domain>
DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-1-eu-central-1.pooler.supabase.com:5432/postgres   # MUST be the Supabase POOLER, not the IPv6 direct host (unset -> sqlite)
REDIS_URL=rediss://...                                       # Upstash (unset -> Postgres leaderboard)
CLIENT_ID=...            # Google OAuth (existing)
CLIENT_SECRET=...
```

### Multiplayer server (Render / Node host)
```
API_BASE_URL=https://backend-kappa-one-42.vercel.app # REQUIRED in prod (else it tries localhost)
CORS_ORIGINS=http://localhost:5173,https://<your-frontend-domain>
REDIS_URL=rediss://...                               # optional: enables the Socket.IO adapter
PORT=4000
```

### Frontend build (Vercel project env)
```
VITE_BACKEND_URL=https://backend-kappa-one-42.vercel.app/api
VITE_SOCKET_URL=https://<your-multiplayer-host>     # set once the Node host is deployed
# VITE_DATA_BASE is optional — defaults to /data (the build bundles the pools there).
# Set it only to serve pools from an external CDN/domain instead.
```

### Home machine (data refresh) — see `backend/trivia/data_pipeline/README.md`
No env vars needed for the default Vercel path — the data ships with the frontend build.

**Optional — only if you publish to Cloudflare R2 instead of Vercel static:**
```
R2_ACCOUNT_ID=...
R2_BUCKET=nba-minigames
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_PUBLIC_BASE_URL=https://data.<your-domain>        # the R2 bucket's custom domain
```

## Weekly data workflow (home machine)

```bash
cd backend
venv/Scripts/python.exe manage.py refresh_game_data   # fetch via nba_api (residential IP)
```
Then commit `backend/trivia/data/` and push. Vercel rebuilds the frontend, the build copies the
data into `/data/`, and the new version goes live on the CDN. Schedule weekly via Windows Task
Scheduler (`backend/scripts/refresh_game_data.ps1`).

_Optional (R2 alternative): `pip install -r requirements-publish.txt` then
`manage.py publish_game_data` to upload to R2 instead._

## Recommended activation order

1. **Now / no accounts:** app serves pools as static `/data/` files (bundled at build) + samples
   client-side; single multiplayer instance; sqlite; Postgres leaderboard. Fully working.
2. **CDN content (Phase 2 + 3):** deploy the frontend to **Vercel** — the build bundles the game
   data into `/data/` and `pool.ts` reads it from there, so content is served by Vercel's CDN
   automatically. No object store or extra account. (R2 stays an optional alternative via
   `publish_game_data` + `VITE_DATA_BASE`.)
3. **Harden prod (Phase 4) — DONE:** Supabase `DATABASE_URL` (pooler) + `DJANGO_*` / CORS vars are
   set on the Vercel backend project; `migrate` runs in the build. Auth + leaderboard verified live.
4. **Fix prod multiplayer (Phase 5a) — PENDING host:** deploy `multiplayer_server/` to an always-on
   Node host, then set `API_BASE_URL` + `CORS_ORIGINS` on it and `VITE_SOCKET_URL` on the frontend.
5. **Scale the leaderboard + realtime (Phase 5b):** set `REDIS_URL` (Upstash) on Django + the
   multiplayer host; run `manage.py sync_leaderboard` once to backfill.

## Verification

- Backend tests: `cd backend && venv/Scripts/python.exe manage.py test trivia users`
- Frontend: `npm run lint && npm run build`
- Multiplayer syntax: `node --check multiplayer_server/src/index.js`
- After setting prod env: `manage.py check --deploy` should report no security warnings.
- Load behavior: content reads hit the CDN/edge (≈unbounded); the origin only handles
  writes/leaderboard/auth, which scale with active engagement, not raw audience.

## Known follow-ups (documented in the phase plans under `docs/superpowers/plans/`)

- Real verification of R2 upload / Postgres connection / Redis requires the live accounts.
- Full multi-instance multiplayer matchmaking needs the in-memory match state moved into Redis.
- Mobile app: point it at the same CDN pools + API; not yet in this repo.
