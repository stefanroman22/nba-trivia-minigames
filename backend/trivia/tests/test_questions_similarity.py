# backend/trivia/tests/test_questions_similarity.py
import datetime
import hashlib
import json
import os
import random
import unittest

from django.test import SimpleTestCase

from trivia.data_pipeline.curated_players import playable_rows
from trivia.questions import fame
from trivia.questions.base import load_dataset_from_rows
from trivia.questions.games import contexto as ctx
from trivia.questions.similarity import (
    ANCHORS_PATH, load_v2_spec, rank_pool, similarity, similarity_v2,
)
from trivia.tests.questions_fixture import fixture_dataset, fixture_rows

GOLDEN = os.path.join(os.path.dirname(__file__), "fixtures", "contexto_golden.json")
SHIPPED = os.path.join(os.path.dirname(__file__), "..", "data_static", "players_curated.json")
NEAR_TOP, FAR_BEYOND = 21, 500  # near: inside the top 20 after the secret (ranks 2-21); far: rank > 500


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

    def test_version_1_is_the_default(self):
        ds = fixture_dataset()
        secret = ds.playable[3]
        self.assertEqual(rank_pool(secret, ds.playable, 2026, version=1), rank_pool(secret, ds.playable, 2026))

    def test_unknown_version_is_refused(self):
        ds = fixture_dataset()
        with self.assertRaises(ValueError):
            rank_pool(ds.playable[0], ds.playable, 2026, version=3)


class SimilarityV2Tests(SimpleTestCase):
    def setUp(self):
        self.spec = load_v2_spec()

    def test_spec_weights_sum_to_100(self):
        self.assertAlmostEqual(sum(self.spec["weights"].values()), 100.0, places=6)
        self.assertEqual(set(self.spec["weights"]),
                         {"franchise_seasons", "era", "position", "draft_class", "style", "fame", "country"})

    def test_self_similarity_is_100(self):
        for p in fixture_dataset().playable[:25]:
            self.assertAlmostEqual(similarity_v2(p, p, 2026, self.spec), 100.0, places=6, msg=p["full_name"])

    def test_ranking_is_complete_and_starts_with_the_secret(self):
        ds = fixture_dataset()
        secret = ds.playable[7]
        ranking = rank_pool(secret, ds.playable, 2026, version=2)
        self.assertEqual(ranking[0], (secret["person_id"], 1))
        self.assertEqual(len(ranking), len(ds.playable))
        self.assertEqual(len({pid for pid, _ in ranking}), len(ds.playable))

    def _row(self, **kw):
        base = {"person_id": 1, "full_name": "A", "position": "G", "country": "USA", "height_in": 75,
                "draft": {"year": 2000, "round": 1, "pick": 5}, "awards": {},
                "teams": [{"abbr": "AAA", "start_year": 2000, "end_year": 2009}],
                "career": {"ppg": 10.0, "rpg": 3.0, "apg": 4.0, "pts": 0, "seasons": 10}}
        base.update(kw)
        return base

    def _only(self, feature, a, b):
        """The one feature's share of similarity_v2, every other weight zeroed."""
        spec = {**self.spec, "weights": {k: (1 if k == feature else 0) for k in self.spec["weights"]}}
        return similarity_v2(a, b, 2026, spec)

    def test_country_region_map(self):
        usa, canada = self._row(country="USA"), self._row(country="Canada")
        serbia, croatia, nowhere = self._row(country="Serbia"), self._row(country="Croatia"), self._row(country=None)
        self.assertEqual(self._only("country", usa, usa), 1.0)
        self.assertEqual(self._only("country", usa, canada), 0.5)
        self.assertEqual(self._only("country", serbia, croatia), 0.5)
        self.assertEqual(self._only("country", serbia, usa), 0.0)
        self.assertEqual(self._only("country", nowhere, nowhere), 0.0)
        self.assertEqual(self._only("country", self._row(country="DRC"),
                                    self._row(country="Democratic Republic of the Congo")), 1.0)

    def test_fame_closeness_is_clamped(self):
        legend = self._row(awards={"allstar_count": 15, "allnba_count": 15, "mvp": [1, 2, 3, 4]},
                           career={"pts": 40000, "seasons": 20})
        nobody = self._row(awards={}, career={})
        self.assertGreater(fame.fame_score(legend) - fame.fame_score(nobody), 100)
        self.assertEqual(self._only("fame", legend, nobody), 0.0)
        self.assertEqual(self._only("fame", nobody, nobody), 1.0)

    def test_draft_class_uses_the_first_season_when_undrafted(self):
        drafted = self._row(draft={"year": 2000, "round": 1, "pick": 5})
        undrafted = self._row(draft=None, teams=[{"abbr": "BBB", "start_year": 2005, "end_year": 2008}])
        self.assertAlmostEqual(self._only("draft_class", drafted, undrafted), 0.5)

    def test_style_missing_values_count_zero(self):
        a = self._row(height_in=None, career={"ppg": 10.0})
        b = self._row(height_in=None, career={"ppg": 20.0})
        self.assertAlmostEqual(self._only("style", a, b), 1.0)  # same direction: ppg only
        c = self._row(height_in=None, career={"rpg": 5.0})
        self.assertEqual(self._only("style", a, c), 0.0)


