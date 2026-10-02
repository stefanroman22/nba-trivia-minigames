# Backend cold start: slim the function and pre-warm it

Status: ready for the pipeline (investigated 2026-10-03). Owner asked to fix this only because it is
the one backend delay players actually feel.

## Problem

The Django backend (Vercel project `backend`, region fra1, next to Supabase eu-central-1) answers
warm requests in about 90-120 ms, but the first request after an idle period took **2,851 ms**
(5 consecutive samples of `GET /api/get-users/` on 2026-10-02: 2851, 111, 121, 144, 100 ms).
Database work is not the cause: the leaderboard query executes in 0.1 ms (3 users). Redis would
not help and was ruled out on 2026-10-02.

Who feels it:
- Logged-in visitors: `src/app/providers.tsx` calls `GET {BACKEND_URL}/me/` on page load, so the
  signed-in header and points appear late.
- Guests and players: the first `POST /trivia/log-guesses/`, score submit, Wordle play, login or
  leaderboard view after an idle period.
- Game data itself is unaffected (served from the CDN data host since 2026-10-02).

## Findings

1. **The function bundle is 74 MB** (`vercel inspect` of production deployment, `λ django (74.07MB) [fra1]`).
   Most of it is libraries no player request needs. Local site-packages sizes (Windows wheels, Linux is
   similar in proportion): pandas 59.9 MB, numpy 29.8 MB + numpy.libs 20.0 MB, Pillow 15.2 MB,
   Django 28.3 MB, nba_api 2.3 MB. A larger bundle means a slower cold start (download, unpack, load).
