# Phase 4 — Settings hardening + DB config (env-driven, sqlite default)

**Goal:** Make production-critical settings env-driven with safe local defaults, and make the app Postgres-ready (Supabase) — without changing local/CI behavior (still sqlite + DEBUG + localhost). Replaces the live deploy's hardcoded `DEBUG=True`, empty `ALLOWED_HOSTS`, hardcoded `SECRET_KEY`, and localhost-only CORS.

**Delivered (account-independent, tested):**
- `backend/backend/env_utils.py` — `env_bool` / `env_list` parsers (unit-tested).
- `backend/backend/settings.py`:
  - `SECRET_KEY` ← `DJANGO_SECRET_KEY` (falls back to the dev key locally).
  - `DEBUG` ← `DJANGO_DEBUG` (default True).
  - `ALLOWED_HOSTS` ← `DJANGO_ALLOWED_HOSTS` (default localhost) + auto `RENDER_EXTERNAL_HOSTNAME`.
  - `CORS_ALLOWED_ORIGINS` / `CSRF_TRUSTED_ORIGINS` ← env (default localhost dev origins).
  - `DATABASES` ← `DATABASE_URL` via `dj_database_url` (lazy import; SSL required) when set, else sqlite.
  - Production hardening block (only when `DEBUG` is off): secure cookies, SSL redirect, `SECURE_PROXY_SSL_HEADER` for Render's TLS-terminating proxy, HSTS.
- `backend/requirements.txt` — `dj-database-url`, `psycopg2-binary` (used only when `DATABASE_URL` is set; Render installs them).
- `backend/.env.example` — documents every new var.

**Why safe / isolated:**
- Every change is env-gated with the **previous behavior as the default**, so with no env vars set the app is byte-for-byte the old dev config: `ENGINE=sqlite3`, `DEBUG=True`, `ALLOWED_HOSTS=['localhost','127.0.0.1']` (verified at runtime). `dj_database_url`/`psycopg2` are imported only on the Postgres path, so local/CI don't need them installed.

**Verification:** `manage.py check` clean; full suite **21 passing** (incl. 4 new `env_utils` tests); confirmed sqlite/DEBUG/localhost still in effect with no env vars.

**Account step (you):** create a Supabase Postgres DB; on Render set `DJANGO_SECRET_KEY`, `DJANGO_DEBUG=False`, `DJANGO_ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`, `CSRF_TRUSTED_ORIGINS`, `DATABASE_URL`; run `manage.py migrate` against Supabase.

**Deferred verification:** the real Postgres connection (psycopg2 → Supabase) and `migrate` can only be confirmed once the DB exists. The IDE "dj_database_url unresolved" warning is expected (lazy import; package is in requirements for Render, not the local venv). Redis cache is Phase 5.
