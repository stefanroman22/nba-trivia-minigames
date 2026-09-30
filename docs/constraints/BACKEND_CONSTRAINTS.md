# Backend Constraints (Django API)

**Scope:** the Django project under `backend/` (Django 5.1 + DRF, deployed as Vercel serverless, Supabase
Postgres via the transaction pooler). Two apps: `users` (accounts, auth, friends, leaderboard) and
`trivia` (game data: central store, modular per-game backends, admin API, pre-generated questions,
data-pipeline entry points). Frontend conventions are `docs/constraints/UI_SHELL_CONSTRAINTS.md`
territory. Pipeline *internals* (NBA API fetch, validation, publishing) are `docs/DATA_PIPELINE.md`
territory; this doc only states the *boundary* task code must respect.

**Reference implementations** (read before touching backend code):

| Concern | Reference |
|---|---|
| Settings / env / CACHES / throttle rates | `backend/backend/settings.py`, `backend/backend/env_utils.py` |
| Rate-limit classes | `backend/backend/throttles.py` |
| URL mounting | `backend/backend/urls.py` |
| Central game-data store | `backend/trivia/models.py` |
| Classic (non-modular) endpoints | `backend/trivia/views.py`, `backend/trivia/urls.py` |
| Modular per-game backend + registry | `backend/trivia/games/__init__.py`, `backend/trivia/games/heatmap.py` |
| Admin-panel API | `backend/trivia/admin_api.py`, `backend/trivia/admin_urls.py` |
| Accounts / auth / friends | `backend/users/views.py`, `backend/users/friends.py`, `backend/users/tokens.py` |
| Redis-or-Postgres service | `backend/users/leaderboard.py` |
| Pre-generated questions | `backend/trivia/questions/runner.py`, `backend/trivia/questions/games/__init__.py` |
| Hand-written data migration | `backend/users/migrations/0003_identity_overhaul.py` |
| Deploy / pooler / env vars | `docs/DEPLOYMENT.md`, `backend/.env.example` |
| Pipeline boundary | `docs/DATA_PIPELINE.md` (`backend/trivia/data_pipeline/README.md` only points there) |

Everything below is measured from the working tree. Where the code is inconsistent, the DOMINANT
pattern is documented and the exception is named.

---

## Rule BE-1: Two apps, one project package; every app is mounted via `include()`

`backend/` holds the project package `backend/backend/` (`settings.py`, `urls.py`, `throttles.py`,
`env_utils.py`, `wsgi.py`, `asgi.py`) and two apps, `backend/users/` and `backend/trivia/`.
`backend/backend/urls.py` is the only ROOT_URLCONF and mounts apps by `include()`, never by importing
views into it. Cross-cutting policy that spans both apps (throttles) lives in the project package.

```python
❌ WRONG — view wired straight into the root urlconf
urlpatterns = [
    path('admin/', admin.site.urls),
    path('leaderboard/', leaderboard_view),
]

✅ RIGHT — backend/backend/urls.py
urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/admin/', include('trivia.admin_urls')),
    path('api/', include('users.urls')),
    path('trivia/', include('trivia.urls')),
]
```

## Rule BE-2: A new minigame is a module under `trivia/games/`, registered in `_GAME_MODULES` — never a hand-wired URL

`trivia/games/__init__.py` maps module name to public slug in `_GAME_MODULES`. For each importable
module it collects `build_pool` into `POOL_BUILDERS`, `validate_rows` into `VALIDATORS`, and (unless
the slug is in `HIDDEN_GAMES`) routes `get_round` as `<slug>/` plus any `EXTRA_URLS`. `trivia/urls.py`
appends this package's `urlpatterns` once. `HIDDEN_GAMES` unroutes a game (including its
`EXTRA_URLS`, e.g. `nba-grid/tally/`) and `trivia/views.py` strips those slugs from
`/trivia/manifest/` and `/trivia/pool/<game>/` (404) — but the pipeline still builds their pools.
An import guard (`try: import_module(...) except Exception: continue`) means one broken module 404s
only its own slug.

