# Questions Store + Supabase Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pre-generate one-round "questions" for the six player-pool games, keep them in a Postgres `questions` table that a daily job prunes and tops up, publish them as versioned immutable snapshots in Supabase Storage, and make web + multiplayer fetch only the question they play (plus one small name list) instead of the 4.1 MB player pool.

**Architecture:** Two tiers by change rate — raw datasets (rare) in Storage under `datasets/`, questions (scheduled churn) in Postgres, materialized into `questions/v/<version>/…` files with a 60-second `manifest.json` pointer (the existing `publish.py` pattern). Generators/materializers/validators live in `trivia/questions/games/<slug>.py`; `maintain_questions` runs them in GitHub Actions and publishes; clients read manifest → index → one question file.

**Tech Stack:** Django 5.1 (Postgres via Supabase pooler in prod, SQLite in tests), boto3 (S3-compatible Supabase Storage), `requests`, GitHub Actions, Next.js 16 / React / TypeScript frontend (`VITE_*` env names kept), Node Socket.IO multiplayer server on Railway.

**Spec:** `docs/superpowers/specs/2026-09-10-questions-store-design.md`

## Global Constraints

- Prerequisite: `fix/data-quality-audit` is merged into `dev` first (5,208-row dataset, `trivia/data_pipeline/live_pool.py`, `curated_players.playable_rows`). Every task branches from that `dev`.
- Frozen row schema of `players_curated.json` (contract #1) — never add/rename/remove player fields.
- Snapshot file envelope: `{"schema": 1, "game": "<slug>", "qid": "<qid>", …}`. `SUPPORTED_SCHEMA = 1` everywhere. **Additive-only** changes to any published shape.
- Cache headers: versioned files `public, max-age=31536000, immutable`; manifests `public, max-age=60` (constants `POOL_CACHE`/`MANIFEST_CACHE` in `trivia/data_pipeline/publish.py`). Manifest is always written **last**.
- Storage layout: `datasets/manifest.json`, `datasets/players/v/<dsver>/players_curated.json`, `questions/manifest.json`, `questions/v/<ver>/players-names.json`, `questions/v/<ver>/<game>/index.json`, `questions/v/<ver>/<game>/<qid>.json`. Retention keeps the 3 newest `questions/v/*`.
- Env var names (values are Stefan's; never commit a value, never invent one): `SUPABASE_S3_ENDPOINT`, `SUPABASE_S3_REGION`, `SUPABASE_S3_ACCESS_KEY_ID`, `SUPABASE_S3_SECRET_ACCESS_KEY`, `SUPABASE_STORAGE_BUCKET`, `QUESTIONS_PUBLIC_BASE`, `VITE_QUESTIONS_BASE`, `DATABASE_URL`, `GITHUB_DISPATCH_TOKEN`.
- Per-game targets/minimums: career-path 300/50 · who-are-ya all-eligible/30 · contexto 90 days/30 · superdraft 200/30 · tictactoe 60/12 · imposter 1 row / 20 names. Tic-Tac-Toe cells 3 ≤ valid ≤ 400. SuperDraft slots 8 ≤ eligible ≤ 250.
- Tests: `cd backend && python manage.py test` must stay green (284 today) and `python manage.py makemigrations --check --dry-run` clean. Frontend: `npm run lint` and `npm run build` clean, plus a real browser pass for every renderer touched.
- Commits: conventional prefix (`feat(questions): …`), end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. One PR to `dev` per phase (A–G); shipping follows `CLAUDE.md` "Shipping".
- Windows dev machine: `PYTHONIOENCODING=utf-8` when printing accented names; the `gh` account must be `stefanroman22`.

---

## File structure

**Backend (create)**
- `backend/trivia/questions/__init__.py` — package doc only
- `backend/trivia/questions/base.py` — `Invalid`, `Dataset`, `envelope()`, `load_dataset_from_rows()`
- `backend/trivia/questions/hashing.py` — `content_hash(definition)`
- `backend/trivia/questions/storage.py` — `StorageConfig`, `s3_client`, `public_url`, `fetch_json`, `download_players_dataset`, `next_version`
- `backend/trivia/questions/similarity.py` — Contexto similarity (Python port), `rank_pool`
- `backend/trivia/questions/games/__init__.py` — `GAME_MODULES` registry
- `backend/trivia/questions/games/{career_path,who_are_ya,tictactoe,superdraft,contexto,imposter}.py`
- `backend/trivia/questions/snapshot.py` — names file, index files, question files, manifest, publish plan, retention
- `backend/trivia/questions/runner.py` — the job (materialize → retire → top-up → minimum gate → publish, transactional)
- `backend/trivia/management/commands/maintain_questions.py`, `upload_dataset.py`
- `backend/scripts/make_players_fixture.py` → `backend/trivia/tests/fixtures/players_fixture.json`
- `backend/trivia/tests/test_questions_*.py`
- `.github/workflows/maintain-questions.yml`

**Backend (modify)**
- `backend/trivia/models.py` — `Question`
- `backend/trivia/admin_api.py`, `backend/trivia/admin_urls.py` — questions endpoints
- `backend/scripts/refresh_nba_data.cmd` — `upload_dataset` step
- `backend/trivia/games/{career_path,who_are_ya,contexto,superdraft,imposter,tictactoe}.py` — Phase G removals

**Frontend (create)**
- `src/utils/questions.ts`, `src/hooks/useNames.ts`, `src/components/admin/QuestionsTab.tsx`

**Frontend (modify)**
- `src/types/types.tsx`, `next.config.ts`, `src/utils/GameUtils.tsx`, `src/Game Renderers/{CareerPath,WhoAreYa,TicTacToe,SuperDraft,Contexto,ImposterGame}.tsx`, `src/views/Admin.tsx`; Phase G deletes `src/hooks/useRoundPool.ts`

**Multiplayer (create/modify)**
- `multiplayer_server/src/questions.js` (new), `gameEndpoints.js`, `index.js`, `turnGames.js`, `scripts/sim_turngames.js`

---

# Phase A — Backend + storage (branch `feat/questions-a-backend`)

### Task 1: `Question` model, migration, content hash

**Files:**
- Modify: `backend/trivia/models.py` (append after `SyncRun`)
- Create: `backend/trivia/questions/__init__.py`, `backend/trivia/questions/hashing.py`
- Create: `backend/trivia/migrations/00XX_question.py` (generated)
- Test: `backend/trivia/tests/test_questions_model.py`

**Interfaces:**
- Produces: `trivia.models.Question` (fields per spec §6); `trivia.questions.hashing.content_hash(definition: dict) -> str` (64-hex sha256 of canonical JSON).

- [ ] **Step 1: Write the failing tests**

```python
# backend/trivia/tests/test_questions_model.py
from django.db import IntegrityError
from django.test import TestCase

from trivia.models import Question
from trivia.questions.hashing import content_hash


class ContentHashTests(TestCase):
    def test_hash_is_order_independent_and_stable(self):
        a = content_hash({"rows": [1, 2], "cols": [3]})
        b = content_hash({"cols": [3], "rows": [1, 2]})
        self.assertEqual(a, b)
        self.assertEqual(len(a), 64)

    def test_hash_changes_with_content(self):
        self.assertNotEqual(content_hash({"person_id": 1}), content_hash({"person_id": 2}))


class QuestionModelTests(TestCase):
    def test_defaults_and_uniqueness(self):
        d = {"person_id": 2544}
        q = Question.objects.create(game="career-path", qid="cp-000001",
                                    definition=d, content_hash=content_hash(d))
        self.assertEqual(q.status, "active")
        self.assertEqual(q.players_referenced, [])
        self.assertEqual(q.created_by, "generator")
        with self.assertRaises(IntegrityError):
            Question.objects.create(game="career-path", qid="cp-000002",
                                    definition=d, content_hash=content_hash(d))
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && python manage.py test trivia.tests.test_questions_model -v 2`
Expected: ImportError `trivia.questions`.

- [ ] **Step 3: Implement**

```python
# backend/trivia/questions/__init__.py
"""Pre-generated game questions: definitions in Postgres, snapshots in Storage.

See docs/superpowers/specs/2026-09-10-questions-store-design.md.
"""
```

```python
# backend/trivia/questions/hashing.py
import hashlib
import json


def content_hash(definition):
    """sha256 over canonical JSON so equal definitions dedupe regardless of key order."""
    canonical = json.dumps(definition, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()
```

Append to `backend/trivia/models.py`:

```python
class Question(models.Model):
    """One pre-generated round for a player-pool game (spec §6).

    `definition` is the small dataset-independent description; the snapshot
    publisher materializes it against the current player dataset.
    """

    STATUS_ACTIVE = "active"
    STATUS_RETIRED = "retired"

    game = models.CharField(max_length=32, db_index=True)
    qid = models.CharField(max_length=48)
    definition = models.JSONField()
    status = models.CharField(max_length=16, default=STATUS_ACTIVE)
    quality = models.JSONField(default=dict, blank=True)
    players_referenced = models.JSONField(default=list, blank=True)
    content_hash = models.CharField(max_length=64)
    dataset_version = models.CharField(max_length=32, blank=True)
    created_by = models.CharField(max_length=32, default="generator")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    retired_at = models.DateTimeField(null=True, blank=True)
    retired_reason = models.TextField(blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["game", "qid"], name="uniq_question_game_qid"),
            models.UniqueConstraint(fields=["game", "content_hash"], name="uniq_question_game_hash"),
        ]
        indexes = [models.Index(fields=["game", "status"])]

    def __str__(self):
        return f"{self.game}/{self.qid} [{self.status}]"
```

- [ ] **Step 4: Migration + tests**

Run: `cd backend && python manage.py makemigrations trivia -n question && python manage.py test trivia.tests.test_questions_model -v 2 && python manage.py makemigrations --check --dry-run`
Expected: migration created; 3 tests PASS; "No changes detected".

- [ ] **Step 5: Commit**

```bash
git add backend/trivia/models.py backend/trivia/migrations backend/trivia/questions backend/trivia/tests/test_questions_model.py
git commit -m "feat(questions): Question model and content hash"
```

### Task 2: Fixture dataset and base helpers

**Files:**
- Create: `backend/scripts/make_players_fixture.py`, `backend/trivia/tests/fixtures/players_fixture.json` (generated, committed)
- Create: `backend/trivia/questions/base.py`
- Test: `backend/trivia/tests/test_questions_base.py`

**Interfaces:**
- Produces: `Invalid(Exception)`; `Dataset` (attrs `rows`, `playable`, `by_id: dict[int, row]`, `version: str`); `load_dataset_from_rows(rows, version) -> Dataset`; `envelope(slug, qid, payload: dict) -> dict`; test helper `trivia.tests.questions_fixture.fixture_dataset() -> Dataset`.

- [ ] **Step 1: Fixture generator script**

```python
# backend/scripts/make_players_fixture.py
"""Write trivia/tests/fixtures/players_fixture.json: a ~250-row slice of
players_curated.json that exercises every generator rule (tiers 1-4, 3-7 stint
journeymen, undrafted, non-US, zero-award rows, never-played rows)."""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
SRC = os.path.join(BACKEND, "trivia", "data_static", "players_curated.json")
DST = os.path.join(BACKEND, "trivia", "tests", "fixtures", "players_fixture.json")


def main():
    with open(SRC, encoding="utf-8") as f:
        rows = json.load(f)
    rows.sort(key=lambda r: r["person_id"])
    tier12 = [r for r in rows if r.get("fame_tier") in (1, 2)]
    journey = [r for r in rows if r.get("fame_tier") in (3, 4) and 3 <= len(r.get("teams") or []) <= 7][:80]
    undrafted = [r for r in rows if r.get("teams") and r.get("draft") is None][:15]
    foreign = [r for r in rows if r.get("teams") and r.get("country") not in (None, "USA")][:30]
    never = [r for r in rows if not r.get("teams")][:5]
    seen, out = set(), []
    for r in tier12 + journey + undrafted + foreign + never:
        if r["person_id"] not in seen:
            seen.add(r["person_id"])
            out.append(r)
    os.makedirs(os.path.dirname(DST), exist_ok=True)
    with open(DST, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"wrote {len(out)} rows -> {DST}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

Run: `cd backend && python scripts/make_players_fixture.py`
Expected: `wrote N rows` with N between 200 and 300.

- [ ] **Step 2: Failing tests**

```python
# backend/trivia/tests/questions_fixture.py
import json
import os

from trivia.questions.base import load_dataset_from_rows

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "players_fixture.json")


def fixture_rows():
    with open(FIXTURE, encoding="utf-8") as f:
        return json.load(f)


def fixture_dataset(version="fixture-1"):
    return load_dataset_from_rows(fixture_rows(), version)
```

```python
# backend/trivia/tests/test_questions_base.py
from django.test import SimpleTestCase

from trivia.questions.base import Invalid, envelope
from trivia.tests.questions_fixture import fixture_dataset


class DatasetTests(SimpleTestCase):
    def test_playable_excludes_rows_without_stints(self):
        ds = fixture_dataset()
        self.assertGreater(len(ds.rows), len(ds.playable))
        self.assertTrue(all(r["teams"] for r in ds.playable))
        self.assertEqual(ds.by_id[ds.playable[0]["person_id"]], ds.playable[0])
        self.assertEqual(ds.version, "fixture-1")

    def test_envelope(self):
        e = envelope("career-path", "cp-000001", {"player": {"a": 1}})
        self.assertEqual(e, {"schema": 1, "game": "career-path", "qid": "cp-000001", "player": {"a": 1}})
        self.assertTrue(issubclass(Invalid, Exception))
```

Run: `cd backend && python manage.py test trivia.tests.test_questions_base -v 2` → ImportError.

- [ ] **Step 3: Implement**

```python
# backend/trivia/questions/base.py
"""Shared pieces every game module and the runner use."""
from trivia.data_pipeline.curated_players import playable_rows

SCHEMA = 1


class Invalid(Exception):
    """A definition cannot be materialized against the current dataset."""


class Dataset:
    def __init__(self, rows, version):
        self.rows = rows
        self.playable = playable_rows(rows)
        self.by_id = {r["person_id"]: r for r in self.playable}
        self.version = version


def load_dataset_from_rows(rows, version):
    return Dataset([r for r in rows if isinstance(r, dict)], version)


def envelope(slug, qid, payload):
    return {"schema": SCHEMA, "game": slug, "qid": qid, **payload}
```

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/make_players_fixture.py backend/trivia/tests/fixtures/players_fixture.json backend/trivia/questions/base.py backend/trivia/tests/questions_fixture.py backend/trivia/tests/test_questions_base.py
git commit -m "feat(questions): dataset fixture and base helpers"
```

### Task 3: Storage config, public reads, dataset download, version numbering

**Files:**
- Create: `backend/trivia/questions/storage.py`
- Test: `backend/trivia/tests/test_questions_storage.py`

**Interfaces:**
- Produces: `StorageConfig.from_env() -> StorageConfig` (attrs `endpoint, region, access_key, secret_key, bucket, public_base`; raises `ImproperlyConfigured` listing missing names); `s3_client(cfg)`; `public_url(cfg, key) -> str`; `fetch_json(url, session=requests) -> dict|list` (raises `StorageUnavailable`); `download_players_dataset(cfg, session=requests) -> Dataset` (verifies sha256); `next_version(current: str|None, today: date) -> str`.

- [ ] **Step 1: Failing tests**

```python
# backend/trivia/tests/test_questions_storage.py
import datetime
import hashlib
import json
import os
from unittest import mock

from django.core.exceptions import ImproperlyConfigured
from django.test import SimpleTestCase

from trivia.questions import storage
from trivia.tests.questions_fixture import fixture_rows

ENV = {
    "SUPABASE_S3_ENDPOINT": "https://ref.storage.supabase.co/storage/v1/s3",
    "SUPABASE_S3_REGION": "eu-central-1",
    "SUPABASE_S3_ACCESS_KEY_ID": "k",
    "SUPABASE_S3_SECRET_ACCESS_KEY": "s",
    "SUPABASE_STORAGE_BUCKET": "game-data",
    "QUESTIONS_PUBLIC_BASE": "https://ref.supabase.co/storage/v1/object/public/game-data/",
}


class FakeResponse:
    def __init__(self, payload, status=200):
        self._payload = payload
        self.status_code = status
        self.ok = status == 200

    def json(self):
        return json.loads(self._payload) if isinstance(self._payload, str) else self._payload

    @property
    def content(self):
        return self._payload.encode("utf-8") if isinstance(self._payload, str) else json.dumps(self._payload).encode()


class FakeSession:
    def __init__(self, routes):
        self.routes = routes

    def get(self, url, timeout=30):
        return self.routes[url]


class StorageConfigTests(SimpleTestCase):
    def test_from_env_reports_every_missing_name(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(ImproperlyConfigured) as ctx:
                storage.StorageConfig.from_env()
        for name in ENV:
            self.assertIn(name, str(ctx.exception))

    def test_public_url_strips_trailing_slash(self):
        with mock.patch.dict(os.environ, ENV, clear=True):
            cfg = storage.StorageConfig.from_env()
        self.assertEqual(storage.public_url(cfg, "questions/manifest.json"),
                         "https://ref.supabase.co/storage/v1/object/public/game-data/questions/manifest.json")


class VersionTests(SimpleTestCase):
    def test_first_of_day_and_increment(self):
        d = datetime.date(2026, 9, 12)
        self.assertEqual(storage.next_version(None, d), "2026-09-12.1")
        self.assertEqual(storage.next_version("2026-09-11.4", d), "2026-09-12.1")
        self.assertEqual(storage.next_version("2026-09-12.9", d), "2026-09-12.10")

    def test_version_sort_key(self):
        vs = ["2026-09-12.10", "2026-09-12.9", "2026-09-11.2"]
        self.assertEqual(sorted(vs, key=storage.version_key), ["2026-09-11.2", "2026-09-12.9", "2026-09-12.10"])


class DatasetDownloadTests(SimpleTestCase):
    def test_downloads_and_verifies_sha(self):
        rows = fixture_rows()
        body = json.dumps(rows, ensure_ascii=False)
        sha = hashlib.sha256(body.encode("utf-8")).hexdigest()
        with mock.patch.dict(os.environ, ENV, clear=True):
            cfg = storage.StorageConfig.from_env()
        base = "https://ref.supabase.co/storage/v1/object/public/game-data"
        session = FakeSession({
            f"{base}/datasets/manifest.json": FakeResponse({"players": {"version": "2026-09-06.3", "url": f"{base}/datasets/players/v/2026-09-06.3/players_curated.json", "sha256": sha, "count": len(rows)}}),
            f"{base}/datasets/players/v/2026-09-06.3/players_curated.json": FakeResponse(body),
        })
        ds = storage.download_players_dataset(cfg, session=session)
        self.assertEqual(ds.version, "2026-09-06.3")
        self.assertEqual(len(ds.rows), len(rows))

    def test_sha_mismatch_is_unavailable(self):
        with mock.patch.dict(os.environ, ENV, clear=True):
            cfg = storage.StorageConfig.from_env()
        base = "https://ref.supabase.co/storage/v1/object/public/game-data"
        session = FakeSession({
            f"{base}/datasets/manifest.json": FakeResponse({"players": {"version": "v", "url": f"{base}/x.json", "sha256": "0" * 64, "count": 1}}),
            f"{base}/x.json": FakeResponse("[]"),
        })
        with self.assertRaises(storage.StorageUnavailable):
            storage.download_players_dataset(cfg, session=session)
```

Run → ImportError.

- [ ] **Step 2: Implement**

```python
# backend/trivia/questions/storage.py
"""Supabase Storage access: S3 for uploads, public HTTP for reads."""
import datetime
import hashlib
import json
import os

import requests
from django.core.exceptions import ImproperlyConfigured

from trivia.questions.base import load_dataset_from_rows

REQUIRED = (
    "SUPABASE_S3_ENDPOINT", "SUPABASE_S3_REGION", "SUPABASE_S3_ACCESS_KEY_ID",
    "SUPABASE_S3_SECRET_ACCESS_KEY", "SUPABASE_STORAGE_BUCKET", "QUESTIONS_PUBLIC_BASE",
)


class StorageUnavailable(Exception):
    """A public read failed or returned something we refuse to trust."""


class StorageConfig:
    def __init__(self, endpoint, region, access_key, secret_key, bucket, public_base):
        self.endpoint = endpoint
        self.region = region
        self.access_key = access_key
        self.secret_key = secret_key
        self.bucket = bucket
        self.public_base = public_base.rstrip("/")

    @classmethod
    def from_env(cls):
        values = {k: (os.environ.get(k) or "").strip() for k in REQUIRED}
        missing = [k for k, v in values.items() if not v]
        if missing:
            raise ImproperlyConfigured(f"Missing Supabase Storage env vars: {', '.join(missing)}")
        return cls(
            values["SUPABASE_S3_ENDPOINT"], values["SUPABASE_S3_REGION"],
            values["SUPABASE_S3_ACCESS_KEY_ID"], values["SUPABASE_S3_SECRET_ACCESS_KEY"],
            values["SUPABASE_STORAGE_BUCKET"], values["QUESTIONS_PUBLIC_BASE"],
        )


def s3_client(cfg):
    import boto3  # lazy: only uploads need it (requirements-publish.txt)

    return boto3.client(
        "s3", endpoint_url=cfg.endpoint, region_name=cfg.region,
        aws_access_key_id=cfg.access_key, aws_secret_access_key=cfg.secret_key,
    )


def public_url(cfg, key):
    return f"{cfg.public_base}/{key.lstrip('/')}"


def fetch_json(url, session=requests):
    try:
        res = session.get(url, timeout=30)
    except Exception as e:  # noqa: BLE001 - network: report as unavailable
        raise StorageUnavailable(f"GET {url}: {e}") from e
    if not res.ok:
        raise StorageUnavailable(f"GET {url}: HTTP {res.status_code}")
    try:
        return res.json()
    except ValueError as e:
        raise StorageUnavailable(f"GET {url}: not JSON") from e


def download_players_dataset(cfg, session=requests):
    manifest = fetch_json(public_url(cfg, "datasets/manifest.json"), session)
    entry = (manifest or {}).get("players") or {}
    url, sha, version = entry.get("url"), entry.get("sha256"), entry.get("version")
    if not (url and sha and version):
        raise StorageUnavailable("datasets/manifest.json has no complete players entry")
    try:
        res = session.get(url, timeout=120)
    except Exception as e:  # noqa: BLE001
        raise StorageUnavailable(f"GET {url}: {e}") from e
    if not res.ok:
        raise StorageUnavailable(f"GET {url}: HTTP {res.status_code}")
    body = res.content
    if hashlib.sha256(body).hexdigest() != sha:
        raise StorageUnavailable(f"players dataset {version}: sha256 mismatch")
    rows = json.loads(body.decode("utf-8"))
    if not isinstance(rows, list) or not rows:
        raise StorageUnavailable(f"players dataset {version}: empty or not a list")
    return load_dataset_from_rows(rows, version)


def version_key(version):
    date, _, n = version.partition(".")
    return (date, int(n or 0))


def next_version(current, today=None):
    today = today or datetime.datetime.now(datetime.timezone.utc).date()
    stamp = today.strftime("%Y-%m-%d")
    if current and current.startswith(stamp + "."):
        return f"{stamp}.{version_key(current)[1] + 1}"
    return f"{stamp}.1"
```

- [ ] **Step 3: Run tests** → PASS (7 tests).

- [ ] **Step 4: Commit**

```bash
git add backend/trivia/questions/storage.py backend/trivia/tests/test_questions_storage.py
git commit -m "feat(questions): Supabase Storage config, dataset download, version numbering"
```

### Task 4: Contexto similarity port + golden test

**Files:**
- Create: `backend/trivia/questions/similarity.py`, `backend/trivia/tests/fixtures/contexto_golden.json`, `scripts/contexto-golden.mjs`
- Test: `backend/trivia/tests/test_questions_similarity.py`

**Interfaces:**
- Produces: `similarity(secret, p, current_year) -> float` (0..100, identical formula to `src/Game Renderers/Contexto.tsx:25-110`); `rank_pool(secret, playable, current_year) -> list[tuple[int, int]]` (`[(person_id, rank)]`, rank 1 = secret, desc score, ties by person_id).

- [ ] **Step 1: Generate the golden file from the TypeScript implementation (once)**

```js
// scripts/contexto-golden.mjs — run once: node scripts/contexto-golden.mjs > backend/trivia/tests/fixtures/contexto_golden.json
// Copies the similarity code from src/Game Renderers/Contexto.tsx verbatim (kept only for this one-off).
import fs from "node:fs";
const rows = JSON.parse(fs.readFileSync("backend/trivia/tests/fixtures/players_fixture.json", "utf8"));
const pool = rows.filter((r) => r.teams && r.teams.length);
const CURRENT_YEAR = 2026;
function franchiseSeasons(p){const s=new Set();for(const t of p.teams){const end=t.end_year??CURRENT_YEAR;for(let y=t.start_year;y<=end;y++)s.add(`${t.abbr}:${y}`);}return s;}
function jaccard(a,b){if(a.size===0&&b.size===0)return 0;let i=0;for(const x of a)if(b.has(x))i++;const u=a.size+b.size-i;return u===0?0:i/u;}
function careerRange(p){let lo=Infinity,hi=-Infinity;for(const t of p.teams){if(t.start_year<lo)lo=t.start_year;const e=t.end_year??CURRENT_YEAR;if(e>hi)hi=e;}return lo===Infinity?[CURRENT_YEAR,CURRENT_YEAR]:[lo,hi];}
function eraOverlap(a,b){const inter=Math.max(0,Math.min(a[1],b[1])-Math.max(a[0],b[0])+1);const u=(a[1]-a[0]+1)+(b[1]-b[0]+1)-inter;return u<=0?0:inter/u;}
const POS={G:["G"],F:["F"],C:["C"],"G-F":["G","F"],"F-C":["F","C"]};
function positionFamily(a,b){if(a.position===b.position)return 1;const fb=POS[b.position]||[];return (POS[a.position]||[]).some((x)=>fb.includes(x))?0.5:0;}
function draftProximity(a,b){const ua=a.draft==null,ub=b.draft==null;if(ua&&ub)return 1;if(ua||ub)return 0;return Math.max(0,1-Math.abs(a.draft.pick-b.draft.pick)/60);}
function awardsVec(p){return [p.awards.mvp.length,p.awards.allstar_count,p.awards.rings.length,p.awards.dpoy.length];}
function cosine(a,b){let d=0,na=0,nb=0;for(let i=0;i<a.length;i++){d+=a[i]*b[i];na+=a[i]*a[i];nb+=b[i]*b[i];}return na===0||nb===0?0:d/(Math.sqrt(na)*Math.sqrt(nb));}
function similarity(s,p){return 35*jaccard(franchiseSeasons(s),franchiseSeasons(p))+20*eraOverlap(careerRange(s),careerRange(p))+15*positionFamily(s,p)+10*(s.country===p.country?1:0)+10*draftProximity(s,p)+10*cosine(awardsVec(s),awardsVec(p));}
const secret = pool.find((p) => p.person_id === 2544) ?? pool[0]; // LeBron if present
const scored = pool.map((p)=>({p,s:similarity(secret,p)})).sort((x,y)=>y.s-x.s||x.p.person_id-y.p.person_id);
process.stdout.write(JSON.stringify({ secret_person_id: secret.person_id, current_year: CURRENT_YEAR, top: scored.slice(0, 40).map((r, i) => [r.p.person_id, i + 1]) }, null, 1));
```

Run: `node scripts/contexto-golden.mjs > backend/trivia/tests/fixtures/contexto_golden.json`
Expected: a JSON with `top` of 40 `[person_id, rank]` pairs, rank 1 = the secret.

- [ ] **Step 2: Failing test**

```python
# backend/trivia/tests/test_questions_similarity.py
import json
import os

from django.test import SimpleTestCase

from trivia.questions.similarity import rank_pool, similarity
from trivia.tests.questions_fixture import fixture_dataset

GOLDEN = os.path.join(os.path.dirname(__file__), "fixtures", "contexto_golden.json")


class SimilarityTests(SimpleTestCase):
    def test_self_similarity_is_100(self):
        ds = fixture_dataset()
        p = ds.playable[0]
        self.assertAlmostEqual(similarity(p, p, 2026), 100.0, places=6)

    def test_ranking_matches_typescript_golden(self):
        with open(GOLDEN, encoding="utf-8") as f:
            golden = json.load(f)
        ds = fixture_dataset()
        secret = ds.by_id[golden["secret_person_id"]]
        ranking = rank_pool(secret, ds.playable, golden["current_year"])
        self.assertEqual(ranking[0], (secret["person_id"], 1))
        self.assertEqual([list(r) for r in ranking[:40]], golden["top"])
        self.assertEqual(len(ranking), len(ds.playable))
```

Run → ImportError.

- [ ] **Step 3: Implement**

```python
# backend/trivia/questions/similarity.py
"""LeContexto similarity — the Python home of what src/Game Renderers/Contexto.tsx
computed client-side. Rankings are precomputed per question, so the renderer no
longer needs player profiles. Formula and tie-break are frozen (golden test)."""
import math

POS_FAMILY = {"G": ["G"], "F": ["F"], "C": ["C"], "G-F": ["G", "F"], "F-C": ["F", "C"]}


def _franchise_seasons(p, current_year):
    out = set()
    for t in p.get("teams") or []:
        end = t["end_year"] if t.get("end_year") is not None else current_year
        for y in range(t["start_year"], end + 1):
            out.add(f"{t['abbr']}:{y}")
    return out


def _jaccard(a, b):
    if not a and not b:
        return 0.0
    inter = len(a & b)
    union = len(a) + len(b) - inter
    return inter / union if union else 0.0


def _career_range(p, current_year):
    lo, hi = math.inf, -math.inf
    for t in p.get("teams") or []:
        lo = min(lo, t["start_year"])
        end = t["end_year"] if t.get("end_year") is not None else current_year
        hi = max(hi, end)
    if lo == math.inf:
        return (current_year, current_year)
    return (lo, hi)


def _era_overlap(a, b):
    inter = max(0, min(a[1], b[1]) - max(a[0], b[0]) + 1)
    union = (a[1] - a[0] + 1) + (b[1] - b[0] + 1) - inter
    return inter / union if union > 0 else 0.0


def _position_family(a, b):
    if a.get("position") == b.get("position"):
        return 1.0
    fb = POS_FAMILY.get(b.get("position"), [])
    return 0.5 if any(x in fb for x in POS_FAMILY.get(a.get("position"), [])) else 0.0


def _draft_proximity(a, b):
    ua, ub = a.get("draft") is None, b.get("draft") is None
    if ua and ub:
        return 1.0
    if ua or ub:
        return 0.0
    return max(0.0, 1 - abs(a["draft"]["pick"] - b["draft"]["pick"]) / 60)


def _awards_vec(p):
    a = p.get("awards") or {}
    return [len(a.get("mvp") or []), a.get("allstar_count") or 0, len(a.get("rings") or []), len(a.get("dpoy") or [])]


def _cosine(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    na = sum(x * x for x in a)
    nb = sum(y * y for y in b)
    return dot / (math.sqrt(na) * math.sqrt(nb)) if na and nb else 0.0


def similarity(secret, p, current_year):
    return (
        35 * _jaccard(_franchise_seasons(secret, current_year), _franchise_seasons(p, current_year))
        + 20 * _era_overlap(_career_range(secret, current_year), _career_range(p, current_year))
        + 15 * _position_family(secret, p)
        + 10 * (1 if secret.get("country") == p.get("country") else 0)
        + 10 * _draft_proximity(secret, p)
        + 10 * _cosine(_awards_vec(secret), _awards_vec(p))
    )


def rank_pool(secret, playable, current_year):
    """[(person_id, rank)] over the playable pool — desc score, ties by person_id."""
    scored = sorted(
        ((similarity(secret, p, current_year), p["person_id"]) for p in playable),
        key=lambda t: (-t[0], t[1]),
    )
    return [(pid, i + 1) for i, (_, pid) in enumerate(scored)]
```

- [ ] **Step 4: Run tests** → PASS. If the golden comparison fails on ties, the JS sort `y.s - x.s` is float; confirm both sides use the same `current_year` (2026) and the same fixture file.

- [ ] **Step 5: Commit**

```bash
git add backend/trivia/questions/similarity.py backend/trivia/tests/test_questions_similarity.py backend/trivia/tests/fixtures/contexto_golden.json scripts/contexto-golden.mjs
git commit -m "feat(questions): port Contexto similarity to Python with a golden test"
```

### Task 5: Game modules — Career Path and Who Are Ya

**Files:**
- Create: `backend/trivia/questions/games/__init__.py`, `backend/trivia/questions/games/career_path.py`, `backend/trivia/questions/games/who_are_ya.py`
- Test: `backend/trivia/tests/test_questions_mystery.py`

**Interfaces:**
- Every game module exposes: `SLUG: str`, `TARGET: int|None` (None = "all eligible"), `MINIMUM: int`, `generate(dataset, existing_hashes: set[str], rng: random.Random, n: int) -> list[dict]`, `materialize(definition, dataset) -> dict` (raises `Invalid`), `validate(materialized) -> list[str]`, `index_item(definition, materialized) -> list`, `players_referenced(definition, materialized) -> list[int]`, `qid_for(definition, seq: int) -> str`.
- `trivia.questions.games.GAME_MODULES: dict[slug, module]` (filled in Task 9).

- [ ] **Step 1: Failing tests**

```python
# backend/trivia/tests/test_questions_mystery.py
import random

from django.test import SimpleTestCase

from trivia.questions.base import Invalid
from trivia.questions.games import career_path, who_are_ya
from trivia.questions.hashing import content_hash
from trivia.tests.questions_fixture import fixture_dataset


class CareerPathTests(SimpleTestCase):
    def test_generate_only_journeymen_and_skips_existing(self):
        ds = fixture_dataset()
        first = career_path.generate(ds, set(), random.Random(1), 5)
        self.assertEqual(len(first), 5)
        for d in first:
            self.assertTrue(3 <= len(ds.by_id[d["person_id"]]["teams"]) <= 7)
        existing = {content_hash(d) for d in first}
        second = career_path.generate(ds, existing, random.Random(1), 5)
        self.assertFalse({content_hash(d) for d in second} & existing)

    def test_materialize_and_index(self):
        ds = fixture_dataset()
        d = career_path.generate(ds, set(), random.Random(2), 1)[0]
        m = career_path.materialize(d, ds)
        self.assertEqual(m["player"]["person_id"], d["person_id"])
        self.assertEqual(career_path.validate(m), [])
        w = career_path.index_item(d, m)[1]
        self.assertIn(w, (1, 3))
        self.assertEqual(career_path.players_referenced(d, m), [d["person_id"]])
        self.assertEqual(career_path.qid_for(d, 7), "cp-000007")

    def test_materialize_rejects_player_that_left_the_pool(self):
        ds = fixture_dataset()
        with self.assertRaises(Invalid):
            career_path.materialize({"person_id": -1}, ds)


class WhoAreYaTests(SimpleTestCase):
    def test_generate_is_tier_1_2_only(self):
        ds = fixture_dataset()
        defs = who_are_ya.generate(ds, set(), random.Random(1), 10_000)
        self.assertTrue(defs)
        self.assertTrue(all(ds.by_id[d["person_id"]]["fame_tier"] in (1, 2) for d in defs))
        self.assertIsNone(who_are_ya.TARGET)

    def test_materialize_rejects_tier_drop(self):
        ds = fixture_dataset()
        deep = next(r for r in ds.playable if r["fame_tier"] in (3, 4))
        with self.assertRaises(Invalid):
            who_are_ya.materialize({"person_id": deep["person_id"]}, ds)
```

- [ ] **Step 2: Implement**

```python
# backend/trivia/questions/games/__init__.py
"""Per-game question modules. Filled by Task 9; keep this list in slug order."""
GAME_MODULES = {}
```

```python
# backend/trivia/questions/games/career_path.py
"""Career Path — one mystery journeyman (3-7 stints), weighted to fame tier 2-3.
Rules moved from trivia/games/career_path.py."""
from trivia.questions.base import Invalid, envelope
from trivia.questions.hashing import content_hash

SLUG = "career-path"
TARGET = 300
MINIMUM = 50
MIN_STINTS, MAX_STINTS = 3, 7


def _eligible(row):
    return MIN_STINTS <= len(row.get("teams") or []) <= MAX_STINTS


def _weight(row):
    return 3 if row.get("fame_tier") in (2, 3) else 1


def generate(dataset, existing_hashes, rng, n):
    candidates = [r for r in dataset.playable if _eligible(r)]
    rng.shuffle(candidates)
    out = []
    for r in candidates:
        d = {"person_id": r["person_id"]}
        if content_hash(d) in existing_hashes:
            continue
        out.append(d)
        if len(out) >= n:
            break
    return out


def materialize(definition, dataset):
    row = dataset.by_id.get(definition.get("person_id"))
    if row is None:
        raise Invalid(f"person_id {definition.get('person_id')} is not in the playable pool")
    if not _eligible(row):
        raise Invalid(f"{row['full_name']} has {len(row['teams'])} stints; need {MIN_STINTS}-{MAX_STINTS}")
    return envelope(SLUG, None, {"player": row})


def validate(materialized):
    p = materialized.get("player") or {}
    problems = []
    if not p.get("full_name"):
        problems.append("player has no full_name")
    if not _eligible(p):
        problems.append("stint count out of range")
    return problems


def index_item(definition, materialized):
    return [None, _weight(materialized["player"])]  # qid is filled by the runner


def players_referenced(definition, materialized):
    return [definition["person_id"]]


def qid_for(definition, seq):
    return f"cp-{seq:06d}"
```

```python
# backend/trivia/questions/games/who_are_ya.py
"""Who Are Ya — one famous (tier 1-2) mystery player. Rules moved from
trivia/games/who_are_ya.py. TARGET None = every eligible player gets a question."""
from trivia.questions.base import Invalid, envelope
from trivia.questions.hashing import content_hash

SLUG = "who-are-ya"
TARGET = None
MINIMUM = 30
ELIGIBLE_FAME_TIERS = (1, 2)


def _eligible(row):
    return row.get("fame_tier") in ELIGIBLE_FAME_TIERS and bool(row.get("teams"))


def generate(dataset, existing_hashes, rng, n):
    out = []
    for r in sorted((r for r in dataset.playable if _eligible(r)), key=lambda r: r["person_id"]):
        d = {"person_id": r["person_id"]}
        if content_hash(d) in existing_hashes:
            continue
        out.append(d)
        if len(out) >= n:
            break
    return out


def materialize(definition, dataset):
    row = dataset.by_id.get(definition.get("person_id"))
    if row is None:
        raise Invalid(f"person_id {definition.get('person_id')} is not in the playable pool")
    if not _eligible(row):
        raise Invalid(f"{row['full_name']} is fame tier {row.get('fame_tier')}; need 1-2")
    return envelope(SLUG, None, {"player": row})


def validate(materialized):
    p = materialized.get("player") or {}
    return [] if p.get("full_name") and _eligible(p) else ["player not eligible"]


def index_item(definition, materialized):
    return [None]


def players_referenced(definition, materialized):
    return [definition["person_id"]]


def qid_for(definition, seq):
    return f"way-{seq:06d}"
```

The runner (Task 11) sets `qid` in the envelope and `index_item[0]` after `qid_for`; modules never know their sequence number.

- [ ] **Step 3: Run tests** → PASS (5 tests).

- [ ] **Step 4: Commit**

```bash
git add backend/trivia/questions/games backend/trivia/tests/test_questions_mystery.py
git commit -m "feat(questions): Career Path and Who Are Ya question modules"
```

### Task 6: Game module — Tic-Tac-Toe boards with precomputed valid ids

**Files:**
- Create: `backend/trivia/questions/games/tictactoe.py`
- Test: `backend/trivia/tests/test_questions_tictactoe.py`

**Interfaces:**
- Consumes: `trivia.games.tictactoe.player_matches(p, c)` (existing matcher) — imported, not copied.
- Produces: definition `{"rows": [Criterion×3], "cols": [Criterion×3]}`; materialized `{…, "rows", "cols", "valid": [[int,…]×9]}` (row-major: cell index `r*3+c`); `SEED_PATH` import of the 8 hand boards; `MIN_VALID = 3`, `MAX_VALID = 400`.

- [ ] **Step 1: Failing tests**

```python
# backend/trivia/tests/test_questions_tictactoe.py
import random

from django.test import SimpleTestCase

from trivia.questions.base import Invalid
from trivia.questions.games import tictactoe as ttt
from trivia.tests.questions_fixture import fixture_dataset


class TicTacToeQuestionTests(SimpleTestCase):
    def test_seed_boards_load(self):
        seeds = ttt.seed_definitions()
        self.assertGreaterEqual(len(seeds), 8)
        self.assertEqual(set(seeds[0]), {"rows", "cols"})

    def test_generate_produces_solvable_bounded_boards(self):
        ds = fixture_dataset()
        defs = ttt.generate(ds, set(), random.Random(3), 3)
        self.assertEqual(len(defs), 3)
        for d in defs:
            m = ttt.materialize(d, ds)
            self.assertEqual(len(m["valid"]), 9)
            for cell in m["valid"]:
                self.assertTrue(ttt.MIN_VALID <= len(cell) <= ttt.MAX_VALID, len(cell))
            self.assertEqual(ttt.validate(m), [])
            self.assertEqual(sorted(set(ttt.players_referenced(d, m))), sorted({pid for cell in m["valid"] for pid in cell}))

    def test_materialize_rejects_unsolvable_cell(self):
        ds = fixture_dataset()
        d = {"rows": [{"type": "team", "value": "ZZZ", "label": "Nobody"}] * 3,
             "cols": [{"type": "award", "value": "mvp", "label": "Won MVP"}] * 3}
        with self.assertRaises(Invalid):
            ttt.materialize(d, ds)

    def test_qid(self):
        self.assertEqual(ttt.qid_for({}, 42), "ttt-0042")
```

- [ ] **Step 2: Implement**

```python
# backend/trivia/questions/games/tictactoe.py
"""Tic-Tac-Toe boards: 3 team rows x 3 non-team columns, each cell precomputed
to the ids that satisfy both criteria. Matching semantics are
trivia.games.tictactoe.player_matches (the server's port of src/utils/criteria.ts)."""
import json
import os

from django.conf import settings

from trivia.games.tictactoe import player_matches
from trivia.questions.base import Invalid, envelope
from trivia.questions.hashing import content_hash

SLUG = "tictactoe"
TARGET = 60
MINIMUM = 12
MIN_VALID, MAX_VALID = 3, 400
MIN_TEAM_PLAYERS = 40

SEED_PATH = os.path.join(settings.BASE_DIR, "trivia", "data_static", "tictactoe_seed.json")

AWARD_COLUMNS = [
    {"type": "award", "value": "mvp", "label": "Won MVP"},
    {"type": "award", "value": "fmvp", "label": "Finals MVP"},
    {"type": "award", "value": "dpoy", "label": "Defensive POY"},
    {"type": "award", "value": "roty", "label": "Rookie of the Year"},
    {"type": "award", "value": "smoy", "label": "Sixth Man"},
    {"type": "award", "value": "ring", "label": "NBA Champion"},
    {"type": "award", "value": "allnba", "label": "All-NBA"},
    {"type": "draft", "value": "undrafted", "label": "Undrafted"},
    {"type": "draft", "value": "lottery", "label": "Lottery pick"},
]


def seed_definitions():
    with open(SEED_PATH, encoding="utf-8") as f:
        boards = json.load(f)
    return [{"rows": b["rows"], "cols": b["cols"]} for b in boards]


def _team_criteria(dataset):
    names, counts = {}, {}
    for r in dataset.playable:
        for s in r.get("teams") or []:
            counts[s["abbr"]] = counts.get(s["abbr"], 0) + 1
            names.setdefault(s["abbr"], s.get("name") or s["abbr"])
    return [
        {"type": "team", "value": abbr, "label": names[abbr]}
        for abbr, n in counts.items() if n >= MIN_TEAM_PLAYERS
    ]


def _cell_valid(dataset, row_c, col_c):
    return [p["person_id"] for p in dataset.playable if player_matches(p, row_c) and player_matches(p, col_c)]


def generate(dataset, existing_hashes, rng, n):
    teams = _team_criteria(dataset)
    out, guard = [], 0
    while len(out) < n and guard < n * 200:
        guard += 1
        rows = rng.sample(teams, 3)
        cols = rng.sample(AWARD_COLUMNS, 3)
        d = {"rows": rows, "cols": cols}
        if content_hash(d) in existing_hashes:
            continue
        try:
            materialize(d, dataset)
        except Invalid:
            continue
        existing_hashes = existing_hashes | {content_hash(d)}
        out.append(d)
    return out


def materialize(definition, dataset):
    rows, cols = definition.get("rows") or [], definition.get("cols") or []
    if len(rows) != 3 or len(cols) != 3:
        raise Invalid("board needs 3 rows and 3 cols")
    valid = []
    for r in rows:
        for c in cols:
            ids = _cell_valid(dataset, r, c)
            if not MIN_VALID <= len(ids) <= MAX_VALID:
                raise Invalid(f"{r['label']} x {c['label']}: {len(ids)} valid players (need {MIN_VALID}-{MAX_VALID})")
            valid.append(ids)
    return envelope(SLUG, None, {"rows": rows, "cols": cols, "valid": valid})


def validate(materialized):
    valid = materialized.get("valid") or []
    problems = []
    if len(valid) != 9:
        problems.append("valid must have 9 cells")
    for i, cell in enumerate(valid):
        if not MIN_VALID <= len(cell) <= MAX_VALID:
            problems.append(f"cell {i}: {len(cell)} valid players")
    return problems


def index_item(definition, materialized):
    return [None]


def players_referenced(definition, materialized):
    return sorted({pid for cell in materialized["valid"] for pid in cell})


def qid_for(definition, seq):
    return f"ttt-{seq:04d}"
```

Check the seed file name: `ls backend/trivia/data_static | grep -i tictactoe` — if it is `tictactoe_seed.json` keep `SEED_PATH`; otherwise use the file `trivia/games/tictactoe.py:_load_seed` reads.

- [ ] **Step 3: Run tests** → PASS. If `generate` returns fewer than 3 boards on the fixture, lower `MIN_TEAM_PLAYERS` to 20 for the fixture-size pool (keep 40 in production by reading `MIN_TEAM_PLAYERS = 40 if len(dataset.playable) > 1000 else 20`).

- [ ] **Step 4: Commit**

```bash
git add backend/trivia/questions/games/tictactoe.py backend/trivia/tests/test_questions_tictactoe.py
git commit -m "feat(questions): Tic-Tac-Toe boards with precomputed valid ids"
```

### Task 7: Game module — SuperDraft slot sets with eligible tuples

**Files:**
- Create: `backend/trivia/questions/games/superdraft.py`
- Test: `backend/trivia/tests/test_questions_superdraft.py`

**Interfaces:**
- Consumes: `trivia.games.superdraft._candidate_queues(rows)`, `draw_slots(queues, rng)`, `SLOT_COUNT`, `MIN_ELIGIBLE`.
- Produces: definition `{"slots": [{kind,value,label,sub}×5]}`; materialized `{…, "slots": [{…slot, "eligible": [[person_id, height_in|null, rings, career_pts, birth_year|null], …]}]}`; `MAX_ELIGIBLE = 250`.

- [ ] **Step 1: Failing tests**

```python
# backend/trivia/tests/test_questions_superdraft.py
import random

from django.test import SimpleTestCase

from trivia.questions.base import Invalid
from trivia.questions.games import superdraft as sd
from trivia.tests.questions_fixture import fixture_dataset


class SuperDraftQuestionTests(SimpleTestCase):
    def test_generate_and_materialize(self):
        ds = fixture_dataset()
        defs = sd.generate(ds, set(), random.Random(4), 2)
        self.assertEqual(len(defs), 2)
        for d in defs:
            self.assertEqual(len(d["slots"]), sd.SLOT_COUNT)
            m = sd.materialize(d, ds)
            for slot in m["slots"]:
                self.assertTrue(sd.MIN_ELIGIBLE <= len(slot["eligible"]) <= sd.MAX_ELIGIBLE)
                pid, height, rings, pts, born = slot["eligible"][0]
                self.assertIsInstance(pid, int)
                self.assertIsInstance(rings, int)
                self.assertIsInstance(pts, int)
            self.assertEqual(sd.validate(m), [])

    def test_slot_matcher(self):
        ds = fixture_dataset()
        usa = [r for r in ds.playable if r.get("country") == "USA"]
        self.assertTrue(all(sd.slot_matches(r, {"kind": "country", "value": "USA"}) for r in usa))

    def test_materialize_rejects_degenerate_slot(self):
        ds = fixture_dataset()
        d = {"slots": [{"kind": "country", "value": "Atlantis", "label": "Atlantis", "sub": "Country"}] * 5}
        with self.assertRaises(Invalid):
            sd.materialize(d, ds)
```

- [ ] **Step 2: Implement**

```python
# backend/trivia/questions/games/superdraft.py
"""SuperDraft Five slot sets. Slot drawing reuses trivia/games/superdraft.py;
the generator adds a MAX_ELIGIBLE cap so a slot is never 'every American'."""
from trivia.games.superdraft import MIN_ELIGIBLE, SLOT_COUNT, _candidate_queues, draw_slots
from trivia.questions.base import Invalid, envelope
from trivia.questions.hashing import content_hash

SLUG = "superdraft"
TARGET = 200
MINIMUM = 30
MAX_ELIGIBLE = 250


def slot_matches(row, slot):
    kind, value = slot.get("kind"), slot.get("value")
    if kind == "team":
        return any((s or {}).get("abbr") == value for s in row.get("teams") or [])
    if kind == "country":
        return row.get("country") == value
    if kind == "draft":
        d = row.get("draft")
        return isinstance(d, dict) and isinstance(d.get("year"), int) and str(d["year"] // 10 * 10) == str(value)
    return False


def _eligible_tuple(row):
    awards = row.get("awards") or {}
    career = row.get("career") or {}
    return [row["person_id"], row.get("height_in"), len(awards.get("rings") or []),
            int(career.get("pts") or 0), row.get("birth_year")]


def _counts(dataset, slots):
    return [sum(1 for r in dataset.playable if slot_matches(r, s)) for s in slots]


def generate(dataset, existing_hashes, rng, n):
    queues = _candidate_queues(dataset.playable)
    queues = [[c for c in q if sum(1 for r in dataset.playable if slot_matches(r, c)) <= MAX_ELIGIBLE] for q in queues]
    out, guard = [], 0
    while len(out) < n and guard < n * 50:
        guard += 1
        slots = draw_slots(queues, rng)
        if len(slots) < SLOT_COUNT:
            break
        d = {"slots": slots}
        if content_hash(d) in existing_hashes:
            continue
        existing_hashes = existing_hashes | {content_hash(d)}
        out.append(d)
    return out


def materialize(definition, dataset):
    slots = definition.get("slots") or []
    if len(slots) != SLOT_COUNT:
        raise Invalid(f"need {SLOT_COUNT} slots")
    filled = []
    for s in slots:
        rows = [r for r in dataset.playable if slot_matches(r, s)]
        if not MIN_ELIGIBLE <= len(rows) <= MAX_ELIGIBLE:
            raise Invalid(f"slot {s.get('label')}: {len(rows)} eligible (need {MIN_ELIGIBLE}-{MAX_ELIGIBLE})")
        filled.append({**s, "eligible": [_eligible_tuple(r) for r in rows]})
    return envelope(SLUG, None, {"slots": filled})


def validate(materialized):
    problems = []
    for s in materialized.get("slots") or []:
        n = len(s.get("eligible") or [])
        if not MIN_ELIGIBLE <= n <= MAX_ELIGIBLE:
            problems.append(f"slot {s.get('label')}: {n} eligible")
    if len(materialized.get("slots") or []) != SLOT_COUNT:
        problems.append("slot count")
    return problems


def index_item(definition, materialized):
    return [None]


def players_referenced(definition, materialized):
    return sorted({t[0] for s in materialized["slots"] for t in s["eligible"]})


def qid_for(definition, seq):
    return f"sd-{seq:06d}"
```

`slot_matches` mirrors the renderer's slot resolution in `SuperDraft.tsx` (team by stint abbr, country equality, draft decade = `year // 10 * 10`); Task 16 makes the renderer read `eligible` instead of re-resolving, so this becomes the single definition.

- [ ] **Step 3: Run tests** → PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/trivia/questions/games/superdraft.py backend/trivia/tests/test_questions_superdraft.py
git commit -m "feat(questions): SuperDraft slot sets with eligible tuples and a size cap"
```

### Task 8: Game module — Contexto daily secrets with precomputed ranking

**Files:**
- Create: `backend/trivia/questions/games/contexto.py`
- Test: `backend/trivia/tests/test_questions_contexto.py`

**Interfaces:**
- Consumes: `similarity.rank_pool`.
- Produces: definition `{"secret_person_id": int, "day": "YYYY-MM-DD"}`; materialized `{…, "day", "secret": row, "ranking": [[person_id, rank], …]}`; index item `[qid, day]`; `qid_for → "ctx-<day>"`; `generate` needs `existing_definitions` for day/secret dedupe — it receives them via `dataset.extra["contexto_existing"]` set by the runner (see Task 11), defaulting to `[]`.

- [ ] **Step 1: Failing tests**

```python
# backend/trivia/tests/test_questions_contexto.py
import datetime
import random

from django.test import SimpleTestCase

from trivia.questions.games import contexto as ctx
from trivia.tests.questions_fixture import fixture_dataset


class ContextoQuestionTests(SimpleTestCase):
    def test_generate_schedules_consecutive_days_without_repeats(self):
        ds = fixture_dataset()
        today = datetime.date(2026, 9, 12)
        defs = ctx.generate(ds, set(), random.Random(5), 10, today=today)
        days = [d["day"] for d in defs]
        self.assertEqual(days[0], "2026-09-12")
        self.assertEqual(days[-1], "2026-09-21")
        self.assertEqual(len({d["secret_person_id"] for d in defs}), 10)
        self.assertTrue(all(ds.by_id[d["secret_person_id"]]["fame_tier"] in (1, 2) for d in defs))

    def test_generate_continues_after_existing_days(self):
        ds = fixture_dataset()
        ds.extra = {"contexto_existing": [{"secret_person_id": ds.playable[0]["person_id"], "day": "2026-09-14"}]}
        defs = ctx.generate(ds, set(), random.Random(5), 2, today=datetime.date(2026, 9, 12))
        self.assertEqual([d["day"] for d in defs], ["2026-09-15", "2026-09-16"])
        self.assertNotIn(ds.playable[0]["person_id"], [d["secret_person_id"] for d in defs])

    def test_materialize_ranking(self):
        ds = fixture_dataset()
        d = ctx.generate(ds, set(), random.Random(6), 1, today=datetime.date(2026, 9, 12))[0]
        m = ctx.materialize(d, ds)
        self.assertEqual(m["ranking"][0], [d["secret_person_id"], 1])
        self.assertEqual(len(m["ranking"]), len(ds.playable))
        self.assertEqual(ctx.validate(m), [])
        self.assertEqual(ctx.index_item(d, m), [None, d["day"]])
        self.assertEqual(ctx.qid_for(d, 0), "ctx-2026-09-12")
```

- [ ] **Step 2: Implement**

```python
# backend/trivia/questions/games/contexto.py
"""LeContexto: one secret per day, ranking precomputed over the whole playable pool."""
import datetime

from trivia.questions.base import Invalid, envelope
from trivia.questions.hashing import content_hash
from trivia.questions.similarity import rank_pool

SLUG = "contexto"
TARGET = 90            # days scheduled ahead
MINIMUM = 30
SECRET_FAME_TIERS = (1, 2)
NO_REPEAT_DAYS = 365


def _existing(dataset):
    return getattr(dataset, "extra", {}).get("contexto_existing", [])


def generate(dataset, existing_hashes, rng, n, today=None):
    today = today or datetime.datetime.now(datetime.timezone.utc).date()
    existing = _existing(dataset)
    taken_days = {e["day"] for e in existing}
    cutoff = (today - datetime.timedelta(days=NO_REPEAT_DAYS)).isoformat()
    recent_secrets = {e["secret_person_id"] for e in existing if e["day"] >= cutoff}
    candidates = [r for r in dataset.playable if r.get("fame_tier") in SECRET_FAME_TIERS and r["person_id"] not in recent_secrets]
    rng.shuffle(candidates)
    out, day = [], today
    while len(out) < n and candidates:
        stamp = day.isoformat()
        day += datetime.timedelta(days=1)
        if stamp in taken_days:
            continue
        secret = candidates.pop()
        d = {"secret_person_id": secret["person_id"], "day": stamp}
        if content_hash(d) in existing_hashes:
            continue
        out.append(d)
    return out


def materialize(definition, dataset):
    secret = dataset.by_id.get(definition.get("secret_person_id"))
    if secret is None:
        raise Invalid(f"secret {definition.get('secret_person_id')} is not in the playable pool")
    if secret.get("fame_tier") not in SECRET_FAME_TIERS:
        raise Invalid(f"{secret['full_name']} is fame tier {secret.get('fame_tier')}; need 1-2")
    year = int(definition["day"][:4])
    ranking = [[pid, rank] for pid, rank in rank_pool(secret, dataset.playable, year)]
    return envelope(SLUG, None, {"day": definition["day"], "secret": secret, "ranking": ranking})


def validate(materialized):
    ranking = materialized.get("ranking") or []
    problems = []
    if not ranking or ranking[0][1] != 1 or ranking[0][0] != (materialized.get("secret") or {}).get("person_id"):
        problems.append("ranking must start with the secret at rank 1")
    if len({r[0] for r in ranking}) != len(ranking):
        problems.append("duplicate person_id in ranking")
    return problems


def index_item(definition, materialized):
    return [None, definition["day"]]


def players_referenced(definition, materialized):
    return [definition["secret_person_id"]]


def qid_for(definition, seq):
    return f"ctx-{definition['day']}"
```

Add to `base.Dataset.__init__`: `self.extra = {}`.

- [ ] **Step 3: Run tests** → PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/trivia/questions/games/contexto.py backend/trivia/questions/base.py backend/trivia/tests/test_questions_contexto.py
git commit -m "feat(questions): Contexto daily secrets with precomputed rankings"
```

### Task 9: Game module — Imposter, and the registry

**Files:**
- Create: `backend/trivia/questions/games/imposter.py`
- Modify: `backend/trivia/questions/games/__init__.py`
- Test: `backend/trivia/tests/test_questions_registry.py`

**Interfaces:**
- Produces: `GAME_MODULES = {"career-path": career_path, "who-are-ya": who_are_ya, "tictactoe": tictactoe, "superdraft": superdraft, "contexto": contexto, "imposter": imposter}`; imposter materialized `{…, "names": [str, …]}`, `qid_for → "imposter-pool"`, `TARGET = 1`, `MINIMUM = 20` (names).

- [ ] **Step 1: Failing test**

```python
# backend/trivia/tests/test_questions_registry.py
import random

from django.test import SimpleTestCase

from trivia.questions.games import GAME_MODULES, imposter
from trivia.tests.questions_fixture import fixture_dataset

REQUIRED = ("SLUG", "TARGET", "MINIMUM", "generate", "materialize", "validate", "index_item", "players_referenced", "qid_for")


class RegistryTests(SimpleTestCase):
    def test_every_module_has_the_interface(self):
        self.assertEqual(sorted(GAME_MODULES), ["career-path", "contexto", "imposter", "superdraft", "tictactoe", "who-are-ya"])
        for slug, mod in GAME_MODULES.items():
            self.assertEqual(mod.SLUG, slug)
            for name in REQUIRED:
                self.assertTrue(hasattr(mod, name), f"{slug} lacks {name}")


class ImposterTests(SimpleTestCase):
    def test_single_definition_and_names(self):
        ds = fixture_dataset()
        defs = imposter.generate(ds, set(), random.Random(0), 5)
        self.assertEqual(defs, [{"rule": "fame_tier<=2"}])
        m = imposter.materialize(defs[0], ds)
        self.assertTrue(all(ds.by_id[p]["full_name"] in m["names"] for p in imposter.players_referenced(defs[0], m)))
        self.assertGreaterEqual(len(m["names"]), imposter.MINIMUM)
        self.assertEqual(imposter.validate(m), [])
        self.assertEqual(imposter.qid_for(defs[0], 0), "imposter-pool")
```

- [ ] **Step 2: Implement**

```python
# backend/trivia/questions/games/imposter.py
"""NBA Imposter mystery pool — one row, materialized to the tier<=2 name list
the turn server draws from (rule mirrored from turnGames.js pickMystery)."""
from trivia.questions.base import Invalid, envelope
from trivia.questions.hashing import content_hash

SLUG = "imposter"
TARGET = 1
MINIMUM = 20
MAX_MYSTERY_TIER = 2
DEFINITION = {"rule": "fame_tier<=2"}


def _eligible(row):
    return isinstance(row.get("full_name"), str) and row["full_name"].strip() and (row.get("fame_tier") or 4) <= MAX_MYSTERY_TIER


def generate(dataset, existing_hashes, rng, n):
    return [] if content_hash(DEFINITION) in existing_hashes else [dict(DEFINITION)]


def materialize(definition, dataset):
    if definition != DEFINITION:
        raise Invalid(f"unknown imposter rule {definition!r}")
    names = [r["full_name"] for r in dataset.playable if _eligible(r)]
    if len(names) < MINIMUM:
        raise Invalid(f"only {len(names)} mystery names; need >= {MINIMUM}")
    return envelope(SLUG, None, {"names": names})


def validate(materialized):
    names = materialized.get("names") or []
    problems = []
    if len(names) < MINIMUM:
        problems.append(f"{len(names)} names")
    if len({n.lower() for n in names}) != len(names):
        problems.append("duplicate names")
    return problems


def index_item(definition, materialized):
    return [None, len(materialized["names"])]


def players_referenced(definition, materialized):
    names = set(materialized["names"])
    return sorted(pid for pid, r in _by_name_ids(names).items())


def _by_name_ids(names):
    # populated by the runner via materialize's dataset; kept simple: ids resolved in runner
    return {}


def qid_for(definition, seq):
    return "imposter-pool"
```

Simplify: make `players_referenced` compute from the dataset instead of the placeholder helper — change the signature use in the runner to pass `dataset` too. Final version:

```python
def players_referenced(definition, materialized, dataset=None):
    if dataset is None:
        return []
    names = set(materialized["names"])
    return sorted(r["person_id"] for r in dataset.playable if r["full_name"] in names)
```

and delete `_by_name_ids`. Every other module accepts the optional third argument too (`def players_referenced(definition, materialized, dataset=None)`), and the runner always passes it.

```python
# backend/trivia/questions/games/__init__.py
"""Per-game question modules (spec §8). Module attribute contract:
SLUG, TARGET, MINIMUM, generate, materialize, validate, index_item,
players_referenced, qid_for."""
from trivia.questions.games import career_path, contexto, imposter, superdraft, tictactoe, who_are_ya

GAME_MODULES = {m.SLUG: m for m in (career_path, who_are_ya, tictactoe, superdraft, contexto, imposter)}
```

Update the four earlier modules' `players_referenced` signatures to `(definition, materialized, dataset=None)`.

- [ ] **Step 3: Run all questions tests** → `python manage.py test trivia.tests -p "test_questions_*.py"` PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/trivia/questions/games backend/trivia/tests/test_questions_registry.py
git commit -m "feat(questions): Imposter pool module and game registry"
```

### Task 10: Snapshot builder, names file, publish plan, retention

**Files:**
- Create: `backend/trivia/questions/snapshot.py`
- Test: `backend/trivia/tests/test_questions_snapshot.py`

**Interfaces:**
- Consumes: `trivia.data_pipeline.publish.upload_plan(plan, client, bucket)`, `POOL_CACHE`, `MANIFEST_CACHE`.
- Produces: `build_names(playable) -> list[[int, str, list[str]]]`; `write_snapshot(out_dir, version, dataset_version, per_game: dict[slug, list[tuple[qid, index_item, materialized]]], names) -> dict` (returns `{slug: count}`); `build_questions_publish_plan(out_dir, version, dataset_version, public_base, counts) -> plan`; `apply_retention(client, bucket, keep=3) -> list[str]` (deleted prefixes).

- [ ] **Step 1: Failing tests**

```python
# backend/trivia/tests/test_questions_snapshot.py
import json
import os
import tempfile

from django.test import SimpleTestCase

from trivia.data_pipeline.publish import MANIFEST_CACHE, POOL_CACHE, upload_plan
from trivia.questions import snapshot
from trivia.tests.questions_fixture import fixture_dataset


class FakeS3:
    def __init__(self, existing_prefixes=()):
        self.objects = {}
        self.calls = []
        self._prefixes = list(existing_prefixes)

    def put_object(self, Bucket, Key, Body, ContentType, CacheControl):
        self.objects[Key] = (Body, ContentType, CacheControl)
        self.calls.append(("put", Key))

    def list_objects_v2(self, Bucket, Prefix, Delimiter=None, ContinuationToken=None):
        if Delimiter:
            return {"CommonPrefixes": [{"Prefix": p} for p in self._prefixes], "IsTruncated": False}
        keys = [k for k in list(self.objects) + [p + "index.json" for p in self._prefixes] if k.startswith(Prefix)]
        return {"Contents": [{"Key": k} for k in keys], "IsTruncated": False}

    def delete_objects(self, Bucket, Delete):
        for o in Delete["Objects"]:
            self.objects.pop(o["Key"], None)
            self.calls.append(("del", o["Key"]))
        return {}


class SnapshotTests(SimpleTestCase):
    def test_names_and_snapshot_files(self):
        ds = fixture_dataset()
        names = snapshot.build_names(ds.playable)
        self.assertEqual(names, sorted(names, key=lambda n: n[1]))
        self.assertEqual(len(names[0]), 3)
        with tempfile.TemporaryDirectory() as tmp:
            q = {"schema": 1, "game": "career-path", "qid": "cp-000001", "player": ds.playable[0]}
            counts = snapshot.write_snapshot(tmp, "2026-09-12.1", "ds-1", {"career-path": [("cp-000001", ["cp-000001", 3], q)]}, names)
            self.assertEqual(counts, {"career-path": 1})
            with open(os.path.join(tmp, "career-path", "index.json"), encoding="utf-8") as f:
                index = json.load(f)
            self.assertEqual(index["schema"], 1)
            self.assertEqual(index["items"], [["cp-000001", 3]])
            self.assertTrue(os.path.exists(os.path.join(tmp, "career-path", "cp-000001.json")))
            self.assertTrue(os.path.exists(os.path.join(tmp, "players-names.json")))

            plan = snapshot.build_questions_publish_plan(tmp, "2026-09-12.1", "ds-1", "https://cdn/base", counts)
            keys = [o["key"] for o in plan["objects"]]
            self.assertIn("questions/v/2026-09-12.1/career-path/index.json", keys)
            self.assertTrue(all(o["cache_control"] == POOL_CACHE for o in plan["objects"]))
            self.assertEqual(plan["manifest_key"], "questions/manifest.json")
            self.assertEqual(plan["manifest_cache"], MANIFEST_CACHE)
            self.assertEqual(plan["manifest"]["games"]["career-path"], {"index": "https://cdn/base/questions/v/2026-09-12.1/career-path/index.json", "count": 1})
            self.assertEqual(plan["manifest"]["names"], "https://cdn/base/questions/v/2026-09-12.1/players-names.json")

            s3 = FakeS3()
            upload_plan(plan, s3, "b")
            self.assertEqual(s3.calls[-1], ("put", "questions/manifest.json"))

    def test_retention_keeps_three_newest(self):
        s3 = FakeS3(existing_prefixes=[f"questions/v/{v}/" for v in ("2026-09-10.1", "2026-09-12.10", "2026-09-12.9", "2026-09-11.1", "2026-09-12.2")])
        deleted = snapshot.apply_retention(s3, "b", keep=3)
        self.assertEqual(deleted, ["questions/v/2026-09-10.1/", "questions/v/2026-09-11.1/"])
```

- [ ] **Step 2: Implement**

```python
# backend/trivia/questions/snapshot.py
"""Materialized questions -> files on disk -> publish plan for Storage."""
import json
import os

from trivia.data_pipeline.publish import MANIFEST_CACHE, POOL_CACHE
from trivia.questions.base import SCHEMA
from trivia.questions.storage import version_key


def build_names(playable):
    names = [[r["person_id"], r["full_name"], list(r.get("aliases") or [])] for r in playable]
    return sorted(names, key=lambda n: n[1])


def _dump(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))


