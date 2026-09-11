"""Pack 5 — the multiplayer pack is dealt from the live pool at request time."""
from unittest import mock

from django.test import TestCase
from django.urls import reverse

from trivia.games import pack_five, players_index


class PackFiveDealTests(TestCase):
    def test_packable_rule_matches_the_renderer(self):
        """isDealable in src/Game Renderers/PackFive.tsx: tier 1-3 + 5 trump stats."""
        base = {
            "fame_tier": 2,
            "career": {"ppg": 20.0, "rpg": 5.0, "apg": 4.0},
            "awards": {"allstar_count": 3, "rings": [2010]},
        }
        self.assertTrue(pack_five._is_packable(base))
        self.assertFalse(pack_five._is_packable(dict(base, fame_tier=4)))
        self.assertFalse(pack_five._is_packable(dict(base, career={"ppg": 20.0})))
        self.assertFalse(pack_five._is_packable(dict(base, awards={"allstar_count": 3})))

    def test_round_deals_a_full_pack_of_distinct_live_pool_rows(self):
        pool_ids = {p["person_id"] for p in players_index.build_pool()}
        res = self.client.get(reverse("pack-five"))
        self.assertEqual(res.status_code, 200)
        pack = res.json()["series"]
        self.assertEqual(len(pack), pack_five.PACK_SIZE)
        self.assertEqual(len({c["person_id"] for c in pack}), pack_five.PACK_SIZE)
        for card in pack:
            self.assertIn(card["person_id"], pool_ids)
            self.assertTrue(pack_five._is_packable(card))

    def test_pool_too_small_to_deal_returns_503(self):
        with mock.patch.object(pack_five, "load_players", return_value=[]):
            res = self.client.get(reverse("pack-five"))
        self.assertEqual(res.status_code, 503)

    def test_no_longer_publishes_a_static_pool(self):
        self.assertFalse(hasattr(pack_five, "build_pool"))
        self.assertFalse(hasattr(pack_five, "SEED_PATH"))
