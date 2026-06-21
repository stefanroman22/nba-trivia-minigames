# Backend on Vercel (serverless) + Supabase + multiplayer on a Node host

**Decision (user):** move the Django backend to Vercel (serverless), use Supabase Postgres,
and host the Socket.IO multiplayer server on a small always-on Node host (Vercel can't run
persistent WebSockets). Frontend + game content stay on Vercel.

## Delivered (this PR — account-independent code/config, verified locally)
- `backend/api/index.py` — Vercel Python entrypoint exposing the Django WSGI app for all routes.
- `backend/vercel.json` — `functions` + `rewrites` (every path → the WSGI function) + `buildCommand: collectstatic --noinput`.
- `backend/.python-version` (3.12), `backend/.vercelignore` (excludes sqlite/media/venv/env).
- `backend/backend/settings.py` — trust `VERCEL_URL` + `*.vercel.app` in `ALLOWED_HOSTS`/`CSRF_TRUSTED_ORIGINS`; add WhiteNoise middleware; serverless static via `STORAGES` + `WHITENOISE_USE_FINDERS=True` + `STATIC_ROOT`.
- `backend/requirements.txt` — add `whitenoise[brotli]`.
- Lazy imports of `pandas` + `nba_api` in `trivia/views.py` and `trivia/dynamic_data/players.py` (keep them off the cold-start boot path).
- `staticfiles/` untracked + gitignored (collectstatic regenerates on build).
- `multiplayer_server/`: `Procfile` (`web: node src/index.js`), `start` script + `engines.node>=18`, `.env.example`.

Verified locally: `manage.py check` clean; `collectstatic` works (WhiteNoise); WSGI entrypoint resolves; **31 tests pass**.

## Deploy runbook (when the Supabase DATABASE_URL is available)

### 1. Migrate Supabase (locally — serverless can't run one-off migrate)
```bash
cd backend
# DIRECT connection (port 5432) for migrations:
$env:DATABASE_URL = "postgresql://postgres:<pwd>@db.<ref>.supabase.co:5432/postgres"   # PowerShell
venv/Scripts/python.exe manage.py migrate
venv/Scripts/python.exe manage.py createsuperuser   # optional, for /admin
```

### 2. Deploy the backend as a SEPARATE Vercel project (root = backend/)
⚠️ The repo root is already linked to the **frontend** Vercel project. Do NOT `vercel link`
from the repo root. Create a distinct backend project:
```bash
cd backend
vercel link            # create/link a NEW project; Root Directory = backend/
vercel env add DJANGO_SECRET_KEY production        # long random
vercel env add DJANGO_DEBUG production             # False
vercel env add DATABASE_URL production             # Supabase POOLER uri (serverless)
vercel env add CORS_ALLOWED_ORIGINS production     # https://<frontend origin>
vercel env add CSRF_TRUSTED_ORIGINS production     # https://<frontend origin>
vercel deploy --prod
# smoke: curl https://<backend>.vercel.app/trivia/manifest/   (JSON => Django routes work)
```
Use the Supabase **pooler** URL for the runtime `DATABASE_URL` (many short-lived serverless
connections); use the **direct** 5432 URL only for the local migrate.

### 3. Frontend → point at the new backend
Set `VITE_BACKEND_URL=https://<backend>.vercel.app/api` on the frontend Vercel project + redeploy.

### 4. Multiplayer on a Node host (Railway/Fly/Render)
Deploy `multiplayer_server/` (Procfile/`npm start`), set `API_BASE_URL=https://<backend>.vercel.app`,
`CORS_ORIGINS=https://<frontend origin>`. Then set `VITE_SOCKET_URL=<host url>` on the frontend Vercel project + redeploy.

## Caveats / follow-ups
- **Media uploads (profile photos) won't persist** on serverless (ephemeral FS). The app boots
  and all non-upload features work; persisting photos needs `django-storages` → Supabase Storage / Vercel Blob (follow-up).
- **Bundle size / cold start:** Python functions cap at ~250 MB unzipped. `pandas`+`nba_api` are
  now lazy-imported (off the boot path) but still ship in the bundle. Check the build size on first
  deploy; if it's tight, move `pandas` to a home-only requirements file (rewrite `get_mvps` to stdlib `csv`).
- **Migrations are local-only** (no serverless shell). Re-run after model changes.
- `DATABASE_URL` is effectively required in prod (the sqlite fallback is ephemeral/read-only on Vercel).
