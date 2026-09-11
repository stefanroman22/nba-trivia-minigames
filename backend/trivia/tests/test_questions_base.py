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
