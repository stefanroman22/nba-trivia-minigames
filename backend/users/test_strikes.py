"""Strikes, bans, the signup IP lock and every enforcement surface (users.strikes, users.authentication)."""
from io import StringIO
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken

from users import leaderboard, strikes
from users.models import Friendship, ModerationEvent
from users.moderation_text import MESSAGE_RESERVED, MESSAGE_SIGNUP_SEVERE
from users.test_leaderboard import FakeRedis
from users.tests import login, signup

User = get_user_model()
PASSWORD = "Testpass123!"
def _severe_name(n):
    """severe.json's first term + n, read at runtime so no term is written into this file."""
    import json
    import os

    from users import moderation_text

    with open(os.path.join(moderation_text.DATA_DIR, "severe.json"), encoding="utf-8") as fh:
        first = json.load(fh)["terms"][0]["term"]
    return f"{first}{n}"


LOCMEM = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache", "LOCATION": "strikes-tests"}}


@override_settings(CACHES=LOCMEM)
class StrikeTestCase(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(username="Hooper1", email="hooper@example.com", password=PASSWORD, points=150)
        self.tokens = login(self.client, "hooper@example.com").json()

    def auth(self, access=None):
        return {"HTTP_AUTHORIZATION": f"Bearer {access or self.tokens['access']}"}

    def rename(self, name, access=None):
        return self.client.post(
            reverse("update"), data={"username": name}, content_type="application/json", **self.auth(access)
        )

    def ban_via_names(self):
        for n in (1, 2, 3):
            resp = self.rename(_severe_name(n))
        return resp

    def assert_banned(self, resp):
        self.assertEqual(resp.status_code, 403, resp.content)
        body = resp.json()
        self.assertEqual(body["code"], "account_banned")
        self.assertEqual(body["public_id"], self.user.public_id)
        self.assertEqual(body["strikes"], 3)
        self.assertEqual(body["reason"], strikes.BAN_REASON_NAME)
        return body


class StrikeServiceTests(StrikeTestCase):
    def test_canonical_email(self):
        self.assertEqual(strikes.canonical_email("A.b+x@Gmail.com"), "ab@gmail.com")
        self.assertEqual(strikes.canonical_email("a.b+x@googlemail.com"), "ab@gmail.com")
        self.assertEqual(strikes.canonical_email("a.b+x@other.com"), "a.b@other.com")

    def test_record_strike_counts_logs_and_bans_on_third(self):
        fake = FakeRedis()
        with mock.patch("users.leaderboard._redis", return_value=fake):
            leaderboard.record_score(self.user)
            self.assertEqual(strikes.record_strike(self.user, "name_change"), (1, False))
            self.assertEqual(strikes.record_strike(self.user, "name_change"), (2, False))
            self.assertEqual(strikes.record_strike(self.user, "name_change"), (3, True))
        self.user.refresh_from_db()
        self.assertIsNotNone(self.user.banned_at)
        self.assertEqual(self.user.ban_reason, "name_severe")
        self.assertEqual(self.user.canonical_email, "hooper@example.com")
        reasons = list(ModerationEvent.objects.filter(user=self.user).values_list("reason", flat=True))
        self.assertEqual(sorted(reasons), ["ban", "strike", "strike", "strike"])
        # Every outstanding refresh token is blacklisted, and the ZSET row is gone.
        outstanding = OutstandingToken.objects.filter(user=self.user).count()
        self.assertGreater(outstanding, 0)
        self.assertEqual(BlacklistedToken.objects.filter(token__user=self.user).count(), outstanding)
        self.assertNotIn(self.user.public_id, fake.z.get(leaderboard.ZKEY, {}))

    def test_strike_count_never_passes_the_limit(self):
        for _ in range(3):
            strikes.record_strike(self.user, "name_change")
        # A racing request that reaches record_strike after the ban adds nothing and reports it.
        self.assertEqual(strikes.record_strike(self.user, "name_change"), (3, True))
        self.user.refresh_from_db()
        self.assertEqual(self.user.strike_count, 3)
        self.assertEqual(ModerationEvent.objects.filter(user=self.user, reason="strike").count(), 3)
        self.assertEqual(ModerationEvent.objects.filter(user=self.user, reason="ban").count(), 1)

    def test_event_stores_no_text(self):
        strikes.record_strike(self.user, "name_change", ip_hash="h" * 64)
        event = ModerationEvent.objects.get(user=self.user)
        self.assertEqual((event.kind, event.tier, event.reason, event.public_id), ("name_change", "severe", "strike", self.user.public_id))
        field_names = {f.name for f in ModerationEvent._meta.get_fields()}
        self.assertFalse({"term", "text", "username", "ip"} & field_names)

    def test_signup_lock_after_three(self):
        h = "a" * 64
        self.assertFalse(strikes.note_blocked_signup(h))
        self.assertFalse(strikes.note_blocked_signup(h))
        self.assertFalse(strikes.signup_ip_locked(h))
        self.assertTrue(strikes.note_blocked_signup(h))
        self.assertTrue(strikes.signup_ip_locked(h))
        self.assertFalse(strikes.signup_ip_locked("b" * 64))


class NameChangeTests(StrikeTestCase):
    def test_first_strike_warns_one_of_three(self):
        resp = self.rename(_severe_name(1))
        self.assertEqual(resp.status_code, 400)
        self.assertIn("Repeated attempts will lead to a ban (1 of 3)", resp.json()["error"])
        self.assertNotIn(_severe_name(1).lower(), resp.json()["error"].lower())
        self.user.refresh_from_db()
        self.assertEqual((self.user.strike_count, self.user.username), (1, "Hooper1"))
        self.assertIn("(2 of 3)", self.rename(_severe_name(2)).json()["error"])

    def test_mild_and_reserved_reject_without_strike(self):
        for name, message in (("Gay", None), ("admin1", MESSAGE_RESERVED)):
            resp = self.rename(name)
            self.assertEqual(resp.status_code, 400)
            if message:
                self.assertEqual(resp.json()["error"], message)
        self.user.refresh_from_db()
        self.assertEqual(self.user.strike_count, 0)
        self.assertFalse(ModerationEvent.objects.exists())

    def test_required_player_names_are_accepted(self):
        for name in ("RudyGay", "DickBarnett", "DellCurry", "TerryCummings", "CollinSexton"):
            self.assertEqual(self.rename(name).status_code, 200, name)

    def test_three_severe_names_ban_and_every_surface_refuses(self):
        resp = self.ban_via_names()
        self.assert_banned(resp)
        self.user.refresh_from_db()
        self.assertIsNotNone(self.user.banned_at)
        self.assertEqual(ModerationEvent.objects.filter(user=self.user, reason="strike").count(), 3)
        self.assertEqual(ModerationEvent.objects.filter(user=self.user, reason="ban").count(), 1)

        # /me/ with the still-unexpired access token
        self.assert_banned(self.client.get(reverse("get_user"), **self.auth()))
        # login: the right password answers 403, not "Incorrect password"
        self.assert_banned(login(self.client, "hooper@example.com"))
        self.assertEqual(login(self.client, "hooper@example.com", password="wrong-pass").status_code, 401)
        # refresh: answered 403 although the ban blacklisted the token
        self.assert_banned(
            self.client.post(reverse("token_refresh"), data={"refresh": self.tokens["refresh"]}, content_type="application/json")
        )
        # Google login with the same address
        self.assert_banned(self.google_login("hooper@example.com"))

    def google_login(self, email):
        # A verified Google identity (users.google_auth is covered in users/tests.py).
        identity = {"sub": f"google-{email}", "email": email, "name": ""}
        with mock.patch("users.views.verify_google_code", return_value=identity):
            return self.client.post(reverse("google_login"), data={"code": "c", "accepted_terms": True, "birth_year": 1990, "birth_month": 6}, content_type="application/json")

    def test_google_new_account_with_banned_canonical_email_is_refused(self):
        self.ban_via_names()
        User.objects.filter(pk=self.user.pk).update(email="h.ooper+x@gmail.com", canonical_email="hooper@gmail.com")
        resp = self.google_login("hooper@gmail.com")
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.json()["code"], "signup_blocked")
        self.assertFalse(User.objects.filter(email="hooper@gmail.com").exists())

    def test_google_flagged_auto_name_falls_back_to_player(self):
        resp = self.google_login("admin@example.com")
        self.assertEqual(resp.status_code, 200, resp.content)
        user = User.objects.get(email="admin@example.com")
        self.assertRegex(user.username, r"^Player\d{4}$")
        self.assertEqual(user.strike_count, 0)
        self.assertFalse(ModerationEvent.objects.exists())

    def test_unban_restores_access(self):
        fake = FakeRedis()
        with mock.patch("users.leaderboard._redis", return_value=fake):
            self.ban_via_names()
            self.user.refresh_from_db()
            strikes.unban_user(self.user)
            self.assertEqual(fake.z[leaderboard.ZKEY][self.user.public_id], 150)
        self.user.refresh_from_db()
        self.assertEqual((self.user.strike_count, self.user.banned_at, self.user.ban_reason), (0, None, ""))
        tokens = login(self.client, "hooper@example.com").json()
        self.assertEqual(self.client.get(reverse("get_user"), **self.auth(tokens["access"])).status_code, 200)

    def test_normal_user_is_unaffected_by_the_auth_class(self):
        self.assertEqual(self.client.get(reverse("get_user"), **self.auth()).status_code, 200)


