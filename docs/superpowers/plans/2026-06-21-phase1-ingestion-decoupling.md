# Phase 1 — Ingestion Decoupling + Versioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all NBA game data build through one validated, versioned Django management command that runs off-cloud (at home), so the live NBA API is never called from Render, and add additive "whole-pool" + manifest endpoints as the foundation for CDN delivery and client-side randomization.

**Architecture:** A new `trivia/data_pipeline/` package holds pure, offline-testable builders (static pools), pool validation, and manifest generation. A `refresh_game_data` management command orchestrates them, with `--skip-live` to reuse existing committed data (offline/CI) and a live mode that runs the existing `nba_api` builders at home. New read-only endpoints serve each whole pool and the manifest. Existing random endpoints are untouched (additive, non-breaking).

**Tech Stack:** Python 3.10+, Django 5.1, `nba_api` (static data is offline), stdlib `hashlib`/`json`/`csv`. No new dependencies.

## Global Constraints

- All paths are under `nba-minigames/backend/`. Run commands from `nba-minigames/backend/`.
- Run Python via the project venv: `venv/Scripts/python.exe` (Windows).
- No new pip dependencies.
- Surgical, additive changes only: do NOT modify or remove the existing random endpoints/views or the existing `trivia/utils/*.json` data files in this phase.
- Published game keys (canonical, used as filenames and endpoint params): `playoff`, `starting-five`, `name-logo`, `all-players`, `wordle`, `mvps`.
- The published data directory is `getattr(settings, "GAME_DATA_DIR", BASE_DIR/"trivia"/"data")`, read INSIDE functions (never module-level) so tests can override it.
- Commits: work on branch `feat/data-pipeline-phase1` (not the default branch). Commit steps are authorized (owner enabled autonomous PR flow). End commit messages with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Execution deviations (applied during the build)

1. **Registered the `trivia` app.** Django only discovers management commands from apps in
   `INSTALLED_APPS`, and `trivia` was missing. Added `'trivia'` to `backend/backend/settings.py`
   `INSTALLED_APPS` (Task 3). Safe: `trivia/models.py` declares no models, so no migrations are triggered.
2. **Flag renamed `--version` → `--label`.** Django's `BaseCommand` reserves `--version`; the manifest
   field is still `version`. All commands/tests use `--label`.
3. **Added `backend/trivia/tests/__init__.py`** so `trivia.tests.*` is an importable test package.

---

### Task 1: data_pipeline package — manifest + validation

**Files:**
- Create: `backend/trivia/data_pipeline/__init__.py`
- Create: `backend/trivia/data_pipeline/manifest.py`
- Create: `backend/trivia/data_pipeline/validate.py`
- Test: `backend/trivia/tests/test_data_pipeline.py`

**Interfaces:**
- Produces: `manifest.sha256_file(path: str) -> str`; `manifest.build_manifest(data_dir: str, version: str) -> dict` returning `{"version": str, "games": {key: {"file": str, "sha256": str, "count": int|None}}}`.
- Produces: `validate.validate_pool(key: str, data) -> list[str]` (empty list = valid).

- [ ] **Step 1: Write the failing test**

