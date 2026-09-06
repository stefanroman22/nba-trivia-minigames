"""NBA Imposter — the published pool matches what the live game actually draws.

The live mystery player comes from multiplayer_server/src/turnGames.js
``pickMystery``: ``pool.filter((p) => (p.fame_tier || 4) <= 2)`` over the
players-index pool. The static pool used to be a hand-authored fame-tier-1 list
that nothing read; these tests pin it to the live rule instead.
"""
from unittest import mock

from django.test import TestCase
from django.urls import reverse

from trivia.games import imposter, players_index


def _turn_server_rule(pool):
    """turnGames.js pickMystery eligibility, mirrored."""
    return [p["full_name"] for p in pool if (p.get("fame_tier") or 4) <= 2]


class ImposterPoolTests(TestCase):
    def test_pool_equals_the_live_tier_rule_over_the_live_pool(self):
        pool = players_index.build_pool()
        self.assertGreater(len(pool), 0)
        self.assertEqual(imposter.build_pool(), _turn_server_rule(pool))

    def test_pool_includes_tier_2_players_the_old_seed_left_out(self):
        pool = players_index.build_pool()
        names = set(imposter.build_pool())
        tier_2 = [p["full_name"] for p in pool if p.get("fame_tier") == 2]
        self.assertTrue(tier_2)
        self.assertTrue(set(tier_2).issubset(names))

    def test_rule_excludes_deep_cuts_and_unnamed_rows(self):
        rows = [
            {"full_name": "Tier One", "fame_tier": 1},
            {"full_name": "Tier Two", "fame_tier": 2},
            {"full_name": "Tier Three", "fame_tier": 3},
            {"full_name": "  ", "fame_tier": 1},
            {"fame_tier": 1},
            {"full_name": "No Tier"},  # (fame_tier || 4) -> 4, excluded
        ]
        self.assertEqual(imposter._mystery_pool(rows), ["Tier One", "Tier Two"])

    def test_published_pool_validates(self):
        self.assertEqual(imposter.validate_rows(imposter.build_pool()), [])

    def test_validate_rows_flags_a_too_small_pool(self):
        self.assertTrue(imposter.validate_rows(["Only One"]))


class ImposterRoundTests(TestCase):
    def test_get_round_returns_the_mystery_pool(self):
        res = self.client.get(reverse("imposter"))
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["mystery_pool"], imposter.build_pool())

    def test_empty_pool_returns_503(self):
        with mock.patch.object(imposter, "load_players", return_value=[]):
            res = self.client.get(reverse("imposter"))
        self.assertEqual(res.status_code, 503)
