"""Player problem reports about one question: POST /trivia/report-question/ (spec §4.9 "Report a problem")."""
from datetime import timedelta

from django.apps import apps
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from trivia import views
from users import retention
from users.tests import login, signup

User = get_user_model()


def report_model():
    return apps.get_model("trivia", "QuestionReport")


class ReportQuestionTests(TestCase):
    def setUp(self):
        cache.clear()

    def post(self, body, **headers):
        return self.client.post(reverse("report-question"), data=body, content_type="application/json", **headers)

    def sign_in(self):
        signup(self.client, username="Ann", email="ann@example.com", password="Testpass123!")
        token = login(self.client, "ann@example.com").json()["access"]
        return User.objects.get(email="ann@example.com"), {"HTTP_AUTHORIZATION": f"Bearer {token}"}

    def test_guest_report_is_stored_without_a_user(self):
        resp = self.post({"game": "career-path", "question_id": "2544"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), {"ok": True})
        row = report_model().objects.get()
        self.assertEqual((row.user, row.game, row.question_id, row.note, row.status), (None, "career-path", "2544", "", "new"))
        self.assertIsNotNone(row.created_at)

    def test_signed_in_report_keeps_the_account_and_note(self):
        ann, auth = self.sign_in()
        resp = self.post({"game": "wordle", "question_id": "LEBRON", "note": "  The word is not a player  "}, **auth)
        self.assertEqual(resp.json(), {"ok": True})
        row = report_model().objects.get()
        self.assertEqual((row.user, row.question_id, row.note), (ann, "LEBRON", "The word is not a player"))

    def test_a_500_character_note_is_accepted(self):
        self.assertEqual(self.post({"game": "wordle", "question_id": "CURRY", "note": "n" * 500}).status_code, 200)

    def test_malformed_bodies_are_refused_and_nothing_is_written(self):
        good = {"game": "career-path", "question_id": "2544", "note": "wrong team"}
        bad = [
            {**good, "game": ""}, {**good, "game": "g" * 41}, {**good, "game": 7}, {**good, "game": None},
            {**good, "game": "career\x00path"}, {k: v for k, v in good.items() if k != "game"},
            {**good, "question_id": ""}, {**good, "question_id": "q" * 61}, {**good, "question_id": 2544},
            {**good, "question_id": "25\x0044"}, {k: v for k, v in good.items() if k != "question_id"},
            {**good, "note": "n" * 501}, {**good, "note": 5}, {**good, "note": ["x"]},
        ]
        for body in bad:
            cache.clear()  # every request counts toward the 10/hour throttle
            with self.subTest(body={k: (v[:12] if isinstance(v, str) else v) for k, v in body.items()}):
                self.assertEqual(self.post(body).status_code, 400)
        cache.clear()
        self.assertEqual(self.client.post(reverse("report-question"), data="[1]", content_type="application/json").status_code, 400)
        self.assertFalse(report_model().objects.exists())

    def test_throttled_under_the_report_scope(self):
        scopes = [t.scope for t in views.report_question.cls.throttle_classes]
        self.assertEqual(scopes, ["report"])
        self.assertEqual(settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]["report"], "10/hour")

    def test_the_eleventh_report_in_an_hour_is_throttled(self):
        for i in range(10):
            self.assertEqual(self.post({"game": "wordle", "question_id": f"W{i}"}).status_code, 200)
        self.assertEqual(self.post({"game": "wordle", "question_id": "W10"}).status_code, 429)

    def test_export_contains_the_players_reports_only(self):
        ann, auth = self.sign_in()
        self.post({"game": "career-path", "question_id": "2544", "note": "wrong team"}, **auth)
        report_model().objects.create(game="wordle", question_id="CURRY")  # a guest's
        rows = self.client.get(reverse("account_export"), **auth).json()["question_reports"]
        self.assertEqual([(r["game"], r["question_id"], r["note"], r["status"]) for r in rows],
                         [("career-path", "2544", "wrong team", "new")])
        self.assertIn("at", rows[0])

    def test_delete_account_removes_them(self):
        ann, auth = self.sign_in()
        self.post({"game": "career-path", "question_id": "2544"}, **auth)
        guest = report_model().objects.create(game="wordle", question_id="CURRY")
        resp = self.client.post(reverse("account_delete"), data={"password": "Testpass123!", "confirm": "DELETE"},
                                content_type="application/json", **auth)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(list(report_model().objects.all()), [guest])


class ReportRetentionTests(TestCase):
    def test_handled_reports_and_reports_older_than_12_months_are_pruned(self):
        model = report_model()
        fresh = model.objects.create(game="wordle", question_id="A")
        handled = model.objects.create(game="wordle", question_id="B", status="handled")
        old = model.objects.create(game="wordle", question_id="C")
        model.objects.filter(pk=old.pk).update(created_at=timezone.now() - timedelta(days=retention.QUESTION_REPORT_DAYS + 1))

        deleted = retention.prune_personal_data()

        self.assertEqual(deleted["question_reports"], 2)
        self.assertEqual(list(model.objects.all()), [fresh])
        self.assertNotIn(handled.pk, model.objects.values_list("pk", flat=True))