def write_snapshot(out_dir, version, dataset_version, per_game, names):
    _dump(os.path.join(out_dir, "players-names.json"), names)
    counts = {}
    for slug, items in per_game.items():
        index_items = []
        for qid, index_item, materialized in items:
            _dump(os.path.join(out_dir, slug, f"{qid}.json"), materialized)
            index_items.append(index_item)
        _dump(os.path.join(out_dir, slug, "index.json"), {
            "schema": SCHEMA, "game": slug, "version": version,
            "dataset": {"players": dataset_version}, "items": index_items,
        })
        counts[slug] = len(items)
    return counts


def build_questions_publish_plan(out_dir, version, dataset_version, public_base, counts):
    base = public_base.rstrip("/")
    prefix = f"questions/v/{version}"
    objects = []
    for root, _, files in os.walk(out_dir):
        for name in sorted(files):
            local = os.path.join(root, name)
            rel = os.path.relpath(local, out_dir).replace(os.sep, "/")
            objects.append({"local_path": local, "key": f"{prefix}/{rel}",
                            "content_type": "application/json", "cache_control": POOL_CACHE})
    games = {slug: {"index": f"{base}/{prefix}/{slug}/index.json", "count": n} for slug, n in counts.items()}
    manifest = {
        "schema": SCHEMA, "version": version,
        "dataset": {"players": dataset_version},
        "names": f"{base}/{prefix}/players-names.json",
        "games": games,
    }
    return {"objects": objects, "manifest": manifest,
            "manifest_key": "questions/manifest.json", "manifest_cache": MANIFEST_CACHE}


