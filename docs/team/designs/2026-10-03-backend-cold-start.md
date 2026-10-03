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

---

# Design round (planner-architect, 2026-10-03)

Pipeline note: this cloud run's planner had no agent-spawning tool (no `Agent`/`Task` tool in the
session; `ListAgents` showed only the planner), so the backend-engine and frontend-engine
proposals below and the sign-off pass were written by the planner from each engine's agent
definition (`.claude/agents/backend-engine.md`, `frontend-engine.md`) and the constraint docs, at
the ≤300-word proposal size. Everything an engine would have reported was verified by reading
the code (paths and line numbers below are from this checkout, HEAD 2b76726).

## Proposals

### backend-engine (sonnet lens, ≤300 words)

Contract exposed: `GET /api/health/` -> `200 {"ok": true}`, `Cache-Control: no-store`, `405` on any
other method; no DB, no auth, no throttle. Lives in the project package (`backend/backend/health.py`)
and is routed from `backend/backend/urls.py` (`api/` is the mount the frontend's `BACKEND_URL`
already ends in, README: `VITE_BACKEND_URL=http://localhost:8000/api`). It is not an app feature,
so it does not go into `users/urls.py` (which imports the AUTH-11 `users/views.py`).

Dependencies: Vercel's Python runtime installs `backend/requirements.txt` only, so that file becomes
the web set and `requirements-pipeline.txt` (`-r requirements.txt` + pandas + nba_api) the data set.
`requirements-publish.txt` stays boto3-only (the S3 upload path is separate from the NBA fetch).
Consumers that need the pipeline set: `publish-game-data.yml`, `game-data-freshness.yml`
(`publish_game_data_v3` -> `publish_v3` -> `curated_players`, which imports nba_api in
`modern_abbr_index`), `maintain-questions.yml`, the owner's PC (`sync_nba_data`,
`refresh_game_data`, `generate_players_curated`), and **every test run**: `tests/test_curated_players.py`
imports `nba_api` and `requests` at module level and `tests/test_refresh_command.py` patches
`trivia.utils.starting_five_utils`, which imports pandas. So the team-run workspace install and the
nightly routine prompt must install the pipeline file. `wordle-daily.yml` (`pick_daily_wordle`
imports only `trivia.wordle_daily` and models) stays on the web file.

