"""Regression tests for the independent audit of 2026-10-08."""
import re
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from django.urls import reverse

from users import leaderboard, strikes
from users.tests import GOOGLE_ID, google, login, signup

User = get_user_model()


class GoogleDisplayNameTests(TestCase):
    def test_a_new_google_account_gets_its_email_name_plus_two_digits(self):
        with mock.patch("users.views.verify_google_code", return_value={**GOOGLE_ID, "email": "runforfun12@gmail.com"}):
            google(self.client)
        user = User.objects.get(email="runforfun12@gmail.com")
        self.assertRegex(user.username, r"^runforfun12\d{2}$")


class UniformLoginErrorTests(TestCase):
    def test_unknown_account_and_wrong_password_look_the_same(self):
        signup(self.client, username="Ann", email="ann@example.com")
        unknown = login(self.client, "nobody@example.com")
        wrong = login(self.client, "ann@example.com", password="Wrong-pass-1!")
        self.assertEqual((unknown.status_code, wrong.status_code), (401, 401))
        self.assertEqual(unknown.json(), wrong.json())


class TeenAccountsAreFullPlayersTests(TestCase):
    """No age rules (owner decision 2026-10-11, removed from the app 2026-10-26): accounts an earlier
    sign-up flagged "teen", or of unknown age, work like every other account (photos too: test_photos)."""

    def setUp(self):
        cache.clear()
        signup(self.client, username="Adult", email="adult@example.com")
        self.adult = User.objects.get(email="adult@example.com")
        # Legacy flag from the earlier sign-up flow; nothing sets it any more.
        self.teen = User.objects.create_user(username="TeenPlayer", email="teen@example.com", password="Testpass123!", age_group="teen")
        self.unknown = User.objects.create_user(username="NoAgeYet", email="noage@example.com", password="x", points=70)
        User.objects.filter(pk__in=[self.adult.pk, self.teen.pk]).update(points=50)
        User.objects.filter(pk=self.teen.pk).update(points=90)
        self.teen.refresh_from_db()

    def test_teens_and_unknown_ages_are_on_the_global_leaderboard(self):
        self.assertEqual(self.teen.age_group, "teen")
        self.assertEqual(self.unknown.age_group, "")
        self.assertEqual([row["username"] for row in leaderboard.top()], ["TeenPlayer", "NoAgeYet", "Adult"])
        self.assertEqual((leaderboard.rank_of(self.teen), leaderboard.rank_of(self.unknown), leaderboard.total()), (1, 2, 3))
        token = login(self.client, "teen@example.com").json()["access"]
        resp = self.client.get(reverse("get-users"), HTTP_AUTHORIZATION=f"Bearer {token}").json()
        self.assertEqual((resp["user_rank"], resp["number_users"]), (1, 3))

    def test_teens_are_on_the_weekly_board(self):
        from trivia.models import GameSession

        GameSession.objects.create(user=self.teen, game="wordle", score=10, awarded=40)
        GameSession.objects.create(user=self.adult, game="wordle", score=10, awarded=20)
        board, my_rank, count, mine = leaderboard.weekly_board(self.teen)
        self.assertEqual([r["username"] for r in board], ["TeenPlayer", "Adult"])
        self.assertEqual((my_rank, count, mine), (1, 2, 40))

    def search(self, q):
        token = login(self.client, "adult@example.com").json()["access"]
        return self.client.get(reverse("search-users"), {"q": q}, HTTP_AUTHORIZATION=f"Bearer {token}").json()["results"]

    def test_teens_are_found_by_name_and_by_partial_id(self):
        self.assertEqual([r["id"] for r in self.search("TeenPl")], [self.teen.public_id])
        self.assertEqual([r["id"] for r in self.search("NoAge")], [self.unknown.public_id])
        self.assertIn(self.teen.public_id, [r["id"] for r in self.search(self.teen.public_id[:3])])


class BanNoticeTests(TestCase):
    def test_the_ban_payload_says_whether_it_was_automatic_and_where_to_appeal(self):
        user = User.objects.create_user(username="bad", email="b@example.com", password="x")
        strikes.ban_user(user, "name_severe")
        payload = strikes.ban_payload(User.objects.get(pk=user.pk))
        self.assertTrue(payload["automated"])
        self.assertTrue(re.match(r".+@.+", payload["appeal_email"]))
        strikes.ban_user(user, "admin")
        self.assertFalse(strikes.ban_payload(User.objects.get(pk=user.pk))["automated"])


class RefreshOfADeletedAccountTests(TestCase):
    def test_another_devices_refresh_token_is_refused_cleanly(self):
        signup(self.client, username="Ann", email="ann@example.com")
        tokens = login(self.client, "ann@example.com").json()
        User.objects.filter(email="ann@example.com").delete()
        resp = self.client.post(reverse("token_refresh"), data={"refresh": tokens["refresh"]}, content_type="application/json")
        self.assertEqual(resp.status_code, 401)