2. **pandas and nba_api are runtime dependencies only because of dead fallbacks.** They are imported
   lazily inside request code that can never succeed on Vercel, because stats.nba.com blocks
   data-center IPs (the reason the NBA sync runs on the owner's PC):
   - `backend/trivia/views.py:103` (`from nba_api.stats.static import teams`, name-logo fallback),
     `:123` (`import pandas as pd`, guess-mvps CSV fallback), `:188` (`nba_api` players fallback).
   - `backend/trivia/dynamic_data/players.py:14` (`/trivia/all-players/` nba_api fallback).
   - `backend/trivia/utils/playoff_games_utils.py`, `starting_five_utils.py`: data-building code that
     belongs with the pipeline, not the web function.
   - `backend/trivia/games/curated_validate.py:33`: a validator (check whether anything at runtime imports it).
   All other pandas/nba_api use is in management commands and `trivia/data_pipeline/`, which run on the
   PC or in GitHub Actions, not on Vercel.
3. **Startup imports libraries most requests don't use.** Measured locally with
   `python -X importtime` on `get_wsgi_application()` plus loading the URL conf (≈2.1 s total on
   Windows after warm-up; Linux is faster, but the ranking holds):
   - `requests` subtree ≈ 400 ms (pulls in `charset_normalizer` ≈ 150 ms on its own). Imported at module
     level by `backend/users/views.py:4` (and `:11-12` `google.oauth2` / `google.auth.transport.requests`
     for Google login) and `backend/trivia/questions/storage.py:7`.
   - Pillow, via `backend/users/photos.py:8` (`from PIL import Image, ImageOps`), only needed for photo uploads.
   - Django + DRF core (≈ 0.9 s and ≈ 0.5 s) are unavoidable.
4. **Nothing warms the function.** There is no health endpoint and the frontend's first backend call
   is a real one (`/me/` or a guess log), so the visitor always pays the cold start.
5. Not yet verified: whether **Fluid compute** is enabled on the `backend` project (keeps instances alive
   longer and reuses them across requests). The Vercel API token available to Claude could not read
   `resourceConfig`.

## Plan

**A. Split runtime and pipeline dependencies** (biggest win)
- `backend/requirements.txt` keeps only what the web function needs (Django, DRF, simplejwt,
  cors-headers, dotenv, dj-database-url, psycopg2-binary, whitenoise[brotli], tzdata, requests,
  google-auth, Pillow, redis).
- New `backend/requirements-pipeline.txt` = `-r requirements.txt` + pandas + nba_api (and anything
  else only commands use). Point every non-Vercel consumer at it: `.github/workflows/publish-game-data.yml`,
  `game-data-freshness.yml`, `wordle-daily.yml` (check whether it needs pandas), `maintain-questions.yml`,
  `backend/scripts/refresh_nba_data.cmd`/`.ps1`, CI test job, README/DEPLOYMENT instructions. Check
  `requirements-publish.txt` and merge or keep it consistent.
- Remove the dead runtime fallbacks listed in finding 2 so request code never imports pandas or nba_api.
  The DB (and the bundled JSON fallbacks already present) is the source; if a table is empty the view
  should return a clear 503/500 JSON error, not try stats.nba.com. Keep behaviour identical when the
  DB has data.
- Guard: a test that imports the WSGI app and every URL-resolved view and asserts `pandas`, `numpy`
  and `nba_api` are NOT in `sys.modules` afterwards.

**B. Lazy-load heavy, rarely used libraries**
- Move `requests`, `google.oauth2`, `google.auth.transport.requests` imports in `users/views.py` inside
  the Google-login function(s) that use them; move Pillow imports in `users/photos.py` inside the
  functions that process images; same for `trivia/questions/storage.py` if anything on the request path
  imports it.
- Guard: extend the startup test to assert `requests`, `PIL`, `google.auth` are not loaded by
  `get_wsgi_application()` + URL resolution. Keep all existing tests green (photo upload, Google login,
  storage tests import inside the function or patch the lazy import path).

**C. Pre-warm from the frontend**
- Add `GET /api/health/` (no DB, no auth, no throttle, returns `{"ok": true}`, `Cache-Control: no-store`)
  in the users or backend URL conf.
- On app mount (`src/app/providers.tsx` or the root client layout), fire one non-blocking
  `fetch(BACKEND_URL + "/health/", {keepalive: true})` for guests (logged-in users already trigger
  `/me/`, which warms it; avoid a duplicate call). Never block rendering, never show errors, at most once
  per page session.
- Optional, owner decision only if A-C are not enough: a scheduled warm ping. GitHub Actions minimum
  billing (1 min per run) makes a 5-minute ping cost ~8,600 min/month, over the free 2,000, so do NOT add it.

**D. Vercel settings check (owner)**
- In the Vercel dashboard, `backend` project, Settings, Functions: confirm Fluid compute is on (free on
  Hobby). Report the setting in the PR; do not change paid settings.

## Measurement (required, before and after)

- Bundle size: `vercel inspect <production-deployment-url>` before (74.07 MB) and after the deploy.
- Startup: the import-time test above, plus `python -X importtime` totals on Linux in CI (log them).
- Real cold start: after at least 20 minutes with no traffic, time 5 first-request samples of
  `GET /api/health/` and `GET /api/get-users/` (record in the PR). Target: first request under 1.2 s;
  warm requests unchanged (~100 ms).

## Risks

- A management command or GitHub workflow that still installs only `requirements.txt` will break once
  pandas/nba_api leave it. Grep every `pip install -r` and fix them in the same change.
- Removing the nba_api fallbacks means an empty production table returns an error instead of a
  (non-working) live fetch. Acceptable: the fallback never worked on Vercel.
- The pre-warm call adds one tiny request per guest visit.

## Suggested routing for the pipeline

- Classify: fullstack (backend + one small frontend change), multi-area, so a design round is expected.
  Risk: medium (touches the production dependency set and auth views' imports, not auth logic).
- Engine: sonnet for all steps (explicit, mechanical, each with a done-check). No motion work.
- QA: backend tests, `manage.py check`, a Vercel preview build log showing the smaller bundle, a browser
  check that login (email and Google), profile photo upload, leaderboard, a guess log and Wordle still
  work, and the before/after timings above.