Fallbacks: the three `nba_api.stats.static` fallbacks read nba_api's bundled static lists, not
stats.nba.com (the owner doc's "blocked IPs" reason is wrong for them) — but they are the only
reason nba_api is a runtime dependency, so they go. `get_mvps`'s pandas fallback reads a bundled
CSV (`trivia/utils/nba_mvps.csv`, 71 rows): keep it with stdlib `csv` (BE-11, identical shape).
`all-players` falls back to the curated dataset `full_name`s (same list the autocomplete is
published from, already memoized by `live_pool.load_dataset`). `name-logo` and `wordle` with an empty
table return `500 {"error": ...}` (classic views use 404/500, BE-8).

`trivia/questions/storage.py` imports `requests` at module level but is imported only by management
commands, `questions/runner.py` and `questions/snapshot.py`, none of which the request path imports:
leave it alone; the startup guard proves it.

Startup guard: the test process already has PIL/nba_api loaded via sibling test modules, so the
`sys.modules` assertion must run in a fresh `subprocess` that boots the WSGI app and resolves the
URL conf. `SimpleTestCase` (no DB access allowed) doubles as the health endpoint's no-DB proof.

Risks: a `pip install -r requirements.txt` somewhere I did not grep; a photo/Google test that
patches the old module-level import path (checked: none exist — `users/tests.py` and
`users/test_photos.py` go through the view with real Pillow; no Google-login test).

### frontend-engine (sonnet lens, ≤300 words)

Consumes `GET {BACKEND_URL}/health/`. One helper, `prewarmBackend(): void`, in
`src/utils/session.ts` — the file that already holds the session-bootstrap helpers for
`app/providers.tsx` (CODE_MAP: "Cached /me/ user read/write/clear and access-token expiry check for
session bootstrap"), so no new util file. It is a fire-and-forget `fetch` with `mode: "no-cors"`
(the response body is never read, and a preview origin that is not in `CORS_ALLOWED_ORIGINS` must
not log a console error), `cache: "no-store"`, `keepalive: true`, `.catch(() => {})`, guarded by a
module-level `prewarmed` flag (once per page load; `reactStrictMode` is already off, so the effect
runs once anyway) and by `BACKEND_URL` being non-empty.

Where it fires: in `AppEffects.restoreSession` in `src/app/providers.tsx`, inside the existing
`if (!getRefreshToken())` guest branch, before `clearCachedUser()`. Signed-in visitors never reach
that branch — their first request is `GET /me/` or `POST token/refresh/`, which warms the function
itself, so there is no duplicate. The call is synchronous (`void`), never awaited, and cannot change
`authChecked`, tokens or the cache, so AUTH_CONSTRAINTS' hydration rules (only a server verdict flips
to guest) are untouched. No UI, no motion, no new component.

Done-check: `npx tsc --noEmit` clean (verify stage), and in the browser as a guest the Network tab
shows exactly one `health/` request on page load and none when signed in; as a signed-in user
`/me/` still fires once.

Risks: none beyond one tiny request per guest visit; if `fetch` is unavailable (SSR) the helper
returns early, and the effect only runs client-side anyway.

## Decision summary

Engine: mixed

- D1. Three requirements files: `requirements.txt` (web, what Vercel installs),
  `requirements-pipeline.txt` (`-r requirements.txt` + pandas + nba_api), `requirements-publish.txt`
  unchanged (boto3). Reason: Vercel reads only `requirements.txt`; boto3 is a different consumer set.
- D2. Pipeline file consumers: `publish-game-data.yml`, `game-data-freshness.yml`,
  `maintain-questions.yml` (plus publish), the team-run workspace install, the nightly routine prompt,
  README's local setup (one added line), DATA_PIPELINE.md (one added line). `wordle-daily.yml` stays on
  the web file. The `.cmd`/`.ps1` refresh scripts install nothing (they run `venv\Scripts\python.exe`)
  and are not edited.
- D3. Dead fallbacks: `name-logo` empty table -> `500 {"error": "No team data available."}`;
  `wordle` empty table -> `500 {"error": "no wordle words available"}` (existing message);
  `all-players` empty table -> curated dataset names (`200`, same shape); `guess-mvps` empty table ->
  bundled CSV via stdlib `csv` (`200`, same shape). Behaviour with data in the DB is byte-identical.
  Reason: BE-11 keeps a bundled fallback wherever one exists without nba_api/pandas; where none
  exists the classic-view convention is a `500` JSON error (BE-8), and the fallback never ran in
  production (the store is populated).
- D4. Health endpoint: `backend/backend/health.py::health_view`, routed as `path('api/health/', ...)`
  in `backend/backend/urls.py` (name `health`). Reason: infra, not an app; keeps the AUTH-11
  `users/views.py` import graph out of it; `include(` count stays three (BE-1 check 11).
- D5. Pre-warm: `prewarmBackend()` in `src/utils/session.ts`, called from the guest branch of
  `restoreSession` in `src/app/providers.tsx`. Reason: that branch is exactly "no `/me/` will fire".
- D6. `trivia/questions/storage.py` is not touched (not on the request path; the guard proves it).
  `trivia/utils/playoff_games_utils.py`, `starting_five_utils.py`, `games/curated_validate.py` are
  not moved: nothing on the request path imports them (only `refresh_game_data` lazily, and the
  standalone validator), and moving files is outside the card.
- D7. Startup guard = `backend/trivia/tests/test_startup.py` (`StartupImportTests` via a fresh
  subprocess; `HealthEndpointTests` on `SimpleTestCase`). Fallback behaviour =
  `backend/trivia/tests/test_classic_fallbacks.py`.
- D8. Unattended measurement: startup time of the WSGI app + URL conf in this checkout's venv
  (3 runs, before and after, with the loaded-heavy-module list) and the `du -sm` of
  pandas/numpy/numpy.libs/nba_api in site-packages as the expected bundle delta. The build engine
  logs both in its final report and in the commit body. `vercel inspect` and the 20-minute-idle
  production samples are owner evidence after the next backend deploy, not blockers.
- D9. Plan step D (Fluid compute) is owner-only: the build report asks for it; no build step.
- D10. Per-step engines: `[opus]` for the four edits that must keep behaviour identical in
  AUTH-11 files and the classic views (steps 4-7); `[sonnet]` for the rest.

## Interfaces

Backend
- `GET /api/health/` -> `200`, body `{"ok": true}`, header `Cache-Control: no-store`. Other
  methods -> `405` (`django.views.decorators.http.require_GET`). URL name: `health`.
- `GET /trivia/name-logo/`: DB rows -> `{"series": [...]}` (unchanged); empty `Team` table ->
  `500 {"error": "No team data available."}`; exception -> unchanged
  `500 {"error": str(e), "message": "Error fetching NBA team logos"}`.
- `GET /trivia/guess-mvps/`: DB rows -> unchanged; empty `Mvp` table -> `200 {"series": [5 rows of
  {"season","mvp","team","team_logo_url"} (all strings) from nba_mvps.csv]}`; missing/empty CSV ->
  `500 {"error": "MVP data is empty."}`.
- `GET /trivia/wordle/`: DB path unchanged; no usable DB word -> `500 {"error": "no wordle words available"}`.
- `GET /trivia/all-players/`: DB names -> unchanged; empty `Player` table -> `200 {"players":
  [curated full_name, ...]}` from `trivia.data_pipeline.live_pool.load_dataset()`.
- `users.views.google_login`, `users.photos.normalize_profile_photo`: signatures, status codes and
  bodies unchanged; only where `requests`/`google`/`PIL` are imported moves.
- Files: `backend/requirements.txt` (web), `backend/requirements-pipeline.txt` (new).
- Tests: `trivia.tests.test_startup.StartupImportTests.test_request_path_loads_no_heavy_libraries`,
  `trivia.tests.test_startup.HealthEndpointTests.{test_get,test_post_rejected}`,
  `trivia.tests.test_classic_fallbacks.ClassicFallbackTests.{test_mvps_come_from_bundled_csv,
  test_name_logo_empty_store_is_json_error,test_wordle_empty_store_is_json_error,
  test_all_players_fall_back_to_curated_dataset}`.

Frontend
- `src/utils/session.ts`: `export function prewarmBackend(): void` — fire-and-forget
  `GET ${BACKEND_URL}/health/`, once per page load, no return value, never throws.
- `src/app/providers.tsx`: calls `prewarmBackend()` in the `!getRefreshToken()` branch of
  `restoreSession`.

## File plan

| File | Change |
|---|---|
| `backend/requirements.txt` | drop `pandas`, `nba_api` |
| `backend/requirements-pipeline.txt` | new: `-r requirements.txt`, `pandas`, `nba_api` |
| `.github/workflows/publish-game-data.yml` | install + cache path -> pipeline file |
| `.github/workflows/game-data-freshness.yml` | install + cache path -> pipeline file |
| `.github/workflows/maintain-questions.yml` | install -> pipeline + publish files, add cache path |
| `README.md` | one line after `pip install -r requirements.txt` |
| `docs/DATA_PIPELINE.md` | one line in "How it's gathered" |
| `.claude/routines/README.md` | nightly prompt installs the pipeline file |
| `.claude/skills/team-run/SKILL.md` | workspace install uses the pipeline file |
| `backend/trivia/views.py` | `import csv`; rewrite `get_random_nba_teams`, `get_mvps` (+`_mvp_rows`), `get_wordle`; drop `_cached_teams`, `_cached_wordle_names`; rewrite the header NOTE |
| `backend/trivia/dynamic_data/players.py` | curated-dataset fallback instead of nba_api |
| `backend/users/views.py` | lazy `requests` / `google.oauth2.id_token` / `google.auth.transport.requests` inside `google_login` |
| `backend/users/photos.py` | lazy `from PIL import Image, ImageOps` inside `normalize_profile_photo` |
| `backend/backend/health.py` | new: `health_view` |
| `backend/backend/urls.py` | `path('api/health/', health_view, name='health')` |
| `backend/trivia/tests/test_startup.py` | new: startup guard + health tests |
| `backend/trivia/tests/test_classic_fallbacks.py` | new: fallback behaviour tests |
| `src/utils/session.ts` | `prewarmBackend()` |
| `src/app/providers.tsx` | call it on the guest path |

Not touched: `backend/requirements-publish.txt`, `.github/workflows/wordle-daily.yml`,
`backend/scripts/*`, `trivia/questions/storage.py`, `trivia/utils/*_utils.py`,
`trivia/games/curated_validate.py`, `vercel.json`, `settings.py`.

## Risks

- A test or workflow still installing only the web file: covered by step 3's grep done-check and by
  the suite needing the pipeline file (the team-run workspace step is updated in the same change).
- `backend/.venv/` is untracked and NOT git-ignored in this checkout (only `backend/venv/` is).
  Engines stage by explicit path; never `git add -A` or `git add .`.
- Lazy imports in AUTH-11 files: import errors would surface as the endpoints' existing generic
  error (`google_login` -> `400 "Unexpected error: ..."`); the photo import sits before the
  `try`, so a missing Pillow raises instead of masquerading as "unreadable image".
- A future module-level `import requests` anywhere on the request path re-introduces the cost
  silently: the guard test fails the suite, naming the module.
- Removing `nba_api` from the web set while the owner's PC venv still has it: no effect; the PC
  installs the pipeline file next time (README line).

## Test plan

- `cd backend && .venv/bin/python manage.py test users trivia` green (BE-18; the verify stage
  runs it; the build engine runs it once in step 11 because the dependency set changed).
- New tests listed under Interfaces.
- `python manage.py check` clean; `makemigrations --check --dry-run` reports no changes (no models touched).
- Startup measurement before (step 1) and after (step 11), logged.
- Browser QA (qa-protocol, after both halves): email login, Google login button reaches Google
  (full OAuth needs the owner's account; a `400` from the backend with a bad code is acceptable
  evidence the lazy import path works), profile photo upload, leaderboard, a guess log, Wordle;
  as a guest the Network tab shows one `health/` request on load; signed in, none.
- Owner evidence after the next `vercel deploy --prod` of `backend/`: `vercel inspect` bundle size
  (was 74.07 MB), 5 first-request samples after 20 idle minutes (target < 1.2 s), Fluid compute
  setting.

## Implementation plan

Conventions for every step: work in this checkout on branch `team/cut-backend-cold-start`; the
backend venv is `backend/.venv` (`.venv/bin/python`); stage files by explicit path only; do not
run lint/tsc/build/tests except where a step says so. Backend steps 1-11 first (built by
backend-engine), then frontend steps 12-13 (frontend-engine).

### Backend

**Step 1 [sonnet] — baseline measurement (no code change).**
Run from `backend/`, three times, and keep the lowest startup time and the loaded list:
```
cd backend && for i in 1 2 3; do .venv/bin/python - <<'PY'
import os, sys, time
t = time.perf_counter()
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.settings")
from django.core.wsgi import get_wsgi_application
get_wsgi_application()
from django.urls import get_resolver
get_resolver().url_patterns
heavy = ("pandas", "numpy", "nba_api", "requests", "PIL", "google")
print(f"startup {(time.perf_counter() - t) * 1000:.0f} ms; heavy loaded: {sorted({m.split('.')[0] for m in sys.modules if m.split('.')[0] in heavy})}")
PY
done
du -sm .venv/lib/python3*/site-packages/pandas .venv/lib/python3*/site-packages/numpy .venv/lib/python3*/site-packages/numpy.libs .venv/lib/python3*/site-packages/nba_api
```
Expected baseline: heavy loaded = `['PIL', 'google', 'requests']`. Done when the three timings,
the loaded list and the four `du` sizes are written down for the final report (label them
"before"). If `.venv` is not ready yet (background install), wait for it; do not pip install yourself.

**Step 2 [sonnet] — split the requirements files.**
`backend/requirements.txt`: delete the two lines `pandas` and `nba_api`; nothing else changes
(order and comments stay). Create `backend/requirements-pipeline.txt` with exactly:
```
# The data pipeline's extra dependencies: the NBA fetch (manage.py sync_nba_data,
# refresh_game_data, generate_players_curated), the game-data publish/freshness commands
# and the full test suite. Not installed by Vercel, which reads requirements.txt only — the
# web function never imports these (guard: trivia/tests/test_startup.py).
# Install where those run: pip install -r requirements-pipeline.txt
-r requirements.txt
pandas
nba_api
```
Done when `grep -c "pandas\|nba_api" backend/requirements.txt` prints `0` and
`grep -c "^-r requirements.txt" backend/requirements-pipeline.txt` prints `1`.

**Step 3 [sonnet] — point every pipeline consumer at the new file.**
- `.github/workflows/publish-game-data.yml`: line `cache-dependency-path: backend/requirements.txt`
  -> `cache-dependency-path: backend/requirements*.txt`; line
  `run: pip install -r backend/requirements.txt` -> `run: pip install -r backend/requirements-pipeline.txt`.
- `.github/workflows/game-data-freshness.yml`: same two edits.
- `.github/workflows/maintain-questions.yml`: under `cache: pip` add
  `cache-dependency-path: backend/requirements*.txt` (same indentation as `cache: pip`); line
  `run: pip install -r backend/requirements.txt -r backend/requirements-publish.txt` ->
  `run: pip install -r backend/requirements-pipeline.txt -r backend/requirements-publish.txt`.
- `.github/workflows/wordle-daily.yml`: unchanged (`pick_daily_wordle` needs no pipeline dep).
- `README.md`: directly after the line `pip install -r requirements.txt` in "1. Backend" add the
  line `pip install -r requirements-pipeline.txt   # only for the NBA data commands and the test suite`.
- `docs/DATA_PIPELINE.md`: in "How it's gathered — `manage.py sync_nba_data`", before the bash block,
  add the paragraph: `The fetch needs the pipeline dependency set: `pip install -r
  backend/requirements-pipeline.txt` (pandas + nba_api on top of `requirements.txt`; the web function
  on Vercel installs only `requirements.txt`).`
- `.claude/routines/README.md`: in the nightly prompt replace `pip install -r requirements.txt` with
  `pip install -r requirements-pipeline.txt`.
- `.claude/skills/team-run/SKILL.md`: in the **workspace** step replace
  `.venv\Scripts\pip install -r requirements.txt` with `.venv\Scripts\pip install -r requirements-pipeline.txt`.
Done when `grep -rn "pip install -r" .github .claude README.md docs/DATA_PIPELINE.md` shows
`requirements.txt` alone only in `wordle-daily.yml` and README's first install line, and every
other hit names `requirements-pipeline.txt`.

**Step 4 [opus] — remove the dead fallbacks in `backend/trivia/views.py`.**
Behaviour with rows in the DB must stay byte-identical; only the empty-table branches change.
- Add `import csv` to the stdlib imports at the top.
- Replace the header comment block (lines 35-39, "Games read from the central Supabase store ...
  NOTE: pandas and nba_api are imported lazily ...") with:
  `# Games read from the central Supabase store (populated by sync_nba_data). Where a bundled`
  `# file exists (playoff JSON, starting-five JSON, MVP CSV) an empty table falls back to it;`
  `# otherwise it is a JSON error. Nothing here may import pandas or nba_api: they are not in`
  `# the web function's requirements.txt (guard: trivia/tests/test_startup.py).`
- `get_random_nba_teams`: delete the module-level `_cached_teams = None` and the `global` line;
  build `pool` from `Team.objects.all()` as now; if `pool` is empty return
  `JsonResponse({'error': 'No team data available.'}, status=500)`; otherwise the existing
  `random.sample` response. Keep the surrounding `try/except Exception` and its error body.
- `get_mvps`: add above it
  ```python
  _cached_mvps = None


  def _mvp_rows():
      """Bundled MVP list (trivia/utils/nba_mvps.csv) read once; [] when the file is missing."""
      global _cached_mvps
      if _cached_mvps is None:
          if not os.path.exists(MVP_DATA_PATH):
              _cached_mvps = []
          else:
              with open(MVP_DATA_PATH, newline='', encoding='utf-8') as f:
                  _cached_mvps = list(csv.DictReader(f))
      return _cached_mvps
  ```
  and replace the pandas block (`import pandas as pd` ... `to_dict(orient='records')`) with
  `rows = _mvp_rows()`; `if not rows: return JsonResponse({'error': 'MVP data is empty.'}, status=500)`;
  `return JsonResponse({'series': random.sample(rows, min(5, len(rows)))})`.
- `get_wordle`: delete `_cached_wordle_names = None` and the `global` line; after the `for ln in
  (...)` loop replace everything up to the `except` with
  `return JsonResponse({'error': 'no wordle words available'}, status=500)`.
Done when `grep -n "nba_api\|pandas" backend/trivia/views.py` prints only the new header comment
line, and `cd backend && .venv/bin/python -c "import django, os; os.environ['DJANGO_SETTINGS_MODULE']='backend.settings'; django.setup(); import trivia.views"` exits 0.

**Step 5 [opus] — `backend/trivia/dynamic_data/players.py` fallback.**
Replace the file body with:
```python
from django.http import JsonResponse

from trivia.data_pipeline.live_pool import load_dataset as load_curated_dataset
from trivia.models import Player


def get_all_players(request):
    """All player full names: the central store, else the bundled curated dataset
    (the same list data/all-players.json is published from, memoized by live_pool)."""
    try:
        names = list(Player.objects.values_list("full_name", flat=True))
        if not names:
            names = [row["full_name"] for row in load_curated_dataset()]
        return JsonResponse({"players": names})
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)
```
Done when `grep -c nba_api backend/trivia/dynamic_data/players.py` prints `0`.

**Step 6 [opus] — lazy-import in `backend/users/views.py` (AUTH-11 file; touch nothing else).**
Delete line 4 (`import requests`) and lines 11-12 (`from google.oauth2 import id_token`,
`from google.auth.transport import requests as google_requests`). In `google_login`, as the first
three statements inside the `try:` block (before `code = json.loads(...)`) add:
```python
        # Lazy: requests (+charset_normalizer) and google-auth cost ~0.5 s to import and only
        # this endpoint uses them (guard: trivia/tests/test_startup.py).
        import requests
        from google.oauth2 import id_token
        from google.auth.transport import requests as google_requests
```
Everything else in the function, its decorators, status codes and bodies stay as they are.
Done when `grep -n "^import requests\|^from google" backend/users/views.py` prints nothing and
`grep -n "requests\.\|id_token\.\|google_requests\." backend/users/views.py` shows only the three
uses inside `google_login`.

**Step 7 [opus] — lazy-import in `backend/users/photos.py` (AUTH-11 file).**
Delete line 8 (`from PIL import Image, ImageOps`). In `normalize_profile_photo`, as the first
statement of the function body, before `try:`, add
`from PIL import Image, ImageOps  # lazy: Pillow (~15 MB) is only for uploads (guard: trivia/tests/test_startup.py)`.
It sits outside the `try` on purpose: a missing Pillow must raise, not become "unreadable image".
Done when `grep -n "PIL" backend/users/photos.py` shows the one in-function import (plus the
docstring mentions of Pillow) and nothing at module level.

**Step 8 [sonnet] — health endpoint.**
Create `backend/backend/health.py`:
```python
"""GET /api/health/ — the pre-warm target (src/utils/session.ts prewarmBackend).

No DB, no auth, no throttle: it exists so a guest's first real request (guess log, login,
leaderboard) finds an already-warm serverless function. Guarded by trivia/tests/test_startup.py."""
from django.http import JsonResponse
from django.views.decorators.http import require_GET


@require_GET
def health_view(request):
    resp = JsonResponse({"ok": True})
    resp["Cache-Control"] = "no-store"
    return resp
```
In `backend/backend/urls.py` add `from backend.health import health_view` after the existing
imports and insert `path('api/health/', health_view, name='health'),` as the first entry of
`urlpatterns` (before `admin/`). Done when `grep -c "include(" backend/backend/urls.py` still
prints `3` and `cd backend && .venv/bin/python manage.py check` is clean.

**Step 9 [sonnet] — startup guard + health tests: `backend/trivia/tests/test_startup.py`.**
Create the file with exactly this content:
```python
"""Startup guard: the request path never loads the data-pipeline/upload libraries, and the
pre-warm endpoint touches no database. See docs/team/designs/2026-10-03-backend-cold-start.md."""
import json
import subprocess
import sys

from django.conf import settings
from django.test import SimpleTestCase
from django.urls import reverse

HEAVY = ("pandas", "numpy", "nba_api", "requests", "PIL", "google")

# Runs in a fresh interpreter: this test process has already imported PIL and nba_api through
# sibling test modules, so inspecting its own sys.modules would prove nothing.
STARTUP_SCRIPT = """
import json, os, sys
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.settings")
from django.core.wsgi import get_wsgi_application
get_wsgi_application()
from django.urls import get_resolver
get_resolver().url_patterns  # imports every urls module and the views they route
heavy = %r
print(json.dumps(sorted(m for m in sys.modules if m.split(".")[0] in heavy)))
""" % (HEAVY,)


class StartupImportTests(SimpleTestCase):
    def test_request_path_loads_no_heavy_libraries(self):
        proc = subprocess.run(
            [sys.executable, "-c", STARTUP_SCRIPT],
            cwd=settings.BASE_DIR, capture_output=True, text=True, timeout=120,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        loaded = json.loads(proc.stdout.strip().splitlines()[-1])
        self.assertEqual(loaded, [], f"heavy modules loaded at startup: {loaded}")


class HealthEndpointTests(SimpleTestCase):
    # SimpleTestCase forbids database access, so a query inside the view fails the test.
    def test_get(self):
        res = self.client.get(reverse("health"))
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), {"ok": True})
        self.assertEqual(res["Cache-Control"], "no-store")

    def test_post_rejected(self):
        self.assertEqual(self.client.post(reverse("health")).status_code, 405)
```
Done when `cd backend && .venv/bin/python manage.py test trivia.tests.test_startup` passes
(3 tests). If `test_request_path_loads_no_heavy_libraries` fails, the message names the module
that still imports a heavy library at startup; fix that import site (steps 4-7), not the test.

**Step 10 [sonnet] — fallback tests: `backend/trivia/tests/test_classic_fallbacks.py`.**
Create the file with exactly this content:
```python
"""Empty store tables: the classic trivia views answer from a bundled file or with a JSON
error, never by importing nba_api or pandas (which are not in the web requirements.txt)."""
from django.test import TestCase
from django.urls import reverse

from trivia.data_pipeline.live_pool import load_dataset as load_curated_dataset


class ClassicFallbackTests(TestCase):
    def test_mvps_come_from_bundled_csv(self):
        res = self.client.get(reverse("guess-mvp"))
        self.assertEqual(res.status_code, 200)
        rows = res.json()["series"]
        self.assertEqual(len(rows), 5)
        self.assertEqual(set(rows[0]), {"season", "mvp", "team", "team_logo_url"})
        self.assertTrue(all(isinstance(v, str) for v in rows[0].values()))

    def test_name_logo_empty_store_is_json_error(self):
        res = self.client.get(reverse("name-logo"))
        self.assertEqual(res.status_code, 500)
        self.assertEqual(res.json(), {"error": "No team data available."})

    def test_wordle_empty_store_is_json_error(self):
        res = self.client.get(reverse("wordle"))
        self.assertEqual(res.status_code, 500)
        self.assertEqual(res.json(), {"error": "no wordle words available"})

    def test_all_players_fall_back_to_curated_dataset(self):
        res = self.client.get(reverse("all-players"))
        self.assertEqual(res.status_code, 200)
        players = res.json()["players"]
        self.assertEqual(len(players), len(load_curated_dataset()))
        self.assertIn(load_curated_dataset()[0]["full_name"], players)
```
Done when `cd backend && .venv/bin/python manage.py test trivia.tests.test_classic_fallbacks`
passes (4 tests).

**Step 11 [sonnet] — full suite, check, after-measurement.**
Run `cd backend && .venv/bin/python manage.py check && .venv/bin/python manage.py makemigrations
--check --dry-run && .venv/bin/python manage.py test users trivia`; all must pass (BE-18: a failure
is real — fix the cause in the files this plan names, never skip a test). Then re-run the step 1
measurement block and label it "after": expected heavy loaded = `[]`. Write into the final report
and the commit body: before/after startup ms (lowest of 3), before/after loaded list, the `du`
sizes as "expected bundle delta", and the owner follow-ups: `vercel inspect` after the next
`cd backend && vercel deploy --prod`, five first-request samples of `GET /api/health/` and
`GET /api/get-users/` after 20 idle minutes (target < 1.2 s), and the Fluid compute setting on the
`backend` project. Done when the suite is green and the numbers are recorded.

### Frontend

**Step 12 [sonnet] — `prewarmBackend()` in `src/utils/session.ts`.**
Add `import { BACKEND_URL } from "../configurations/backend";` after the existing type import, and
append at the end of the file:
```ts
let prewarmed = false;

/** Guests only: one fire-and-forget GET /health/ so the serverless backend is warm before the
 *  first real request (a guess log, login, leaderboard). Signed-in visitors already warm it with
 *  /me/ or token/refresh/, so providers.tsx calls this only on the no-refresh-token path. Never
 *  awaited, never surfaces an error, at most once per page load. */
export function prewarmBackend(): void {
  if (prewarmed || !BACKEND_URL || typeof fetch !== "function") return;
  prewarmed = true;
  try {
    fetch(`${BACKEND_URL}/health/`, { method: "GET", mode: "no-cors", cache: "no-store", keepalive: true })
      .catch(() => { /* warming only */ });
  } catch {
    /* ignore */
  }
}
```
Done when the export exists and the file has no other change.

**Step 13 [sonnet] — call it from the guest path in `src/app/providers.tsx`.**
Extend the existing import line
`import { clearCachedUser, isAccessTokenExpired, readCachedUser, writeCachedUser } from "../utils/session";`
to also import `prewarmBackend` (keep alphabetical order: `clearCachedUser, isAccessTokenExpired,
prewarmBackend, readCachedUser, writeCachedUser`). In `restoreSession`, inside
`if (!getRefreshToken()) {`, add `prewarmBackend();` as the first statement (before the existing
comment and `clearCachedUser();`), with the comment line
`// Guest: nothing will call /me/, so warm the backend for the first real request.` above it.
Nothing else in the file changes. Done when `grep -n prewarmBackend src/app/providers.tsx` prints
exactly two lines (the import and the call) and the verify stage's `npx next typegen && npx tsc
--noEmit` is clean.

### Self-review (step 5b)
- Coverage: spec A -> steps 2-5 (+ guard 9, fallback tests 10); B -> steps 6-7 (+ guard 9);
  C -> steps 8, 12, 13; "bundle and startup measured before/after" -> steps 1, 11; "a test asserts
  pandas/numpy/nba_api/requests/PIL/google.auth are not loaded" -> step 9; "all backend tests pass"
  -> step 11; browser checks -> Test plan (QA stage); D -> owner follow-up in step 11's report.
- No placeholders: every step names files, exact text or code, and a command/grep done-check.
- Consistency: URL name `health`, path `api/health/`, helper `prewarmBackend`, test module names
  and class names match between Interfaces, File plan and steps.
- Scope: no file moves, no `.gitignore`, `storage.py`, `settings.py`, `vercel.json` or scheduled
  pings; `wordle-daily.yml` deliberately unchanged.
- Ambiguity settled: `/api/health/` (not `/health/`) because `BACKEND_URL` ends in `/api`; MVP CSV
  stays a fallback (stdlib csv) while the nba_api static-list fallbacks become a 500 or the curated
  dataset; pipeline file includes the web file; publish file untouched.

### Sign-off
backend-engine lens: OK (checked the subprocess guard resolves `backend.settings` from
`cwd=settings.BASE_DIR`, `TestCase` tables are empty so every fallback branch is exercised,
`require_GET` yields the 405). frontend-engine lens: OK (`mode: "no-cors"` + `keepalive` is valid
for a GET, `.catch` is attached so no floating promise, the call cannot alter `authChecked`).
No unresolved objection; no design deadlock.