class SignupModerationTests(StrikeTestCase):
    def test_three_severe_signups_lock_the_ip_without_creating_accounts(self):
        before = User.objects.count()
        for n in (1, 2, 3):
            resp = signup(self.client, username=_severe_name(n), email=f"new{n}@example.com")
            self.assertEqual(resp.status_code, 400)
            self.assertEqual(resp.json()["error"], MESSAGE_SIGNUP_SEVERE)
        resp = signup(self.client, username="CleanName", email="clean@example.com")
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.json()["code"], "signup_locked")
        self.assertEqual(User.objects.count(), before)
        self.assertEqual(ModerationEvent.objects.filter(reason="signup_ip_locked").count(), 1)
        # Another network can still sign up.
        other = self.client.post(
            reverse("signup"),
            data={"username": "CleanName", "email": "clean@example.com", "password": PASSWORD, "accepted_terms": True, "birth_year": 1990, "birth_month": 6},
            content_type="application/json",
            REMOTE_ADDR="10.9.9.9",
        )
        self.assertEqual(other.status_code, 201)

    def test_mild_signup_name_is_rejected_without_counting(self):
        for _ in range(4):
            resp = signup(self.client, username="admin1", email="x@example.com")
            self.assertEqual(resp.json()["error"], MESSAGE_RESERVED)
        self.assertEqual(signup(self.client, username="Fine_Name", email="x@example.com").status_code, 201)

    def test_banned_canonical_email_cannot_sign_up_again(self):
        self.ban_via_names()
        resp = signup(self.client, username="Fresh", email="Hooper+again@example.com")
        taken = signup(self.client, username="Fresh", email="hooper@example.com")
        # Indistinguishable from a taken email: no ban oracle on an anonymous endpoint.
        self.assertEqual((resp.status_code, resp.json()), (taken.status_code, taken.json()))
        self.assertEqual(resp.status_code, 409)
        self.assertNotIn("code", resp.json())
        self.assertFalse(User.objects.filter(email="hooper+again@example.com").exists())
        # Both attempts match the banned canonical email; the reason is only in the event log.
        self.assertEqual(ModerationEvent.objects.filter(reason="signup_blocked").count(), 2)


