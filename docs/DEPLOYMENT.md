# Deployment & Scaling Runbook

This is the single checklist to take the app from "works locally" to "scales to lots of
users." Everything below is **optional and incremental** — the app runs today with none of
it (sqlite, in-memory cache, Django-served pools, single multiplayer instance). Each step
"lights up" a piece of the scalable architecture by adding an account + a few env vars.

Design background: `docs/superpowers/specs/2026-06-21-nba-data-architecture-design.md`.

## The two lanes (why this scales)

- **Game content** — tiny (<1 MB), identical for everyone, changes weekly. Built off-cloud,
  served as static JSON. Scales to millions for ~$0.
- **User data** — accounts, points, leaderboard; per-user, changes constantly. The only part
  that needs a server + database + cache.

## Services

| Service | Runs on | Repo location |
|---|---|---|
| Frontend (React/Vite) | Static host / CDN (Cloudflare Pages, Vercel, …) | repo root `src/` |
| Django API | Render web service | `backend/` |
| Multiplayer (Socket.IO) | Render / any Node host | `multiplayer_server/` |
| Data refresh + publish | **Your home machine** (residential IP) | `backend/` management commands |

> The NBA blocks data-center IPs, so the data **refresh** must run from home. The cloud only
> ever serves pre-built data.

## One-time accounts (create as you need each phase)

1. **GitHub** — already done (repo pushed).
2. **Cloudflare R2 + custom domain** (Phase 2 — content CDN).
3. **Supabase Postgres** (Phase 4 — user DB).
4. **Upstash Redis** (Phase 5 — leaderboard + multiplayer scaling).

## Environment variables by service

### Django API (Render) — see `backend/.env.example`
```
DJANGO_SECRET_KEY=<long random secret>
DJANGO_DEBUG=False
DJANGO_ALLOWED_HOSTS=<your-backend>.onrender.com      # RENDER_EXTERNAL_HOSTNAME is auto-added
CORS_ALLOWED_ORIGINS=https://<your-frontend-domain>
CSRF_TRUSTED_ORIGINS=https://<your-frontend-domain>
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/postgres   # Supabase (unset -> sqlite)
REDIS_URL=rediss://...                                       # Upstash (unset -> Postgres leaderboard)
CLIENT_ID=...            # Google OAuth (existing)
CLIENT_SECRET=...
```

### Multiplayer server (Render / Node host)
```
API_BASE_URL=https://<your-backend>.onrender.com     # REQUIRED in prod (else it tries localhost)
CORS_ORIGINS=http://localhost:5173,https://<your-frontend-domain>
REDIS_URL=rediss://...                               # optional: enables the Socket.IO adapter
PORT=4000
```

### Frontend build (host's build env)
```
VITE_BACKEND_URL=https://<your-backend>.onrender.com/api
VITE_SOCKET_URL=https://<your-multiplayer-host>
```

### Home machine (data refresh + publish) — see `backend/trivia/data_pipeline/README.md`
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
venv/Scripts/python.exe manage.py refresh_game_data            # fetch via nba_api (residential IP)
pip install -r requirements-publish.txt                        # one-time (boto3)
venv/Scripts/python.exe manage.py publish_game_data            # upload to R2 (needs R2_* vars)
```
Schedule weekly via Windows Task Scheduler (`backend/scripts/refresh_game_data.ps1`).
Until R2 is set up, just commit `backend/trivia/data/` and let Render serve it.

## Recommended activation order

1. **Now / no accounts:** app already serves pools from Django + samples client-side; single
   multiplayer instance; sqlite; Postgres leaderboard. Fully working.
2. **Harden prod (Phase 4):** set Supabase `DATABASE_URL` + the `DJANGO_*` / CORS vars on Render;
   run `manage.py migrate`. Fixes DEBUG/secret/hosts.
3. **Fix prod multiplayer (Phase 5a):** set `API_BASE_URL` + `CORS_ORIGINS` on the multiplayer host.
4. **CDN content (Phase 2 + 3):** set up R2; run `publish_game_data`; point the frontend's pool
   source at the CDN manifest URL (localized change in `src/utils/pool.ts`).
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
