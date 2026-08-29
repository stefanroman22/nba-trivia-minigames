# Backend Constraints (Django API)

**Scope:** the Django project under `backend/` — the `users` app (accounts, auth, leaderboard)
and the `trivia` app (game data: central store, modular per-game backends, data pipeline
entry points). Frontend conventions are `docs/constraints/UI_SHELL_CONSTRAINTS.md` territory;
the data-gathering pipeline internals (NBA API fetch, validation, publishing to R2) are
`docs/DATA_PIPELINE.md` territory — this doc only states the *boundary* task code must respect,
not how the pipeline works internally.

**Reference implementations** (read these before touching backend code):

| Concern | Reference |
|---|---|
| Settings / env-var pattern | `backend/backend/settings.py`, `backend/backend/env_utils.py` |
| URL mounting | `backend/backend/urls.py` |
| Central game-data store (models) | `backend/trivia/models.py` |
| Classic (non-modular) game endpoints | `backend/trivia/views.py`, `backend/trivia/urls.py` |
| Modular per-game backend + aggregation | `backend/trivia/games/__init__.py`, `backend/trivia/games/bingo.py` |
| Auth / accounts endpoints | `backend/users/views.py`, `backend/users/urls.py`, `backend/users/tokens.py` |
| Data-migration example (non-auto-generated) | `backend/users/migrations/0003_identity_overhaul.py` |
| Data pipeline boundary | `docs/DATA_PIPELINE.md` |

Everything below is measured from the live codebase (working tree, not just the last commit).
Where the code is inconsistent, the DOMINANT pattern is documented and the exception is called
out explicitly — nothing here is an aspirational convention the code doesn't actually show.

---

## Rule BE-1: Two apps, one project package — `users/` and `trivia/` are siblings of `backend/backend/`

`backend/` holds the Django project package `backend/backend/` (`settings.py`, `urls.py`,
`wsgi.py`, `asgi.py`, plus a project-local `env_utils.py`) and two INSTALLED_APPS,
`backend/users/` and `backend/trivia/`. `backend/backend/urls.py` is the only ROOT_URLCONF and
mounts each app under its own prefix.

```python
❌ WRONG — a new app's URLs wired directly into backend/backend/urls.py instead of its own urls.py
urlpatterns = [
    path('admin/', admin.site.urls),
    path('leaderboard/', leaderboard_view),   # bypasses the per-app urls.py convention
]

✅ RIGHT — backend/backend/urls.py, every app mounted via include()
urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include('users.urls')),
    path('trivia/', include('trivia.urls')),
]
```

## Rule BE-2: A new minigame is a module under `trivia/games/`, registered in one dict — never a hand-wired URL

`trivia/games/__init__.py` maps module name → public slug in `_GAME_MODULES` and, for each
importable module, auto-registers `get_round` as `<slug>/`, collects `build_pool` into
`POOL_BUILDERS`, `validate_rows` into `VALIDATORS`, and any `EXTRA_URLS`. `trivia/urls.py`
appends this package's `urlpatterns` once. All 13 registered games (`heatmap.py`, `bingo.py`,
`tictactoe.py`, `connections.py`, `career_path.py`, `nba_grid.py`, `who_are_ya.py`,
`contexto.py`, `who_would_win.py`, `pack_five.py`, `superdraft.py`, `imposter.py`,
`players_index.py`) follow this shape — none of them touch `trivia/urls.py` directly.

```python
❌ WRONG — wiring a new game's endpoint straight into trivia/urls.py
# trivia/urls.py
urlpatterns = [
    path('new-game/', new_game_views.get_round, name='new-game'),
    ...
]

✅ RIGHT — trivia/games/__init__.py, one dict entry
_GAME_MODULES = {
    ...
    "new_game": "new-game",   # module trivia/games/new_game.py, URL /trivia/new-game/
}
```

Per-module import guards (`try: import_module(...) except Exception: continue`) mean one broken
module 404s only its own slug — the other 12 games keep working.

## Rule BE-3: `trivia/data_static/` is authored source; `trivia/data/` is generated output — never hand-edit the latter

