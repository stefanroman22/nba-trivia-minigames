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