class CheckNameTests(StrikeTestCase):
    def check(self, name):
        return self.client.post(reverse("check-name"), data={"username": name}, content_type="application/json")

    def test_check_name(self):
        self.assertEqual(self.check("Baller").json(), {"ok": True})
        self.assertEqual(self.check("admin1").json(), {"ok": False, "error": MESSAGE_RESERVED})
        body = self.check(_severe_name(1)).json()
        self.assertFalse(body["ok"])
        self.assertNotIn(_severe_name(1)[:-1].lower(), body["error"].lower())
        self.assertFalse(self.check("a b").json()["ok"])
        self.assertFalse(ModerationEvent.objects.exists())

    def test_non_object_body_is_a_400_not_a_500(self):
        resp = self.client.post(reverse("check-name"), data=["admin"], content_type="application/json")
        self.assertEqual(resp.status_code, 400)
        self.assertFalse(resp.json()["ok"])


class HiddenWhenBannedTests(StrikeTestCase):
    def setUp(self):
        super().setUp()
        self.other = User.objects.create_user(username="Watcher", email="w@example.com", password=PASSWORD)
        self.other_access = login(self.client, "w@example.com").json()["access"]
        self.user.profile_photo_data = b"\xff\xd8jpeg"
        self.user.profile_photo_version = 1
        self.user.save()
        Friendship.objects.create(**dict(zip(("user_low", "user_high"), Friendship.ordered_pair(self.user, self.other))))
        self.user.refresh_from_db()
        strikes.ban_user(self.user, strikes.BAN_REASON_ADMIN)

    def test_leaderboards_hide_banned(self):
        ids = [r["id"] for r in leaderboard.top(10)]
        self.assertNotIn(self.user.public_id, ids)
        self.assertEqual(leaderboard.total(), 1)
        board, _, count = leaderboard.friends_board(self.other)
        self.assertEqual(([r["id"] for r in board], count), ([self.other.public_id], 1))
        resp = self.client.get(reverse("get-users"))
        self.assertNotIn(self.user.public_id, [r["id"] for r in resp.json()["top_100_users"]])

    def test_search_omits_banned(self):
        resp = self.client.get(reverse("search-users"), {"q": "Hooper"}, **self.auth(self.other_access))
        self.assertEqual(resp.json()["results"], [])

    def test_photo_is_the_same_404(self):
        resp = self.client.get(reverse("profile-photo", args=[self.user.public_id]), {"v": "1"})
        missing = self.client.get(reverse("profile-photo", args=["ZZZZZZ"]), {"v": "1"})
        self.assertEqual((resp.status_code, resp.content), (404, missing.content))

    def test_sync_leaderboard_skips_banned(self):
        fake = FakeRedis()
        with mock.patch("users.leaderboard._redis", return_value=fake):
            call_command("sync_leaderboard", stdout=StringIO())
        self.assertEqual(set(fake.z[leaderboard.ZKEY]), {self.other.public_id})

    def test_record_score_never_re_adds_a_banned_user(self):
        fake = FakeRedis()
        with mock.patch("users.leaderboard._redis", return_value=fake):
            leaderboard.record_score(self.user)
        self.assertEqual(fake.z, {})


