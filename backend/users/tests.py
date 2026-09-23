import re
import time
from io import BytesIO
from importlib import import_module

from django.apps import apps as django_apps
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.urls import reverse
from PIL import Image

from users.identity import PUBLIC_ID_ALPHABET, PUBLIC_ID_LENGTH
from users.models import FriendRequest, Friendship
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


def png_bytes(color=(200, 30, 30)):
    """A tiny valid PNG for the multipart upload path (users.photos.normalize_profile_photo)."""
    buf = BytesIO()
    Image.new("RGB", (16, 16), color).save(buf, format="PNG")
    return buf.getvalue()


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


class FriendsPhotoTests(TestCase):
    """List endpoints (search, search-friends, friends-overview) never inline a photo's bytes —
    only the signed-in user's own /me payload does. Rows carry `photo_version` instead, which
    the client turns into the cacheable /api/users/<id>/photo/?v= URL. See users/friends.py `_brief`."""

    def setUp(self):
        self.me = User.objects.create_user(username="Searcher1", email="searcher@example.com", password="Testpass123!")
        self.access = str(issue_session_tokens(self.me).access_token)
        self.friend = User.objects.create_user(username="Photogenic", email="photo@example.com", password="Testpass123!")
        self.friend.profile_photo_data = b"fake-normalized-jpeg-bytes"
        self.friend.profile_photo_version = 1
        self.friend.save(update_fields=["profile_photo_data", "profile_photo_version"])
        lo, hi = Friendship.ordered_pair(self.me, self.friend)
        Friendship.objects.create(user_low=lo, user_high=hi)
        self.requester = User.objects.create_user(username="Requester", email="req@example.com", password="Testpass123!")
        self.requester.profile_photo_data = b"other-fake-jpeg-bytes"
        self.requester.profile_photo_version = 2
        self.requester.save(update_fields=["profile_photo_data", "profile_photo_version"])
        FriendRequest.objects.create(sender=self.requester, receiver=self.me)

    def test_search_and_overview_omit_photo_for_user_with_photo_data(self):
        resp = self.client.get(
            reverse("search-users"), {"q": "Photogenic"}, HTTP_AUTHORIZATION=f"Bearer {self.access}"
        )
        self.assertEqual(resp.status_code, 200)
        results = resp.json()["results"]
        self.assertEqual(len(results), 1)
        self.assertIsNone(results[0]["profile_photo"])
        self.assertEqual(results[0]["photo_version"], 1)

        resp = self.client.get(reverse("search-friends"), HTTP_AUTHORIZATION=f"Bearer {self.access}")
        self.assertEqual(resp.status_code, 200)
        friends = resp.json()["results"]
        self.assertEqual(len(friends), 1)
        self.assertIsNone(friends[0]["profile_photo"])
        self.assertEqual(friends[0]["photo_version"], 1)

        resp = self.client.get(reverse("friends-overview"), HTTP_AUTHORIZATION=f"Bearer {self.access}")
        self.assertEqual(resp.status_code, 200)
        incoming = resp.json()["incoming_requests"]
        self.assertEqual(len(incoming), 1)
        self.assertIsNone(incoming[0]["profile_photo"])
        self.assertEqual(incoming[0]["photo_version"], 2)


