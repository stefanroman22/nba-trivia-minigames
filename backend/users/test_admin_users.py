"""Time-on-site reports (users.activity) and the admin Users tab API (users.admin_users_api)."""
import datetime

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from trivia.models import GameSession
from trivia.wordle_daily import cet_today
from users import account_data, activity, retention, strikes
from users.models import DailyActivity, FriendRequest, ModerationEvent

User = get_user_model()

LOCMEM = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}


def _user(email, name="Player", **extra):
    return User.objects.create_user(email=email, username=name, password="pw-12345", **extra)


@override_settings(CACHES=LOCMEM)
class ReportActivityTests(TestCase):
    def setUp(self):
        cache.clear()
        self.api = APIClient()
        self.user = _user("p@example.com")

    def _post(self, body, **headers):
        return self.api.post(reverse("activity"), body, format="json", **headers)

    def test_guests_are_never_tracked(self):
        self.assertEqual(self._post({"seconds": 60}).status_code, 401)
        self.assertEqual(DailyActivity.objects.count(), 0)

    def test_reports_add_up_on_one_row_per_day_with_the_country_header(self):
        self.api.force_authenticate(self.user)
        self.assertEqual(self._post({"seconds": 120}, HTTP_X_VERCEL_IP_COUNTRY="ro").status_code, 204)
        self.assertEqual(self._post({"seconds": 30}).status_code, 204)
        row = DailyActivity.objects.get()
        self.assertEqual((row.day, row.seconds, row.country), (cet_today(), 150, "RO"))

    def test_a_report_is_clamped_and_a_day_never_exceeds_24_hours(self):
        self.api.force_authenticate(self.user)
        self._post({"seconds": 10**9})
        self.assertEqual(DailyActivity.objects.get().seconds, activity.MAX_REPORT_SECONDS)
        DailyActivity.objects.update(seconds=activity.MAX_DAY_SECONDS - 10)
        self._post({"seconds": 600})
        self.assertEqual(DailyActivity.objects.get().seconds, activity.MAX_DAY_SECONDS)
        self._post({"seconds": -50})
        self.assertEqual(DailyActivity.objects.get().seconds, activity.MAX_DAY_SECONDS)

    def test_bad_seconds_and_placeholder_countries(self):
        self.api.force_authenticate(self.user)
        self.assertEqual(self._post({"seconds": "abc"}).status_code, 400)
        self._post({"seconds": 5}, HTTP_X_VERCEL_IP_COUNTRY="XX")
        self.assertEqual(DailyActivity.objects.get().country, "")