```python
❌ WRONG — a new game wired into trivia/urls.py
urlpatterns = [
    path('new-game/', new_game_views.get_round, name='new-game'),
]

✅ RIGHT — trivia/games/__init__.py, one dict entry (+ HIDDEN_GAMES only to pull it from players)
_GAME_MODULES = {
    ...
    "new_game": "new-game",   # trivia/games/new_game.py -> /trivia/new-game/
}
```

Module contract (from the package docstring): `get_round(request)`, optional `build_pool()`,
optional `validate_rows(rows) -> list[str]`, optional `EXTRA_URLS`. Do not hide/unhide a game
without checking `trivia/views.py::get_manifest`/`get_pool` still agree.

## Rule BE-3: `trivia/data_static/` is authored source; `trivia/data/` is generated output — never hand-edit the latter

Authored/committed inputs (`tictactoe_seed.json`, `bingo_seed.json`, `players_curated.json`,
`heatmap_seed.json`, `nba_grid_seed.json`, `connections_seed.json`, `fan_favorites_seed.json`,
`who_would_win_seed.json`) live in `trivia/data_static/`. The pools served to the frontend/CDN
(`trivia/data/<key>.json` + `trivia/data/manifest.json`) are written by
`manage.py build_pools_from_db` from the DB plus each `trivia/games/*.py::build_pool()`. An
invalid/empty pool is skipped and the old file kept — never clobbered.

```python
❌ WRONG — hand-editing the served pool
# editing backend/trivia/data/bingo.json to fix a typo

✅ RIGHT — fix the source, regenerate
# 1. edit backend/trivia/data_static/bingo_seed.json
# 2. python manage.py build_pools_from_db
```

## Rule BE-4: `trivia/models.py` is one shared store — games query it, they don't own tables

The module docstring states it: "no game owns its own storage." `Team`, `Player`, `PlayoffSeries`,
`Mvp`, `StartingFiveGame`, `FanFavoritesQuestion` feed several games; `GameSession` and `GuessLog`
are cross-game logs (a `game` CharField distinguishes rows); `SyncRun` audits syncs; `Question`
holds pre-generated rounds keyed by `game`+`qid`; `Feedback`, `WordleDailyWord`, `WordlePlay` are
feature tables. User/social tables (`CustomUser`, `FriendRequest`, `Friendship`, `BlockedUser`) belong
to `users/models.py` and are referenced via `settings.AUTH_USER_MODEL`.

```python
❌ WRONG — a per-game answer-log table
class NewGameGuess(models.Model): ...

✅ RIGHT — trivia/models.py, reuse the cross-game log
class GuessLog(models.Model):
    game = models.CharField(max_length=40)
    question_id = models.CharField(max_length=60, blank=True)
    answer = models.CharField(max_length=120)
```

## Rule BE-5: Every model has a docstring saying what it feeds, and `Meta.indexes`/constraints match real queries

