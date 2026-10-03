"""Empty store tables: the classic trivia views answer from a bundled file or with a JSON
error, never by importing nba_api or pandas (which are not in the web requirements.txt)."""
from django.test import TestCase
from django.urls import reverse

from trivia.data_pipeline.live_pool import load_dataset as load_curated_dataset


class ClassicFallbackTests(TestCase):
    def test_mvps_come_from_bundled_csv(self):
        res = self.client.get(reverse("guess-mvp"))
        self.assertEqual(res.status_code, 200)
        rows = res.json()["series"]
        self.assertEqual(len(rows), 5)
        self.assertEqual(set(rows[0]), {"season", "mvp", "team", "team_logo_url"})
        self.assertTrue(all(isinstance(v, str) for v in rows[0].values()))

    def test_name_logo_empty_store_is_json_error(self):
        res = self.client.get(reverse("name-logo"))
        self.assertEqual(res.status_code, 500)
        self.assertEqual(res.json(), {"error": "No team data available."})

    def test_wordle_empty_store_is_json_error(self):
        res = self.client.get(reverse("wordle"))
        self.assertEqual(res.status_code, 500)
        self.assertEqual(res.json(), {"error": "no wordle words available"})

    def test_all_players_fall_back_to_curated_dataset(self):
        res = self.client.get(reverse("all-players"))
        self.assertEqual(res.status_code, 200)
        players = res.json()["players"]
        self.assertEqual(len(players), len(load_curated_dataset()))
        self.assertIn(load_curated_dataset()[0]["full_name"], players)
