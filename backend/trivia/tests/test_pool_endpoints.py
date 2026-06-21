import tempfile
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.urls import reverse


class PoolEndpointTests(TestCase):
    def test_manifest_and_pool_endpoints(self):
        with tempfile.TemporaryDirectory() as d:
            with override_settings(GAME_DATA_DIR=d):
                call_command("refresh_game_data", "--skip-live", "--label", "test-2")
                manifest = self.client.get(reverse("manifest"))
                self.assertEqual(manifest.status_code, 200)
                self.assertEqual(manifest.json()["version"], "test-2")

                pool = self.client.get(reverse("pool", args=["wordle"]))
                self.assertEqual(pool.status_code, 200)
                body = pool.json()
                self.assertGreater(body["count"], 0)
                self.assertEqual(len(body["pool"]), body["count"])

                missing = self.client.get(reverse("pool", args=["nope"]))
                self.assertEqual(missing.status_code, 404)

                # 'manifest' is not a pool; it must 404 (use /trivia/manifest/).
                manifest_as_pool = self.client.get(reverse("pool", args=["manifest"]))
                self.assertEqual(manifest_as_pool.status_code, 404)
