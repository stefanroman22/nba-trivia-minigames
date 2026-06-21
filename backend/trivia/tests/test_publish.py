import json
import os
import tempfile
from io import StringIO

from django.core.management import call_command
from django.test import TestCase, override_settings

from trivia.data_pipeline.publish import (
    MANIFEST_CACHE,
    POOL_CACHE,
    build_publish_plan,
    upload_plan,
)


class FakeS3Client:
    def __init__(self):
        self.puts = []

    def put_object(self, **kwargs):
        self.puts.append(kwargs)


class BuildPublishPlanTests(TestCase):
    def _seed(self, d):
        with open(os.path.join(d, "wordle.json"), "w", encoding="utf-8") as f:
            json.dump(["jones"], f)
        with open(os.path.join(d, "manifest.json"), "w", encoding="utf-8") as f:
            json.dump({"version": "v1", "games": {}}, f)

    def test_versioned_keys_immutable_cache_and_manifest_urls(self):
        with tempfile.TemporaryDirectory() as d:
            self._seed(d)
            plan = build_publish_plan(d, "v1", "https://cdn.example.com/")
            keys = [o["key"] for o in plan["objects"]]
            self.assertIn("v/v1/wordle.json", keys)
            self.assertNotIn("manifest.json", keys)  # manifest handled separately
            self.assertTrue(all(o["cache_control"] == POOL_CACHE for o in plan["objects"]))
            self.assertEqual(
                plan["manifest"]["games"]["wordle"],
                "https://cdn.example.com/v/v1/wordle.json",
            )
            self.assertEqual(plan["manifest_cache"], MANIFEST_CACHE)


class UploadPlanTests(TestCase):
    def test_uploads_all_objects_and_manifest(self):
        with tempfile.TemporaryDirectory() as d:
            with open(os.path.join(d, "wordle.json"), "w", encoding="utf-8") as f:
                json.dump(["jones"], f)
            plan = build_publish_plan(d, "v1", "https://cdn.example.com")
            client = FakeS3Client()
            written = upload_plan(plan, client, "mybucket")
            self.assertIn("v/v1/wordle.json", written)
            self.assertIn("manifest.json", written)
            manifest_put = next(p for p in client.puts if p["Key"] == "manifest.json")
            self.assertEqual(manifest_put["CacheControl"], MANIFEST_CACHE)
            self.assertTrue(all(p["Bucket"] == "mybucket" for p in client.puts))


class PublishCommandDryRunTests(TestCase):
    def test_dry_run_lists_versioned_objects(self):
        with tempfile.TemporaryDirectory() as d:
            with override_settings(GAME_DATA_DIR=d):
                call_command("refresh_game_data", "--skip-live", "--label", "v9")
                os.environ["R2_PUBLIC_BASE_URL"] = "https://cdn.example.com"
                try:
                    out = StringIO()
                    call_command("publish_game_data", "--dry-run", stdout=out)
                finally:
                    del os.environ["R2_PUBLIC_BASE_URL"]
            output = out.getvalue()
            self.assertIn("v/v9/wordle.json", output)
            self.assertIn("Dry run: 7 objects for version v9", output)
