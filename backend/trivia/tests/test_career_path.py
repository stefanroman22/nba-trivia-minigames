"""Career Path — the round endpoint filters the live pool (frozen contract #4)."""
from unittest import mock

from django.test import TestCase

from trivia.games import career_path


class CareerPathEligibilityTests(TestCase):
    def test_eligible_keeps_only_3_to_7_stint_rows(self):
        rows = [
            {"full_name": "two", "teams": [{}, {}]},
            {"full_name": "three", "teams": [{}, {}, {}]},
            {"full_name": "seven", "teams": [{}] * 7},
            {"full_name": "eight", "teams": [{}] * 8},
            {"full_name": "no teams key"},
        ]
        self.assertEqual(
            [r["full_name"] for r in career_path._eligible(rows)], ["three", "seven"]
        )

    def test_live_pool_yields_eligible_players(self):
        """The rule, not a hand-picked list, is what makes a round possible."""
        from trivia.data_pipeline.live_pool import load_players

        eligible = career_path._eligible(load_players())
        self.assertGreater(len(eligible), 0)
        for row in eligible:
            self.assertTrue(career_path.MIN_STINTS <= len(row["teams"]) <= career_path.MAX_STINTS)


class CareerPathRoundTests(TestCase):
    def test_get_round_serves_one_eligible_live_pool_row(self):
        res = self.client.get("/trivia/career-path/")
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(len(body["series"]), 1)
        row = body["series"][0]
        self.assertIsInstance(row["person_id"], int)
        self.assertTrue(career_path.MIN_STINTS <= len(row["teams"]) <= career_path.MAX_STINTS)

    def test_round_rows_all_come_from_the_live_pool(self):
        from trivia.games import players_index

        pool_ids = {r["person_id"] for r in players_index.build_pool()}
        for _ in range(15):
            row = self.client.get("/trivia/career-path/").json()["series"][0]
            self.assertIn(row["person_id"], pool_ids)

    def test_empty_pool_returns_503(self):
        with mock.patch.object(career_path, "load_players", return_value=[]):
            res = self.client.get("/trivia/career-path/")
        self.assertEqual(res.status_code, 503)

    def test_no_longer_publishes_a_static_pool(self):
        """The seed is gone: one path per game, filtered live."""
        self.assertFalse(hasattr(career_path, "build_pool"))
        self.assertFalse(hasattr(career_path, "SEED_PATH"))
