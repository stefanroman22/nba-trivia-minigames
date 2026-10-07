"""Photo moderation: client, decision, the update_profile hook and the scan pass (service mocked).

No real classifier and no network: `users.photo_moderation.classify_photo` or `requests.post` is patched.
"""
from io import BytesIO, StringIO
from unittest.mock import MagicMock, patch

import requests
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.urls import reverse
from PIL import Image

from users import photo_moderation
from users.models import ModerationEvent
from users.photo_moderation import ModerationUnavailable, Scores, classify_photo, decide, moderate_photo
from users.tokens import issue_session_tokens

User = get_user_model()
URL = "http://mod.test/api/classify"
REQUIRED = override_settings(MODERATION_REQUIRED=True, IMAGE_MODERATION_URL=URL, MODERATION_SHARED_SECRET="k")
SENTINEL = b"previous-photo"


def scores(nsfw=0.01, nsfl=0.01, sfw=0.98):
    return Scores(nsfw=nsfw, nsfl=nsfl, sfw=sfw, model="m", version="v")


def response(status=200, body=None):
    res = MagicMock(status_code=status)
    res.json.return_value = body if body is not None else {"nsfw": 0.01, "nsfl": 0.02, "sfw": 0.97, "model": "m", "version": "v"}
    return res


def png():
    out = BytesIO()
    Image.new("RGB", (64, 64), (200, 150, 120)).save(out, format="PNG")
    return out.getvalue()


@REQUIRED
class ClassifyPhotoTests(TestCase):
    @patch("requests.post")
    def test_sends_key_content_type_and_timeout(self, post):
        post.return_value = response()
        out = classify_photo(b"jpeg")
        self.assertAlmostEqual(out.sfw, 0.97)
        _, kwargs = post.call_args
        self.assertEqual(post.call_args[0][0], URL)
        self.assertEqual(kwargs["headers"]["X-Moderation-Key"], "k")
        self.assertEqual(kwargs["headers"]["Content-Type"], "image/jpeg")
        self.assertEqual(kwargs["timeout"], 4)
        self.assertEqual(kwargs["data"], b"jpeg")

    @patch("requests.post")
    def test_retries_once_on_timeout(self, post):
        post.side_effect = [requests.Timeout(), response()]
        self.assertAlmostEqual(classify_photo(b"j").sfw, 0.97)
        self.assertEqual(post.call_count, 2)

    @patch("requests.post")
    def test_second_failure_raises(self, post):
        post.side_effect = [requests.Timeout(), requests.ConnectionError()]
        with self.assertRaises(ModerationUnavailable):
            classify_photo(b"j")
        self.assertEqual(post.call_count, 2)

    @patch("requests.post")
    def test_500_retried_then_raises(self, post):
        post.return_value = response(500)
        with self.assertRaises(ModerationUnavailable):
            classify_photo(b"j")
        self.assertEqual(post.call_count, 2)

    @patch("requests.post")
    def test_401_raises_without_retry(self, post):
        post.return_value = response(401, {"error": "unauthorized"})
        with self.assertRaises(ModerationUnavailable):
            classify_photo(b"j")
        self.assertEqual(post.call_count, 1)

    @patch("requests.post")
    def test_malformed_bodies_raise(self, post):
        for body in ({"nsfl": 0.1, "sfw": 0.9}, {"nsfw": "nan", "nsfl": 0, "sfw": 1}, {"nsfw": 2, "nsfl": 0, "sfw": 0}, ["x"]):
            post.return_value = response(200, body)
            with self.assertRaises(ModerationUnavailable):
                classify_photo(b"j")

    @override_settings(MODERATION_SHARED_SECRET=None)
    @patch("requests.post")
    def test_missing_secret_raises_without_calling(self, post):
        with self.assertRaises(ModerationUnavailable):
            classify_photo(b"j")
        post.assert_not_called()