Seed content that a human/tool authors and commits (`tictactoe_seed.json`, `bingo_seed.json`,
`players_curated.json`, `heatmap_seed.json`, `imposter_seed.json`, `superdraft_seed.json`, ...)
lives in `trivia/data_static/`. The versioned pools actually served to the frontend/CDN
(`trivia/data/<key>.json` + `trivia/data/manifest.json`) are *generated* by
`manage.py build_pools_from_db` from the DB + `trivia/games/*.py`'s `build_pool()` functions —
they are build output, not something to edit by hand.

```python
❌ WRONG — editing the served pool file directly
# hand-editing backend/trivia/data/bingo.json to fix a typo

✅ RIGHT — fix the source, then regenerate
# 1. edit backend/trivia/data_static/bingo_seed.json
# 2. python manage.py build_pools_from_db
```

## Rule BE-4: `trivia/models.py` is one shared "big data" store — games query it, they don't own tables

`trivia/models.py`'s own module docstring states the convention: "One normalized set of tables
that every current and future game queries... no game owns its own storage." `Team`, `Player`,
`PlayoffSeries`, `Mvp`, `StartingFiveGame` feed multiple/future games; `GameSession` and
`GuessLog` are cross-game logging tables (`game = models.CharField(...)` distinguishes rows, not
a per-game table).

```python
❌ WRONG — a new game creates its own dedicated model/table
class NewGameRound(models.Model):
    ...

✅ RIGHT — trivia/models.py, GuessLog already covers any game's answer log
class GuessLog(models.Model):
    game = models.CharField(max_length=40)
    question_id = models.CharField(max_length=60, blank=True)
    answer = models.CharField(max_length=120)
    ...
```

## Rule BE-5: Every model has a docstring naming what game(s) it feeds, and `Meta.indexes` match the actual query pattern

Every model in `trivia/models.py` opens with a one-line docstring like `"""An NBA franchise.
Feeds the Name->Logo game and team lookups."""` (`Team`) or `"""Every NBA player... Feeds
Wordle and All-Players."""` (`Player`). Indexes are added for fields the code actually
filters/orders by — `Player.Meta.indexes` covers `is_active` and `last_name` because
`trivia/views.py`'s `get_wordle` filters/annotates on `last_name`; `GuessLog.Meta.indexes`
covers `["game", "question_id"]` because `nba_grid.py`'s tally endpoint filters on exactly that
pair. Natural/business-key primary keys are used where the source data has one
(`Team.team_id`, `Player.person_id`, `StartingFiveGame.game_id`, `FanFavoritesQuestion.qid`)
rather than defaulting every model to `BigAutoField`.

```python
❌ WRONG — a new model with no docstring and an index that doesn't match any query
class NewThing(models.Model):
    value = models.CharField(max_length=50)
    class Meta:
        indexes = [models.Index(fields=["value"])]  # nothing ever filters on `value`

✅ RIGHT — trivia/models.py, PlayoffSeries
class PlayoffSeries(models.Model):
    """One completed playoff series, stored canonically (winner/loser)."""
    season = models.CharField(max_length=7)
    ...
    class Meta:
        indexes = [models.Index(fields=["season"])]  # views order/filter by season
```

## Rule BE-6: Migrations are auto-generated by `makemigrations`; a hand-authored data migration is the one named exception

`users/migrations/0002_alter_customuser_rank.py`, `trivia/migrations/0002_alter_playoffseries_series_id.py`,
`trivia/migrations/0003_fanfavoritesquestion_gamesession_guesslog.py`, and
`trivia/migrations/0004_fanfavoritesquestion_category.py` all carry Django's default
auto-generated names. The one exception, `users/migrations/0003_identity_overhaul.py`, was
manually renamed and hand-written with a `RunPython` step
(`backfill_public_ids`) to safely add a unique `public_id` to a live table — a deliberate,
documented departure for a real data migration, not something to imitate for an ordinary field
add. Whichever kind, a migration must be generated/committed in the same change as the model
edit — `manage.py makemigrations --check --dry-run` must report no changes needed.

```python
❌ WRONG — editing trivia/models.py without a matching migration
# models.py changed, no new file under trivia/migrations/ — makemigrations --check fails

✅ RIGHT — model + migration land together (current working tree)
# backend/trivia/models.py: FanFavoritesQuestion gains `category`
# backend/trivia/migrations/0004_fanfavoritesquestion_category.py: matching AddField
```

