from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from trivia.models import Feedback, GameSession, GuessLog
from users import retention, strikes
from users.models import ModerationEvent

User = get_user_model()


def age(obj, days, field):
    """Backdate an auto_now_add timestamp (update() bypasses auto_now_add)."""
    type(obj).objects.filter(pk=obj.pk).update(**{field: timezone.now() - timedelta(days=days)})


class PrunePersonalDataTests(TestCase):
    def test_old_rows_go_and_recent_rows_stay(self):
        old_guess = GuessLog.objects.create(game="wordle", answer="a")
        new_guess = GuessLog.objects.create(game="wordle", answer="b")
        age(old_guess, retention.GUESS_LOG_DAYS + 1, "created_at")
        old_session = GameSession.objects.create(game="wordle")
        new_session = GameSession.objects.create(game="wordle")
        age(old_session, retention.GAME_SESSION_DAYS + 1, "finished_at")

        deleted = retention.prune_personal_data()

        self.assertEqual((deleted["guess_logs"], deleted["game_sessions"]), (1, 1))
        self.assertEqual(list(GuessLog.objects.all()), [new_guess])
        self.assertEqual(list(GameSession.objects.all()), [new_session])

    def test_a_ban_record_is_erased_after_five_years_and_not_before(self):
        recent = User.objects.create_user(username="recent", email="r@example.com", password="x")
        old = User.objects.create_user(username="old", email="o@example.com", password="x")
        for user in (recent, old):
            strikes.ban_user(user, "name_severe")
        User.objects.filter(pk=old.pk).update(banned_at=timezone.now() - timedelta(days=retention.BAN_RECORD_DAYS + 1))

        deleted = retention.prune_personal_data()

        self.assertEqual(deleted["expired_ban_records"], 1)
        self.assertEqual(list(User.objects.values_list("email", flat=True)), ["r@example.com"])

    def test_only_resolved_feedback_expires(self):
        resolved = Feedback.objects.create(rating=4, status=Feedback.RESOLVED)
        pending = Feedback.objects.create(rating=2, status=Feedback.NEW)
        for item in (resolved, pending):
            age(item, retention.RESOLVED_FEEDBACK_DAYS + 5, "created_at")
        retention.prune_personal_data()
        self.assertEqual(list(Feedback.objects.all()), [pending])

    def test_moderation_events_expire_but_a_standing_ban_keeps_its_record(self):
        free = User.objects.create_user(username="free", email="f@example.com", password="x")
        banned = User.objects.create_user(username="bad", email="b@example.com", password="x")
        strikes.ban_user(banned, "name_severe")
        stray = ModerationEvent.objects.create(user=free, public_id=free.public_id, kind="name_change", tier="mild", reason="blocked")
        signup_lock = ModerationEvent.objects.create(user=None, public_id="", kind="name_signup", tier="severe", reason="blocked", ip_hash="h")
        ban_events = list(ModerationEvent.objects.filter(public_id=banned.public_id))
        for event in [stray, signup_lock, *ban_events]:
            age(event, retention.MODERATION_EVENT_DAYS + 5, "created_at")

        retention.prune_personal_data()

        remaining = set(ModerationEvent.objects.values_list("pk", flat=True))
        self.assertNotIn(stray.pk, remaining)
        self.assertNotIn(signup_lock.pk, remaining)
        self.assertTrue(all(e.pk in remaining for e in ban_events))
