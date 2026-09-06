"""Who Are Ya — the multiplayer round filters the live pool by the tier rule."""
from unittest import mock

from django.test import TestCase
from django.urls import reverse

from trivia.games import players_index, who_are_ya

# src/Game Renderers/WhoAreYa.tsx isEligible — the rule single-player applies
# client-side. The server round must not be able to disagree with it.
def _sp_eligible(p):
    return p.get("fame_tier") in (1, 2) and len(p.get("teams") or []) > 0


class WhoAreYaEligibilityTests(TestCase):
    def test_server_rule_matches_the_single_player_rule_over_the_live_pool(self):
        pool = players_index.build_pool()
        self.assertGreater(len(pool), 0)
        expected = [p["person_id"] for p in pool if _sp_eligible(p)]
        actual = [p["person_id"] for p in pool if who_are_ya._eligible(p)]
        self.assertEqual(actual, expected)
        self.assertGreater(len(actual), 0)

    def test_eligibility_is_a_rule_not_a_list(self):
        self.assertFalse(who_are_ya._eligible({"fame_tier": 3, "teams": [{"abbr": "LAL"}]}))
        self.assertFalse(who_are_ya._eligible({"fame_tier": 1, "teams": []}))
        self.assertTrue(who_are_ya._eligible({"fame_tier": 2, "teams": [{"abbr": "LAL"}]}))


class WhoAreYaRoundTests(TestCase):
    def test_round_serves_one_eligible_live_pool_row(self):
        pool_ids = {p["person_id"] for p in players_index.build_pool() if _sp_eligible(p)}
        for _ in range(15):
            res = self.client.get(reverse("who-are-ya"))
            self.assertEqual(res.status_code, 200)
            series = res.json()["series"]
            self.assertEqual(len(series), 1)
            row = series[0]
            self.assertIn(row["fame_tier"], (1, 2))
            self.assertGreater(len(row["teams"]), 0)
            # Every served row is a live-pool row, not a separately-authored copy.
            self.assertIn(row["person_id"], pool_ids)

    def test_round_row_carries_the_full_player_profile(self):
        row = self.client.get(reverse("who-are-ya")).json()["series"][0]
        for key in ("person_id", "full_name", "aliases", "position", "height_in",
                    "birth_year", "country", "college", "draft", "jersey",
                    "is_active", "teams", "awards", "career"):
            self.assertIn(key, row)

    def test_empty_pool_returns_503(self):
        with mock.patch.object(who_are_ya, "load_players", return_value=[]):
            res = self.client.get(reverse("who-are-ya"))
        self.assertEqual(res.status_code, 503)

    def test_no_longer_publishes_a_static_pool(self):
        self.assertFalse(hasattr(who_are_ya, "build_pool"))
        self.assertFalse(hasattr(who_are_ya, "SEED_PATH"))
