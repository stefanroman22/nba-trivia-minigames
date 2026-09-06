"""The live pool is parsed once, re-read on regeneration, and stint-filtered."""
import json
import os
import tempfile
from unittest import mock

from django.test import TestCase

from trivia.data_pipeline import live_pool


def _row(person_id):
    """A pool-eligible row: the filter only looks at `teams`."""
    return {"person_id": person_id, "teams": [{"abbr": "LAL", "start_year": 2000}]}


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
        self._write([_row(1)])
        first = live_pool.load_players()
        with mock.patch("builtins.open", side_effect=AssertionError("re-read the file")):
            second = live_pool.load_players()
        self.assertEqual(second, [_row(1)])
        self.assertIs(second, first)  # same object: no copy, no re-parse

    def test_a_regenerated_file_invalidates_the_cache(self):
        self._write([_row(1)])
        self.assertEqual(live_pool.load_players(), [_row(1)])
        self._write([_row(1), _row(2)])
        self.assertEqual(live_pool.load_players(), [_row(1), _row(2)])

    def test_missing_file_returns_empty_without_caching_it(self):
        self.assertEqual(live_pool.load_players(), [])
        self._write([_row(7)])
        self.assertEqual(live_pool.load_players(), [_row(7)])

    def test_players_who_never_took_the_floor_are_not_in_the_pool(self):
        """The dataset is 1:1 with the league index; the pool is not.

        307 rows carry `teams: []` (2026 draftees, two-way signings, the one
        player with no identity at all). They belong to the dataset for parity,
        but a game cannot ask a question about them and the client's copy of the
        published pool does not contain them.
        """
        self._write([_row(1), {"person_id": 2, "teams": []}, _row(3)])
        self.assertEqual([r["person_id"] for r in live_pool.load_players()], [1, 3])

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
