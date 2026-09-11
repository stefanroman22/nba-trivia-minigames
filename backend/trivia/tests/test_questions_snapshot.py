import json
import os
import tempfile

from django.test import SimpleTestCase

from trivia.data_pipeline.publish import MANIFEST_CACHE, POOL_CACHE, upload_plan
from trivia.questions import snapshot
from trivia.tests.questions_fixture import fixture_dataset


class FakeS3:
    def __init__(self, existing_prefixes=()):
        self.objects = {}
        self.calls = []
        self._prefixes = list(existing_prefixes)

    def put_object(self, Bucket, Key, Body, ContentType, CacheControl):
        self.objects[Key] = (Body, ContentType, CacheControl)
        self.calls.append(("put", Key))

    def list_objects_v2(self, Bucket, Prefix, Delimiter=None, ContinuationToken=None):
        if Delimiter:
            return {"CommonPrefixes": [{"Prefix": p} for p in self._prefixes], "IsTruncated": False}
        keys = [k for k in list(self.objects) + [p + "index.json" for p in self._prefixes] if k.startswith(Prefix)]
        return {"Contents": [{"Key": k} for k in keys], "IsTruncated": False}

    def delete_objects(self, Bucket, Delete):
        for o in Delete["Objects"]:
            self.objects.pop(o["Key"], None)
            self.calls.append(("del", o["Key"]))
        return {}


class SnapshotTests(SimpleTestCase):
    def test_names_and_snapshot_files(self):
        ds = fixture_dataset()
        names = snapshot.build_names(ds.playable)
        self.assertEqual(names, sorted(names, key=lambda n: n[1]))
        self.assertEqual(len(names[0]), 3)
        with tempfile.TemporaryDirectory() as tmp:
            q = {"schema": 1, "game": "career-path", "qid": "cp-000001", "player": ds.playable[0]}
            counts = snapshot.write_snapshot(tmp, "2026-09-12.1", "ds-1", {"career-path": [("cp-000001", ["cp-000001", 3], q)]}, names)
            self.assertEqual(counts, {"career-path": 1})
            with open(os.path.join(tmp, "career-path", "index.json"), encoding="utf-8") as f:
                index = json.load(f)
            self.assertEqual(index["schema"], 1)
            self.assertEqual(index["items"], [["cp-000001", 3]])
            self.assertTrue(os.path.exists(os.path.join(tmp, "career-path", "cp-000001.json")))
            self.assertTrue(os.path.exists(os.path.join(tmp, "players-names.json")))

            plan = snapshot.build_questions_publish_plan(tmp, "2026-09-12.1", "ds-1", "https://cdn/base", counts)
            keys = [o["key"] for o in plan["objects"]]
            self.assertIn("questions/v/2026-09-12.1/career-path/index.json", keys)
            self.assertTrue(all(o["cache_control"] == POOL_CACHE for o in plan["objects"]))
            self.assertEqual(plan["manifest_key"], "questions/manifest.json")
            self.assertEqual(plan["manifest_cache"], MANIFEST_CACHE)
            self.assertEqual(plan["manifest"]["games"]["career-path"], {"index": "https://cdn/base/questions/v/2026-09-12.1/career-path/index.json", "count": 1})
            self.assertEqual(plan["manifest"]["names"], "https://cdn/base/questions/v/2026-09-12.1/players-names.json")

            s3 = FakeS3()
            upload_plan(plan, s3, "b")
            self.assertEqual(s3.calls[-1], ("put", "questions/manifest.json"))

    def test_retention_keeps_three_newest(self):
        s3 = FakeS3(existing_prefixes=[f"questions/v/{v}/" for v in ("2026-09-10.1", "2026-09-12.10", "2026-09-12.9", "2026-09-11.1", "2026-09-12.2")])
        deleted = snapshot.apply_retention(s3, "b", keep=3)
        self.assertEqual(deleted, ["questions/v/2026-09-10.1/", "questions/v/2026-09-11.1/"])