Create `backend/trivia/tests/test_data_pipeline.py`:
```python
import json
import os
import tempfile
from django.test import TestCase
from trivia.data_pipeline.manifest import build_manifest, sha256_file
from trivia.data_pipeline.validate import validate_pool


class ManifestTests(TestCase):
    def test_build_manifest_lists_games_with_hash_and_count(self):
        with tempfile.TemporaryDirectory() as d:
            with open(os.path.join(d, "wordle.json"), "w", encoding="utf-8") as f:
                json.dump(["jones", "smith"], f)
            with open(os.path.join(d, "manifest.json"), "w", encoding="utf-8") as f:
                json.dump({"stale": True}, f)
            m = build_manifest(d, "2026-06-21")
            self.assertEqual(m["version"], "2026-06-21")
            self.assertIn("wordle", m["games"])
            self.assertEqual(m["games"]["wordle"]["count"], 2)
            self.assertEqual(m["games"]["wordle"]["file"], "wordle.json")
            self.assertEqual(len(m["games"]["wordle"]["sha256"]), 64)
            self.assertNotIn("manifest", m["games"])  # manifest.json excluded


class ValidateTests(TestCase):
    def test_empty_pool_is_a_problem(self):
        self.assertTrue(validate_pool("wordle", []))

    def test_non_list_is_a_problem(self):
        self.assertTrue(validate_pool("wordle", {"x": 1}))

    def test_starting_five_requires_keys(self):
        self.assertTrue(validate_pool("starting-five", [{"game_id": "1"}]))
        self.assertFalse(
            validate_pool("starting-five", [{"game_id": "1", "starting_5": []}])
        )

    def test_good_wordle_pool_has_no_problems(self):
        self.assertEqual(validate_pool("wordle", ["jones"]), [])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `venv/Scripts/python.exe manage.py test trivia.tests.test_data_pipeline -v 2`
Expected: FAIL / ERROR — `ModuleNotFoundError: No module named 'trivia.data_pipeline'`.

- [ ] **Step 3: Create the package + manifest module**

Create `backend/trivia/data_pipeline/__init__.py` (empty file).

Create `backend/trivia/data_pipeline/manifest.py`:
```python
import hashlib
import json
import os


