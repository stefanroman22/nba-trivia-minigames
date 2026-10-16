"""The progression fields the client reads, guest carry-over at signup, and the weekly board (spec §4-5)."""
import datetime
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import Client, TestCase
from django.utils import timezone

from trivia.models import GameSession
from users.tests import GOOGLE_ID

User = get_user_model()
SIGNUP = {"username": "Newbie", "email": "new@example.com", "password": "Str0ng!Passw0rd",
          "accepted_terms": True, "age_confirmed": True}


class PayloadTests(TestCase):
    def setUp(self):
        cache.clear()  # the auth throttles live in the cache

    def test_me_carries_progression(self):
        User.objects.create_user(username="Baller", email="b@example.com", password="Str0ng!Passw0rd", points=300, founding_member=True)
        c = Client()
        tokens = c.post("/api/login/", {"id": "b@example.com", "password": "Str0ng!Passw0rd"}, content_type="application/json").json()
        me = c.get("/api/me/", HTTP_AUTHORIZATION=f"Bearer {tokens['access']}").json()["user"]
        self.assertTrue(me["founding_member"])
        self.assertEqual(me["streak_days"], 0)
        self.assertEqual(me["streak_freezes"], 1)
        self.assertEqual(me["active_days"], 0)
        self.assertEqual(me["rank_progress"]["next_rank"], "Sixth Man")
        self.assertEqual(me["rank_progress"]["points_to_next"], 200)


class GuestCarryOverTests(TestCase):
    def setUp(self):
        cache.clear()  # the signup throttle lives in the cache

    def _signup(self, **extra):
        body = dict(SIGNUP, **extra)
        return Client().post("/api/signup/", body, content_type="application/json")

    def test_guest_points_are_credited_and_capped(self):
        res = self._signup(guest_points=340)
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.json()["user"]["points"], 340)
        self.assertEqual(res.json()["user"]["rank"], "Role Player")

    def test_guest_points_cap_at_1000(self):
        res = self._signup(guest_points=999_999)
        self.assertEqual(res.json()["user"]["points"], 1000)

    def test_junk_guest_points_are_ignored(self):
        self.assertEqual(self._signup(guest_points="lots").json()["user"]["points"], 0)
        self.assertEqual(self._signup(email="x@example.com", guest_points=-50).json()["user"]["points"], 0)

    def test_an_overflowing_number_is_ignored(self):
        # JSON 1e999 parses to float("inf"); int() of it raises OverflowError, not ValueError.
        body = '{"username": "Newbie", "email": "inf@example.com", "password": "Str0ng!Passw0rd", ' \
               '"accepted_terms": true, "age_confirmed": true, "guest_points": 1e999}'
        res = Client().post("/api/signup/", body, content_type="application/json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.json()["user"]["points"], 0)

    def test_a_new_google_account_gets_the_guest_points(self):
        identity = {"sub": GOOGLE_ID["sub"], "email": GOOGLE_ID["email"], "name": ""}
        with patch("users.views.verify_google_code", return_value=identity):
            res = Client().post(
                "/api/login/google/",
                {"code": "c", "accepted_terms": True, "age_confirmed": True, "guest_points": 250},
                content_type="application/json",
            )
        self.assertEqual(res.status_code, 200, res.content)
        self.assertTrue(res.json()["new_account"])
        self.assertEqual(res.json()["user"]["points"], 250)
        self.assertEqual(User.objects.get(email=GOOGLE_ID["email"]).rank, "Role Player")

    def test_an_existing_google_account_ignores_guest_points(self):
        User.objects.create_user(username="Fan", email=GOOGLE_ID["email"], password=None, google_sub=GOOGLE_ID["sub"])
        identity = {"sub": GOOGLE_ID["sub"], "email": GOOGLE_ID["email"], "name": ""}
        with patch("users.views.verify_google_code", return_value=identity):
            res = Client().post("/api/login/google/", {"code": "c", "guest_points": 250}, content_type="application/json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()["user"]["points"], 0)


class WeeklyBoardTests(TestCase):
    def setUp(self):
        cache.clear()  # the login throttle lives in the cache
        self.a = User.objects.create_user(username="alice", email="a@example.com", password="x", points=9_000, age_group="adult")
        self.b = User.objects.create_user(username="bob", email="b@example.com", password="x", points=100, age_group="adult")
        self.teen = User.objects.create_user(username="kid", email="k@example.com", password="x", points=5, age_group="teen")
        now = timezone.now()
        # This week: bob 300, alice 120, the teen 900 (hidden). Last week: alice 5,000 (ignored).
        GameSession.objects.create(user=self.b, game="wordle", score=200, awarded=300)
        GameSession.objects.create(user=self.a, game="wordle", score=100, awarded=120)
        GameSession.objects.create(user=self.teen, game="wordle", score=500, awarded=900)
        old = GameSession.objects.create(user=self.a, game="wordle", score=500, awarded=5_000)
        GameSession.objects.filter(pk=old.pk).update(finished_at=now - datetime.timedelta(days=14))

    def test_weekly_scope_sums_this_weeks_awards(self):
        res = Client().get("/api/get-users/?scope=weekly").json()
        self.assertEqual([(r["username"], r["points"]) for r in res["top_100_users"]], [("bob", 300), ("alice", 120)])
        self.assertEqual(res["number_users"], 2)
        self.assertIsNone(res["user_rank"])

    def test_weekly_position_of_the_signed_in_player(self):
        c = Client()
        tokens = c.post("/api/login/", {"id": "a@example.com", "password": "x"}, content_type="application/json").json()
        res = c.get("/api/get-users/?scope=weekly", HTTP_AUTHORIZATION=f"Bearer {tokens['access']}").json()
        self.assertEqual(res["user_rank"], 2)

    def test_global_rows_carry_rank_names(self):
        res = Client().get("/api/get-users/").json()
        self.assertEqual(res["top_100_users"][0]["rank"], "Rookie")
