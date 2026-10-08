"""Regression tests for the independent audit of 2026-10-08."""
import re
from datetime import date
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from django.urls import reverse

from users import leaderboard, strikes
from users.tests import GOOGLE_ID, google, login, signup

User = get_user_model()
TEEN = {"accepted_terms": True, "birth_year": date.today().year - 14, "birth_month": 1}


class GoogleDisplayNameTests(TestCase):
    def test_a_new_google_account_never_gets_a_name_derived_from_the_email(self):
        with mock.patch("users.views.verify_google_code", return_value={**GOOGLE_ID, "email": "runforfun12@gmail.com"}):
            google(self.client)
        user = User.objects.get(email="runforfun12@gmail.com")
        self.assertRegex(user.username, r"^Player\d{4}$")
        self.assertNotIn("runforfun", user.username.lower())


class UniformLoginErrorTests(TestCase):
    def test_unknown_account_and_wrong_password_look_the_same(self):
        signup(self.client, username="Ann", email="ann@example.com")
        unknown = login(self.client, "nobody@example.com")
        wrong = login(self.client, "ann@example.com", password="Wrong-pass-1!")
        self.assertEqual((unknown.status_code, wrong.status_code), (401, 401))
        self.assertEqual(unknown.json(), wrong.json())


class TeenPrivacyTests(TestCase):
    def setUp(self):
        cache.clear()
        signup(self.client, username="Adult", email="adult@example.com")
        self.adult = User.objects.get(email="adult@example.com")
        self.client.post(
            reverse("signup"),
            data={"username": "TeenPlayer", "email": "teen@example.com", "password": "Testpass123!", **TEEN},
            content_type="application/json",
        )
        self.teen = User.objects.get(email="teen@example.com")
        User.objects.filter(pk__in=[self.adult.pk, self.teen.pk]).update(points=50)

    def test_teens_are_not_on_the_global_leaderboard(self):
        names = [row["username"] for row in leaderboard.top()]
        self.assertIn("Adult", names)
        self.assertNotIn("TeenPlayer", names)

    def search(self, q):
        token = login(self.client, "adult@example.com").json()["access"]
        return self.client.get(reverse("search-users"), {"q": q}, HTTP_AUTHORIZATION=f"Bearer {token}").json()["results"]

    def test_teens_are_found_only_by_their_exact_player_id(self):
        self.assertEqual(self.search("TeenPl"), [])
        self.assertNotIn(self.teen.public_id, [r["id"] for r in self.search(self.teen.public_id[:3])])
        exact = self.search(self.teen.public_id)
        self.assertEqual([r["id"] for r in exact], [self.teen.public_id])


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