## Rule BE-7: A "give me a round" GET endpoint returns `{"series": [...]}` — two named exceptions

Every classic round endpoint in `trivia/views.py` (`get_random_playoff_series`,
`get_random_nba_teams`, `get_mvps`, `get_starting_five`, `get_wordle`, `get_fan_favorites`) and
11 of the 13 modular `trivia/games/*.py` `get_round` functions return
`JsonResponse({"series": [...]})` — several modules' own docstrings call this "the standard
`{'series': [...]}` envelope" (e.g. `heatmap.py`, `tictactoe.py`, `who_are_ya.py`). Two modules
deviate, and both say so in their own docstrings: `imposter.py` returns
`{"mystery_pool": [...]}` (it publishes a name list, not a "round"), and `superdraft.py` returns
the raw objectives seed dict unwrapped (`JsonResponse(seed)`).

```python
❌ WRONG — a new game's get_round skipping the standard envelope with no documented reason
def get_round(request):
    return JsonResponse(random.choice(rows))   # bare dict, not {"series": [...]}

✅ RIGHT — trivia/games/heatmap.py
def get_round(request):
    """One random seed row in the standard {'series': [...]} envelope."""
    rows = _load_seed()
    if not rows:
        return JsonResponse({"error": "The Heatmap content not ready"}, status=503)
    return JsonResponse({"series": [random.choice(rows)]})
```

## Rule BE-8: Modular `get_round` returns `503` for "seed not ready"; classic `trivia/views.py` endpoints use `404`/`500` for "no data" — don't mix them up

Every `trivia/games/*.py` `get_round` returns `503` with `{"error": "<Game Name> content not
ready"}` when its bundled seed is empty (`bingo.py`, `contexto.py`, `players_index.py`, etc. —
13 for 13). The older, non-modular endpoints in `trivia/views.py` use different codes for the
equivalent case: `get_starting_five` returns `404` (`'No games available.'`), `get_mvps` /
`get_wordle` / `get_random_nba_teams` return `500` inside a `try/except`. Match whichever layer
you're extending — don't invent a third status for "no data" in either.

```python
❌ WRONG — a new modular game module returning 404 like the classic endpoints do
if not rows:
    return JsonResponse({"error": "content not ready"}, status=404)

✅ RIGHT — trivia/games/contexto.py, matching every other modular game
if not rows:
    return JsonResponse({"error": "LeContexto content not ready"}, status=503)
```

## Rule BE-9: DRF's `@api_view` is for auth/permission-gated or body-parsing endpoints only — public read-only game data is plain Django views

`@api_view([...])` (+ `permission_classes`) is used throughout `users/views.py` (every endpoint
needs `request.data` parsing and/or `IsAuthenticated`/`AllowAny` control) and on exactly two
`trivia/views.py` endpoints, `log_guesses`/`log_session` (both POST, both read `request.data`).
Every other trivia read endpoint — the rest of `trivia/views.py` (`get_random_playoff_series`,
`get_mvps`, `get_wordle`, `get_manifest`, `get_pool`, ...) and all 13 `trivia/games/*.py`
`get_round` functions — is a bare Django view function returning `django.http.JsonResponse`
directly, with no `@api_view` anywhere in `trivia/games/`.

```python
❌ WRONG — wrapping a new public read-only game endpoint in DRF machinery it doesn't need
@api_view(["GET"])
@permission_classes([AllowAny])
def get_round(request):
    return Response({"series": [...]})

✅ RIGHT — trivia/games/bingo.py, a plain view like every other get_round
def get_round(request):
    rows = _load_seed()
    if not rows:
        return JsonResponse({"error": "NBA Bingo content not ready"}, status=503)
    return JsonResponse({"series": [random.choice(rows)]})
```

## Rule BE-10: No `serializers.py` anywhere — response shapes are hand-built dicts via small helper functions