Models open with a docstring naming the games/features they serve (`Team`: "Feeds the Name->Logo
game..."; `Feedback`, `WordlePlay` explain their invariants). Indexes exist for fields actually
filtered/ordered on — `GuessLog` indexes `["game", "question_id"]` (the `nba_grid` tally filter),
`GameSession` indexes `["game", "-finished_at"]`. Uniqueness is enforced with named
`UniqueConstraint`s (`uniq_playoff_series`, `uniq_question_game_qid`, `uniq_friendship_pair`).
Natural keys are primary keys where the source has one (`Team.team_id`, `Player.person_id`,
`StartingFiveGame.game_id`, `FanFavoritesQuestion.qid`). Constraint names use the `uniq_<what>` form.

```python
❌ WRONG — no docstring, speculative index, anonymous uniqueness
class NewThing(models.Model):
    value = models.CharField(max_length=50, unique_together=...)
    class Meta:
        indexes = [models.Index(fields=["value"])]   # nothing filters on it

✅ RIGHT — trivia/models.py, PlayoffSeries
class PlayoffSeries(models.Model):
    """One completed playoff series, stored canonically (winner/loser)."""
    class Meta:
        constraints = [models.UniqueConstraint(fields=["season", "series_id"], name="uniq_playoff_series")]
        indexes = [models.Index(fields=["season"])]
```

## Rule BE-6: Migrations are auto-generated and land with the model edit; a hand-written data migration is the named exception

Every migration in `users/migrations/` (`0001`–`0006`) and `trivia/migrations/` (`0001`–`0007`) carries
Django's generated name, except `users/migrations/0003_identity_overhaul.py`, hand-renamed with a
`RunPython` (`backfill_public_ids`) to add a unique `public_id` to a live table (add nullable →
backfill → lock unique). That is the pattern for any non-null/unique add on populated data; it is not
how ordinary field adds are done. `vercel.json`'s `buildCommand` runs `migrate --noinput` on every
deploy, so a bad migration fails the build. `python manage.py makemigrations --check --dry-run` must
report no changes.

```python
❌ WRONG — model edited, no migration file (makemigrations --check fails)
# backend/trivia/models.py gains a field; backend/trivia/migrations/ unchanged

✅ RIGHT — together in one change
# backend/trivia/models.py: FanFavoritesQuestion.category
# backend/trivia/migrations/0004_fanfavoritesquestion_category.py: matching AddField
```

Note the dev and prod environments share one Supabase database (`docs/DEPLOYMENT.md`), so a
migration also runs against production data: keep changes additive (see the comment on
`CustomUser.profile_photo` in `users/models.py` — a legacy column kept alive across deploys).

## Rule BE-7: A "give me a round" GET returns `{"series": [...]}` — one named exception

`trivia/views.py` round endpoints and every `trivia/games/*.py::get_round` return
`JsonResponse({"series": [...]})`; the array length is game-defined (`who_would_win.py` samples
`ROUNDS_PER_SESSION`, `pack_five.py` returns the whole pack, `contexto.py` returns one config object
`{pool, day, secret_person_id}` rather than the player pool). The exception is `imposter.py`, which
returns `{"mystery_pool": [...]}` and says so in its docstring.

```python
❌ WRONG — bare dict, no documented reason
def get_round(request):
    return JsonResponse(random.choice(rows))

✅ RIGHT — trivia/games/heatmap.py
def get_round(request):
    """One random seed row in the standard {'series': [...]} envelope."""
    rows = _load_seed()
    if not rows:
        return JsonResponse({"error": "The Heatmap content not ready"}, status=503)
    return JsonResponse({"series": [random.choice(rows)]})
```

## Rule BE-8: Modular `get_round` returns `503` for "content not ready"; classic `trivia/views.py` uses `404`/`500` — don't mix them

Every `trivia/games/*.py::get_round` returns `503` with `{"error": "<Game> content not ready"}` when its
seed/pool is empty (`players_index.py` words it `players_curated.json not published yet`). The older
endpoints differ: `get_starting_five` returns `404` (`'No games available.'`), `get_random_playoff_series`,
`get_mvps`, `get_wordle`, `get_fan_favorites` return `500`. Match the layer you are extending; do not
invent a third status for "no data".

```python
❌ WRONG — modular game using the classic status
if not rows:
    return JsonResponse({"error": "content not ready"}, status=404)

✅ RIGHT — trivia/games/contexto.py
rows = load_players()
if not rows:
    return JsonResponse({"error": "LeContexto content not ready"}, status=503)
```

## Rule BE-9: `@api_view` is for POST bodies, permission/throttle-gated, or admin endpoints — public read-only round data is a plain Django view

`@api_view` (+ `permission_classes`, `throttle_classes`) is used across `users/views.py`,
`users/friends.py`, `trivia/admin_api.py`/`trivia/feedback_api.py` (`IsAdminUser`, return DRF
`Response`) and on `trivia/views.py`'s state-changing or throttled endpoints (`log_guesses`,
`log_session`, `submit_feedback`, `wordle_daily_status`, `wordle_daily_play`). The rest of
`trivia/views.py` (`get_random_playoff_series`, `get_mvps`, `get_manifest`, `get_pool`, ...) and all
`trivia/games/*.py::get_round` are bare functions returning `django.http.JsonResponse`, with no
`@api_view` anywhere in `trivia/games/` (`nba_grid_tally`, an `EXTRA_URLS` entry, is also plain).
Response class is inconsistent in `users/` (`Response` dominant, `JsonResponse` for some errors) and
`trivia/views.py` `@api_view` endpoints return `JsonResponse`; follow the file you edit.

