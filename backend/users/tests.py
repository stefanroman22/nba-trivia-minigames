import re
import time

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse

from users.identity import PUBLIC_ID_ALPHABET, PUBLIC_ID_LENGTH
from users.tokens import AUTH_TIME_CLAIM, MAX_SESSION_AGE, SessionRefreshSerializer, issue_session_tokens

User = get_user_model()

PID_RE = re.compile(f"^[{PUBLIC_ID_ALPHABET}]{{{PUBLIC_ID_LENGTH}}}$")


def signup(client, username="Baller23", email="baller@example.com", password="Testpass123!"):
    return client.post(
        reverse("signup"),
        data={"username": username, "email": email, "password": password},
        content_type="application/json",
    )


def login(client, user_id, password="Testpass123!"):
    return client.post(
        reverse("login"),
        data={"id": user_id, "password": password},
        content_type="application/json",
    )


class PublicIdTests(TestCase):
    def test_every_account_gets_a_wellformed_unique_id(self):
        a = User.objects.create_user(username="p1", email="a@x.com", password="x")
        b = User.objects.create_user(username="p2", email="b@x.com", password="x")
        self.assertTrue(PID_RE.match(a.public_id))
        self.assertTrue(PID_RE.match(b.public_id))
        self.assertNotEqual(a.public_id, b.public_id)

    def test_id_is_stable_across_saves(self):
        a = User.objects.create_user(username="p1", email="a@x.com", password="x")
        original = a.public_id
        a.username = "renamed"
        a.save()
        a.refresh_from_db()
        self.assertEqual(a.public_id, original)


class SignupTests(TestCase):
    def test_signup_returns_tokens_and_user_with_id(self):
        resp = signup(self.client)
        self.assertEqual(resp.status_code, 201)
        body = resp.json()
        self.assertIn("access", body)
        self.assertIn("refresh", body)
        self.assertTrue(PID_RE.match(body["user"]["id"]))
        self.assertEqual(body["user"]["username"], "Baller23")

    def test_duplicate_usernames_are_allowed(self):
        r1 = signup(self.client, email="one@example.com")
        r2 = signup(self.client, email="two@example.com")
        self.assertEqual(r1.status_code, 201)
        self.assertEqual(r2.status_code, 201)
        self.assertNotEqual(r1.json()["user"]["id"], r2.json()["user"]["id"])
        self.assertEqual(User.objects.filter(username="Baller23").count(), 2)

    def test_duplicate_email_is_rejected(self):
        signup(self.client)
        resp = signup(self.client, username="Other99", email="BALLER@example.com")
        self.assertEqual(resp.status_code, 409)

    def test_bad_username_format_rejected(self):
        resp = signup(self.client, username="x")
        self.assertEqual(resp.status_code, 400)
        resp = signup(self.client, username="has spaces!")
        self.assertEqual(resp.status_code, 400)

    def test_weak_password_rejected(self):
        resp = signup(self.client, password="123")
        self.assertEqual(resp.status_code, 400)

    def test_invalid_email_rejected(self):
        resp = signup(self.client, email="not-an-email")
        self.assertEqual(resp.status_code, 400)


class LoginTests(TestCase):
    def setUp(self):
        self.u1 = User.objects.create_user(username="Baller23", email="one@example.com", password="Testpass123!")
        self.u2 = User.objects.create_user(username="Baller23", email="two@example.com", password="Testpass123!")
        self.solo = User.objects.create_user(username="SoloName", email="solo@example.com", password="Testpass123!")

    def test_login_by_email(self):
        resp = login(self.client, "ONE@example.com")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["user"]["id"], self.u1.public_id)

    def test_login_by_unambiguous_username(self):
        resp = login(self.client, "SoloName")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["user"]["id"], self.solo.public_id)

    def test_ambiguous_username_gets_helpful_error(self):
        resp = login(self.client, "Baller23")
        self.assertEqual(resp.status_code, 401)
        self.assertIn("Several players", resp.json()["error"])

    def test_login_by_username_hash_id(self):
        resp = login(self.client, f"Baller23#{self.u2.public_id.lower()}")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["user"]["id"], self.u2.public_id)

    def test_wrong_password(self):
        resp = login(self.client, "solo@example.com", password="nope")
        self.assertEqual(resp.status_code, 401)

    def test_me_includes_public_id(self):
        tokens = login(self.client, "solo@example.com").json()
        resp = self.client.get(reverse("get_user"), HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["user"]["id"], self.solo.public_id)


class SessionLifetimeTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="Session1", email="s@example.com", password="Testpass123!")

    def test_login_stamps_auth_time(self):
        refresh = issue_session_tokens(self.user)
        self.assertAlmostEqual(refresh[AUTH_TIME_CLAIM], int(time.time()), delta=5)

    def test_fresh_session_refreshes_and_keeps_auth_time(self):
        refresh = issue_session_tokens(self.user)
        ser = SessionRefreshSerializer(data={"refresh": str(refresh)})
        self.assertTrue(ser.is_valid(), ser.errors)
        # Rotation must carry the original sign-in time onto the new token.
        from rest_framework_simplejwt.tokens import RefreshToken
        rotated = RefreshToken(ser.validated_data["refresh"])
        self.assertEqual(rotated[AUTH_TIME_CLAIM], refresh[AUTH_TIME_CLAIM])

    def test_session_older_than_cap_is_refused(self):
        refresh = issue_session_tokens(self.user)
        refresh[AUTH_TIME_CLAIM] = int(time.time() - MAX_SESSION_AGE.total_seconds() - 60)
        resp = self.client.post(
            reverse("token_refresh"),
            data={"refresh": str(refresh)},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 401)

    def test_refresh_endpoint_round_trip(self):
        tokens = login(self.client, "s@example.com").json()
        resp = self.client.post(
            reverse("token_refresh"),
            data={"refresh": tokens["refresh"]},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertIn("access", body)
        self.assertIn("refresh", body)  # rotation returns a new refresh token
