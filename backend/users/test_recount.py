"""users.progression_recount: active days, Founding Member, rank and the live streak from GameSession history."""
import datetime
import io

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase

from trivia.models import GameSession
from users.progression_recount import CET, recount_progression

User = get_user_model()
TODAY = datetime.date(2026, 10, 16)
OLD = datetime.datetime(2026, 9, 1, 12, tzinfo=datetime.timezone.utc)


def _noon(day):
    return datetime.datetime.combine(day, datetime.time(12), tzinfo=CET)


class RecountTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="Baller", email="baller@example.com", password="x")
        User.objects.filter(pk=self.user.pk).update(date_joined=OLD)

    def play(self, at, score=80, mode="single", user=None):
        s = GameSession.objects.create(user=user or self.user, game="series-winner", mode=mode, score=score)
        GameSession.objects.filter(pk=s.pk).update(finished_at=at)

    def run_recount(self, today=TODAY):
        recount_progression(User, GameSession, today=today)
        return User.objects.get(pk=self.user.pk)

    def test_two_plays_either_side_of_utc_midnight_are_one_paris_day(self):
        self.play(datetime.datetime(2026, 10, 15, 23, 30, tzinfo=datetime.timezone.utc))  # 01:30 Paris, the 16th
        self.play(datetime.datetime(2026, 10, 16, 0, 30, tzinfo=datetime.timezone.utc))   # 02:30 Paris, the 16th
        user = self.run_recount()
        self.assertEqual(user.active_days, 1)
        self.assertEqual(user.last_active_day, TODAY)

    def test_friend_rooms_and_zero_scores_do_not_count(self):
        self.play(_noon(TODAY - datetime.timedelta(days=5)), mode="friend")
        self.play(_noon(TODAY - datetime.timedelta(days=4)), score=0)
        self.play(_noon(TODAY - datetime.timedelta(days=3)), mode="match")
        user = self.run_recount()
        self.assertEqual(user.active_days, 1)
        self.assertEqual(user.last_active_day, TODAY - datetime.timedelta(days=3))

    def test_founding_member_only_for_accounts_from_before_the_ladder(self):
        new = User.objects.create_user(username="Newbie", email="new@example.com", password="x")
        User.objects.filter(pk=new.pk).update(date_joined=_noon(TODAY))
        self.assertTrue(self.run_recount().founding_member)
        self.assertFalse(User.objects.get(pk=new.pk).founding_member)

    def test_rank_follows_the_new_ladder(self):
        User.objects.filter(pk=self.user.pk).update(points=6_000, rank="GOAT")
        self.play(_noon(TODAY))
        # 6,000 points but one active day: Starter needs 3 days, so Sixth Man.
        self.assertEqual(self.run_recount().rank, "Sixth Man")

    def test_a_player_active_yesterday_has_a_live_streak(self):
        self.play(_noon(TODAY - datetime.timedelta(days=1)))
        user = self.run_recount()
        self.assertEqual((user.streak_days, user.streak_best), (1, 1))

    def test_an_older_last_day_leaves_the_streak_alone(self):
        self.play(_noon(TODAY - datetime.timedelta(days=2)))
        user = self.run_recount()
        self.assertEqual((user.streak_days, user.streak_best), (0, 0))

    def test_a_rerun_keeps_a_streak_already_running(self):
        self.play(_noon(TODAY))
        User.objects.filter(pk=self.user.pk).update(streak_days=4, streak_best=6)
        user = self.run_recount()
        self.assertEqual((user.streak_days, user.streak_best), (4, 6))

    def test_the_command_runs_the_recount(self):
        self.play(_noon(TODAY))
        call_command("recount_progression", stdout=io.StringIO())
        self.assertEqual(User.objects.get(pk=self.user.pk).active_days, 1)
