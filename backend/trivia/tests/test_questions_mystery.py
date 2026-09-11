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