```python
❌ WRONG — DRF machinery on a public read-only round endpoint
@api_view(["GET"])
@permission_classes([AllowAny])
def get_round(request):
    return Response({"series": [...]})

✅ RIGHT — trivia/games/bingo.py
def get_round(request):
    rows = _load_seed()
    if not rows:
        return JsonResponse({"error": "NBA Bingo content not ready"}, status=503)
    return JsonResponse({"series": [random.choice(rows)]})
```

## Rule BE-10: No model serializers — response shapes are hand-built dicts from small named helpers

There is no project `serializers.py`. Shapes come from helpers: `user_payload`/`auth_response` in
`users/views.py`, `_brief` in `users/friends.py`, `_playoff_row`/`_starting_five_row`/
`_fan_favorites_row` in `trivia/views.py`. The only serializer subclass is
`users/tokens.py::SessionRefreshSerializer`, an extension of simplejwt's `TokenRefreshSerializer`, not
a model serializer. Do not introduce the first `ModelSerializer`.

```python
❌ WRONG
class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = CustomUser
        fields = ["public_id", "username"]

✅ RIGHT — users/views.py
def user_payload(request, user):
    return {"id": user.public_id, "username": user.username, "email": user.email,
            "rank": user.rank, "points": user.points, "is_admin": bool(user.is_staff), ...}
```

## Rule BE-11: Game-data reads try the DB first, then a bundled file — players never see a hard error for missing data

`get_random_playoff_series`, `get_random_nba_teams`, `get_mvps`, `get_starting_five`, `get_wordle`,
`get_fan_favorites` query the model first and fall back to bundled JSON/CSV (`trivia/utils/`,
`trivia/data_static/`) or `nba_api` static lists; `pandas`/`nba_api` are imported lazily inside the
fallback. The comment atop `trivia/views.py` gives the reason. Modular games skip the DB and read a
bundled seed or the curated pool via `trivia/data_pipeline/live_pool.py` (`load_players()`,
read-only shared list).

Note: `trivia/views.py` imports the curated loader as `load_curated_dataset` (used only by
`_player_names()`); its module-local `load_dataset(path)` is the per-file fallback cache and returns
`None` when the file is missing (-> 404 in `get_manifest`/`get_pool`).

```python
❌ WRONG — 500s the moment the table is empty
def get_new_thing(request):
    if not NewThing.objects.exists():
        return JsonResponse({"error": "no data"}, status=500)

✅ RIGHT — trivia/views.py, get_random_playoff_series
qs = list(PlayoffSeries.objects.order_by('?')[:5])
if qs:
    return JsonResponse({'series': [_playoff_row(s) for s in qs]})
data = load_dataset(PLAYOFF_DATA_PATH)     # bundled fallback
```

## Rule BE-12: Risky view logic is wrapped in `try/except Exception` returning `{"error": str(e)}`; newer write endpoints validate input and return explicit 4xx

`trivia/views.py` (`get_random_nba_teams`, `get_mvps`, `get_wordle`, `get_fan_favorites`) and
`users/views.py` (`signup_view`, `get_current_user`, `google_login`, `get_users`) catch broadly and
return `{"error": ...}` (sometimes plus `"message"`). The newer body-parsing endpoints
(`log_guesses`, `log_session`, `submit_feedback`) instead clamp/validate inputs and return `400`s
without a blanket `except`. Never let a raw exception page escape; never echo Pillow's or another
library's internal error text for user-controlled input (`users/photos.py` returns a fixed message).

```python
❌ WRONG — unhandled exception, stack trace to the client
def get_new_thing(request):
    return JsonResponse({"series": list(NewThing.objects.all()[:5].values())})

✅ RIGHT — trivia/views.py, get_mvps
try:
    qs = list(Mvp.objects.order_by('?')[:5])
    ...
except Exception as e:
    return JsonResponse({'error': str(e), 'message': "Error fetching MVP data"}, status=500)
```

## Rule BE-13: Every `path()` ends in `/`; mount prefixes are `api/`, `api/admin/`, `trivia/`

