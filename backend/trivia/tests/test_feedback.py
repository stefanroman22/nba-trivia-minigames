"""Feedback submission + the admin panel's filter/aggregate language.

The aggregates are the part worth testing: bucket gap-filling, the usage
subquery and the same-length previous window are all things that look right by
inspection and are wrong in ways only a query shows.
"""
from datetime import datetime, timedelta, timezone as dt_timezone

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework.test import APIClient

from trivia.models import Feedback, GameSession

User = get_user_model()


def _at(entry, when):
    """created_at is auto_now_add, so backdating needs a direct UPDATE."""
    Feedback.objects.filter(pk=entry.pk).update(created_at=when)
    entry.refresh_from_db()
    return entry


@override_settings(
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
)
class SubmitFeedbackTests(TestCase):
    def setUp(self):
        cache.clear()  # the throttle counter is shared across tests
        self.api = APIClient()

    def test_guest_can_submit_and_row_is_stored(self):
        res = self.api.post(
            reverse("submit-feedback"),
            {"rating": 4, "message": "More games please", "page": "/", "game": "wordle"},
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        entry = Feedback.objects.get()
        self.assertEqual(entry.rating, 4)
        self.assertEqual(entry.game, "wordle")
        self.assertIsNone(entry.user)
        self.assertEqual(entry.status, Feedback.NEW)

    def test_rating_must_be_one_to_five(self):
        for bad in (0, 6, -1, "abc"):
            res = self.api.post(
                reverse("submit-feedback"), {"rating": bad}, format="json"
            )
            self.assertEqual(res.status_code, 400, bad)
        self.assertEqual(Feedback.objects.count(), 0)

    def test_signed_in_sender_is_taken_from_the_token_not_the_body(self):
        user = User.objects.create_user(
            email="player@example.com", username="Baller", password="pw-12345"
        )
        self.api.force_authenticate(user)
        res = self.api.post(
            reverse("submit-feedback"),
            {"rating": 5, "email": "attacker@evil.test"},
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        entry = Feedback.objects.get()
        self.assertEqual(entry.user, user)
        self.assertEqual(entry.email, "player@example.com")
        self.assertEqual(entry.public_id, user.public_id)

    def test_guest_email_is_kept_only_when_it_looks_like_an_address(self):
        self.api.post(
            reverse("submit-feedback"),
            {"rating": 3, "email": "not-an-address"},
            format="json",
        )
        self.assertEqual(Feedback.objects.get().email, "")

    def test_message_is_capped(self):
        self.api.post(
            reverse("submit-feedback"),
            {"rating": 3, "message": "x" * 5000},
            format="json",
        )
        self.assertEqual(len(Feedback.objects.get().message), 2000)


@override_settings(
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
)
class AdminFeedbackApiTests(TestCase):
    def setUp(self):
        cache.clear()
        self.api = APIClient()
        self.admin = User.objects.create_user(
            email="admin@example.com", username="Admin", password="pw-12345", is_staff=True
        )
        self.player = User.objects.create_user(
            email="heavy@example.com", username="Heavy", password="pw-12345", points=900
        )
        for _ in range(12):
            GameSession.objects.create(user=self.player, game="wordle", score=10)

        now = datetime.now(dt_timezone.utc)
        # A registered heavy user, this month.
        _at(
            Feedback.objects.create(
                user=self.player,
                email=self.player.email,
                display_name=self.player.username,
                public_id=self.player.public_id,
                rating=5,
                message="Love it",
                game="wordle",
            ),
            now - timedelta(days=1),
        )
        # A guest, this month, no message.
        _at(Feedback.objects.create(rating=2, game="bingo"), now - timedelta(days=2))
        # A guest, ~4 months back - lands in a different month bucket.
        _at(Feedback.objects.create(rating=1, message="Too hard"), now - timedelta(days=120))

        self.stats_url = reverse("admin-feedback-stats")
        self.list_url = reverse("admin-feedback")

    def test_requires_staff(self):
        self.assertIn(self.api.get(self.stats_url).status_code, (401, 403))
        self.api.force_authenticate(self.player)
        self.assertEqual(self.api.get(self.stats_url).status_code, 403)

    def test_totals_and_distribution(self):
        self.api.force_authenticate(self.admin)
        data = self.api.get(self.stats_url).json()
        self.assertEqual(data["totals"]["count"], 3)
        self.assertEqual(data["totals"]["registered"], 1)
        self.assertEqual(data["totals"]["guests"], 2)
        self.assertEqual(data["totals"]["with_message"], 2)
        self.assertEqual(data["totals"]["promoters"], 1)
        self.assertEqual(data["totals"]["detractors"], 2)
        self.assertEqual(
            data["distribution"], [{"rating": r, "count": c} for r, c in zip(range(1, 6), [1, 1, 0, 0, 1])]
        )

    def test_series_has_no_gaps(self):
        """The 4-month span must yield a continuous month axis, including the
        months with no feedback at all - not just the two that have rows."""
        self.api.force_authenticate(self.admin)
        series = self.api.get(self.stats_url, {"granularity": "month"}).json()["series"]
        buckets = series["buckets"]
        self.assertEqual(series["granularity"], "month")
        self.assertGreaterEqual(len(buckets), 4)
        self.assertEqual(sum(b["count"] for b in buckets), 3)
        self.assertTrue(any(b["count"] == 0 for b in buckets), "expected an empty month on the axis")
        starts = [b["start"] for b in buckets]
        self.assertEqual(starts, sorted(starts))

    def test_usage_filter_uses_the_senders_session_count(self):
        self.api.force_authenticate(self.admin)
        heavy = self.api.get(self.list_url, {"min_sessions": 10}).json()
        self.assertEqual(heavy["total"], 1)
        self.assertEqual(heavy["rows"][0]["account"]["email"], "heavy@example.com")
        self.assertEqual(heavy["rows"][0]["sessions"], 12)
        # Guests have no account, so they sit at 0 and drop out of the filter.
        self.assertEqual(self.api.get(self.list_url, {"max_sessions": 0}).json()["total"], 2)

    def test_rating_audience_and_message_filters(self):
        self.api.force_authenticate(self.admin)
        self.assertEqual(self.api.get(self.list_url, {"rating": "1,2"}).json()["total"], 2)
        self.assertEqual(self.api.get(self.list_url, {"audience": "guest"}).json()["total"], 2)
        self.assertEqual(self.api.get(self.list_url, {"audience": "registered"}).json()["total"], 1)
        self.assertEqual(self.api.get(self.list_url, {"has_message": "true"}).json()["total"], 2)
        self.assertEqual(self.api.get(self.list_url, {"game": "wordle"}).json()["total"], 1)
        self.assertEqual(self.api.get(self.list_url, {"q": "hard"}).json()["total"], 1)

    def test_period_filter_narrows_the_window(self):
        self.api.force_authenticate(self.admin)
        self.assertEqual(self.api.get(self.stats_url, {"period": "30d"}).json()["totals"]["count"], 2)
        self.assertEqual(self.api.get(self.stats_url, {"period": "all"}).json()["totals"]["count"], 3)

    def test_stats_and_list_agree_under_the_same_filters(self):
        """The charts and the table must never disagree - same filters, same set."""
        self.api.force_authenticate(self.admin)
        params = {"rating": "1,2", "audience": "guest"}
        self.assertEqual(
            self.api.get(self.stats_url, params).json()["totals"]["count"],
            self.api.get(self.list_url, params).json()["total"],
        )

    def test_contact_details_survive_account_deletion(self):
        self.api.force_authenticate(self.admin)
        self.player.delete()
        row = next(r for r in self.api.get(self.list_url).json()["rows"] if r["snapshot"]["email"])
        self.assertIsNone(row["account"])
        self.assertTrue(row["account_deleted"])
        self.assertFalse(row["is_guest"])
        self.assertEqual(row["snapshot"]["email"], "heavy@example.com")

    def test_triage_updates_status(self):
        self.api.force_authenticate(self.admin)
        entry = Feedback.objects.first()
        res = self.api.patch(
            reverse("admin-feedback-update", args=[entry.pk]),
            {"status": "resolved"},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["row"]["status"], "resolved")
        entry.refresh_from_db()
        self.assertEqual(entry.status, Feedback.RESOLVED)

    def test_triage_rejects_an_unknown_status(self):
        self.api.force_authenticate(self.admin)
        res = self.api.patch(
            reverse("admin-feedback-update", args=[Feedback.objects.first().pk]),
            {"status": "banana"},
            format="json",
        )
        self.assertEqual(res.status_code, 400)

    def test_badge_count_ignores_the_active_filters(self):
        """`all_time.new` drives the tab badge, so a narrow filter must not
        shrink it - otherwise the badge hides work rather than surfacing it."""
        self.api.force_authenticate(self.admin)
        data = self.api.get(self.stats_url, {"rating": "5", "period": "7d"}).json()
        self.assertEqual(data["totals"]["count"], 1)
        self.assertEqual(data["all_time"]["count"], 3)
        self.assertEqual(data["all_time"]["new"], 3)

    def test_previous_window_does_not_share_the_boundary_row(self):
        """Both bounds are inclusive, so a naive previous window would count the
        current window's own first row again and invent a delta."""
        self.api.force_authenticate(self.admin)
        data = self.api.get(self.stats_url, {"period": "all"}).json()
        self.assertEqual(data["totals"]["count"], 3)
        self.assertEqual(data["previous"]["count"], 0)
        self.assertIsNone(data["previous"]["avg_rating"])

    def test_no_game_bucket_is_filterable(self):
        """Clicking "(no game)" in the by-game chart must filter to exactly the
        rows sent from a non-game screen.

        Two ways this broke before: the chart sent the display label
        ("(no game)") as the filter value instead of the stored one, and the
        stored value is "" - which is falsy, so the filter was skipped entirely
        and every row came back. Both paths are covered here.
        """
        self.api.force_authenticate(self.admin)
        stats = self.api.get(self.stats_url).json()
        rows = {r["game"]: r for r in stats["by_game"]}

        # The bucket carries a sendable value and a separate human label.
        self.assertIn("__none__", rows, f"expected a no-game bucket, got {list(rows)}")
        self.assertEqual(rows["__none__"]["label"], "(no game)")
        self.assertEqual(rows["__none__"]["count"], 1)  # the 1-star row has no game

        # Filtering by that value returns only the no-game row - not zero, not all.
        filtered = self.api.get(self.list_url, {"game": "__none__"}).json()
        self.assertEqual(filtered["total"], 1)
        self.assertEqual(filtered["rows"][0]["game"], "")
        self.assertEqual(filtered["rows"][0]["rating"], 1)

        # And the charts agree with the table under them.
        self.assertEqual(
            self.api.get(self.stats_url, {"game": "__none__"}).json()["totals"]["count"], 1
        )

    def test_named_game_filter_still_excludes_no_game_rows(self):
        self.api.force_authenticate(self.admin)
        self.assertEqual(self.api.get(self.list_url, {"game": "wordle"}).json()["total"], 1)
        self.assertEqual(self.api.get(self.list_url, {"game": ""}).json()["total"], 3)
