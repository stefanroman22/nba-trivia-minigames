"""Career Path — seed validity + round endpoint (frozen contract #4)."""
import json
import os

from django.conf import settings
from django.test import TestCase

from trivia.games import career_path

SEED_PATH = os.path.join(settings.BASE_DIR, "trivia", "data_static", "career_path_seed.json")


class CareerPathSeedTests(TestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        with open(SEED_PATH, encoding="utf-8") as f:
            cls.rows = json.load(f)

    def test_seed_exists_and_validates_clean(self):
        self.assertGreaterEqual(len(self.rows), 20)
        self.assertEqual(career_path.validate_rows(self.rows), [])

    def test_validator_flags_bad_rows(self):
        self.assertTrue(career_path.validate_rows([{"person_id": "not-an-int"}]))
        two_stints = dict(self.rows[0], teams=self.rows[0]["teams"][:2])
        self.assertTrue(career_path.validate_rows([two_stints]))

    def test_build_pool_returns_only_eligible_rows(self):
        pool = career_path.build_pool()
        self.assertGreaterEqual(len(pool), 20)
        for row in pool:
            self.assertTrue(3 <= len(row["teams"]) <= 7)


class CareerPathRoundTests(TestCase):
    def test_get_round_envelope(self):
        res = self.client.get("/trivia/career-path/")
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertIn("series", body)
        self.assertEqual(len(body["series"]), 1)
        row = body["series"][0]
        self.assertIsInstance(row["person_id"], int)
        self.assertTrue(3 <= len(row["teams"]) <= 7)