All routes in `users/urls.py`, `trivia/urls.py`, `trivia/admin_urls.py` and the generated
`path(f"{_slug}/", ...)` in `trivia/games/__init__.py` end in `/`. `users` mounts at `api/` (so
`/api/login/`), the admin API at `api/admin/`, trivia at `trivia/`. Every route has a `name=` (reused
via `reverse()` in tests, e.g. `reverse("manifest")`).

```python
❌ WRONG
path('new-endpoint', new_view, name='new-endpoint'),

✅ RIGHT — users/urls.py
path('get-users/', get_users, name='get-users'),
```

## Rule BE-14: Env vars — `os.environ.get` for scalars, `env_bool`/`env_list`/`env_list_merge` for typed values; secrets never hardcoded

`settings.py` reads scalars directly (`DJANGO_SECRET_KEY`, `DATABASE_URL`, `REDIS_URL`, `VERCEL_URL`,
`RENDER_EXTERNAL_HOSTNAME`), `users/views.py` reads `CLIENT_ID`/`CLIENT_SECRET` via `os.getenv`, and
booleans/lists go through `backend/env_utils.py` (`DEBUG = env_bool("DJANGO_DEBUG", True)`).
`CORS_ALLOWED_ORIGINS`/`CSRF_TRUSTED_ORIGINS` use `env_list_merge` against `FRONTEND_ORIGINS`: the env
value ADDS, never replaces, so a partial value cannot lock deployed frontends out. `backend/.env`
is loaded by `load_dotenv` for local use only (gitignored). The only literal default is the
dev-only `SECRET_KEY`. Feature-specific config that must exist to work fails loudly at use, not import
(`trivia/questions/storage.py::StorageConfig.from_env` raises `ImproperlyConfigured`). Document any new
variable in `backend/.env.example` and `docs/DEPLOYMENT.md`. Note `.env.example` still suggests the
session port `5432`; `docs/DEPLOYMENT.md` and `settings.py` are authoritative (Rule BE-20).

```python
❌ WRONG — hand-rolled boolean
FEATURE_X = os.environ.get("FEATURE_X", "false").lower() == "true"

✅ RIGHT — backend/backend/settings.py
DEBUG = env_bool("DJANGO_DEBUG", True)
CORS_ALLOWED_ORIGINS = env_list_merge("CORS_ALLOWED_ORIGINS", FRONTEND_ORIGINS)
```

## Rule BE-15: Task code reads the store and seeds; it never runs the NBA fetch on a request, hand-edits generated data, or extends superseded commands

Per `docs/DATA_PIPELINE.md`: `manage.py sync_nba_data` (`trivia/data_pipeline/sources.py`) must run
from a residential IP and is a home-machine job, never callable from a view or Vercel function.
`manage.py build_pools_from_db` is the only bridge from DB to served pools (Rule BE-3).
`manage.py refresh_game_data` and `backend/scripts/refresh_game_data.ps1` are superseded — still
present and tested (`trivia/tests/test_refresh_command.py`), but not the target for new work.
Pre-generated questions are a separate boundary: `trivia/questions/` (`runner.py`, per-game modules
registered in `trivia/questions/games/__init__.py::GAME_MODULES`, each exposing `SLUG`, `TARGET`,
`MINIMUM`, `generate`, `materialize`, `validate`, `index_item`, `players_referenced`, `qid_for`) is
driven only by `manage.py maintain_questions`, which downloads the players dataset from Supabase
Storage, updates the `Question` table inside one `transaction.atomic()` and publishes a snapshot.
Request handlers do not import `trivia.questions.runner`/`storage` write paths; `boto3` is imported
lazily (`storage.s3_client`) and lives in `requirements-publish.txt`, not `requirements.txt`.

```python
❌ WRONG — network fetch (or question generation) from a web request
def get_fresh_data(request):
    from trivia.data_pipeline import sources
    sources.fetch_teams()

✅ RIGHT — request code reads what the pipeline already stored
def get_random_nba_teams(request):
    qs = list(Team.objects.all())
```

## Rule BE-16: Django admin is used only for `users/`; trivia's admin surface is the `IsAdminUser` API, and `is_staff` is checked server-side

