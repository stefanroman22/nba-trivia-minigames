import json
import os
import tempfile
from django.test import TestCase
from trivia.data_pipeline.manifest import build_manifest, sha256_file
from trivia.data_pipeline.validate import validate_pool


class ManifestTests(TestCase):
    def test_build_manifest_lists_games_with_hash_and_count(self):
        with tempfile.TemporaryDirectory() as d:
            with open(os.path.join(d, "wordle.json"), "w", encoding="utf-8") as f:
                json.dump(["jones", "smith"], f)
            with open(os.path.join(d, "manifest.json"), "w", encoding="utf-8") as f:
                json.dump({"stale": True}, f)
            m = build_manifest(d, "2026-06-21")
            self.assertEqual(m["version"], "2026-06-21")
            self.assertIn("wordle", m["games"])
            self.assertEqual(m["games"]["wordle"]["count"], 2)
            self.assertEqual(m["games"]["wordle"]["file"], "wordle.json")
            self.assertEqual(len(m["games"]["wordle"]["sha256"]), 64)
            self.assertNotIn("manifest", m["games"])  # manifest.json excluded


class ValidateTests(TestCase):
    def test_empty_pool_is_a_problem(self):
        self.assertTrue(validate_pool("wordle", []))

    def test_non_list_is_a_problem(self):
        self.assertTrue(validate_pool("wordle", {"x": 1}))

    def test_starting_five_requires_keys(self):
        self.assertTrue(validate_pool("starting-five", [{"game_id": "1"}]))
        self.assertFalse(
            validate_pool("starting-five", [{"game_id": "1", "starting_5": []}])
        )

    def test_good_wordle_pool_has_no_problems(self):
        self.assertEqual(validate_pool("wordle", ["jones"]), [])
