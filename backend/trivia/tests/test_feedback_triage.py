"""The feedback-triage hand-off: what is exported to the agent and how its verdicts land."""
import json
import os
import tempfile
from io import StringIO

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase

from trivia import feedback_triage
from trivia.models import Feedback

User = get_user_model()


class FeedbackTriageTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        user = User.objects.create_user(username="fan", email="fan@test.dev", password="x")
        cls.bug = Feedback.objects.create(user=user, email="fan@test.dev", display_name="Fan", public_id="abc123",
                                          rating=2, message="Wordle froze on my phone", page="/wordle", game="wordle")
        cls.idea = Feedback.objects.create(email="guest@test.dev", rating=5, message="Add a WNBA mode")
        Feedback.objects.create(rating=4)  # a rating with no message
        Feedback.objects.create(rating=3, message="[Appeal #9] unban me", game="appeal", page="/banned")
        Feedback.objects.create(rating=1, message="handled by the owner", status=Feedback.READ)

    def test_export_carries_no_identity_and_only_what_needs_triage(self):
        batch = feedback_triage.export_batch(run="r1")
        self.assertEqual([i["id"] for i in batch["items"]], [self.bug.pk, self.idea.pk])
        self.assertEqual(set(batch["items"][0]), {"id", "rating", "message", "page", "game", "day", "signed_in"})
        self.assertEqual([i["signed_in"] for i in batch["items"]], [True, False])
        blob = json.dumps(batch)
        for secret in ("fan@test.dev", "guest@test.dev", "abc123", "Fan\""):
            self.assertNotIn(secret, blob)
        self.assertEqual(len(feedback_triage.export_batch(limit=1)["items"]), 1)

    def test_apply_marks_rows_read_and_is_idempotent(self):
        doc = {"run": "r1", "items": [
            {"id": self.bug.pk, "kind": "bug", "summary": "Wordle freezes on mobile", "cluster": "wordle-freeze", "ticket": "page-1"},
            {"id": self.idea.pk, "kind": "idea", "summary": "WNBA mode", "cluster": "wnba", "ticket": ""},
        ]}
        self.assertEqual(feedback_triage.apply_verdicts(doc), {"applied": 2, "skipped": 0, "problems": []})
        self.bug.refresh_from_db()
        self.assertEqual(self.bug.status, Feedback.READ)
        self.assertEqual((self.bug.triage["kind"], self.bug.triage["ticket"], self.bug.triage["run"]), ("bug", "page-1", "r1"))
        self.assertEqual(self.bug.admin_note, "")
        self.assertEqual(feedback_triage.apply_verdicts(doc)["skipped"], 2)
        self.assertEqual(feedback_triage.export_batch()["items"], [])

    def test_the_admin_list_shows_the_verdict(self):
        from rest_framework.test import APIClient

        feedback_triage.apply_verdicts({"run": "r1", "items": [
            {"id": self.bug.pk, "kind": "bug", "summary": "Wordle freezes on mobile", "cluster": "wordle-freeze", "ticket": "page-1"}]})
        api = APIClient()
        api.force_authenticate(User.objects.create_user(username="admin", email="a@test.dev", password="x", is_staff=True))
        rows = {r["id"]: r for r in api.get("/api/admin/feedback/?period=all").json()["rows"]}
        self.assertEqual((rows[self.bug.pk]["triage"]["kind"], rows[self.bug.pk]["triage"]["summary"]), ("bug", "Wordle freezes on mobile"))
        self.assertIsNone(rows[self.idea.pk]["triage"])
        patched = api.patch(f"/api/admin/feedback/{self.bug.pk}/", {"status": "resolved"}, format="json").json()["row"]
        self.assertEqual(patched["triage"]["ticket"], "page-1")

    def test_apply_rejects_unknown_kinds_and_bad_files(self):
        result = feedback_triage.apply_verdicts({"run": "r1", "items": [{"id": self.bug.pk, "kind": "urgent"}]})
        self.assertEqual((result["applied"], len(result["problems"])), (0, 1))
        with self.assertRaises(ValueError):
            feedback_triage.apply_verdicts({"items": []})

    def test_command_round_trip(self):
        with tempfile.TemporaryDirectory() as tmp:
            batch_path, applied_path = os.path.join(tmp, "batch.json"), os.path.join(tmp, "applied.json")
            call_command("feedback_triage", "export", "--out", batch_path, stderr=StringIO())
            batch = json.load(open(batch_path, encoding="utf-8"))
            applied = {"run": batch["run"], "items": [{"id": i["id"], "kind": "other", "summary": "s"} for i in batch["items"]]}
            json.dump(applied, open(applied_path, "w", encoding="utf-8"))
            out = StringIO()
            call_command("feedback_triage", "apply", "--file", applied_path, "--dry-run", stdout=out)
            self.assertIn("2 applied", out.getvalue())
            self.assertEqual(Feedback.objects.filter(status=Feedback.NEW).exclude(triage={}).count(), 0)
            self.assertEqual(feedback_triage.pending().count(), 2)  # the dry run changed nothing
            call_command("feedback_triage", "apply", "--file", applied_path, stdout=StringIO())
            self.assertEqual(feedback_triage.pending().count(), 0)
            with self.assertRaises(CommandError):
                call_command("feedback_triage", "apply")
