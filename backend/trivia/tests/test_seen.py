"""Account-level seen questions: GET /trivia/seen/<game>/ and POST /trivia/seen/ (spec §4.4)."""
from django.apps import apps
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from django.urls import reverse

from users.tests import login, signup

User = get_user_model()


def seen_model():
    return apps.get_model("trivia", "SeenQuestion")


class SeenTests(TestCase):
    def setUp(self):
        cache.clear()
        signup(self.client, username="Ann", email="ann@example.com", password="Testpass123!")
        self.ann = User.objects.get(email="ann@example.com")
        self.token = login(self.client, "ann@example.com").json()["access"]

    def auth(self):
        return {"HTTP_AUTHORIZATION": f"Bearer {self.token}"}

    def add(self, game, qids, **headers):
        return self.client.post(reverse("seen-add"), data={"game": game, "qids": qids},
                                content_type="application/json", **(headers or self.auth()))

    def listed(self, game):
        resp = self.client.get(reverse("seen-list", args=[game]), **self.auth())
        self.assertEqual(resp.status_code, 200)
        return resp.json()["qids"]

    def test_anonymous_is_refused(self):
        self.assertEqual(self.client.get(reverse("seen-list", args=["career-path"])).status_code, 401)
        resp = self.client.post(reverse("seen-add"), data={"game": "career-path", "qids": ["cp-1"]},
                                content_type="application/json")
        self.assertEqual(resp.status_code, 401)

    def test_post_then_get_round_trips_newest_first(self):
        self.assertEqual(self.add("career-path", ["cp-1", "cp-2"]).json(), {"added": 2})
        self.assertEqual(self.add("career-path", ["cp-3"]).json(), {"added": 1})
        self.add("who-would-win", ["ww-1"])
        qids = self.listed("career-path")
        self.assertEqual(qids[0], "cp-3")
        self.assertEqual(set(qids), {"cp-1", "cp-2", "cp-3"})
        self.assertEqual(self.listed("who-would-win"), ["ww-1"])

    def test_duplicate_post_adds_nothing(self):
        self.add("career-path", ["cp-1"])
        self.assertEqual(self.add("career-path", ["cp-1", "cp-1"]).json(), {"added": 0})
        self.assertEqual(seen_model().objects.count(), 1)

    def test_the_201st_id_is_ignored(self):
        qids = [f"cp-{i}" for i in range(201)]
        self.assertEqual(self.add("career-path", qids).json(), {"added": 200})
        self.assertNotIn("cp-200", self.listed("career-path"))
        self.assertEqual(seen_model().objects.count(), 200)

    def test_bad_body_is_refused(self):
        self.assertEqual(self.add("", ["cp-1"]).status_code, 400)
        self.assertEqual(self.add("career-path", "cp-1").status_code, 400)

    def test_malformed_game_is_refused_and_nothing_is_written(self):
        for game in ("g" * 41, None, 123, ["career-path"], "career\x00path"):
            with self.subTest(game=game):
                self.assertEqual(self.add(game, ["cp-1"]).status_code, 400)
        self.assertFalse(seen_model().objects.exists())

    def test_malformed_qid_is_refused_and_nothing_is_written(self):
        for bad in (7, None, "", "q" * 61, "cp\x001"):
            with self.subTest(qid=bad):
                self.assertEqual(self.add("career-path", ["cp-1", bad]).status_code, 400)
        self.assertFalse(seen_model().objects.exists())

    def test_ids_past_the_first_200_are_not_validated(self):
        qids = [f"cp-{i}" for i in range(200)] + [7]
        self.assertEqual(self.add("career-path", qids).json(), {"added": 200})

    def test_another_players_rows_are_not_listed(self):
        signup(self.client, username="Bob", email="bob@example.com", password="Testpass123!")
        seen_model().objects.create(user=User.objects.get(email="bob@example.com"), game="career-path", qid="cp-9")
        self.assertEqual(self.listed("career-path"), [])

    def test_export_contains_the_rows(self):
        self.add("career-path", ["cp-1"])
        resp = self.client.get(reverse("account_export"), **self.auth())
        rows = resp.json()["seen_questions"]
        self.assertEqual([(r["game"], r["qid"]) for r in rows], [("career-path", "cp-1")])
        self.assertIn("at", rows[0])

    def test_delete_account_removes_them(self):
        self.add("career-path", ["cp-1", "cp-2"])
        resp = self.client.post(reverse("account_delete"), data={"confirm_username": "Ann", "confirm_text": "delete"},
                                content_type="application/json", **self.auth())
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(seen_model().objects.exists())