There is no `serializers.py` in the project (only inside `backend/venv/`, DRF's own). Every
response is a plain dict/list built by a small, named helper: `user_payload` / `auth_response`
in `users/views.py`, `_playoff_row` / `_starting_five_row` / `_fan_favorites_row` in
`trivia/views.py`. New endpoints follow this — don't introduce the first `ModelSerializer` in
the codebase without discussing it first; it would be a new convention, not a continuation of
one.

```python
❌ WRONG — introducing DRF ModelSerializer where nothing else in the project uses one
class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = CustomUser
        fields = ["public_id", "username", "email"]

✅ RIGHT — users/views.py, the existing hand-built-dict convention
def user_payload(request, user):
    """The user object shape the frontend expects."""
    return {
        "id": user.public_id,
        "username": user.username,
        "email": user.email,
        "rank": user.rank,
        "points": user.points,
        "profile_photo": profile_photo_url(request, user),
    }
```

## Rule BE-11: Every trivia game-data read tries the DB first, then falls back to a bundled file — players never see a hard error for missing data

`get_random_playoff_series`, `get_random_nba_teams`, `get_mvps`, `get_starting_five`,
`get_wordle`, `get_fan_favorites`, and `get_all_players` (`trivia/dynamic_data/players.py`) all
query the DB model first and, only if that returns nothing, fall back to a bundled JSON/CSV
file or `nba_api`'s static lists — `trivia/views.py`'s own comment states the reason: "Each
endpoint falls back to the bundled JSON/CSV/static source if its table is empty or the DB is
unreachable, so players never receive an error or stale-empty pool."

```python
❌ WRONG — a new endpoint that 500s the moment the table is empty
def get_new_thing(request):
    rows = NewThing.objects.all()
    if not rows:
        return JsonResponse({"error": "no data"}, status=500)  # no fallback

✅ RIGHT — trivia/views.py, get_starting_five
def get_starting_five(request):
    g = StartingFiveGame.objects.order_by('?').first()
    if g:
        return JsonResponse({"series": [_starting_five_row(g)]})
    data = load_dataset(STARTING_FIVE_DATA_PATH)   # bundled fallback
    if not data:
        return JsonResponse({'error': 'No games available.'}, status=404)
    return JsonResponse({"series": [random.choice(data)]})
```

## Rule BE-12: Risky view logic is wrapped in broad `try/except Exception`, returning `{"error": str(e)}`

`trivia/views.py` (`get_random_nba_teams`, `get_mvps`, `get_wordle`, `get_fan_favorites`) and
`users/views.py` (`signup_view`, `get_current_user`, `google_login`, `get_users`) all catch
`Exception` broadly and return `{"error": str(e)}` (or `{"error": ..., "message": ...}`) at a
4xx/5xx status rather than letting Django's default error page render. This is the dominant
error-handling shape in both apps — new view code should match it rather than letting exceptions
propagate.

```python
❌ WRONG — a new view with no error handling, letting an unhandled exception 500 with a stack trace
def get_new_thing(request):
    rows = NewThing.objects.all()[:5]
    return JsonResponse({"series": list(rows)})

✅ RIGHT — trivia/views.py, get_mvps
def get_mvps(request):
    try:
        qs = list(Mvp.objects.order_by('?')[:5])
        ...
    except Exception as e:
        return JsonResponse({'error': str(e), 'message': "Error fetching MVP data"}, status=500)
```

## Rule BE-13: Every `path()` ends in a trailing slash; `users` is mounted at `api/`, not `users/`

Both `users/urls.py` and `trivia/urls.py` (classic and modular) end every route in `/` —
`path('login/', ...)`, `path('playoff-series/', ...)`, `path(f"{_slug}/", ...)` in
`trivia/games/__init__.py`. The mount prefix in `backend/backend/urls.py` does not mirror the
app name for `users` — it's `path('api/', include('users.urls'))`, so `users`' endpoints are
`/api/login/`, `/api/signup/`, etc., while `trivia` mounts at its own name,
`path('trivia/', include('trivia.urls'))`.

```python
❌ WRONG — a new route missing the trailing slash
path('new-endpoint', new_view, name='new-endpoint'),

✅ RIGHT — users/urls.py, matching every existing route
path('get-users/', get_users, name='get-users'),
```

## Rule BE-14: Settings read env vars with `os.environ.get(NAME, default)` for scalars, and typed `env_bool`/`env_list` helpers for booleans/lists

`backend/backend/settings.py` reads simple string/URL env vars directly —
`os.environ.get("DJANGO_SECRET_KEY", <dev-only-default>)`, `os.environ.get("DATABASE_URL")`,
`os.getenv("CLIENT_ID")` (in `users/views.py`) — and routes anything boolean or comma-separated
through `backend/backend/env_utils.py`'s `env_bool`/`env_list`/`env_list_merge`:
`DEBUG = env_bool("DJANGO_DEBUG", True)`, `ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", [...])`.
`CORS_ALLOWED_ORIGINS` / `CSRF_TRUSTED_ORIGINS` use **`env_list_merge`**, not `env_list`: the env
value is *added* to `settings.FRONTEND_ORIGINS` rather than replacing it, so a partial value can
never evict the deployed frontends and lock them out of the API (it did once). Reach for
`env_list_merge` for any list where dropping a baseline entry breaks the app rather than merely
narrowing it. Local dev loads
`backend/.env` via `load_dotenv(BASE_DIR / ".env")` (gitignored); production sets real env vars
(documented in `backend/.env.example`, `docs/DEPLOYMENT.md`). No secret is ever hardcoded as a
literal for production use — the one inline default (`SECRET_KEY`'s `"django-insecure-..."`
string) is explicitly commented as the local/dev-only fallback.

```python
❌ WRONG — a new boolean setting parsed by hand instead of using env_bool
FEATURE_X = os.environ.get("FEATURE_X", "false").lower() == "true"

✅ RIGHT — backend/backend/settings.py, the existing helper
DEBUG = env_bool("DJANGO_DEBUG", True)
```

## Rule BE-15: Task code may query `trivia/models.py`'s tables and `trivia/data_static/` seeds — it may not touch `sync_nba_data` internals, hand-edit `trivia/data/`, or extend the superseded `refresh_game_data`

Per `docs/DATA_PIPELINE.md`: the NBA-API fetch (`manage.py sync_nba_data`, `trivia/data_pipeline/sources.py`)
"must run from a residential IP" and is a scheduled, offline, home-machine-only operation — it
must never be called from a request/view. `manage.py build_pools_from_db` is the only supported
bridge from the DB to the served `trivia/data/*.json` pools (Rule BE-3). `manage.py
refresh_game_data` and `backend/scripts/refresh_game_data.ps1` are explicitly documented as
superseded ("predate `sync_nba_data`/`build_pools_from_db`... Left in the codebase but
undocumented elsewhere; use `sync_nba_data` for anything new") — still present and still tested
(`trivia/tests/test_refresh_command.py`, `trivia/tests/test_pool_endpoints.py`), but not the
target for new work.

```python
❌ WRONG — a view or new management command calling the NBA-API fetch on request
def get_fresh_data(request):
    from trivia.data_pipeline import sources
    sources.fetch_teams()   # network call to stats.nba.com from a web request — will be blocked anyway

✅ RIGHT — task code reads the store trivia/models.py already populated
def get_random_nba_teams(request):
    qs = list(Team.objects.all())
    ...
```

## Rule BE-16: Only `users/admin.py` exists — trivia's models aren't Django-admin-registered

`backend/users/admin.py` registers `CustomUser` with a customized `UserAdmin` and explicitly
unregisters the `token_blacklist` app's `OutstandingToken`/`BlacklistedToken` from the admin
sidebar (enforcement stays on via `SIMPLE_JWT`; only the admin UI clutter is removed). There is
no `trivia/admin.py` — `Team`, `Player`, `PlayoffSeries`, `Mvp`, `StartingFiveGame`,
`FanFavoritesQuestion`, `GameSession`, `GuessLog`, `SyncRun` are managed exclusively through
management commands and API endpoints, not the Django admin.

```python
❌ WRONG — adding a trivia/admin.py to inspect SyncRun rows in the admin UI
# trivia/admin.py
admin.site.register(SyncRun)

✅ RIGHT — inspect via a management command or the ORM/shell, matching current practice
python manage.py shell -c "from trivia.models import SyncRun; print(SyncRun.objects.order_by('-created_at')[:5])"
```

## Rule BE-17: Test file layout differs by app — `trivia/tests/` is a package, `users/` keeps two flat files at the app root

`trivia/tests/` is a Python package with one `test_<feature>.py` per feature/game
(`test_bingo.py`, `test_heatmap.py`, `test_nba_grid.py`, `test_pool_endpoints.py`,
`test_data_pipeline.py`, ...). `users/` instead has two flat modules directly under `users/`:
`users/tests.py` (signup/login/session tests) and `users/test_leaderboard.py`. Both conventions
are live and neither is being migrated to the other — match whichever app you're adding tests
to; don't introduce a `users/tests/` package or a `trivia/tests.py` file.

```python
❌ WRONG — adding a new trivia test as a flat trivia/test_new_game.py file
# backend/trivia/test_new_game.py

✅ RIGHT — inside the existing trivia/tests/ package
# backend/trivia/tests/test_new_game.py
```

## Rule BE-18: A bare `python manage.py test` silently runs only 30 of the project's 121 tests — always name both apps

`backend/trivia/__init__.py` does not exist (`trivia` is a namespace package; `users/__init__.py`
does exist). Because of this, Django's default bare `python manage.py test` (no labels) —
which discovers tests via plain `unittest` package discovery — finds and runs only the `users`
app's 30 tests and reports `OK`; it silently never runs `trivia`'s 91 tests (`trivia/tests/*.py`).
Passing the app labels explicitly, `python manage.py test users trivia` (or `python manage.py
test trivia` alone), finds and runs all 121. A bare `manage.py test` reporting `OK` is **not**
evidence the trivia suite passed — verified directly (see Acceptance checks below).

```bash
❌ WRONG — trusting a bare invocation as "the test suite passed"
cd backend && python manage.py test
# Found 30 test(s) ... OK   <- trivia's 91 tests never ran, but this looks green

✅ RIGHT — name the apps explicitly (or run per-app while iterating on one)
cd backend && python manage.py test users trivia
# Found 121 test(s) ... OK
```

---

## Acceptance checks

Concrete commands (run from the repo root unless noted) an automated reviewer can run against a
diff. All outputs below were captured directly against the current working tree.

**1. Django system check is clean.**
```bash
cd backend && python manage.py check
```
Observed: `System check identified no issues (0 silenced).`

**2. Migrations are in sync with models (Rule BE-6).**
```bash
cd backend && python manage.py makemigrations --check --dry-run
```
Observed: `No changes detected` (exit code 0).

**3. The full suite only runs when both apps are named (Rule BE-18).**
```bash
find backend/trivia -maxdepth 1 -name "__init__.py"          # confirms the missing file
cd backend && python manage.py test 2>&1 | grep -E "^Found|^OK"
cd backend && python manage.py test users trivia 2>&1 | grep -E "^Found|^OK"
```
Observed: first `find` prints nothing (file absent); bare `test` → `Found 30 test(s).` / `OK`;
`test users trivia` → `Found 121 test(s).` / `OK`.

**4. Round-envelope exceptions match exactly the two documented modules (Rule BE-7).**
```bash
grep -L '"series"' backend/trivia/games/{bingo,heatmap,connections,contexto,tictactoe,nba_grid,who_are_ya,who_would_win,career_path,pack_five,players_index,imposter,superdraft}.py
```
Observed: exactly `backend/trivia/games/imposter.py` and `backend/trivia/games/superdraft.py`.
Any other file appearing here is a new, undocumented violation of Rule BE-7.

**5. No `@api_view` inside the modular game package (Rule BE-9).**
```bash
grep -rl "@api_view" backend/trivia/games/*.py
```
Observed: no output (no matches). Any match here is a new violation.

**6. No `serializers.py` in project code (Rule BE-10).**
```bash
find backend -iname "serializers.py" -not -path "*/venv/*"
```
Observed: no output. A new `serializers.py` appearing here is a new convention that should be
discussed, not assumed.

**7. `trivia` has no `admin.py` (Rule BE-16).**
```bash
find backend -maxdepth 2 -iname "admin.py"
```
Observed: `backend/users/admin.py` only.

**8. URL mount prefixes (Rule BE-1, BE-13).**
```bash
grep -n "include(" backend/backend/urls.py
```
Observed:
```
10:    path('api/', include('users.urls')), 
11:    path('trivia/', include('trivia.urls')),
```
