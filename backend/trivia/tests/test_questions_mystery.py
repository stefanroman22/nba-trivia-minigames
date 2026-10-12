import random

from django.test import SimpleTestCase

from trivia.questions import fame
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

    def test_generate_skips_obscure_journeymen(self):
        ds = fixture_dataset()
        defs = career_path.generate(ds, set(), random.Random(3), 10_000)
        self.assertTrue(defs)
        self.assertTrue(all(fame.at_least(ds.by_id[d["person_id"]], fame.DEEP) for d in defs))

    def test_materialize_rejects_an_obscure_journeyman(self):
        ds = fixture_dataset()
        obscure = next(r for r in ds.playable
                       if 3 <= len(r["teams"]) <= 7 and not fame.at_least(r, fame.DEEP))
        with self.assertRaises(Invalid) as raised:
            career_path.materialize({"person_id": obscure["person_id"]}, ds)
        self.assertIn("fame band", str(raised.exception))

    def test_weight_favours_known_and_deep_over_stars(self):
        ds = fixture_dataset()
        for d in career_path.generate(ds, set(), random.Random(4), 10_000):
            row = ds.by_id[d["person_id"]]
            m = career_path.materialize(d, ds)
            expected = 3 if fame.fame_band(row) in (fame.KNOWN, fame.DEEP) else 1
            self.assertEqual(career_path.index_item(d, m)[1], expected)


class WhoAreYaTests(SimpleTestCase):
    def _ids(self, ds):
        return {d["person_id"] for d in who_are_ya.generate(ds, set(), random.Random(1), 10_000)}

    def test_generate_is_known_band_or_better(self):
        ds = fixture_dataset()
        ids = self._ids(ds)
        self.assertTrue(ids)
        self.assertTrue(all(fame.at_least(ds.by_id[i], fame.KNOWN) for i in ids))
        self.assertIsNone(who_are_ya.TARGET)

    def test_every_tier_1_2_player_is_still_eligible(self):
        ds = fixture_dataset()
        tier12 = {r["person_id"] for r in ds.playable if r["fame_tier"] in (1, 2)}
        self.assertLessEqual(tier12, self._ids(ds))

    def test_widens_beyond_tier_1_2(self):
        ds = fixture_dataset()
        self.assertTrue(any(ds.by_id[i]["fame_tier"] in (3, 4) for i in self._ids(ds)))

    def test_materialize_rejects_band_drop(self):
        ds = fixture_dataset()
        deep = next(r for r in ds.playable if not fame.at_least(r, fame.KNOWN))
        with self.assertRaises(Invalid) as ctx:
            who_are_ya.materialize({"person_id": deep["person_id"]}, ds)
        self.assertIn("fame band", str(ctx.exception))