@override_settings(CACHES=LOCMEM)
class AdminUsersApiTests(TestCase):
    def setUp(self):
        cache.clear()
        self.api = APIClient()
        self.admin = _user("admin@example.com", "Boss", is_staff=True)
        self.ann = _user("ann@example.com", "Ann")
        self.bob = _user("bob@example.com", "Bob")
        today = cet_today()
        now = timezone.now()
        DailyActivity.objects.create(user=self.ann, day=today, seconds=600, country="RO", last_seen_at=now)
        DailyActivity.objects.create(
            user=self.ann, day=today - datetime.timedelta(days=3), seconds=300, country="NL", last_seen_at=now
        )
        DailyActivity.objects.create(
            user=self.bob, day=today - datetime.timedelta(days=40), seconds=100, country="US", last_seen_at=now
        )
        GameSession.objects.create(user=self.ann, game="wordle", mode="single", score=50, duration_ms=60000)
        GameSession.objects.create(user=self.ann, game="wordle", mode="match", score=80, duration_ms=90000)
        GameSession.objects.create(user=None, game="mvps", mode="single", score=10)
        self.api.force_authenticate(self.admin)

    def test_every_endpoint_requires_staff(self):
        player = APIClient()
        player.force_authenticate(self.ann)
        urls = [
            reverse("admin-users"),
            reverse("admin-users-overview"),
            reverse("admin-user-detail", args=[self.bob.public_id]),
        ]
        for url in urls:
            self.assertEqual(player.get(url).status_code, 403, url)
        ban = reverse("admin-user-ban", args=[self.bob.public_id])
        self.assertEqual(player.post(ban, {"action": "ban"}, format="json").status_code, 403)

    def test_overview_totals_for_the_last_30_days(self):
        data = self.api.get(reverse("admin-users-overview"), {"period": "30d"}).json()
        self.assertEqual(data["users"]["total"], 3)
        self.assertEqual(data["active"]["period"], 1)  # Bob's only day is 40 days ago
        self.assertEqual(data["active"]["today"], 1)
        self.assertEqual(data["time"]["period_seconds"], 900)
        self.assertEqual(data["time"]["per_active_player"], 900)
        self.assertEqual(data["games"]["total"], 3)
        self.assertEqual(data["games"]["guests"], 1)
        self.assertEqual(data["games"]["online"], 1)
        self.assertEqual(data["games"]["online_players"], 1)
        self.assertEqual(len(data["series"]["buckets"]), 30)
        self.assertEqual(sum(b["seconds"] for b in data["series"]["buckets"]), 900)
        self.assertEqual(sum(b["signups"] for b in data["series"]["buckets"]), 3)
        self.assertEqual({c["country"] for c in data["countries"]}, {"RO", "NL"})
        self.assertEqual(data["top_time"][0]["public_id"], self.ann.public_id)

    def test_every_period_answers(self):
        for period in ("7d", "30d", "90d", "12m", "all", "nonsense"):
            res = self.api.get(reverse("admin-users-overview"), {"period": period})
            self.assertEqual(res.status_code, 200, period)

    def test_list_rows_sorts_and_filters(self):
        data = self.api.get(reverse("admin-users"), {"sort": "time"}).json()
        self.assertEqual(data["total"], 3)
        first = data["rows"][0]
        self.assertEqual(first["public_id"], self.ann.public_id)
        self.assertEqual((first["app_seconds"], first["games"], first["online_games"]), (900, 2, 1))
        self.assertEqual(first["country"], "RO")  # the most recent day's country

        def ids(**params):
            return [r["public_id"] for r in self.api.get(reverse("admin-users"), params).json()["rows"]]

        self.assertEqual(ids(filter="online"), [self.ann.public_id])
        self.assertEqual(ids(filter="active_7d"), [self.ann.public_id])
        self.assertEqual(set(ids(filter="inactive_30d")), {self.admin.public_id, self.bob.public_id})
        self.assertEqual(ids(filter="admins"), [self.admin.public_id])
        self.assertEqual(ids(q="bob@"), [self.bob.public_id])
        self.assertEqual(ids(country="ro"), [self.ann.public_id])
        self.assertEqual(len(ids(sort="last_seen")), 3)

    def test_detail_reports_usage_games_and_the_admins_relationship(self):
        FriendRequest.objects.create(sender=self.admin, receiver=self.ann)
        data = self.api.get(reverse("admin-user-detail", args=[self.ann.public_id])).json()
        self.assertEqual(data["account"]["email"], "ann@example.com")
        self.assertEqual(data["usage"]["total_seconds"], 900)
        self.assertEqual(data["usage"]["seconds_7d"], 900)
        self.assertEqual(data["usage"]["days_active"], 2)
        self.assertEqual(data["usage"]["country"], "RO")
        self.assertEqual(len(data["usage"]["daily"]), 30)
        self.assertEqual(data["games"]["total"], 2)
        self.assertEqual(data["games"]["by_game"][0]["best"], 80)
        self.assertEqual(data["relationship"]["status"], "pending_outgoing")
        self.assertEqual(self.api.get(reverse("admin-user-detail", args=["NOPE00"])).status_code, 404)

    def test_admin_can_send_a_friend_request_through_the_ordinary_endpoint(self):
        res = self.api.post(reverse("send-friend-request"), {"public_id": self.bob.public_id}, format="json")
        self.assertEqual(res.status_code, 201)
        detail = self.api.get(reverse("admin-user-detail", args=[self.bob.public_id])).json()
        self.assertEqual(detail["relationship"]["status"], "pending_outgoing")

    def test_ban_and_unban(self):
        url = reverse("admin-user-ban", args=[self.bob.public_id])
        res = self.api.post(url, {"action": "ban"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.bob.refresh_from_db()
        self.assertIsNotNone(self.bob.banned_at)
        self.assertEqual(self.bob.ban_reason, strikes.BAN_REASON_ADMIN)
        self.assertTrue(ModerationEvent.objects.filter(user=self.bob, kind="admin", reason="ban").exists())
        self.assertEqual(self.api.post(url, {"action": "ban"}, format="json").status_code, 409)

        res = self.api.post(url, {"action": "unban"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertIsNone(res.json()["account"]["banned_at"])
        self.assertTrue(ModerationEvent.objects.filter(user=self.bob, kind="admin", reason="unban").exists())

    def test_ban_refuses_self_admins_and_bad_actions(self):
        other_admin = _user("ops@example.com", "Ops", is_staff=True)
        self.assertEqual(
            self.api.post(reverse("admin-user-ban", args=[self.admin.public_id]), {"action": "ban"}, format="json").status_code,
            400,
        )
        self.assertEqual(
            self.api.post(reverse("admin-user-ban", args=[other_admin.public_id]), {"action": "ban"}, format="json").status_code,
            403,
        )
        self.assertEqual(
            self.api.post(reverse("admin-user-ban", args=[self.bob.public_id]), {"action": "nuke"}, format="json").status_code,
            400,
        )
        self.assertEqual(
            self.api.post(reverse("admin-user-ban", args=[self.bob.public_id]), ["ban"], format="json").status_code, 400
        )

    def test_a_banned_staff_account_can_still_be_unbanned(self):
        other_admin = _user("ops@example.com", "Ops", is_staff=True)
        strikes.ban_user(other_admin, strikes.BAN_REASON_NAME)
        res = self.api.post(reverse("admin-user-ban", args=[other_admin.public_id]), {"action": "unban"}, format="json")
        self.assertEqual(res.status_code, 200)

    def test_country_filter_lists_everyone_who_played_from_it(self):
        ids = [r["public_id"] for r in self.api.get(reverse("admin-users"), {"country": "NL"}).json()["rows"]]
        self.assertEqual(ids, [self.ann.public_id])  # NL is not Ann's latest country, but she played from it


@override_settings(CACHES=LOCMEM)
class ActivityPrivacyTests(TestCase):
    def setUp(self):
        self.user = _user("p@example.com")
        DailyActivity.objects.create(user=self.user, day=cet_today(), seconds=60, country="RO", last_seen_at=timezone.now())

    def test_export_includes_activity(self):
        rows = account_data.export_account(self.user)["daily_activity"]
        self.assertEqual(rows[0]["seconds"], 60)
        self.assertEqual(rows[0]["country"], "RO")

    def test_deleting_a_banned_account_drops_its_activity(self):
        self.user.banned_at = timezone.now()
        self.user.save(update_fields=["banned_at"])
        self.assertEqual(account_data.delete_account(self.user), "anonymised")
        self.assertFalse(DailyActivity.objects.exists())

    def test_retention_drops_days_older_than_the_period(self):
        old = cet_today() - datetime.timedelta(days=retention.ACTIVITY_DAYS + 2)
        DailyActivity.objects.create(user=self.user, day=old, seconds=5, last_seen_at=timezone.now())
        self.assertEqual(retention.prune_personal_data()["daily_activity"], 1)
        self.assertEqual(DailyActivity.objects.count(), 1)
