import json
import os
import tempfile
from django.core.management import call_command
from django.test import TestCase, override_settings


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