def _list_version_prefixes(client, bucket):
    prefixes, token = [], None
    while True:
        kwargs = {"Bucket": bucket, "Prefix": "questions/v/", "Delimiter": "/"}
        if token:
            kwargs["ContinuationToken"] = token
        page = client.list_objects_v2(**kwargs)
        prefixes += [p["Prefix"] for p in page.get("CommonPrefixes", [])]
        if not page.get("IsTruncated"):
            return prefixes
        token = page.get("NextContinuationToken")


def apply_retention(client, bucket, keep=3):
    prefixes = _list_version_prefixes(client, bucket)
    ordered = sorted(prefixes, key=lambda p: version_key(p.rstrip("/").rsplit("/", 1)[-1]))
    doomed = ordered[:-keep] if len(ordered) > keep else []
    for prefix in doomed:
        keys, token = [], None
        while True:
            kwargs = {"Bucket": bucket, "Prefix": prefix}
            if token:
                kwargs["ContinuationToken"] = token
            page = client.list_objects_v2(**kwargs)
            keys += [o["Key"] for o in page.get("Contents", [])]
            if not page.get("IsTruncated"):
                break
            token = page.get("NextContinuationToken")
        for i in range(0, len(keys), 1000):
            client.delete_objects(Bucket=bucket, Delete={"Objects": [{"Key": k} for k in keys[i:i + 1000]]})
    return doomed