@REQUIRED
class DecideTests(TestCase):
    def test_thresholds(self):
        self.assertEqual(decide(scores(nsfw=0.85)), "block")
        self.assertEqual(decide(scores(nsfw=0.849)), "review")
        self.assertEqual(decide(scores(nsfw=0.5)), "review")
        self.assertEqual(decide(scores(nsfw=0.499)), "allow")
        self.assertEqual(decide(scores(nsfw=0.0, nsfl=0.9)), "block")

    @override_settings(PHOTO_BLOCK_THRESHOLD=0.95, PHOTO_REVIEW_THRESHOLD=0.7)
    def test_thresholds_come_from_settings(self):
        self.assertEqual(decide(scores(nsfw=0.9)), "review")
        self.assertEqual(decide(scores(nsfw=0.6)), "allow")


class ModeratePhotoTests(TestCase):
    @override_settings(MODERATION_REQUIRED=False, IMAGE_MODERATION_URL=None)
    def test_skipped_with_warning_when_not_required_and_unset(self):
        with self.assertLogs("users.photo_moderation", level="WARNING"):
            self.assertIsNone(moderate_photo(b"j"))

    @override_settings(MODERATION_REQUIRED=True, IMAGE_MODERATION_URL=None, MODERATION_SHARED_SECRET="k")
    def test_required_and_unset_is_unavailable(self):
        with self.assertRaises(ModerationUnavailable):
            moderate_photo(b"j")


class PhotoHookTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="Baller23", email="baller@example.com", password="Testpass123!")
        self.access = str(issue_session_tokens(self.user).access_token)
        User.objects.filter(pk=self.user.pk).update(profile_photo_data=SENTINEL, profile_photo_version=5)

    def upload(self):
        return self.client.post(
            reverse("update"),
            {"profile_photo": SimpleUploadedFile("x.png", png(), content_type="image/png")},
            HTTP_AUTHORIZATION=f"Bearer {self.access}",
        )

    def assert_unchanged(self):
        self.user.refresh_from_db()
        self.assertEqual(bytes(self.user.profile_photo_data), SENTINEL)
        self.assertEqual(self.user.profile_photo_version, 5)

    def assert_no_image_in(self, res):
        self.assertNotIn("data:image", res.content.decode())
        self.assertLess(len(res.content), 1000)

    @REQUIRED
    @patch("users.photo_moderation.classify_photo", return_value=scores(nsfw=0.97))
    def test_block_is_a_strike_and_saves_nothing(self, _):
        res = self.upload()
        self.assertEqual(res.status_code, 422)
        body = res.json()
        self.assertEqual(body["code"], "photo_rejected")
        self.assertEqual(body["strikes"], 1)
        self.assertIn("(1 of 3)", body["error"])
        self.assert_no_image_in(res)
        self.assert_unchanged()
        self.assertEqual(self.user.strike_count, 1)
        self.assertEqual(ModerationEvent.objects.filter(user=self.user, kind="photo", reason="strike").count(), 1)

    @REQUIRED
    @patch("users.photo_moderation.classify_photo", return_value=scores(nsfl=0.9))
    def test_third_block_bans_with_photo_reason(self, _):
        self.assertEqual(self.upload().status_code, 422)
        self.assertEqual(self.upload().status_code, 422)
        res = self.upload()
        self.assertEqual(res.status_code, 403)
        body = res.json()
        self.assertEqual(body["code"], "account_banned")
        self.assertEqual(body["strikes"], 3)
        self.assertEqual(body["reason"], "photo")
        self.user.refresh_from_db()
        self.assertIsNotNone(self.user.banned_at)
        self.assertEqual(self.user.ban_reason, "photo")
        self.assert_unchanged()

    @REQUIRED
    @patch("users.photo_moderation.classify_photo", side_effect=ModerationUnavailable("Timeout"))
    def test_unavailable_is_503_and_saves_nothing(self, _):
        res = self.upload()
        self.assertEqual(res.status_code, 503)
        self.assertEqual(res.json()["code"], "moderation_unavailable")
        self.assertEqual(res.json()["error"], photo_moderation.MESSAGE_MODERATION_UNAVAILABLE)
        self.assert_no_image_in(res)
        self.assert_unchanged()
        self.assertEqual(self.user.strike_count, 0)
        self.assertFalse(ModerationEvent.objects.exists())

    @override_settings(MODERATION_REQUIRED=True, IMAGE_MODERATION_URL=None)
    def test_required_but_unconfigured_is_503(self):
        res = self.upload()
        self.assertEqual(res.status_code, 503)
        self.assert_unchanged()

    @REQUIRED
    @patch("users.photo_moderation.classify_photo", return_value=scores(nsfw=0.6))
    def test_review_band_saves_and_logs_uncertain(self, _):
        res = self.upload()
        self.assertEqual(res.status_code, 200)
        self.user.refresh_from_db()
        self.assertNotEqual(bytes(self.user.profile_photo_data), SENTINEL)
        self.assertEqual(self.user.profile_photo_version, 6)
        self.assertEqual(self.user.strike_count, 0)
        event = ModerationEvent.objects.get(user=self.user)
        self.assertEqual((event.kind, event.tier, event.reason), ("photo", "mild", "uncertain"))

    @REQUIRED
    @patch("users.photo_moderation.classify_photo", return_value=scores())
    def test_allow_saves_without_event(self, _):
        res = self.upload()
        self.assertEqual(res.status_code, 200)
        self.user.refresh_from_db()
        self.assertEqual(self.user.profile_photo_version, 6)
        self.assertFalse(ModerationEvent.objects.exists())

    @override_settings(MODERATION_REQUIRED=False, IMAGE_MODERATION_URL=None)
    def test_skipped_in_local_dev_saves_with_warning(self):
        with self.assertLogs("users.photo_moderation", level="WARNING"):
            res = self.upload()
        self.assertEqual(res.status_code, 200)
        self.user.refresh_from_db()
        self.assertEqual(self.user.profile_photo_version, 6)


