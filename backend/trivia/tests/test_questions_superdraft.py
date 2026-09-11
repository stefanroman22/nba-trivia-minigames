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
