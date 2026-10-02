import json
import os
import tempfile

from django.test import TestCase

from trivia.data_pipeline.publish import MANIFEST_CACHE, POOL_CACHE, upload_plan


class FakeS3Client:
    def __init__(self):
        self.puts = []

    def put_object(self, **kwargs):
        self.puts.append(kwargs)


class UploadPlanTests(TestCase):
    def test_uploads_all_objects_and_manifest_last(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "wordle.json")
            with open(path, "w", encoding="utf-8") as f:
                json.dump(["jones"], f)
            plan = {
                "objects": [{"local_path": path, "key": "v/v1/wordle.json",
                             "content_type": "application/json", "cache_control": POOL_CACHE}],
                "manifest": {"version": "v1"},
                "manifest_key": "manifest.json",
                "manifest_cache": MANIFEST_CACHE,
            }
            client = FakeS3Client()
            written = upload_plan(plan, client, "mybucket")
            self.assertEqual(written, ["v/v1/wordle.json", "manifest.json"])
            manifest_put = client.puts[-1]
            self.assertEqual(manifest_put["Key"], "manifest.json")
            self.assertEqual(manifest_put["CacheControl"], MANIFEST_CACHE)
            self.assertEqual(client.puts[0]["CacheControl"], POOL_CACHE)
            self.assertTrue(all(p["Bucket"] == "mybucket" for p in client.puts))
