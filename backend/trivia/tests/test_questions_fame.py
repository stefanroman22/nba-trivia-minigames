import json
import os

from django.test import SimpleTestCase

from trivia.data_pipeline.curated_players import playable_rows
from trivia.questions import fame

SHIPPED = os.path.join(os.path.dirname(__file__), "..", "data_static", "players_curated.json")


class FameScoreTests(SimpleTestCase):
    def test_empty_and_null_rows_score_zero(self):
        self.assertEqual(fame.fame_score({}), 0.0)
        self.assertEqual(fame.fame_score({"awards": None, "career": None}), 0.0)
        self.assertEqual(fame.fame_band({}), fame.OBSCURE)

    def test_weights(self):
        row = {"awards": {"allstar_count": 10, "mvp": [2000, 2001]}, "career": {}}
        self.assertEqual(fame.fame_score(row), 60.0)
        self.assertEqual(fame.fame_score({"awards": {"roty": 2004}}), 3.0)

    def test_caps(self):
        row = {"awards": {"allstar_count": 22, "allnba_count": 21, "rings": [1, 2, 3, 4, 5, 6, 7]},
               "career": {"pts": 43440, "seasons": 23}}
        self.assertEqual(fame.fame_score(row), 145.0)  # 60 + 45 + 5 + 25 + 10

    def test_band_edges(self):
        known = {"career": {"pts": 12000, "seasons": 12}}  # 12 + 6 = 18.0
        self.assertEqual(fame.fame_band(known), fame.KNOWN)
        deep = {"career": {"pts": 11900, "seasons": 12}}  # 17.9
        self.assertEqual(fame.fame_band(deep), fame.DEEP)
        self.assertEqual(fame.fame_band({"awards": {"allstar_count": 10}}), fame.STAR)  # 40.0

    def test_tier_is_a_floor_that_never_lowers(self):
        self.assertEqual(fame.fame_band({"fame_tier": 1}), fame.STAR)
        self.assertEqual(fame.fame_band({"fame_tier": 2}), fame.KNOWN)
        self.assertEqual(fame.fame_band({"fame_tier": 3}), fame.DEEP)
        star = {"fame_tier": 4, "awards": {"allstar_count": 10}}
        self.assertEqual(fame.fame_band(star), fame.STAR)

    def test_unexpected_tier_values_are_ignored(self):
        for tier in (None, 0, "2", 9):
            self.assertEqual(fame.fame_band({"fame_tier": tier}), fame.OBSCURE, tier)

    def test_at_least(self):
        row = {"fame_tier": 2}
        self.assertTrue(fame.at_least(row, fame.KNOWN))
        self.assertTrue(fame.at_least(row, fame.DEEP))
        self.assertFalse(fame.at_least(row, fame.STAR))


class ShippedCalibrationTests(SimpleTestCase):
    """Pins the bands against the real dataset (measured 2026-10-12: STAR 177,
    KNOWN+ 501, DEEP+ 1,038 of 4,900 playable). The ranges leave room for a data
    refresh; a failure here means the weights or the data moved a lot."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        with open(SHIPPED, encoding="utf-8") as f:
            cls.rows = playable_rows(json.load(f))
        cls.by_name = {r["full_name"]: r for r in cls.rows}

    def test_band_sizes(self):
        bands = [fame.fame_band(r) for r in self.rows]
        self.assertTrue(150 <= bands.count(fame.STAR) <= 230, bands.count(fame.STAR))
        known = sum(b <= fame.KNOWN for b in bands)
        self.assertTrue(450 <= known <= 600, known)
        deep = sum(b <= fame.DEEP for b in bands)
        self.assertTrue(900 <= deep <= 1200, deep)

    def test_named_anchors(self):
        self.assertEqual(fame.fame_band(self.by_name["LeBron James"]), fame.STAR)
        self.assertTrue(fame.at_least(self.by_name["John Wall"], fame.KNOWN))
        self.assertEqual(fame.fame_band(self.by_name["Kyle Korver"]), fame.KNOWN)
        self.assertEqual(fame.fame_band(self.by_name["Brian Scalabrine"]), fame.OBSCURE)

    def test_every_tier_1_2_player_is_known_or_better(self):
        missing = [r["full_name"] for r in self.rows
                   if r.get("fame_tier") in (1, 2) and not fame.at_least(r, fame.KNOWN)]
        self.assertEqual(missing, [])