```

- [ ] **Step 3: Run tests** → PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/trivia/questions/snapshot.py backend/trivia/tests/test_questions_snapshot.py
git commit -m "feat(questions): snapshot writer, publish plan, retention"
```

### Task 11: Runner + `maintain_questions` command

**Files:**
- Create: `backend/trivia/questions/runner.py`, `backend/trivia/management/commands/maintain_questions.py`
- Test: `backend/trivia/tests/test_questions_runner.py`

**Interfaces:**
- Produces: `runner.run(games: list[str], publish: bool, dry_run: bool, rng: random.Random, dataset: Dataset, s3=None, cfg=None, out=print) -> dict` (summary `{slug: {"active", "retired", "added", "materialized"}, "version": str|None}`); raises `runner.BelowMinimum(slug, count, minimum)` before any publish; `runner.RunAborted` for storage failures.

- [ ] **Step 1: Failing tests**

```python
# backend/trivia/tests/test_questions_runner.py
import random
from unittest import mock

from django.test import TestCase

from trivia.models import Question
from trivia.questions import runner
from trivia.questions.hashing import content_hash
from trivia.tests.questions_fixture import fixture_dataset
from trivia.tests.test_questions_snapshot import FakeS3


class Cfg:
    bucket = "b"
    public_base = "https://cdn/base"


class RunnerTests(TestCase):
    def setUp(self):
        self.ds = fixture_dataset("ds-1")
        self.rng = random.Random(7)

    def test_top_up_materialize_and_publish(self):
        s3 = FakeS3()
        with mock.patch.object(runner, "current_published_version", return_value=None):
            summary = runner.run(["career-path", "imposter"], publish=True, dry_run=False, rng=self.rng,
                                 dataset=self.ds, s3=s3, cfg=Cfg(), out=lambda *_: None)
        self.assertGreaterEqual(summary["career-path"]["added"], runner_min("career-path"))
        self.assertEqual(Question.objects.filter(game="imposter", status="active").count(), 1)
        self.assertEqual(s3.calls[-1], ("put", "questions/manifest.json"))
        self.assertTrue(summary["version"].endswith(".1"))
        q = Question.objects.filter(game="career-path").first()
        self.assertEqual(q.dataset_version, "ds-1")
        self.assertTrue(q.qid.startswith("cp-"))

    def test_broken_definition_is_retired_with_reason(self):
        Question.objects.create(game="career-path", qid="cp-999999", definition={"person_id": -1},
                                content_hash=content_hash({"person_id": -1}))
        s3 = FakeS3()
        with mock.patch.object(runner, "current_published_version", return_value=None):
            runner.run(["career-path"], publish=True, dry_run=False, rng=self.rng, dataset=self.ds, s3=s3, cfg=Cfg(), out=lambda *_: None)
        q = Question.objects.get(qid="cp-999999")
        self.assertEqual(q.status, "retired")
        self.assertIn("not in the playable pool", q.retired_reason)
        self.assertIsNotNone(q.retired_at)

    def test_below_minimum_publishes_nothing_and_rolls_back(self):
        s3 = FakeS3()
        with mock.patch.object(runner, "current_published_version", return_value=None), \
             mock.patch("trivia.questions.games.career_path.TARGET", 5), \
             mock.patch("trivia.questions.games.career_path.MINIMUM", 50):
            with self.assertRaises(runner.BelowMinimum):
                runner.run(["career-path"], publish=True, dry_run=False, rng=self.rng, dataset=self.ds, s3=s3, cfg=Cfg(), out=lambda *_: None)
        self.assertEqual(s3.calls, [])
        self.assertEqual(Question.objects.count(), 0)

    def test_failed_upload_rolls_back_db(self):
        class Boom(FakeS3):
            def put_object(self, *a, **k):
                raise RuntimeError("s3 down")
        with mock.patch.object(runner, "current_published_version", return_value=None):
            with self.assertRaises(RuntimeError):
                runner.run(["imposter"], publish=True, dry_run=False, rng=self.rng, dataset=self.ds, s3=Boom(), cfg=Cfg(), out=lambda *_: None)
        self.assertEqual(Question.objects.count(), 0)

    def test_dry_run_writes_nothing(self):
        s3 = FakeS3()
        with mock.patch.object(runner, "current_published_version", return_value=None):
            runner.run(["imposter"], publish=True, dry_run=True, rng=self.rng, dataset=self.ds, s3=s3, cfg=Cfg(), out=lambda *_: None)
        self.assertEqual(Question.objects.count(), 0)
        self.assertEqual(s3.calls, [])


def runner_min(slug):
    from trivia.questions.games import GAME_MODULES
    return GAME_MODULES[slug].MINIMUM
```

