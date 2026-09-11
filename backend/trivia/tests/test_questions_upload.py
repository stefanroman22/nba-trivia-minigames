import hashlib
import json
import os
import tempfile

from django.test import SimpleTestCase

from trivia.questions.upload import build_dataset_plan
from trivia.tests.test_questions_snapshot import FakeS3
from trivia.data_pipeline.publish import upload_plan


class UploadDatasetTests(SimpleTestCase):
    def test_plan_and_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "players_curated.json")
            rows = [{"person_id": 1, "full_name": "A", "teams": [{"abbr": "LAL"}]}]
            with open(path, "w", encoding="utf-8") as f:
                json.dump(rows, f)
            plan = build_dataset_plan(path, "2026-09-06.3", "https://cdn/base")
            self.assertEqual(plan["objects"][0]["key"], "datasets/players/v/2026-09-06.3/players_curated.json")
            self.assertEqual(plan["manifest_key"], "datasets/manifest.json")
            entry = plan["manifest"]["players"]
            self.assertEqual(entry["version"], "2026-09-06.3")
            self.assertEqual(entry["count"], 1)
            with open(path, "rb") as f:
                self.assertEqual(entry["sha256"], hashlib.sha256(f.read()).hexdigest())
            s3 = FakeS3()
            upload_plan(plan, s3, "b")
            self.assertEqual(s3.calls[-1], ("put", "datasets/manifest.json"))
