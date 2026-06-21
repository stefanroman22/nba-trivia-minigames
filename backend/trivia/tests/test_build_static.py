import os
from django.conf import settings
from django.test import TestCase
from trivia.data_pipeline.build_static import (
    build_name_logo_pool,
    build_all_players_pool,
    build_wordle_pool,
    build_mvps_pool,
)


class BuildStaticTests(TestCase):
    def test_name_logo_pool_has_30_teams_with_logo(self):
        pool = build_name_logo_pool()
        self.assertEqual(len(pool), 30)
        self.assertIn("logo", pool[0])
        self.assertTrue(pool[0]["logo"].startswith("https://cdn.nba.com/logos/"))

    def test_all_players_pool_is_nonempty_strings(self):
        pool = build_all_players_pool()
        self.assertGreater(len(pool), 1000)
        self.assertIsInstance(pool[0], str)

    def test_wordle_pool_only_five_letter_surnames(self):
        pool = build_wordle_pool()
        self.assertTrue(pool)
        self.assertTrue(all(len(name) == 5 for name in pool))

    def test_mvps_pool_reads_existing_csv(self):
        csv_path = os.path.join(settings.BASE_DIR, "trivia", "utils", "nba_mvps.csv")
        pool = build_mvps_pool(csv_path)
        self.assertTrue(pool)
        self.assertIsInstance(pool[0], dict)