`backend/users/admin.py` registers `CustomUser`, `FriendRequest`, `Friendship`, `BlockedUser` and
unregisters simplejwt's `OutstandingToken`/`BlacklistedToken` from the sidebar (enforcement stays on).
There is no `trivia/admin.py`; the in-app admin panel is served by `trivia/admin_api.py` and
`trivia/feedback_api.py` under `api/admin/` (`trivia/admin_urls.py`), every view gated by
`@permission_classes([IsAdminUser])`. `user_payload`'s `is_admin` is only a UI hint. New trivia
tables that need inspection are added to `DB_SOURCES` in `admin_api.py`, not to a new admin.py.

```python
❌ WRONG — an admin endpoint relying on the frontend's flag
@api_view(["GET"])
@permission_classes([AllowAny])
def admin_thing(request): ...

✅ RIGHT — trivia/admin_api.py
@api_view(["GET"])
@permission_classes([IsAdminUser])
def admin_games(request): ...
```

## Rule BE-17: Test layout differs by app; game views are tested by calling `get_round` directly

`trivia/tests/` is a package with one `test_<feature>.py` per feature/game (plus shared helpers
`published_pool.py`, `questions_fixture.py`). `users/` keeps flat modules at the app root:
`users/tests.py`, `users/test_leaderboard.py`, `users/test_photos.py`. Match the app; do not add
`users/tests/` or `trivia/tests.py`. Because hidden games are unrouted (Rule BE-2), game-module tests
call the view directly instead of going through the URL:
`superdraft.get_round(RequestFactory().get("/"))` (`test_superdraft.py`, `test_pack_five.py`,
`test_imposter.py`, `test_nba_grid.py`, ...). Routed endpoints use `reverse(name)` + `self.client`
(`test_pool_endpoints.py`) or `APIClient` + `force_authenticate` for permission-gated ones
(`test_admin_api.py`). Redis-backed code is tested with an in-memory fake patched in
(`FakeRedis` in `users/test_leaderboard.py`); nothing in tests touches the network or real Redis.

```python
❌ WRONG — flat file in the trivia tests-package app / testing a hidden game via URL
# backend/trivia/test_new_game.py
self.client.get("/trivia/superdraft/")   # 404: hidden

✅ RIGHT — backend/trivia/tests/test_superdraft.py
body = json.loads(superdraft.get_round(RequestFactory().get("/")).content)
```

## Rule BE-18: Run the suite with `python manage.py test` (both apps) and treat a failing bare run as real