class ProfilePhotoEndpointTests(TestCase):
    """GET api/users/<public_id>/photo/ — the public, cacheable bytes behind list rows
    (users/photos.py profile_photo_view)."""

    JPEG = b"\xff\xd8\xff\xe0fake-jpeg-bytes"

    def setUp(self):
        self.user = User.objects.create_user(username="Photogenic", email="photo@example.com", password="Testpass123!")
        self.user.profile_photo_data = self.JPEG
        self.user.profile_photo_version = 3
        self.user.save(update_fields=["profile_photo_data", "profile_photo_version"])
        self.url = reverse("profile-photo", args=[self.user.public_id])

    def test_current_version_is_served_immutable_without_auth(self):
        resp = self.client.get(self.url, {"v": "3"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp["Content-Type"], "image/jpeg")
        self.assertEqual(resp.content, self.JPEG)
        self.assertEqual(resp["Cache-Control"], "public, max-age=31536000, immutable")
        self.assertEqual(resp["ETag"], '"3"')

    def test_missing_or_stale_version_must_revalidate(self):
        for params in ({}, {"v": "2"}):
            resp = self.client.get(self.url, params)
            self.assertEqual(resp.status_code, 200, params)
            self.assertEqual(resp.content, self.JPEG)
            self.assertEqual(resp["Cache-Control"], "no-cache")
            self.assertEqual(resp["ETag"], '"3"')

    def test_matching_if_none_match_is_304(self):
        resp = self.client.get(self.url, {"v": "3"}, HTTP_IF_NONE_MATCH='"3"')
        self.assertEqual(resp.status_code, 304)
        self.assertEqual(resp.content, b"")

    def test_lowercase_public_id_resolves(self):
        resp = self.client.get(reverse("profile-photo", args=[self.user.public_id.lower()]), {"v": "3"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.content, self.JPEG)

    def test_no_photo_and_unknown_id_are_the_same_404(self):
        bare = User.objects.create_user(username="NoPhoto", email="bare@example.com", password="Testpass123!")
        for pid in (bare.public_id, "ZZZZZZ"):
            resp = self.client.get(reverse("profile-photo", args=[pid]), {"v": "1"})
            self.assertEqual(resp.status_code, 404, pid)
            self.assertEqual(resp["Cache-Control"], "no-store")
            self.assertFalse(resp.has_header("ETag"))
            self.assertEqual(resp.json(), {"error": "No photo."})

    def test_only_safe_methods(self):
        self.assertEqual(self.client.post(self.url).status_code, 405)

    def test_upload_bumps_version_rows_carry_it_and_me_keeps_the_data_url(self):
        access = str(issue_session_tokens(self.user).access_token)
        for expected in (4, 5):
            resp = self.client.post(
                reverse("update"),
                {"profile_photo": SimpleUploadedFile("p.png", png_bytes(), content_type="image/png")},
                HTTP_AUTHORIZATION=f"Bearer {access}",
            )
            self.assertEqual(resp.status_code, 200, resp.content)
            self.user.refresh_from_db()
            self.assertEqual(self.user.profile_photo_version, expected)
        # The new bytes are served under the new version; the old version now revalidates.
        resp = self.client.get(self.url, {"v": "5"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp["ETag"], '"5"')
        self.assertEqual(resp.content[:2], b"\xff\xd8")  # a real JPEG now
        self.assertEqual(self.client.get(self.url, {"v": "3"})["Cache-Control"], "no-cache")
        # /me/ keeps the inline data URL and gains no version key.
        me = self.client.get(reverse("get_user"), HTTP_AUTHORIZATION=f"Bearer {access}").json()["user"]
        self.assertTrue(me["profile_photo"].startswith("data:image/jpeg;base64,"))
        self.assertNotIn("photo_version", me)
        # Another player's search row carries the version, never the bytes.
        other = User.objects.create_user(username="Searcher1", email="searcher@example.com", password="Testpass123!")
        other_access = str(issue_session_tokens(other).access_token)
        rows = self.client.get(
            reverse("search-users"), {"q": "Photogenic"}, HTTP_AUTHORIZATION=f"Bearer {other_access}"
        ).json()["results"]
        self.assertEqual(rows[0]["photo_version"], 5)
        self.assertIsNone(rows[0]["profile_photo"])

    def test_backfill_gives_legacy_photos_version_1(self):
        legacy = User.objects.create_user(username="Legacy1", email="legacy@example.com", password="Testpass123!")
        legacy.profile_photo_data = self.JPEG
        legacy.save(update_fields=["profile_photo_data"])  # version stays 0, like a pre-0006 row
        bare = User.objects.create_user(username="NoPhoto", email="bare@example.com", password="Testpass123!")
        migration = import_module("users.migrations.0006_customuser_profile_photo_version")
        migration.backfill_photo_version(django_apps, None)
        legacy.refresh_from_db()
        bare.refresh_from_db()
        self.user.refresh_from_db()
        self.assertEqual(legacy.profile_photo_version, 1)
        self.assertEqual(bare.profile_photo_version, 0)
        self.assertEqual(self.user.profile_photo_version, 3)  # already-versioned rows are left alone


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
        # The /me/ payload rides along so a return visit resumes in one round trip.
        self.assertEqual(body["user"]["id"], self.user.public_id)

    def test_refresh_user_payload_matches_me(self):
        tokens = login(self.client, "s@example.com").json()
        refreshed = self.client.post(
            reverse("token_refresh"),
            data={"refresh": tokens["refresh"]},
            content_type="application/json",
        ).json()
        me = self.client.get(reverse("get_user"), HTTP_AUTHORIZATION=f"Bearer {refreshed['access']}").json()
        self.assertEqual(refreshed["user"], me["user"])