class ScanPhotosTests(TestCase):
    def setUp(self):
        self.bad = User.objects.create_user(username="BadPic", email="bad@example.com", password="Testpass123!")
        self.good = User.objects.create_user(username="GoodPic", email="good@example.com", password="Testpass123!")
        User.objects.filter(pk=self.bad.pk).update(profile_photo_data=b"bad")
        User.objects.filter(pk=self.good.pk).update(profile_photo_data=b"good")
        User.objects.create_user(username="NoPic", email="nopic@example.com", password="Testpass123!")

    @REQUIRED
    def test_reports_only_flagged_and_writes_nothing(self):
        def fake(data):
            return scores(nsfw=0.99) if data == b"bad" else scores()

        buf = StringIO()
        with patch("users.management.commands.scan_existing_users.classify_photo", side_effect=fake) as cls:
            call_command("scan_existing_users", "--photos", stdout=buf)
        out = buf.getvalue()
        self.assertEqual(cls.call_count, 2)
        self.assertIn(f"{self.bad.public_id}  photo  block", out)
        self.assertNotIn(self.good.public_id, out)
        self.assertIn("1 photo(s) flagged", out)
        self.assertFalse(ModerationEvent.objects.exists())
        self.bad.refresh_from_db()
        self.assertEqual((self.bad.strike_count, self.bad.banned_at), (0, None))
        self.assertEqual(bytes(self.bad.profile_photo_data), b"bad")

    @REQUIRED
    def test_service_failure_is_reported_unchecked(self):
        buf = StringIO()
        with patch(
            "users.management.commands.scan_existing_users.classify_photo",
            side_effect=ModerationUnavailable("Timeout"),
        ):
            call_command("scan_existing_users", "--photos", stdout=buf)
        out = buf.getvalue()
        self.assertIn(f"{self.bad.public_id}  photo  unchecked", out)
        self.assertIn(f"{self.good.public_id}  photo  unchecked", out)
        self.assertIn("0 photo(s) flagged, 2 could not be checked.", out)
        self.assertFalse(ModerationEvent.objects.exists())

    @override_settings(IMAGE_MODERATION_URL=None)
    def test_url_unset_prints_notice(self):
        buf = StringIO()
        with patch("users.management.commands.scan_existing_users.classify_photo") as cls:
            call_command("scan_existing_users", "--photos", stdout=buf)
        self.assertIn("photo scan skipped", buf.getvalue())
        cls.assert_not_called()
