import json
import os
import tempfile
from unittest.mock import patch

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase, override_settings


def _fake_playoff_builder(output_path, num_seasons=20):
    # Simulate a failed/empty live fetch (the real builder returns [] on error).
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump([], f)


def _fake_sf_builder(output_path, max_games_per_season=50):
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump([{"game_id": "1", "starting_5": []}], f)


class RefreshCommandTests(TestCase):
    def test_skip_live_writes_all_pools_and_manifest(self):
        with tempfile.TemporaryDirectory() as d:
            with override_settings(GAME_DATA_DIR=d):
                call_command("refresh_game_data", "--skip-live", "--label", "test-1")
            with open(os.path.join(d, "manifest.json"), encoding="utf-8") as f:
                manifest = json.load(f)
            self.assertEqual(manifest["version"], "test-1")
            for key in ["playoff", "starting-five", "name-logo", "all-players", "wordle", "mvps"]:
                self.assertIn(key, manifest["games"])
                self.assertTrue(os.path.exists(os.path.join(d, f"{key}.json")))
                self.assertGreater(manifest["games"][key]["count"], 0)


class RefreshLivePartialWriteTests(TestCase):
    @patch(
        "trivia.utils.starting_five_utils.build_starting_five_database",
        _fake_sf_builder,
    )
    @patch(
        "trivia.utils.playoff_games_utils.build_local_playoff_database",
        _fake_playoff_builder,
    )
    def test_live_validation_failure_leaves_data_dir_untouched(self):
        with tempfile.TemporaryDirectory() as d:
            good = [{"season": "2020-21", "winner": "Lakers"}]
            with open(os.path.join(d, "playoff.json"), "w", encoding="utf-8") as f:
                json.dump(good, f)
            with override_settings(GAME_DATA_DIR=d):
                with self.assertRaises(CommandError):
                    call_command("refresh_game_data", "--label", "bad")
            # The empty live playoff pool must fail validation BEFORE any write,
            # so the previously-good committed file is untouched.
            with open(os.path.join(d, "playoff.json"), encoding="utf-8") as f:
                self.assertEqual(json.load(f), good)