- [ ] **Step 2: Implement**

```python
# backend/trivia/questions/runner.py
"""The maintenance job: re-materialize, retire, top up, gate, publish (spec §9)."""
import re
import tempfile

from django.db import transaction
from django.utils import timezone

from trivia.data_pipeline.publish import upload_plan
from trivia.models import Question
from trivia.questions.base import Invalid
from trivia.questions.games import GAME_MODULES
from trivia.questions.hashing import content_hash
from trivia.questions.snapshot import apply_retention, build_names, build_questions_publish_plan, write_snapshot
from trivia.questions.storage import StorageUnavailable, fetch_json, next_version, public_url

GENERATE_BATCH = 50


class BelowMinimum(Exception):
    def __init__(self, slug, count, minimum):
        super().__init__(f"{slug}: {count} active < minimum {minimum}")
        self.slug, self.count, self.minimum = slug, count, minimum


class RunAborted(Exception):
    pass


def current_published_version(cfg):
    try:
        return (fetch_json(public_url(cfg, "questions/manifest.json")) or {}).get("version")
    except StorageUnavailable:
        return None


def _next_seq(slug):
    seqs = [0]
    for qid in Question.objects.filter(game=slug).values_list("qid", flat=True):
        m = re.search(r"(\d+)$", qid)
        if m:
            seqs.append(int(m.group(1)))
    return max(seqs) + 1


def _materialize_row(mod, row, dataset, now):
    try:
        m = mod.materialize(row.definition, dataset)
        problems = mod.validate(m)
    except Invalid as e:
        problems = [str(e)]
        m = None
    if problems:
        row.status = Question.STATUS_RETIRED
        row.retired_at = now
        row.retired_reason = "; ".join(problems)[:2000]
        row.save(update_fields=["status", "retired_at", "retired_reason", "updated_at"])
        return None
    m["qid"] = row.qid
    row.quality = {"materialized": True}
    row.players_referenced = mod.players_referenced(row.definition, m, dataset)
    row.dataset_version = dataset.version
    row.save(update_fields=["quality", "players_referenced", "dataset_version", "updated_at"])
    item = mod.index_item(row.definition, m)
    item[0] = row.qid
    return (row.qid, item, m)


def _process_game(slug, dataset, rng, now, out):
    mod = GAME_MODULES[slug]
    if slug == "contexto":
        dataset.extra["contexto_existing"] = list(
            Question.objects.filter(game=slug, status=Question.STATUS_ACTIVE).values_list("definition", flat=True)
        )
    kept, retired = [], 0
    for row in Question.objects.filter(game=slug, status=Question.STATUS_ACTIVE).order_by("id"):
        result = _materialize_row(mod, row, dataset, now)
        if result is None:
            retired += 1
        else:
            kept.append(result)
    target = mod.TARGET if mod.TARGET is not None else 10 ** 9
    existing = set(Question.objects.filter(game=slug).values_list("content_hash", flat=True))
    added, seq = 0, _next_seq(slug)
    while len(kept) < target:
        want = min(GENERATE_BATCH, target - len(kept)) if mod.TARGET is not None else GENERATE_BATCH
        defs = mod.generate(dataset, existing, rng, want)
        if not defs:
            break
        for d in defs:
            h = content_hash(d)
            if h in existing:
                continue
            existing.add(h)
            row = Question(game=slug, qid=mod.qid_for(d, seq), definition=d, content_hash=h, created_by="generator")
            seq += 1
            row.save()
            result = _materialize_row(mod, row, dataset, now)
            if result is not None:
                kept.append(result)
                added += 1
        if slug == "contexto":
            dataset.extra["contexto_existing"] += defs
    active = len(kept)
    if slug == "imposter":
        active = len(kept[0][2]["names"]) if kept else 0
    if active < mod.MINIMUM:
        raise BelowMinimum(slug, active, mod.MINIMUM)
    out(f"  {slug}: active {len(kept)}, retired {retired}, added {added}")
    return kept, {"active": len(kept), "retired": retired, "added": added, "materialized": len(kept)}


def run(games, publish, dry_run, rng, dataset, s3=None, cfg=None, out=print):
    games = games or list(GAME_MODULES)
    now = timezone.now()
    summary = {"version": None}
    with transaction.atomic():
        per_game = {}
        for slug in games:
            kept, stats = _process_game(slug, dataset, rng, now, out)
            per_game[slug] = kept
            summary[slug] = stats
        if publish and not dry_run:
            version = next_version(current_published_version(cfg))
            names = build_names(dataset.playable)
            with tempfile.TemporaryDirectory() as tmp:
                counts = write_snapshot(tmp, version, dataset.version, per_game, names)
                plan = build_questions_publish_plan(tmp, version, dataset.version, cfg.public_base, counts)
                upload_plan(plan, s3, cfg.bucket)
            apply_retention(s3, cfg.bucket, keep=3)
            summary["version"] = version
            out(f"  published version {version}")
        if dry_run:
            transaction.set_rollback(True)
            out("  dry run: rolled back")
    return summary
```

Note `write_snapshot` receives `kept` tuples `(qid, index_item, materialized)` — the same shape Task 10 tested.

```python
# backend/trivia/management/commands/maintain_questions.py
"""Daily job (GitHub Actions): download the dataset, refresh the questions
table, publish a new snapshot. Exit 1 on any gate failure — nothing is published."""
import random

from django.core.management.base import BaseCommand, CommandError

from trivia.questions import runner
from trivia.questions.games import GAME_MODULES
from trivia.questions.storage import StorageConfig, StorageUnavailable, download_players_dataset, s3_client


class Command(BaseCommand):
    help = "Re-materialize, prune, top up and publish the pre-generated game questions."

    def add_arguments(self, parser):
        parser.add_argument("--games", default="", help="comma-separated slugs (default: all)")
        parser.add_argument("--no-publish", action="store_true")
        parser.add_argument("--dry-run", action="store_true", help="run everything, roll back, upload nothing")
        parser.add_argument("--rng-seed", type=int, default=None)

    def handle(self, *args, **opts):
        games = [g.strip() for g in opts["games"].split(",") if g.strip()] or list(GAME_MODULES)
        unknown = [g for g in games if g not in GAME_MODULES]
        if unknown:
            raise CommandError(f"unknown games: {unknown}")
        cfg = StorageConfig.from_env()
        try:
            dataset = download_players_dataset(cfg)
        except StorageUnavailable as e:
            raise CommandError(f"dataset unavailable: {e}")
        self.stdout.write(f"dataset players {dataset.version}: {len(dataset.playable)} playable / {len(dataset.rows)} rows")
        s3 = None if opts["no_publish"] or opts["dry_run"] else s3_client(cfg)
        rng = random.Random(opts["rng_seed"])
        try:
            summary = runner.run(games, publish=not opts["no_publish"], dry_run=opts["dry_run"],
                                 rng=rng, dataset=dataset, s3=s3, cfg=cfg, out=self.stdout.write)
        except runner.BelowMinimum as e:
            raise CommandError(str(e))
        self.stdout.write(self.style.SUCCESS(f"done: {summary}"))
```

- [ ] **Step 3: Run tests** → `python manage.py test trivia.tests.test_questions_runner -v 2` PASS; then the whole suite.

- [ ] **Step 4: Commit**

```bash
git add backend/trivia/questions/runner.py backend/trivia/management/commands/maintain_questions.py backend/trivia/tests/test_questions_runner.py
git commit -m "feat(questions): maintenance runner and maintain_questions command"
```

### Task 12: `upload_dataset`, refresh script hook, GitHub workflow, first publish

**Files:**
- Create: `backend/trivia/management/commands/upload_dataset.py`, `.github/workflows/maintain-questions.yml`
- Modify: `backend/scripts/refresh_nba_data.cmd` (append one line after the pools are built), `backend/requirements-publish.txt` (comment only), `docs/DATA_PIPELINE.md` (new section — final wording in Task 21)
- Test: `backend/trivia/tests/test_questions_upload.py`

- [ ] **Step 1: Failing test**

```python
# backend/trivia/tests/test_questions_upload.py
import hashlib
import json
import os
import tempfile

from django.test import SimpleTestCase

from trivia.questions.upload import build_dataset_plan
from trivia.tests.test_questions_snapshot import FakeS3
from trivia.data_pipeline.publish import upload_plan


class UploadDatasetTests(SimpleTestCase):
    def test_plan_and_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "players_curated.json")
            rows = [{"person_id": 1, "full_name": "A", "teams": [{"abbr": "LAL"}]}]
            with open(path, "w", encoding="utf-8") as f:
                json.dump(rows, f)
            plan = build_dataset_plan(path, "2026-09-06.3", "https://cdn/base")
            self.assertEqual(plan["objects"][0]["key"], "datasets/players/v/2026-09-06.3/players_curated.json")
            self.assertEqual(plan["manifest_key"], "datasets/manifest.json")
            entry = plan["manifest"]["players"]
            self.assertEqual(entry["version"], "2026-09-06.3")
            self.assertEqual(entry["count"], 1)
            with open(path, "rb") as f:
                self.assertEqual(entry["sha256"], hashlib.sha256(f.read()).hexdigest())
            s3 = FakeS3()
            upload_plan(plan, s3, "b")
            self.assertEqual(s3.calls[-1], ("put", "datasets/manifest.json"))
```