def sha256_file(path):
    """Return the hex SHA-256 of a file's bytes."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def build_manifest(data_dir, version):
    """List every published <key>.json (excluding manifest.json) with hash + count."""
    games = {}
    for name in sorted(os.listdir(data_dir)):
        if not name.endswith(".json") or name == "manifest.json":
            continue
        key = name[:-len(".json")]
        path = os.path.join(data_dir, name)
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        games[key] = {
            "file": name,
            "sha256": sha256_file(path),
            "count": len(data) if isinstance(data, list) else None,
        }
    return {"version": version, "games": games}
```

- [ ] **Step 4: Create the validation module**

Create `backend/trivia/data_pipeline/validate.py`:
```python
def validate_pool(key, data):
    """Return a list of human-readable problems for a pool. Empty list means valid."""
    if not isinstance(data, list):
        return [f"{key}: expected a list, got {type(data).__name__}"]
    problems = []
    if len(data) == 0:
        problems.append(f"{key}: empty pool")
    if key == "starting-five":
        for i, g in enumerate(data):
            if not isinstance(g, dict) or "game_id" not in g or "starting_5" not in g:
                problems.append(f"{key}[{i}]: missing game_id/starting_5")
                break
    if key == "playoff":
        for i, s in enumerate(data):
            if not isinstance(s, dict) or "season" not in s or "winner" not in s:
                problems.append(f"{key}[{i}]: missing season/winner")
                break
    return problems
```

- [ ] **Step 5: Run test to verify it passes**

Run: `venv/Scripts/python.exe manage.py test trivia.tests.test_data_pipeline -v 2`
Expected: PASS (6 tests OK).

- [ ] **Step 6: Commit**

```bash
git add backend/trivia/data_pipeline/__init__.py backend/trivia/data_pipeline/manifest.py backend/trivia/data_pipeline/validate.py backend/trivia/tests/test_data_pipeline.py
git commit -m "feat(data): add manifest + pool validation to data_pipeline" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: static pool builders (offline)

**Files:**
- Create: `backend/trivia/data_pipeline/build_static.py`
- Test: `backend/trivia/tests/test_build_static.py`

**Interfaces:**
- Consumes: `trivia.utils.logo_utils.logo` (existing).
- Produces: `build_name_logo_pool() -> list[dict]`; `build_all_players_pool() -> list[str]`; `build_wordle_pool() -> list[str]`; `build_mvps_pool(csv_path: str) -> list[dict]`.

- [ ] **Step 1: Write the failing test**

Create `backend/trivia/tests/test_build_static.py`:
```python
import os
from django.conf import settings
from django.test import TestCase
from trivia.data_pipeline.build_static import (
    build_name_logo_pool,
    build_all_players_pool,
    build_wordle_pool,
    build_mvps_pool,
)


class BuildStaticTests(TestCase):
    def test_name_logo_pool_has_30_teams_with_logo(self):
        pool = build_name_logo_pool()
        self.assertEqual(len(pool), 30)
        self.assertIn("logo", pool[0])
        self.assertTrue(pool[0]["logo"].startswith("https://cdn.nba.com/logos/"))

    def test_all_players_pool_is_nonempty_strings(self):
        pool = build_all_players_pool()
        self.assertGreater(len(pool), 1000)
        self.assertIsInstance(pool[0], str)

    def test_wordle_pool_only_five_letter_surnames(self):
        pool = build_wordle_pool()
        self.assertTrue(pool)
        self.assertTrue(all(len(name) == 5 for name in pool))

    def test_mvps_pool_reads_existing_csv(self):
        csv_path = os.path.join(settings.BASE_DIR, "trivia", "utils", "nba_mvps.csv")
        pool = build_mvps_pool(csv_path)
        self.assertTrue(pool)
        self.assertIsInstance(pool[0], dict)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `venv/Scripts/python.exe manage.py test trivia.tests.test_build_static -v 2`
Expected: FAIL / ERROR — `ModuleNotFoundError: No module named 'trivia.data_pipeline.build_static'`.

- [ ] **Step 3: Create the static builders**

Create `backend/trivia/data_pipeline/build_static.py`:
```python
import csv

from nba_api.stats.static import players, teams

from trivia.utils.logo_utils import logo


def build_name_logo_pool():
    """Team -> {team_id, full_name, abbreviation, logo} for the Name->Logo game."""
    return [
        {
            "team_id": t["id"],
            "full_name": t["full_name"],
            "abbreviation": t["abbreviation"],
            "logo": logo(t["id"]),
        }
        for t in teams.get_teams()
    ]


def build_all_players_pool():
    """Full names of all players (current + historical)."""
    return [p["full_name"] for p in players.get_players()]


def build_wordle_pool():
    """Five-letter player surnames for the Wordle game."""
    return [p["last_name"] for p in players.get_players() if len(p["last_name"]) == 5]


def build_mvps_pool(csv_path):
    """MVP rows read from the committed CSV (no network)."""
    with open(csv_path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `venv/Scripts/python.exe manage.py test trivia.tests.test_build_static -v 2`
Expected: PASS (4 tests OK).

- [ ] **Step 5: Commit**

```bash
git add backend/trivia/data_pipeline/build_static.py backend/trivia/tests/test_build_static.py
git commit -m "feat(data): add offline static pool builders (teams/players/wordle/mvps)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `refresh_game_data` management command

**Files:**
- Create: `backend/trivia/management/__init__.py`
- Create: `backend/trivia/management/commands/__init__.py`
- Create: `backend/trivia/management/commands/refresh_game_data.py`
- Test: `backend/trivia/tests/test_refresh_command.py`

**Interfaces:**
- Consumes: `build_static.*` (Task 2), `validate.validate_pool` (Task 1), `manifest.build_manifest` (Task 1), and existing `trivia/utils/playoff_data.json`, `starting_five_data.json`, `nba_mvps.csv`.
- Produces: command `refresh_game_data` with `--skip-live` and `--version`; writes `<key>.json` for all six keys + `manifest.json` into `GAME_DATA_DIR`.

- [ ] **Step 1: Write the failing test**

Create `backend/trivia/tests/test_refresh_command.py`:
```python
import json
import os
import tempfile
from django.core.management import call_command
from django.test import TestCase, override_settings


class RefreshCommandTests(TestCase):
    def test_skip_live_writes_all_pools_and_manifest(self):
        with tempfile.TemporaryDirectory() as d:
            with override_settings(GAME_DATA_DIR=d):
                call_command("refresh_game_data", "--skip-live", "--version", "test-1")
            with open(os.path.join(d, "manifest.json"), encoding="utf-8") as f:
                manifest = json.load(f)
            self.assertEqual(manifest["version"], "test-1")
            for key in ["playoff", "starting-five", "name-logo", "all-players", "wordle", "mvps"]:
                self.assertIn(key, manifest["games"])
                self.assertTrue(os.path.exists(os.path.join(d, f"{key}.json")))
                self.assertGreater(manifest["games"][key]["count"], 0)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `venv/Scripts/python.exe manage.py test trivia.tests.test_refresh_command -v 2`
Expected: FAIL / ERROR — `Unknown command: 'refresh_game_data'`.

- [ ] **Step 3: Create the management command package + command**

Create `backend/trivia/management/__init__.py` (empty).
Create `backend/trivia/management/commands/__init__.py` (empty).
Create `backend/trivia/management/commands/refresh_game_data.py`:
```python
import json
import os
from datetime import datetime, timezone

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from trivia.data_pipeline.build_static import (
    build_all_players_pool,
    build_mvps_pool,
    build_name_logo_pool,
    build_wordle_pool,
)
from trivia.data_pipeline.manifest import build_manifest
from trivia.data_pipeline.validate import validate_pool


def _data_dir():
    return getattr(
        settings, "GAME_DATA_DIR", os.path.join(settings.BASE_DIR, "trivia", "data")
    )


def _utils_dir():
    return os.path.join(settings.BASE_DIR, "trivia", "utils")


def _load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


class Command(BaseCommand):
    help = "Build, validate, and version all game data pools into GAME_DATA_DIR."

    def add_arguments(self, parser):
        parser.add_argument(
            "--skip-live",
            action="store_true",
            help="Skip nba_api network builders; reuse existing playoff/starting_five JSON.",
        )
        parser.add_argument(
            "--version",
            default=None,
            help="Manifest version label (default: UTC date, e.g. 2026-06-21).",
        )

    def handle(self, *args, **opts):
        data_dir = _data_dir()
        utils_dir = _utils_dir()
        os.makedirs(data_dir, exist_ok=True)
        version = opts["version"] or datetime.now(timezone.utc).strftime("%Y-%m-%d")

        pools = {
            "name-logo": build_name_logo_pool(),
            "all-players": build_all_players_pool(),
            "wordle": build_wordle_pool(),
            "mvps": build_mvps_pool(os.path.join(utils_dir, "nba_mvps.csv")),
        }

        if opts["skip_live"]:
            pools["playoff"] = _load_json(os.path.join(utils_dir, "playoff_data.json"))
            pools["starting-five"] = _load_json(
                os.path.join(utils_dir, "starting_five_data.json")
            )
        else:
            from trivia.utils.playoff_games_utils import build_local_playoff_database
            from trivia.utils.starting_five_utils import build_starting_five_database

            playoff_path = os.path.join(data_dir, "playoff.json")
            sf_path = os.path.join(data_dir, "starting-five.json")
            build_local_playoff_database(output_path=playoff_path, num_seasons=20)
            build_starting_five_database(output_path=sf_path, max_games_per_season=50)
            pools["playoff"] = _load_json(playoff_path)
            pools["starting-five"] = _load_json(sf_path)

        problems = []
        for key, data in pools.items():
            problems += validate_pool(key, data)
        if problems:
            raise CommandError("Validation failed:\n" + "\n".join(problems))

        for key, data in pools.items():
            with open(os.path.join(data_dir, f"{key}.json"), "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False)

        manifest = build_manifest(data_dir, version)
        with open(os.path.join(data_dir, "manifest.json"), "w", encoding="utf-8") as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2)

        self.stdout.write(
            self.style.SUCCESS(
                f"Wrote {len(pools)} pools + manifest (version {version}) to {data_dir}"
            )
        )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `venv/Scripts/python.exe manage.py test trivia.tests.test_refresh_command -v 2`
Expected: PASS (1 test OK).

- [ ] **Step 5: Generate the canonical data dir for serving + commit**

Run (populates the committed `trivia/data/` that Render will serve in Task 4):
```bash
venv/Scripts/python.exe manage.py refresh_game_data --skip-live
```
Expected: `Wrote 6 pools + manifest (version YYYY-MM-DD) to .../trivia/data`

- [ ] **Step 6: Commit**

```bash
git add backend/trivia/management/ backend/trivia/tests/test_refresh_command.py backend/trivia/data/
git commit -m "feat(data): add refresh_game_data command; generate versioned data dir" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: additive manifest + pool endpoints

**Files:**
- Modify: `backend/trivia/views.py` (append two views; do not touch existing ones)
- Modify: `backend/trivia/urls.py` (add two routes)
- Test: `backend/trivia/tests/test_pool_endpoints.py`

**Interfaces:**
- Consumes: `GAME_DATA_DIR` files written by Task 3; existing `load_dataset(path)` helper in views.
- Produces: `GET <manifest/>` → manifest JSON; `GET <pool/<game>/>` → `{"pool": [...], "count": N}`.

- [ ] **Step 1: Write the failing test**

Create `backend/trivia/tests/test_pool_endpoints.py`:
```python
import tempfile
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.urls import reverse


class PoolEndpointTests(TestCase):
    def test_manifest_and_pool_endpoints(self):
        with tempfile.TemporaryDirectory() as d:
            with override_settings(GAME_DATA_DIR=d):
                call_command("refresh_game_data", "--skip-live", "--version", "test-2")
                manifest = self.client.get(reverse("manifest"))
                self.assertEqual(manifest.status_code, 200)
                self.assertEqual(manifest.json()["version"], "test-2")

                pool = self.client.get(reverse("pool", args=["wordle"]))
                self.assertEqual(pool.status_code, 200)
                body = pool.json()
                self.assertGreater(body["count"], 0)
                self.assertEqual(len(body["pool"]), body["count"])

                missing = self.client.get(reverse("pool", args=["nope"]))
                self.assertEqual(missing.status_code, 404)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `venv/Scripts/python.exe manage.py test trivia.tests.test_pool_endpoints -v 2`
Expected: FAIL — `NoReverseMatch: Reverse for 'manifest' not found`.

- [ ] **Step 3: Append the two views**

Append to `backend/trivia/views.py` (after the existing code; do not modify existing functions). Note: read the data dir INSIDE each view so `override_settings` works:
```python
def _game_data_dir():
    return getattr(
        settings, "GAME_DATA_DIR", os.path.join(settings.BASE_DIR, "trivia", "data")
    )


def get_manifest(request):
    """Serve the versioned manifest of all published pools."""
    data = load_dataset(os.path.join(_game_data_dir(), "manifest.json"))
    if data is None:
        return JsonResponse(
            {"error": "manifest not found; run: manage.py refresh_game_data"}, status=404
        )
    return JsonResponse(data)


def get_pool(request, game):
    """Serve a whole game pool so the client can randomize locally / cache it."""
    safe = os.path.basename(game)  # block path traversal
    data = load_dataset(os.path.join(_game_data_dir(), f"{safe}.json"))
    if data is None:
        return JsonResponse({"error": f"pool '{game}' not found"}, status=404)
    return JsonResponse(
        {"pool": data, "count": len(data) if isinstance(data, list) else None}
    )
```

- [ ] **Step 4: Add the two routes**

Edit `backend/trivia/urls.py` — add the imports and two `path(...)` entries (keep existing routes unchanged):
```python
from .views import (
    get_random_playoff_series,
    get_random_nba_teams,
    get_mvps,
    get_starting_five,
    get_wordle,
    get_manifest,
    get_pool,
)
from trivia.dynamic_data.players import get_all_players

urlpatterns = [
    path('playoff-series/', get_random_playoff_series, name='playoff-series'),
    path('name-logo/', get_random_nba_teams, name='name-logo'),
    path('guess-mvps/', get_mvps, name='guess-mvp'),
    path('all-players/', get_all_players, name='all-players'),
    path('starting-five/', get_starting_five, name='starting-five'),
    path('wordle/', get_wordle, name='wordle'),
    path('manifest/', get_manifest, name='manifest'),
    path('pool/<str:game>/', get_pool, name='pool'),
]
```
(Note: this also fixes a pre-existing duplicate `name='starting-five'` on the wordle route by naming it `wordle` — required so `reverse('wordle')` is unambiguous. This is the only change to existing lines and is needed for correct routing.)

- [ ] **Step 5: Run test to verify it passes**

Run: `venv/Scripts/python.exe manage.py test trivia.tests.test_pool_endpoints -v 2`
Expected: PASS (1 test OK).

- [ ] **Step 6: Run the full trivia test suite**

Run: `venv/Scripts/python.exe manage.py test trivia -v 2`
Expected: PASS (all tests from Tasks 1-4 OK).

- [ ] **Step 7: Commit**

```bash
git add backend/trivia/views.py backend/trivia/urls.py backend/trivia/tests/test_pool_endpoints.py
git commit -m "feat(api): add additive manifest + whole-pool endpoints" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: home scheduler script + pipeline docs

**Files:**
- Create: `backend/scripts/refresh_game_data.ps1`
- Create: `backend/trivia/data_pipeline/README.md`

**Interfaces:**
- Consumes: the `refresh_game_data` command (Task 3).
- Produces: a one-command weekly refresh runnable from a residential machine + Task Scheduler instructions.

- [ ] **Step 1: Create the scheduler script**

Create `backend/scripts/refresh_game_data.ps1`:
```powershell
# Weekly NBA data refresh — RUN FROM A RESIDENTIAL MACHINE (not the cloud).
# stats.nba.com blocks data-center IPs, so the live fetch must run from home internet.
$ErrorActionPreference = "Stop"
Set-Location -Path (Join-Path $PSScriptRoot "..")   # -> backend/
& ".\venv\Scripts\python.exe" manage.py refresh_game_data
Write-Host "Refresh complete. Review git diff in backend/trivia/data/, then commit & push to publish."
```

- [ ] **Step 2: Verify the script parses (no execution of the live fetch)**

Run: `pwsh -NoProfile -Command "[System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path 'backend/scripts/refresh_game_data.ps1'), [ref]$null, [ref]$null) | Out-Null; 'parse OK'"`
Expected: `parse OK` (if `pwsh` is unavailable, open the file and confirm it matches Step 1 exactly).

- [ ] **Step 3: Create the pipeline README**

Create `backend/trivia/data_pipeline/README.md`:
```markdown
# Game data pipeline

All game data is built by one command and published as versioned JSON. The cloud
(Render) NEVER calls the NBA API — `stats.nba.com` blocks data-center IPs.

## Refresh the data (run at home, weekly)

```bash
cd backend
venv/Scripts/python.exe manage.py refresh_game_data        # live: fetches via nba_api
venv/Scripts/python.exe manage.py refresh_game_data --skip-live   # offline: reuse existing playoff/starting_five
```

This writes `trivia/data/<key>.json` for `playoff`, `starting-five`, `name-logo`,
`all-players`, `wordle`, `mvps`, plus `trivia/data/manifest.json` (version + per-file
SHA-256 + counts). Validation runs first; a malformed pool aborts the write.

Then commit & push `backend/trivia/data/` to publish.

## Endpoints (foundation for CDN + client-side randomization)

- `GET /api/manifest/` — current version + per-pool hash/count.
- `GET /api/pool/<game>/` — the whole pool for a game (client caches it and randomizes locally).

## Schedule it (Windows Task Scheduler)

Create a weekly task: Program `powershell.exe`, Arguments
`-NoProfile -ExecutionPolicy Bypass -File "C:\path\to\nba-minigames\backend\scripts\refresh_game_data.ps1"`.
Because the data is historical, weekly (or even monthly off-season) is plenty.
```

- [ ] **Step 4: Commit**

```bash
git add backend/scripts/refresh_game_data.ps1 backend/trivia/data_pipeline/README.md
git commit -m "docs(data): add home refresh script + pipeline README" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review (completed by plan author)

**Spec coverage (Phase 1 = spec §8.1):**
- "management command that runs the builders, validates, writes data files, emits manifest" → Tasks 1-3. ✅
- "home scheduler instructions/script" → Task 5. ✅
- "additive endpoint to serve a whole pool without removing the current random endpoints" → Task 4 (`pool/` + `manifest/`; existing views untouched). ✅
- "fixes blocking; lays versioning foundation" → command runs at home; manifest = version foundation. ✅
- Settings hardening + CDN + DB + Redis + multiplayer are explicitly LATER phases (spec §8.2-8.6) — correctly out of this plan.

**Placeholder scan:** none — every code/test/command block is complete with expected output. ✅

**Type/name consistency:** `validate_pool(key, data)`, `build_manifest(data_dir, version)`, `sha256_file(path)`, and the static builders are defined in Tasks 1-2 and consumed with identical names/signatures in Task 3; the six published keys (`playoff`, `starting-five`, `name-logo`, `all-players`, `wordle`, `mvps`) are used identically across Tasks 3-4; `GAME_DATA_DIR` is read inside functions in both the command (Task 3) and views (Task 4) so `override_settings` works in tests. ✅