`backend/trivia/__init__.py` and `backend/trivia/tests/__init__.py` now exist, so Django's bare
`python manage.py test` discovers `trivia` as well as `users` (both forms currently discover 369 tests). (The earlier "bare run only executes
`users`" behavior no longer holds.) `docs/DEPLOYMENT.md` documents the explicit form
`manage.py test trivia users`; either is acceptable, and an app-scoped run is fine while iterating.
Always run from `backend/` with the venv interpreter.

```bash
❌ WRONG — reporting "tests pass" from a single test module after touching shared code
cd backend && python manage.py test trivia.tests.test_bingo

✅ RIGHT — the whole suite before handing back
cd backend && python manage.py test trivia users
```

## Rule BE-19: Throttle per view via `backend/throttles.py`; counters live in `CACHES`, whose 3 tiers exist because of it

There is deliberately no `DEFAULT_THROTTLE_CLASSES`: each throttle is a `UserRateThrottle` subclass in
`backend/backend/throttles.py` with a `scope`, whose rate lives in
`settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]`, applied with `@throttle_classes([...])` on
endpoints worth abusing (`login_view`, `signup_view`, `log_session`, `submit_feedback`,
`wordle_daily_play`, friends search/actions, `SessionRefreshView.throttle_classes`). Public game-data
reads stay unthrottled. DRF stores counters in the default cache, so `settings.py` picks `CACHES` by
environment: `REDIS_URL` set -> `RedisCache`; else `DATABASE_URL` set -> `DatabaseCache`
(`django_cache_table`, created by `createcachetable` in `vercel.json`'s build); else `LocMemCache`
(local/CI only). `LocMemCache` is per-process and every lambda is its own process, so throttling on
it is silently useless in production — never rely on it there and never reorder the tiers.
`users/leaderboard.py` follows the same REDIS_URL-or-Postgres idea with a lazy direct client:
`_redis()` returns `None` without `REDIS_URL`, `redis` is imported lazily, and every public function
(`top`, `rank_of`, `total`, `record_score`) has a Postgres path — so callers never branch on Redis.

```python
❌ WRONG — new limit with a hardcoded rate, no scope, or a global default
REST_FRAMEWORK = {"DEFAULT_THROTTLE_CLASSES": ["rest_framework.throttling.AnonRateThrottle"], ...}
@api_view(["POST"])
def new_write(request): ...

✅ RIGHT — throttles.py + settings.py + view
class FriendActionRateThrottle(UserRateThrottle):
    scope = "friend-action"
# settings.py: "friend-action": "60/hour"
@throttle_classes([FriendActionRateThrottle])
def send_friend_request(request): ...
```

## Rule BE-20: The API is serverless — connections are not persistent, the disk is read-only, deploy is manual

`settings.py` builds `DATABASES` from `DATABASE_URL` with `conn_max_age=0` (a persistent connection
per warm lambda exhausts the pooler's session slots) and `DISABLE_SERVER_SIDE_CURSORS = True` because
`DATABASE_URL` must be the Supabase TRANSACTION pooler (port 6543; `docs/DEPLOYMENT.md`) — so no
`.iterator()` assumptions about server-side cursors. Unset `DATABASE_URL` means local sqlite. Nothing
in a request path may write to the filesystem: profile photos are stored as bytes in
`CustomUser.profile_photo_data` (`users/photos.py`), static files go through WhiteNoise, and the
`trivia/data/` pools are read-only at runtime. Keep request bodies under Vercel's ~4.5 MB limit
(`MAX_PHOTO_UPLOAD_BYTES`). The API deploys only by manual `cd backend && vercel deploy --prod`
(not git-connected; uploads the working tree), and the build runs `migrate`, `createcachetable`,
`collectstatic`. `docs/ARCHITECTURE.md` still says "session pooler"; `settings.py` and
`docs/DEPLOYMENT.md` are authoritative.

```python
❌ WRONG — persistent connection / writing to disk in a view
DATABASES["default"]["CONN_MAX_AGE"] = 600
open(os.path.join(settings.MEDIA_ROOT, "profiles", name), "wb").write(upload.read())

✅ RIGHT — backend/backend/settings.py and users/views.py
dj_database_url.parse(DATABASE_URL, conn_max_age=0, ssl_require=DATABASE_URL.startswith("postgres"))
user.profile_photo_data = normalize_profile_photo(upload.read())
```

---

## Acceptance checks

Run from `backend/` with the venv interpreter (`venv\Scripts\python.exe` on Windows).

1. `python manage.py check` reports `System check identified no issues (0 silenced).`
2. `python manage.py makemigrations --check --dry-run` reports `No changes detected` (Rule BE-6).
3. `python manage.py test trivia users` is green (Rules BE-17, BE-18); a bare `python manage.py test` also covers both apps.
4. No new endpoint without a `path()` (trailing slash, `name=`) in the right `urls.py` or an `EXTRA_URLS` entry, and a test (Rules BE-2, BE-13, BE-17).
5. No new minigame outside `_GAME_MODULES`; `trivia/urls.py` gains no game route (Rule BE-2).
6. Round endpoints return `{"series": [...]}` (only `trivia/games/imposter.py` deviates) — `Grep` `"series"` across `trivia/games/*.py` (Rule BE-7).
7. No `@api_view` in `trivia/games/*.py`; no `serializers.py` in project code, excluding `venv/` (Rules BE-9, BE-10).
8. No edits under `trivia/data/` in a diff unless produced by `build_pools_from_db` (Rule BE-3).
9. Every new env var appears in `backend/.env.example` and `docs/DEPLOYMENT.md`; no secret literal in code (Rule BE-14).
10. New abuse-prone endpoints carry a scoped throttle with a rate in `settings.REST_FRAMEWORK` (Rule BE-19); admin endpoints use `IsAdminUser` (Rule BE-16).
11. No filesystem writes or persistent-connection settings in request paths (Rule BE-20); `grep include(` in `backend/backend/urls.py` shows exactly the three mounts (Rule BE-1).
