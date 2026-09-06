"""The live pool is parsed once and re-read when the file is regenerated."""
import json
import os
import tempfile
from unittest import mock

from django.test import TestCase

from trivia.data_pipeline import live_pool


class LoadPlayersCacheTests(TestCase):
    def setUp(self):
        self._dir = tempfile.TemporaryDirectory()
        self.addCleanup(self._dir.cleanup)
        self.path = os.path.join(self._dir.name, "players_curated.json")
        patcher = mock.patch.object(live_pool, "CURATED_PATH", self.path)
        patcher.start()
        self.addCleanup(patcher.stop)
        # Each test starts from a cold cache and leaves one behind for nobody.
        self._reset_cache()
        self.addCleanup(self._reset_cache)

    def _reset_cache(self):
        live_pool._cache_key = None
        live_pool._cache_rows = []

    def _write(self, rows):
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(rows, f)

    def test_file_is_parsed_once_across_calls(self):
        self._write([{"person_id": 1}])
        first = live_pool.load_players()
        with mock.patch("builtins.open", side_effect=AssertionError("re-read the file")):
            second = live_pool.load_players()
        self.assertEqual(second, [{"person_id": 1}])
        self.assertIs(second, first)  # same object: no copy, no re-parse

    def test_a_regenerated_file_invalidates_the_cache(self):
        self._write([{"person_id": 1}])
        self.assertEqual(live_pool.load_players(), [{"person_id": 1}])
        self._write([{"person_id": 1}, {"person_id": 2}])
        self.assertEqual(
            live_pool.load_players(), [{"person_id": 1}, {"person_id": 2}]
        )

    def test_missing_file_returns_empty_without_caching_it(self):
        self.assertEqual(live_pool.load_players(), [])
        self._write([{"person_id": 7}])
        self.assertEqual(live_pool.load_players(), [{"person_id": 7}])

    def test_unreadable_or_non_list_content_returns_empty(self):
        with open(self.path, "w", encoding="utf-8") as f:
            f.write("{ not json")
        self.assertEqual(live_pool.load_players(), [])
        self._write({"person_id": 1})
        self.assertEqual(live_pool.load_players(), [])


class LivePoolCallerTests(TestCase):
    def test_round_endpoints_do_not_mutate_the_shared_list(self):
        """The cached list is handed out by reference — nobody may reshape it."""
        before = [dict(r) for r in live_pool.load_players()]
        for url in ("/trivia/career-path/", "/trivia/who-are-ya/", "/trivia/contexto/",
                    "/trivia/pack-five/", "/trivia/superdraft/", "/trivia/imposter/"):
            self.assertEqual(self.client.get(url).status_code, 200)
        self.assertEqual(live_pool.load_players(), before)