@unittest.skipUnless(os.path.exists(SHIPPED), "the shipped players_curated.json is not in this checkout")
class AnchorTests(SimpleTestCase):
    """Every anchor pair in specs/contexto-anchors.json holds for v2 on the shipped dataset:
    a near pair sits in each other's top 20, a far pair beyond rank 500 both ways."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        with open(SHIPPED, encoding="utf-8") as f:
            cls.playable = playable_rows(json.load(f))
        cls.by_id = {r["person_id"]: r for r in cls.playable}
        with open(ANCHORS_PATH, encoding="utf-8") as f:
            cls.anchors = json.load(f)
        cls.ranks = {}

    def _rank(self, secret_id, other_id):
        if secret_id not in self.ranks:
            ranking = rank_pool(self.by_id[secret_id], self.playable, 2026, version=2)
            self.ranks[secret_id] = dict(ranking)
        return self.ranks[secret_id][other_id]

    def test_anchor_set_size(self):
        self.assertGreaterEqual(len(self.anchors["near"]), 40)
        self.assertGreaterEqual(len(self.anchors["far"]), 20)
        self.assertGreaterEqual(len(self.anchors["near"]) + len(self.anchors["far"]), 60)
        for a, b, label in self.anchors["near"] + self.anchors["far"]:
            self.assertIn(a, self.by_id, label)
            self.assertIn(b, self.by_id, label)

    def test_near_pairs_are_in_each_others_top_20(self):
        broken = [(label, self._rank(a, b), self._rank(b, a)) for a, b, label in self.anchors["near"]
                  if self._rank(a, b) > NEAR_TOP or self._rank(b, a) > NEAR_TOP]
        self.assertEqual(broken, [])

    def test_far_pairs_rank_beyond_500(self):
        broken = [(label, self._rank(a, b), self._rank(b, a)) for a, b, label in self.anchors["far"]
                  if self._rank(a, b) <= FAR_BEYOND or self._rank(b, a) <= FAR_BEYOND]
        self.assertEqual(broken, [])


V1_DAY = {"secret_person_id": 17, "day": "2026-09-12"}  # Clyde Drexler on the fixture
V1_SHA = "949f3b930473192bb30ecc46a0b5f88c6f6afd74050c489556137d440ef8fa8d"  # materialize() before v2 existed


class ContextoVersionTests(SimpleTestCase):
    def test_a_scheduled_v1_day_rematerializes_identically(self):
        m = ctx.materialize(dict(V1_DAY), fixture_dataset())
        self.assertNotIn("sim_version", m)
        sha = hashlib.sha256(json.dumps(m, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        self.assertEqual(sha, V1_SHA)
        self.assertEqual(ctx.validate(m), [])
        self.assertEqual(ctx.index_item(V1_DAY, m), [None, V1_DAY["day"]])

    def test_new_definitions_carry_sim_version_2(self):
        ds = fixture_dataset()
        defs = ctx.generate(ds, set(), random.Random(5), 5, today=datetime.date(2026, 9, 12))
        self.assertTrue(defs)
        self.assertTrue(all(d["sim_version"] == 2 for d in defs))
        m = ctx.materialize(defs[0], ds)
        self.assertEqual(m["sim_version"], 2)
        self.assertEqual(ctx.validate(m), [])
        expected = [[pid, rank] for pid, rank in rank_pool(ds.by_id[defs[0]["secret_person_id"]], ds.playable,
                                                           2026, version=2)]
        self.assertEqual(m["ranking"], expected)
        self.assertEqual(ctx.index_item(defs[0], m), [None, defs[0]["day"], 2])
        self.assertEqual(ctx.checker_view(m, ds)["sim_version"], 2)

    def _one_team_dataset(self):
        """A secret whose ten nearest players all played for one made-up franchise in 1990."""
        rows = fixture_rows()
        star = next(r for r in rows if r.get("teams") and fame.fame_band(r) == fame.STAR)
        secret = {**star, "person_id": 990000, "full_name": "Secret Star",
                  "teams": [{"abbr": "ZZZ", "name": "Zed", "start_year": 1990, "end_year": 1990, "gp": 82, "ppg": 20}]}
        clones = [{**secret, "person_id": 990001 + i, "full_name": f"Clone {i}"} for i in range(12)]
        return load_dataset_from_rows(rows + [secret] + clones, "one-team")

    def test_gate_rejects_a_one_team_season_top_10(self):
        ds = self._one_team_dataset()
        m = ctx.materialize({"secret_person_id": 990000, "day": "2026-09-12", "sim_version": 2}, ds)
        self.assertTrue(any("team-season" in p for p in ctx.validate(m)), ctx.validate(m))
        legacy = ctx.materialize({"secret_person_id": 990000, "day": "2026-09-12"}, ds)
        self.assertEqual(ctx.validate(legacy), [])  # v1 days never get the gate

    def test_gate_rejects_a_top_10_of_unknowns(self):
        rows = fixture_rows()
        star = next(r for r in rows if r.get("teams") and fame.fame_band(r) == fame.STAR)
        nobody = {"awards": {}, "career": {**star["career"], "pts": 0, "seasons": 1}, "fame_tier": None}
        secret = {**star, "person_id": 990000, "full_name": "Secret Star"}
        clones = [{**secret, **nobody, "person_id": 990001 + i, "full_name": f"Nobody {i}"} for i in range(12)]
        ds = load_dataset_from_rows(rows + [secret] + clones, "unknowns")
        m = ctx.materialize({"secret_person_id": 990000, "day": "2026-09-12", "sim_version": 2}, ds)
        self.assertTrue(any("KNOWN" in p for p in ctx.validate(m)), ctx.validate(m))

    def test_generate_skips_a_secret_that_fails_the_gate(self):
        ds = self._one_team_dataset()
        ds.extra = {"contexto_existing": [], "contexto_taken": []}
        defs = ctx.generate(ds, set(), random.Random(1), 400, today=datetime.date(2026, 9, 12))
        self.assertNotIn(990000, [d["secret_person_id"] for d in defs])