class AdminAndScanTests(StrikeTestCase):
    def test_scan_reports_and_writes_nothing(self):
        User.objects.filter(pk=self.user.pk).update(username="admin")
        buf = StringIO()
        call_command("scan_existing_users", stdout=buf)
        out = buf.getvalue()
        self.assertIn(f"{self.user.public_id}  reserved  blocked", out)
        self.assertIn("1 account(s) would be blocked.", out)
        self.user.refresh_from_db()
        self.assertEqual((self.user.strike_count, self.user.banned_at, self.user.username), (0, None, "admin"))
        self.assertFalse(ModerationEvent.objects.exists())

    def test_admin_unban_action(self):
        self.ban_via_names()
        boss = User.objects.create_superuser(username="Boss", email="boss@example.com", password=PASSWORD)
        self.client.force_login(boss)
        url = reverse("admin:users_customuser_changelist")
        self.assertEqual(self.client.get(url).status_code, 200)
        self.assertEqual(self.client.get(reverse("admin:users_customuser_change", args=[self.user.pk])).status_code, 200)
        resp = self.client.post(url, {"action": "unban_users", "_selected_action": [self.user.pk]})
        self.assertEqual(resp.status_code, 302)
        self.user.refresh_from_db()
        self.assertEqual((self.user.banned_at, self.user.strike_count), (None, 0))
        self.assertEqual(ModerationEvent.objects.filter(user=self.user, reason="unban").count(), 1)