- [ ] **Step 2: Implement**

```python
# backend/trivia/questions/upload.py
import json

from trivia.data_pipeline.manifest import sha256_file
from trivia.data_pipeline.publish import MANIFEST_CACHE, POOL_CACHE


def build_dataset_plan(path, version, public_base):
    base = public_base.rstrip("/")
    key = f"datasets/players/v/{version}/players_curated.json"
    with open(path, encoding="utf-8") as f:
        count = len(json.load(f))
    return {
        "objects": [{"local_path": path, "key": key, "content_type": "application/json", "cache_control": POOL_CACHE}],
        "manifest": {"players": {"version": version, "url": f"{base}/{key}", "sha256": sha256_file(path), "count": count}},
        "manifest_key": "datasets/manifest.json",
        "manifest_cache": MANIFEST_CACHE,
    }
```

```python
# backend/trivia/management/commands/upload_dataset.py
"""Home-PC step after generate_players_curated: put the dataset in Storage."""
import json
import os

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from trivia.data_pipeline.publish import upload_plan
from trivia.questions.storage import StorageConfig, s3_client
from trivia.questions.upload import build_dataset_plan

DEFAULT_PATH = os.path.join(settings.BASE_DIR, "trivia", "data_static", "players_curated.json")
MANIFEST = os.path.join(settings.BASE_DIR, "trivia", "data", "manifest.json")


class Command(BaseCommand):
    help = "Upload players_curated.json to Supabase Storage and point datasets/manifest.json at it."

    def add_arguments(self, parser):
        parser.add_argument("--path", default=DEFAULT_PATH)
        parser.add_argument("--version", default=None, help="default: trivia/data/manifest.json version")
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **opts):
        version = opts["version"]
        if not version:
            with open(MANIFEST, encoding="utf-8") as f:
                version = json.load(f)["version"]
        cfg = StorageConfig.from_env()
        plan = build_dataset_plan(opts["path"], version, cfg.public_base)
        if opts["dry_run"]:
            for o in plan["objects"]:
                self.stdout.write(f"PUT {o['key']}")
            self.stdout.write(f"PUT {plan['manifest_key']}")
            return
        if not os.path.exists(opts["path"]):
            raise CommandError(f"{opts['path']} not found")
        upload_plan(plan, s3_client(cfg), cfg.bucket)
        self.stdout.write(self.style.SUCCESS(f"uploaded players dataset {version}"))
```

Append to `backend/scripts/refresh_nba_data.cmd` right after the `build_pools_from_db` line (read the file first; keep its `venv\Scripts\python.exe` invocation style):

```
venv\Scripts\python.exe manage.py upload_dataset >> scripts\last_refresh.log 2>&1
```

```yaml
# .github/workflows/maintain-questions.yml
name: Maintain Questions
# Re-materializes, prunes, tops up and publishes the pre-generated game questions.
# Reads the player dataset from Supabase Storage (never stats.nba.com).
on:
  schedule:
    - cron: "0 4 * * *"   # 04:00 UTC daily
  workflow_dispatch:
    inputs:
      games:
        description: "comma-separated slugs (empty = all)"
        required: false
        default: ""
concurrency:
  group: maintain-questions
  cancel-in-progress: false
permissions:
  contents: read
jobs:
  maintain:
    runs-on: ubuntu-latest
    env:
      DATABASE_URL: ${{ secrets.DATABASE_URL }}
      SUPABASE_S3_ENDPOINT: ${{ secrets.SUPABASE_S3_ENDPOINT }}
      SUPABASE_S3_REGION: ${{ secrets.SUPABASE_S3_REGION }}
      SUPABASE_S3_ACCESS_KEY_ID: ${{ secrets.SUPABASE_S3_ACCESS_KEY_ID }}
      SUPABASE_S3_SECRET_ACCESS_KEY: ${{ secrets.SUPABASE_S3_SECRET_ACCESS_KEY }}
      SUPABASE_STORAGE_BUCKET: ${{ secrets.SUPABASE_STORAGE_BUCKET }}
      QUESTIONS_PUBLIC_BASE: ${{ secrets.QUESTIONS_PUBLIC_BASE }}
      DJANGO_SECRET_KEY: ${{ secrets.DJANGO_SECRET_KEY }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.13"
          cache: pip
      - name: Install
        run: pip install -r backend/requirements.txt -r backend/requirements-publish.txt
      - name: Maintain and publish
        working-directory: backend
        run: python manage.py maintain_questions --games "${{ inputs.games }}" | tee ../maintain-questions.log
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: maintain-questions-log
          path: maintain-questions.log
```

Check `backend/backend/settings.py` for the exact secret-key env name (`grep -n "SECRET_KEY" backend/backend/settings.py`) and use that name instead of `DJANGO_SECRET_KEY` if it differs.

- [ ] **Step 3: Run tests + first manual publish (Stefan supplies the env values locally)**

Run: `cd backend && python manage.py test && python manage.py upload_dataset --dry-run && python manage.py maintain_questions --dry-run`
Expected: suite green; dry runs print the plan / per-game counts and "rolled back".
Then, with real values in `backend/.env`: `python manage.py upload_dataset` and `python manage.py maintain_questions` → "published version 2026-MM-DD.1". Verify: `curl -s "$QUESTIONS_PUBLIC_BASE/questions/manifest.json"` shows six games; fetch one index and one question.

- [ ] **Step 4: Commit, open the Phase A PR**

```bash
git add backend/trivia/questions/upload.py backend/trivia/management/commands/upload_dataset.py backend/trivia/tests/test_questions_upload.py backend/scripts/refresh_nba_data.cmd .github/workflows/maintain-questions.yml
git commit -m "feat(questions): dataset upload command and daily maintain workflow"
```

Follow `CLAUDE.md` Shipping: push, `gh pr create --base dev`, checks green, merge. Then Stefan adds the six repository secrets listed in the workflow (Settings → Secrets → Actions) and runs the workflow once by hand (`gh workflow run maintain-questions.yml`).

---

# Phase B — Client library + Career Path + Who Are Ya (branch `feat/questions-b-client`)

### Task 13: Types, `questions.ts`, `useNames`, env

**Files:**
- Modify: `src/types/types.tsx` (append), `next.config.ts` (env block)
- Create: `src/utils/questions.ts`, `src/hooks/useNames.ts`

**Interfaces:**
- Produces (TypeScript):
  - types `QuestionsManifest`, `NamesEntry = [number, string, string[]]`, `QuestionIndex`, `CareerPathQuestion`, `WhoAreYaQuestion`, `TicTacToeQuestion`, `SuperDraftQuestion`, `ContextoQuestion`, `ImposterQuestion`, `Question`
  - `SUPPORTED_SCHEMA = 1`
  - `getManifest(): Promise<QuestionsManifest>`, `loadNames(): Promise<NamesEntry[]>`, `loadIndex(game): Promise<QuestionIndex>`, `loadQuestion<T extends Question>(game, qid): Promise<T>`
  - `pickRandom(index)`, `pickWeighted(index)`, `pickDaily(index, today = utcToday())` → `string` (qid)
  - `fetchQuestion(game: string): Promise<FetchResult>` → `{ success: true, data: [question] }`
  - `buildNameLookup(names): { suggestions: string[]; toId: (guess: string) => number | null; nameOf: (id: number) => string | null }`
  - hook `useNames(): NamesEntry[] | null`

- [ ] **Step 1: Types**

Append to `src/types/types.tsx`:

```ts
/* ---- Pre-generated questions (docs/superpowers/specs/2026-09-10-questions-store-design.md) ---- */

export interface QuestionsManifest {
  schema: number;
  version: string;
  dataset: { players: string };
  names: string;
  games: Record<string, { index: string; count: number }>;
}

/** [person_id, full_name, aliases] */
export type NamesEntry = [number, string, string[]];

export interface QuestionIndex {
  schema: number;
  game: string;
  version: string;
  dataset: { players: string };
  /** Per game: [qid] | [qid, weight] | [qid, day] | [qid, namesCount] */
  items: (string | number)[][];
}

interface QuestionBase {
  schema: number;
  game: string;
  qid: string;
}
export interface CareerPathQuestion extends QuestionBase { player: PlayerIndexEntry }
export interface WhoAreYaQuestion extends QuestionBase { player: PlayerIndexEntry }
export interface TicTacToeQuestion extends QuestionBase { rows: Criterion[]; cols: Criterion[]; valid: number[][] }
export interface SuperDraftSlot { kind: "team" | "draft" | "country"; value: string; label: string; sub: string; eligible: [number, number | null, number, number, number | null][] }
export interface SuperDraftQuestion extends QuestionBase { slots: SuperDraftSlot[] }
export interface ContextoQuestion extends QuestionBase { day: string; secret: PlayerIndexEntry; ranking: [number, number][] }
export interface ImposterQuestion extends QuestionBase { names: string[] }
export type Question =
  | CareerPathQuestion | WhoAreYaQuestion | TicTacToeQuestion
  | SuperDraftQuestion | ContextoQuestion | ImposterQuestion;
```

and add `| Question` to the `GameData` union (the `| PlayerIndexEntry | string;` line).

- [ ] **Step 2: Client library**

```ts
// src/utils/questions.ts
// Pre-generated questions: manifest (60 s) -> index -> one question file, all from
// Supabase Storage's public CDN. Same caching shape as utils/pool.ts.
import type {
  FetchResult, NamesEntry, Question, QuestionIndex, QuestionsManifest,
} from "../types/types";
import { normalizeAnswer } from "./answerMatch";

export const SUPPORTED_SCHEMA = 1;
const BASE = (process.env.VITE_QUESTIONS_BASE || "").replace(/\/$/, "");
const MANIFEST_TTL_MS = 60_000;
const LS_MANIFEST = "questions:manifest";

let manifestCache: { at: number; value: QuestionsManifest } | null = null;
let manifestPromise: Promise<QuestionsManifest> | null = null;
const mem = new Map<string, unknown>();

class QuestionsUnavailable extends Error {}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new QuestionsUnavailable(`${url} ${res.status}`);
  return (await res.json()) as T;
}

function readLs<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeLs(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // quota / private mode: memory cache still serves this session
  }
}

function pruneOtherVersions(keep: string): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith("questions:v:") && !k.startsWith(`questions:v:${keep}:`)) localStorage.removeItem(k);
    }
  } catch {
    // ignore
  }
}

export async function getManifest(): Promise<QuestionsManifest> {
  if (manifestCache && Date.now() - manifestCache.at < MANIFEST_TTL_MS) return manifestCache.value;
  if (!manifestPromise) {
    manifestPromise = getJson<QuestionsManifest>(`${BASE}/questions/manifest.json`)
      .then((m) => {
        if (m.schema !== SUPPORTED_SCHEMA) throw new QuestionsUnavailable(`schema ${m.schema}`);
        manifestCache = { at: Date.now(), value: m };
        writeLs(LS_MANIFEST, m);
        pruneOtherVersions(m.version);
        return m;
      })
      .catch((err) => {
        const stale = readLs<QuestionsManifest>(LS_MANIFEST);
        if (stale && stale.schema === SUPPORTED_SCHEMA) return stale;
        throw err;
      })
      .finally(() => {
        manifestPromise = null;
      });
  }
  return manifestPromise;
}

async function cached<T>(version: string, key: string, url: string): Promise<T> {
  const k = `questions:v:${version}:${key}`;
  const inMem = mem.get(k);
  if (inMem) return inMem as T;
  const stored = readLs<T>(k);
  if (stored) {
    mem.set(k, stored);
    return stored;
  }
  const value = await getJson<T>(url);
  mem.set(k, value);
  writeLs(k, value);
  return value;
}

export async function loadNames(): Promise<NamesEntry[]> {
  const m = await getManifest();
  return cached<NamesEntry[]>(m.version, "names", m.names);
}

export async function loadIndex(game: string): Promise<QuestionIndex> {
  const m = await getManifest();
  const entry = m.games[game];
  if (!entry) throw new QuestionsUnavailable(`no questions for ${game}`);
  return cached<QuestionIndex>(m.version, `${game}:index`, entry.index);
}

export async function loadQuestion<T extends Question>(game: string, qid: string): Promise<T> {
  const m = await getManifest();
  const entry = m.games[game];
  if (!entry) throw new QuestionsUnavailable(`no questions for ${game}`);
  const url = entry.index.replace(/index\.json$/, `${qid}.json`);
  try {
    return await cached<T>(m.version, `${game}:${qid}`, url);
  } catch (err) {
    // Retention race: the manifest we hold may point at a version that was just pruned.
    manifestCache = null;
    const fresh = await getManifest();
    const freshUrl = fresh.games[game].index.replace(/index\.json$/, `${qid}.json`);
    if (freshUrl === url) throw err;
    return cached<T>(fresh.version, `${game}:${qid}`, freshUrl);
  }
}

export function pickRandom(index: QuestionIndex): string {
  const items = index.items;
  return String(items[Math.floor(Math.random() * items.length)][0]);
}

export function pickWeighted(index: QuestionIndex): string {
  const items = index.items;
  const total = items.reduce((s, it) => s + (Number(it[1]) || 1), 0);
  let r = Math.random() * total;
  for (const it of items) {
    r -= Number(it[1]) || 1;
    if (r <= 0) return String(it[0]);
  }
  return String(items[items.length - 1][0]);
}

export function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/** FNV-1a over the date — the existing Contexto dailySecret rule, used only as a fallback. */
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function pickDaily(index: QuestionIndex, today = utcToday()): string {
  const scheduled = index.items.find((it) => it[1] === today);
  if (scheduled) return String(scheduled[0]);
  const sorted = [...index.items].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return String(sorted[hashStr(today) % sorted.length][0]);
}

const PICKERS: Record<string, (i: QuestionIndex) => string> = {
  "career-path": pickWeighted,
  "who-are-ya": pickRandom,
  tictactoe: pickRandom,
  superdraft: pickRandom,
  contexto: (i) => pickDaily(i),
  imposter: (i) => String(i.items[0][0]),
};

const UNAVAILABLE = {
  success: false,
  error: {
    title: "Unable to connect to the server",
    message: "Please check your internet connection or try again later.",
  },
} as const;

/** One question for a game, in the { success, data: [question] } shape MiniGame expects. */
export async function fetchQuestion(game: string): Promise<FetchResult> {
  try {
    const index = await loadIndex(game);
    if (!index.items.length) return { success: false, error: { title: "No data available", message: "Please try again later." } };
    const qid = (PICKERS[game] ?? pickRandom)(index);
    const q = await loadQuestion<Question>(game, qid);
    return { success: true, data: [q] };
  } catch {
    return UNAVAILABLE;
  }
}

export function buildNameLookup(names: NamesEntry[]) {
  const toIdMap = new Map<string, number>();
  const nameOfMap = new Map<number, string>();
  for (const [id, name, aliases] of names) {
    nameOfMap.set(id, name);
    const canon = normalizeAnswer(name);
    if (canon && !toIdMap.has(canon)) toIdMap.set(canon, id);
    for (const a of aliases) {
      const k = normalizeAnswer(a);
      if (k && !toIdMap.has(k)) toIdMap.set(k, id);
    }
  }
  return {
    suggestions: names.map((n) => n[1]),
    toId: (guess: string) => toIdMap.get(normalizeAnswer(guess)) ?? null,
    nameOf: (id: number) => nameOfMap.get(id) ?? null,
  };
}
```

```ts
// src/hooks/useNames.ts
import { useEffect, useState } from "react";
import type { NamesEntry } from "../types/types";
import { loadNames } from "../utils/questions";

/** The shared player name list (autocomplete + name->id). null while loading, [] on failure. */
export function useNames(): NamesEntry[] | null {
  const [names, setNames] = useState<NamesEntry[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadNames().then((n) => { if (!cancelled) setNames(n); }).catch(() => { if (!cancelled) setNames([]); });
    return () => { cancelled = true; };
  }, []);
  return names;
}
```

`next.config.ts` env block: add `VITE_QUESTIONS_BASE: process.env.VITE_QUESTIONS_BASE,`. Add `VITE_QUESTIONS_BASE=<public base>` to `.env.production` / `.env.example` if those files exist (check `ls -a | grep env`); the value is the same public base as `QUESTIONS_PUBLIC_BASE`.

- [ ] **Step 3: Verify**

Run: `npm run lint && npm run build`
Expected: clean (the new module is unused yet; ESLint must not flag unused exports).

- [ ] **Step 4: Commit**

```bash
git add src/types/types.tsx src/utils/questions.ts src/hooks/useNames.ts next.config.ts
git commit -m "feat(questions): client library, names hook, question types"
```

### Task 14: Career Path + Who Are Ya on questions

**Files:**
- Modify: `src/utils/GameUtils.tsx:348` and `:408` (`fetchData`), `src/Game Renderers/CareerPath.tsx`, `src/Game Renderers/WhoAreYa.tsx`

- [ ] **Step 1: Registry**

In `GameUtils.tsx` import `fetchQuestion` from `"./questions"` and change the two entries:

```ts
fetchData: () => fetchQuestion("career-path"),
// …
fetchData: () => fetchQuestion("who-are-ya"),
```

- [ ] **Step 2: CareerPath.tsx**

Read the file top to bottom first. Then:
1. Delete `import { fetchWholePool } from "../utils/pool";` and any `useRoundPool` import.
2. Replace the "gameInfo is the whole pool (single-player) or exactly one row (multiplayer)" logic (~line 130) and the autocomplete `useEffect` that calls `fetchWholePool("players-index")` (~line 151-170) with:

```tsx
import { useNames } from "../hooks/useNames";
import { buildNameLookup } from "../utils/questions";
import type { CareerPathQuestion } from "../types/types";

// …inside the component:
const question = gameInfo[0] as CareerPathQuestion | undefined;
const mystery = question?.player ?? null;
const names = useNames();
const lookup = useMemo(() => (names ? buildNameLookup(names) : null), [names]);
const suggestions = lookup?.suggestions ?? [];
```

3. Wherever the old code compared a guess to the mystery (`isEligible`/`pickMystery`/alias matching), keep the existing `matchAnswer(guess, mystery.full_name, mystery.aliases)` call — it is unchanged; delete `isEligible` and `pickMystery` (the server now guarantees eligibility).
4. Loading state: the renderer already keys "loading" off a null mystery; keep `names === null` as loading for the input only (render the cards immediately).

- [ ] **Step 3: WhoAreYa.tsx** — same four edits (`WhoAreYaQuestion`, `mystery = question?.player`, `useNames`, delete `isEligible` + the client-side sampler + the `fetchWholePool` effect at ~line 182).

- [ ] **Step 4: Verify in the browser**

Run: `npm run lint && npm run build && npm run dev` (needs `VITE_QUESTIONS_BASE` in `.env.local`).
Check both games: Start → a mystery loads; Network tab shows `manifest.json`, `<game>/index.json`, one `<qid>.json`, `players-names.json` and **no** `players-index.json`; autocomplete works with an accented name typed unaccented (e.g. "jokic"); wrong/right guess flows unchanged; play-again loads a different question. Multiplayer still works because the server still deals the old one-row payload for these games until Phase E — confirm `gameInfo[0].player` vs the old `gameInfo[0]` (a raw row): to stay compatible during B–D, resolve the mystery as `("player" in q ? q.player : q) as PlayerIndexEntry`.

- [ ] **Step 5: Commit + PR (Phase B)**

```bash
git add src/utils/GameUtils.tsx "src/Game Renderers/CareerPath.tsx" "src/Game Renderers/WhoAreYa.tsx"
git commit -m "feat(questions): Career Path and Who Are Ya play pre-generated questions"
```

---

# Phase C — Tic-Tac-Toe, SuperDraft, Imposter single-player (branch `feat/questions-c-boards`)

### Task 15: Tic-Tac-Toe validates by id

**Files:**
- Modify: `src/utils/GameUtils.tsx:438`, `src/Game Renderers/TicTacToe.tsx`

- [ ] **Step 1:** `fetchData: () => fetchQuestion("tictactoe")`.

- [ ] **Step 2: Renderer** — read it fully, then:
1. Remove both `fetchWholePool("players-index")` effects (~lines 138 and 426) and the `criteria.ts` import.
2. Board source: `const question = gameInfo[0] as TicTacToeQuestion; const { rows, cols, valid } = question;` (the old seed board had `rows`/`cols` in the same shape; `valid` is new).
3. Names: `const names = useNames(); const lookup = useMemo(() => names ? buildNameLookup(names) : null, [names]);` — suggestions from `lookup.suggestions`.
4. Solo guess check replaces `playerMatches(player, rowCrit) && playerMatches(player, colCrit)` with:

```ts
const id = lookup?.toId(guess) ?? null;
const ok = id !== null && valid[cell].includes(id);
const displayName = ok ? lookup!.nameOf(id)! : guess;
```

5. Solo "used player" rule keeps working by comparing `normalizeAnswer(displayName)` with occupied cells (unchanged).
6. Multiplayer path: unchanged in this task (server-authoritative; Phase E).

- [ ] **Step 3: Verify** — browser: board renders, a correct name is accepted only in cells it fits, alias/accents accepted, the same player cannot fill two cells, no `players-index.json` request. `npm run lint && npm run build` clean.

- [ ] **Step 4: Commit**

```bash
git add src/utils/GameUtils.tsx "src/Game Renderers/TicTacToe.tsx"
git commit -m "feat(questions): Tic-Tac-Toe validates guesses against precomputed cell ids"
```

### Task 16: SuperDraft reads slots + eligible tuples

**Files:**
- Modify: `src/utils/GameUtils.tsx:558`, `src/Game Renderers/SuperDraft.tsx`

- [ ] **Step 1:** `fetchData: () => fetchQuestion("superdraft")`.

- [ ] **Step 2: Renderer** — read it fully, then:
1. Delete `buildCandidates`, `drawSlots` (and the `// grouped by kind` block ~line 158-260) and the `useRoundPool`/pool state.
2. Slot state comes from the question: `const question = gameInfo[0] as SuperDraftQuestion; const slots = question.slots;` (drop `setSlots`).
3. Introduce a light pick type and metrics from the tuple:

```ts
type Pick = { person_id: number; full_name: string; height_in: number | null; rings: number; career_pts: number; birth_year: number | null };
const toPick = (t: SuperDraftSlot["eligible"][number], name: string): Pick =>
  ({ person_id: t[0], full_name: name, height_in: t[1], rings: t[2], career_pts: t[3], birth_year: t[4] });
```

`ringsOf`/`ptsOf` and the `OBJECTIVES` `perPick` functions read `p.rings`, `p.career_pts`, `p.height_in`, `p.birth_year` from `Pick` instead of `PlayerIndexEntry`. `dailyObjective` unchanged.
4. Autocomplete for the current slot: `slots[i].eligible.map((t) => lookup.nameOf(t[0])).filter(Boolean)` (was `slot.eligible` rows). Guess resolution: `const id = lookup.toId(guess); const tuple = slot.eligible.find((t) => t[0] === id);` → `toPick(tuple, lookup.nameOf(id))`.
5. Share text / result rows use `Pick.full_name`.

- [ ] **Step 3: Verify** — browser: five slots with varied kinds, a slot never lists thousands of names, picking + scoring for each objective (change the date in devtools or temporarily force `dailyObjective`), share text correct, no pool download. Lint + build clean.

- [ ] **Step 4: Commit + PR (Phase C)**

```bash
git add src/utils/GameUtils.tsx "src/Game Renderers/SuperDraft.tsx"
git commit -m "feat(questions): SuperDraft drafts from precomputed slot eligibility"
```

Imposter's single-player screen is an explainer with no data; its registry entry switches to `fetchQuestion("imposter")` in Phase E together with the turn server.

---

# Phase D — Contexto (branch `feat/questions-d-contexto`)

### Task 17: Contexto uses the precomputed ranking

**Files:**
- Modify: `src/utils/GameUtils.tsx:498`, `src/Game Renderers/Contexto.tsx`

- [ ] **Step 1:** `fetchData: () => fetchQuestion("contexto")`.

- [ ] **Step 2: Renderer** — delete `franchiseSeasons`, `jaccard`, `careerRange`, `eraOverlap`, `POS_FAMILY`, `positionFamily`, `draftProximity`, `awardsVec`, `cosine`, `similarity`, `buildRanking`, `hashStr`, `dailySecret` (lines ~25-165). Replace the `secret`/`ranking` memos (~211-220) with:

```tsx
const question = gameInfo[0] as ContextoQuestion | undefined;
const secret = question?.secret ?? null;
const rankById = useMemo(() => new Map<number, number>(question?.ranking ?? []), [question]);
const names = useNames();
const lookup = useMemo(() => (names ? buildNameLookup(names) : null), [names]);
```

Guess handler (~line 46-72): `const pid = lookup?.toId(norm)`, `const rank = rankById.get(pid)`, `name: lookup.nameOf(pid)`. Unknown name → existing "not a player" popup. `scoreFor` unchanged. Multiplayer prop compatibility: during Phase D the server still sends `{pool, day, secret_person_id}`; guard with `if (!question || !("ranking" in question)) return <existing loading/empty state>` until Phase E ships.

- [ ] **Step 3: Verify** — browser: today's secret loads; guessing the secret ends the game with rank 1; a random guess shows a rank between 2 and ~4,900; unaccented input works; no `players-index.json`. Lint + build clean.

- [ ] **Step 4: Commit + PR (Phase D)**

```bash
git add src/utils/GameUtils.tsx "src/Game Renderers/Contexto.tsx"
git commit -m "feat(questions): Contexto ranks guesses with the precomputed ranking"
```

---

# Phase E — Multiplayer server (branch `feat/questions-e-multiplayer`)

### Task 18: `questions.js`, endpoints, turn games, simulation

**Files:**
- Create: `multiplayer_server/src/questions.js`
- Modify: `multiplayer_server/src/gameEndpoints.js`, `multiplayer_server/src/index.js` (`fetchRound`), `multiplayer_server/src/turnGames.js`, `multiplayer_server/scripts/sim_turngames.js`, `src/utils/GameUtils.tsx:588` (imposter → `fetchQuestion("imposter")`)

**Interfaces:**
- Produces (Node): `questions.getManifest()`, `questions.loadNames()`, `questions.deal(gameId) -> Promise<object>` (one question; contexto picks today's, imposter the pool, career-path weighted, others random), `questions.nameLookup(names)` (same API as the TS `buildNameLookup`), `questions._setForTest({ manifest, files })`.

- [ ] **Step 1: Loader**

```js
// multiplayer_server/src/questions.js
// Pre-generated questions from Supabase Storage (public CDN). Mirrors src/utils/questions.ts.
const { normalizeAnswer } = require("./turnGames").helpers; // exported in step 3

const BASE = (process.env.QUESTIONS_PUBLIC_BASE || "").replace(/\/$/, "");
const SUPPORTED_SCHEMA = 1;
const MANIFEST_TTL_MS = 60_000;

let manifest = null;      // { at, value }
let testFiles = null;     // url -> object (test seam)
const files = new Map();  // `${version}:${key}` -> object

async function getJson(url) {
  if (testFiles) {
    if (!(url in testFiles)) throw new Error(`test file missing: ${url}`);
    return testFiles[url];
  }
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return r.json();
}

async function getManifest() {
  if (manifest && Date.now() - manifest.at < MANIFEST_TTL_MS) return manifest.value;
  const m = await getJson(`${BASE}/questions/manifest.json`);
  if (m.schema !== SUPPORTED_SCHEMA) throw new Error(`questions schema ${m.schema} unsupported`);
  manifest = { at: Date.now(), value: m };
  for (const k of files.keys()) if (!k.startsWith(`${m.version}:`)) files.delete(k);
  return m;
}

async function cached(version, key, url) {
  const k = `${version}:${key}`;
  if (files.has(k)) return files.get(k);
  const v = await getJson(url);
  files.set(k, v);
  return v;
}

async function loadNames() {
  const m = await getManifest();
  return cached(m.version, "names", m.names);
}

async function loadIndex(game) {
  const m = await getManifest();
  const entry = m.games[game];
  if (!entry) throw new Error(`no questions for ${game}`);
  return cached(m.version, `${game}:index`, entry.index);
}

async function loadQuestion(game, qid) {
  const m = await getManifest();
  const url = m.games[game].index.replace(/index\.json$/, `${qid}.json`);
  return cached(m.version, `${game}:${qid}`, url);
}

function utcToday() { return new Date().toISOString().slice(0, 10); }
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function pickRandom(index) { return String(index.items[Math.floor(Math.random() * index.items.length)][0]); }
function pickWeighted(index) {
  const total = index.items.reduce((s, it) => s + (Number(it[1]) || 1), 0);
  let r = Math.random() * total;
  for (const it of index.items) { r -= Number(it[1]) || 1; if (r <= 0) return String(it[0]); }
  return String(index.items[index.items.length - 1][0]);
}
function pickDaily(index, today = utcToday()) {
  const hit = index.items.find((it) => it[1] === today);
  if (hit) return String(hit[0]);
  const sorted = [...index.items].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return String(sorted[hashStr(today) % sorted.length][0]);
}
const PICKERS = { "career-path": pickWeighted, contexto: pickDaily, imposter: (i) => String(i.items[0][0]) };

/** One question for a game id (a room deals once so every member plays the same one). */
async function deal(gameId) {
  const index = await loadIndex(gameId);
  if (!index.items.length) throw new Error(`no questions for ${gameId}`);
  const qid = (PICKERS[gameId] || pickRandom)(index);
  return loadQuestion(gameId, qid);
}

function nameLookup(names) {
  const toId = new Map();
  const nameOf = new Map();
  for (const [id, name, aliases] of names) {
    nameOf.set(id, name);
    const c = normalizeAnswer(name);
    if (c && !toId.has(c)) toId.set(c, id);
    for (const a of aliases || []) { const k = normalizeAnswer(a); if (k && !toId.has(k)) toId.set(k, id); }
  }
  return { toId: (g) => toId.get(normalizeAnswer(g)) ?? null, nameOf: (id) => nameOf.get(id) ?? null };
}

function _setForTest(fixture) { testFiles = fixture ? fixture.files : null; manifest = null; files.clear(); }

module.exports = { getManifest, loadNames, loadIndex, loadQuestion, deal, nameLookup, pickDaily, _setForTest };
```

If `normalizeAnswer` lives as a local function in `turnGames.js`, move it to `multiplayer_server/src/answerMatch.js` (exporting `normalizeAnswer`) and require it from both files instead of the `helpers` indirection above.

- [ ] **Step 2: Endpoints + rounds**

`gameEndpoints.js`: delete the six entries (`career-path`, `who-are-ya`, `tictactoe`, `contexto`, `superdraft`, `imposter`). In `index.js` `fetchRound`:

```js
const questions = require("./questions");
const QUESTION_GAMES = new Set(["career-path", "who-are-ya", "contexto", "superdraft"]);

async function fetchRound(gameId) {
  if (QUESTION_GAMES.has(gameId)) return [await questions.deal(gameId)];
  const endpoint = gameEndpoints[gameId];
  if (!endpoint) throw new Error(`No endpoint configured for game id: ${gameId}`);
  const response = await fetch(endpoint);
  if (!response.ok) throw new Error(`Failed to fetch data: ${response.statusText}`);
  const body = await response.json();
  return Array.isArray(body) ? body : body.series ?? body.pool ?? [];
}
```

(`tictactoe`/`imposter` are in `TURN_GAMES` and never reach `fetchRound`.)

- [ ] **Step 3: Turn games**

In `turnGames.js`:
- Delete `PLAYERS_INDEX_URL`, `loadPlayersIndex`, `_setPlayersIndexForTest`, `findPlayerByName`, `playerMatches`, `generateGrid` and the criteria port (everything under "Criteria semantics").
- `initTTT`:

```js
async function initTTT(room, helpers) {
  const [question, names] = await Promise.all([questions.deal("tictactoe"), questions.loadNames()]);
  const state = {
    board: Array(9).fill(null),
    criteria: { rows: question.rows, cols: question.cols },
    turnUid: room.members[0],
    deadlineTs: Date.now() + TTT_TURN_MS,
    stealsLeft: Object.fromEntries(room.members.map((m) => [m, TTT_STEALS])),
    winnerUid: null,
    draw: false,
  };
  room.turn = { game: "tictactoe", state, valid: question.valid, lookup: questions.nameLookup(names), trustClient: false };
  armTurnTimer(room, helpers);
  broadcastTurnState(room, helpers);
}
```

- `handleTTT` answer validation block becomes:

```js
const id = t.lookup.toId(name);
if (id === null || !t.valid[cell].includes(id)) {
  return helpers.reject(uid, `${name} doesn't fit that square.`);
}
const displayName = t.lookup.nameOf(id);
```

(the used-player check and the rest are unchanged). If `deal`/`loadNames` reject, `turnGames.init` already surfaces `roundDataError` — the old "trust the client" fallback is removed because there is no pool to fall back to; keep `trustClient: false`.
- Imposter `pickMystery`: `const q = await questions.deal("imposter"); const pool = q.names;` then the existing random choice over `pool` (a name list), deleting the `FALLBACK_MYSTERY` list.
- Export `_setQuestionsForTest = questions._setForTest` next to the other test seams.

- [ ] **Step 4: Simulation**

Extend `multiplayer_server/scripts/sim_turngames.js`: build a fixture `{ files: { "<BASE>/questions/manifest.json": {...}, "<BASE>/questions/v/t/players-names.json": [[1,"Kobe Bryant",[]],[2,"LeBron James",[]],[3,"Shaquille O'Neal",["Shaq"]]], "<BASE>/questions/v/t/tictactoe/index.json": {schema:1,game:"tictactoe",version:"t",dataset:{players:"t"},items:[["ttt-0001"]]}, "<BASE>/questions/v/t/tictactoe/ttt-0001.json": {schema:1,game:"tictactoe",qid:"ttt-0001",rows:[...],cols:[...],valid:[[1,2],[3],[1],[2],[3],[1],[2],[3],[1,2,3]]}, … } }`, call `_setQuestionsForTest`, and assert: a claim with "Shaq" on a cell whose `valid` contains 3 succeeds and canonicalises to "Shaquille O'Neal"; the same player on a second cell is rejected with "already on the board"; a name not in `valid` is rejected with "doesn't fit".

Run: `node multiplayer_server/scripts/sim_turngames.js` → all assertions pass.

- [ ] **Step 5: Two-browser check**

Run the server locally with `QUESTIONS_PUBLIC_BASE` set; open two browsers; play one Tic-Tac-Toe room and one Career Path room end to end. Then deploy: `cd multiplayer_server && railway up` (Railway env gets `QUESTIONS_PUBLIC_BASE`).

- [ ] **Step 6: Commit + PR (Phase E)**

```bash
git add multiplayer_server/src multiplayer_server/scripts/sim_turngames.js src/utils/GameUtils.tsx
git commit -m "feat(questions): multiplayer deals pre-generated questions; TTT validates by id"
```

---

# Phase F — Admin (branch `feat/questions-f-admin`)

### Task 19: Admin API — list, retire, publish

**Files:**
- Modify: `backend/trivia/admin_api.py`, `backend/trivia/admin_urls.py`
- Test: `backend/trivia/tests/test_admin_questions.py`

**Interfaces:**
- `GET /api/admin/questions/?game=&status=&q=&limit=&offset=` → `{game, total, offset, rows: [{id, qid, status, created_by, quality, dataset_version, retired_reason, players_referenced_count, updated_at}]}`
- `POST /api/admin/questions/<int:pk>/retire/` `{reason}` → `{id, status: "retired"}` (409 if already retired)
- `POST /api/admin/questions/publish/` → 202 `{dispatched: true}`; 503 `{error}` when `GITHUB_DISPATCH_TOKEN` is unset or GitHub rejects.

- [ ] **Step 1: Failing tests** (copy the staff-user setup from `test_admin_api.py`)

```python
# backend/trivia/tests/test_admin_questions.py
import os
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse

from trivia.models import Question


class AdminQuestionsTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.staff = User.objects.create_user(username="admin", email="a@x.io", password="pw", is_staff=True)
        self.client.force_login(self.staff)
        for i in range(3):
            Question.objects.create(game="career-path", qid=f"cp-{i:06d}", definition={"person_id": i}, content_hash=str(i) * 64)

    def test_requires_staff(self):
        self.client.logout()
        self.assertIn(self.client.get(reverse("admin-questions")).status_code, (401, 403))

    def test_list_filters_and_pages(self):
        res = self.client.get(reverse("admin-questions"), {"game": "career-path", "limit": 2})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["total"], 3)
        self.assertEqual(len(res.json()["rows"]), 2)
        res = self.client.get(reverse("admin-questions"), {"game": "career-path", "q": "cp-000002"})
        self.assertEqual([r["qid"] for r in res.json()["rows"]], ["cp-000002"])

    def test_retire(self):
        q = Question.objects.first()
        res = self.client.post(reverse("admin-question-retire", args=[q.pk]), {"reason": "wrong facts"}, content_type="application/json")
        self.assertEqual(res.status_code, 200)
        q.refresh_from_db()
        self.assertEqual(q.status, "retired")
        self.assertEqual(q.retired_reason, "wrong facts")
        self.assertEqual(self.client.post(reverse("admin-question-retire", args=[q.pk]), {}, content_type="application/json").status_code, 409)

    def test_publish_needs_token(self):
        with mock.patch.dict(os.environ, {"GITHUB_DISPATCH_TOKEN": ""}):
            self.assertEqual(self.client.post(reverse("admin-questions-publish")).status_code, 503)

    def test_publish_dispatches(self):
        with mock.patch.dict(os.environ, {"GITHUB_DISPATCH_TOKEN": "t"}), \
             mock.patch("trivia.admin_api.requests.post") as post:
            post.return_value.status_code = 204
            res = self.client.post(reverse("admin-questions-publish"))
        self.assertEqual(res.status_code, 202)
        self.assertIn("maintain-questions.yml/dispatches", post.call_args[0][0])
```

- [ ] **Step 2: Implement** (append to `admin_api.py`; add `import requests`, `from django.utils import timezone`, `Question` to the models import)

```python
GITHUB_REPO = "stefanroman22/nba-trivia-minigames"
QUESTION_SOURCES = [f"questions:{slug}" for slug in ("career-path", "who-are-ya", "tictactoe", "superdraft", "contexto", "imposter")]


@api_view(["GET"])
@permission_classes([IsAdminUser])
def admin_questions(request):
    game = str(request.query_params.get("game") or "")
    status = str(request.query_params.get("status") or "")
    query = str(request.query_params.get("q") or "").strip()
    try:
        limit = min(max(int(request.query_params.get("limit", 20)), 1), 100)
        offset = max(int(request.query_params.get("offset", 0)), 0)
    except ValueError:
        return Response({"error": "limit/offset must be integers"}, status=400)
    qs = Question.objects.order_by("-updated_at")
    if game:
        qs = qs.filter(game=game)
    if status:
        qs = qs.filter(status=status)
    if query:
        qs = qs.filter(Q(qid__icontains=query) | Q(retired_reason__icontains=query))
    total = qs.count()
    rows = [
        {
            "id": q.id, "qid": q.qid, "game": q.game, "status": q.status, "created_by": q.created_by,
            "quality": q.quality, "dataset_version": q.dataset_version, "retired_reason": q.retired_reason,
            "players_referenced_count": len(q.players_referenced or []), "updated_at": _iso(q.updated_at),
        }
        for q in qs[offset:offset + limit]
    ]
    return Response({"game": game, "total": total, "offset": offset, "rows": rows})


@api_view(["POST"])
@permission_classes([IsAdminUser])
def admin_question_retire(request, pk):
    try:
        q = Question.objects.get(pk=pk)
    except Question.DoesNotExist:
        return Response({"error": "not found"}, status=404)
    if q.status == Question.STATUS_RETIRED:
        return Response({"error": "already retired"}, status=409)
    q.status = Question.STATUS_RETIRED
    q.retired_at = timezone.now()
    q.retired_reason = str((request.data or {}).get("reason") or "retired by admin")[:2000]
    q.save(update_fields=["status", "retired_at", "retired_reason", "updated_at"])
    return Response({"id": q.id, "status": q.status})


@api_view(["POST"])
@permission_classes([IsAdminUser])
def admin_questions_publish(request):
    token = (os.environ.get("GITHUB_DISPATCH_TOKEN") or "").strip()
    if not token:
        return Response({"error": "GITHUB_DISPATCH_TOKEN is not configured on the backend"}, status=503)
    res = requests.post(
        f"https://api.github.com/repos/{GITHUB_REPO}/actions/workflows/maintain-questions.yml/dispatches",
        json={"ref": "dev", "inputs": {"games": ""}},
        headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"},
        timeout=15,
    )
    if res.status_code != 204:
        return Response({"error": f"GitHub returned {res.status_code}"}, status=503)
    return Response({"dispatched": True}, status=202)
```

`admin_urls.py`:

```python
    path("questions/", admin_api.admin_questions, name="admin-questions"),
    path("questions/<int:pk>/retire/", admin_api.admin_question_retire, name="admin-question-retire"),
    path("questions/publish/", admin_api.admin_questions_publish, name="admin-questions-publish"),
```

Also update `GAME_REGISTRY`: for the six games replace `"pool:players-index"` (and `pool:tictactoe`, `pool:imposter`) in `sources` with `f"questions:{slug}"`, and extend `_source(ref)` to return `{"key": ref, "kind": "questions", "label": slug, "count": Question.objects.filter(game=slug, status="active").count(), "fields": ["qid","status","created_by","dataset_version"], "last_updated": _iso(latest updated_at), "sync": None}` for `kind == "questions"`. Add `"questions:players-names"` handling as a kind that reports the playable count from `live_pool.load_players()`.

- [ ] **Step 3: Run tests** → PASS; full suite green.

- [ ] **Step 4: Commit**

```bash
git add backend/trivia/admin_api.py backend/trivia/admin_urls.py backend/trivia/tests/test_admin_questions.py
git commit -m "feat(admin): questions list, retire and publish endpoints"
```

### Task 20: Admin Questions tab

**Files:**
- Create: `src/components/admin/QuestionsTab.tsx`
- Modify: `src/views/Admin.tsx` (tab state union, tab button, render)

- [ ] **Step 1: Component** (reuse `apiFetch`, `BACKEND_URL`, `Field`, `fmtCell`, `fmtCount` — import them the way `FeedbackTab.tsx` does)

```tsx
// src/components/admin/QuestionsTab.tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, BACKEND_URL, Field, fmtCell, fmtCount } from "./shared"; // match FeedbackTab's imports

const GAMES = ["career-path", "who-are-ya", "tictactoe", "superdraft", "contexto", "imposter"];
const PAGE = 25;

type Row = Record<string, unknown> & { id: number; qid: string; status: string };

export default function QuestionsTab() {
  const [game, setGame] = useState(GAMES[0]);
  const [status, setStatus] = useState("active");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (offset: number, append: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ game, status, q: query, limit: String(PAGE), offset: String(offset) });
      const res = await apiFetch(`${BACKEND_URL}/admin/questions/?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load questions");
      setTotal(data.total);
      setRows((prev) => (append ? [...prev, ...data.rows] : data.rows));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load questions");
    } finally {
      setLoading(false);
    }
  }, [game, status, query]);

  useEffect(() => {
    const t = window.setTimeout(() => load(0, false), query ? 350 : 0);
    return () => window.clearTimeout(t);
  }, [load, query]);

  const retire = async (row: Row) => {
    const reason = window.prompt(`Retire ${row.qid}? Reason:`);
    if (reason === null) return;
    const res = await apiFetch(`${BACKEND_URL}/admin/questions/${row.id}/retire/`, { method: "POST", body: JSON.stringify({ reason }) });
    if (res.ok) {
      setNotice(`${row.qid} retired — takes effect at the next publish.`);
      load(0, false);
    } else setError("Could not retire");
  };

  const publish = async () => {
    const res = await apiFetch(`${BACKEND_URL}/admin/questions/publish/`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setNotice(res.ok ? "Publish queued — check GitHub Actions." : data.error || "Publish failed");
  };

  const columns = useMemo(() => ["qid", "status", "created_by", "dataset_version", "players_referenced_count", "retired_reason", "updated_at"], []);

  return (
    <div className="admin-rows">
      <div className="admin-rows-bar">
        <select value={game} onChange={(e) => setGame(e.target.value)} aria-label="Game">{GAMES.map((g) => <option key={g}>{g}</option>)}</select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="active">active</option><option value="retired">retired</option><option value="">all</option></select>
        <Field search value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search qid / reason…" aria-label="Search questions" />
        <span className="admin-rows-total tnum">{total == null ? "" : `${fmtCount(total)} question${total === 1 ? "" : "s"}`}</span>
        <button className="btn btn-primary btn-sm" onClick={publish}>Publish now</button>
      </div>
      {notice && <div className="admin-muted">{notice}</div>}
      {error ? <div className="admin-error">{error}</div> : rows.length === 0 && !loading ? <div className="admin-empty">No questions match.</div> : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr>{columns.map((c) => <th key={c}>{c}</th>)}<th /></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  {columns.map((c) => <td key={c}>{fmtCell(row[c])}</td>)}
                  <td>{row.status === "active" && <button className="btn btn-secondary btn-sm" onClick={() => retire(row)}>Retire</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="admin-rows-foot">
        {loading && <span className="admin-muted">Loading…</span>}
        {!loading && total != null && rows.length < total && (
          <button className="btn btn-secondary btn-sm" onClick={() => load(rows.length, true)}>Load more ({fmtCount(total - rows.length)} left)</button>
        )}
      </div>
    </div>
  );
}
```

If `fmtCell`/`fmtCount`/`Field` are module-private in `Admin.tsx`, move them (unchanged) into `src/components/admin/shared.tsx` and import from there in both files.

- [ ] **Step 2: Wire the tab** in `Admin.tsx`: `useState<"games" | "feedback" | "users" | "questions">`, a fourth `<button role="tab">Questions</button>`, and `{tab === "questions" && <QuestionsTab />}`.

- [ ] **Step 3: Verify** — browser as a staff user: list per game, filter retired, search, Retire flow, Publish now (with the token set on the backend, an Actions run appears). Lint + build clean.

- [ ] **Step 4: Commit + PR (Phase F)**

```bash
git add src/components/admin/QuestionsTab.tsx src/components/admin/shared.tsx src/views/Admin.tsx
git commit -m "feat(admin): Questions tab with retire and publish-now"
```

---

# Phase G — Cleanup + docs (branch `chore/questions-g-cleanup`)

### Task 21: Remove the superseded paths and document the system

**Files:**
- Modify: `backend/trivia/games/{career_path,who_are_ya,contexto,superdraft,imposter,tictactoe}.py` — delete `get_round` and the now-unused imports; delete `imposter.build_pool/validate_rows` and `tictactoe.build_pool/validate_rows` (their pools are no longer published), keep `tictactoe.player_matches` (used by the question module) and `superdraft._candidate_queues/draw_slots`.
- Delete: `backend/trivia/data/imposter.json`, `backend/trivia/data/tictactoe.json`, `src/hooks/useRoundPool.ts`, `scripts/contexto-golden.mjs` (its output is committed).
- Modify tests that asserted the old `get_round`/pools: `test_career_path.py`, `test_who_are_ya.py`, `test_contexto.py`, `test_superdraft.py`, `test_imposter.py`, `test_tictactoe.py`, `test_pool_endpoints.py`, `test_admin_api.py` — remove the cases for deleted behaviour, keep the rule tests (point them at `trivia.questions.games.*`).
- Modify: `backend/trivia/tests/published_pool.py` if it lists `imposter`/`tictactoe` as expected pools.
- Docs: `docs/DATA_PIPELINE.md` (new "Questions" section: two tiers, Storage layout, the daily job, `upload_dataset`, retention, versioning rules), `docs/ARCHITECTURE.md` (Storage box in the diagram), `docs/games/{career-path,who-are-ya,tictactoe,superdraft,contexto,imposter}.md` (data source = questions), `CLAUDE.md` (one paragraph: where questions come from, the additive-only rule, the six env names), `docs/DEPLOYMENT.md` (Railway `QUESTIONS_PUBLIC_BASE`, Vercel `VITE_QUESTIONS_BASE`, backend `GITHUB_DISPATCH_TOKEN`, Actions secrets).

- [ ] **Step 1:** Make the deletions; run `grep -rn "get_round\|useRoundPool\|fetchWholePool(\"players-index\")" backend/trivia/games src multiplayer_server/src` and confirm the only remaining `fetchWholePool("players-index")` calls are in Bingo, Heatmap, NBA Grid, Pack Five.

- [ ] **Step 2:** `cd backend && python manage.py test && python manage.py makemigrations --check --dry-run`; `npm run lint && npm run build`; `node multiplayer_server/scripts/sim_turngames.js`. All green.

- [ ] **Step 3:** Write the docs sections (plain prose; copy the layout table and env table from the spec §5).

- [ ] **Step 4: Commit + PR (Phase G)**

```bash
git add -A backend/trivia/games backend/trivia/tests backend/trivia/data src/hooks docs CLAUDE.md scripts
git commit -m "chore(questions): remove superseded round endpoints and pools; document the questions store"
```

After the merge and promotion, verify production per spec §14: manifest URL, one index, one question, each of the six games on `nba-minigames.vercel.app` with no `players-index.json` in the Network tab, one multiplayer round on the Railway server, and the admin Questions tab.

---

## Self-review notes

- **Spec coverage:** §5 layout/env → Tasks 3, 10, 12; §6 model → Task 1; §7 payloads → Tasks 5–9 (+ names in 10); §8 interface → Tasks 5–9; §9 job/workflow/upload → Tasks 11–12; §10 client/registry/renderers/multiplayer/Django → Tasks 13–18, 21; §11 versioning → `SUPPORTED_SCHEMA` checks in 13 and 18, docs in 21; §12 admin → 19–20; §13 degradation → 3 (sha/abort), 10–11 (manifest last, minimum gate, rollback), 13 (stale manifest, retention retry), 18 (`roundDataError`); §14 tests → every task; §15 rollout → phase branches; §16 secrets → Task 12 handoff.
- **Signatures used consistently:** `players_referenced(definition, materialized, dataset=None)` (set in Task 9, used by runner in 11); `write_snapshot(out_dir, version, dataset_version, per_game, names)` with `per_game[slug] = [(qid, index_item, materialized)]` (10, 11); `build_questions_publish_plan(out_dir, version, dataset_version, public_base, counts)` (10, 11); TS `buildNameLookup` ↔ Node `nameLookup` (13, 18); index item shapes `[qid]`, `[qid, weight]`, `[qid, day]`, `[qid, namesCount]` (5–9, 13, 18).
- **Known judgment calls:** `MIN_TEAM_PLAYERS` scaling for the small fixture (Task 6); Contexto `TARGET` counts days ahead, so the runner's `len(kept) < target` loop tops up by days (Task 8/11); the Phase B–D renderers carry a one-line compatibility guard until Phase E lands.
