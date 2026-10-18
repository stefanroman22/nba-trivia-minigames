"""Everything between a finished game's score and the points on the account (spec §2).

Day boundaries are Europe/Paris; tests pin `cet_today` so they don't depend on the wall clock.
"""
import datetime
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase

from trivia import awarding
from trivia.models import GameSession
from trivia.wordle_daily import CET

User = get_user_model()
DAY = datetime.date(2026, 10, 16)  # a Friday


def _user(**kw):
    return User.objects.create_user(username="Baller", email="baller@example.com", password="x", **kw)


def _at(day):
    """Noon Paris on `day`, in UTC: the clock a play on that day is stamped with."""
    return datetime.datetime.combine(day, datetime.time(12), tzinfo=CET).astimezone(datetime.timezone.utc)


class CapTests(SimpleTestCase):
    def test_every_public_game_has_its_own_ceiling(self):
        self.assertEqual(awarding.cap_for("series-winner", "single"), 100)
        self.assertEqual(awarding.cap_for("starting-five", "single"), 150)
        self.assertEqual(awarding.cap_for("career-path", "single"), 200)
        self.assertEqual(awarding.cap_for("wordle", "single"), 500)
        self.assertEqual(awarding.cap_for("who-would-win", "single"), 100)
        self.assertEqual(awarding.cap_for("tictactoe", "match"), 200)

    def test_online_wordle_pays_less(self):
        self.assertEqual(awarding.cap_for("wordle", "match"), 200)

    def test_unknown_game_gets_the_default(self):
        self.assertEqual(awarding.cap_for("not-a-game", "single"), awarding.DEFAULT_MAX_POINTS)

    def test_clamp(self):
        self.assertEqual(awarding.clamp_score("wordle", "single", 10**9), 500)
        self.assertEqual(awarding.clamp_score("wordle", "single", -5), 0)
        self.assertEqual(awarding.clamp_score("wordle", "single", "lots"), 0)
        self.assertEqual(awarding.clamp_score("wordle", "single", "250"), 250)


class SoftCapTests(SimpleTestCase):
    def test_first_1500_count_in_full(self):
        self.assertEqual(awarding.soft_capped(500, 0), 500)
        self.assertEqual(awarding.soft_capped(500, 1_000), 500)

    def test_next_1500_count_half(self):
        self.assertEqual(awarding.soft_capped(500, 1_600), 250)
        # Straddles the boundary: 300 full + 200 half.
        self.assertEqual(awarding.soft_capped(500, 1_200), 400)

    def test_beyond_3000_counts_a_tenth(self):
        self.assertEqual(awarding.soft_capped(500, 3_000), 50)
        self.assertEqual(awarding.soft_capped(500, 10_000), 50)
        # Straddles both boundaries: 200 full + 1500 half + 300 tenth.
        self.assertEqual(awarding.soft_capped(2_000, 1_300), 200 + 750 + 30)


class DayTests(SimpleTestCase):
    def test_day_and_week_start_are_paris_midnight(self):
        start = awarding.day_start_utc(DAY)
        self.assertEqual(start.isoformat(), "2026-10-15T22:00:00+00:00")  # CEST = UTC+2
        self.assertEqual(awarding.week_start_utc(DAY).isoformat(), "2026-10-11T22:00:00+00:00")  # Monday the 12th


@patch("trivia.awarding.cet_today", return_value=DAY)
class AwardTests(TestCase):
    def setUp(self):
        self.user = _user()
        # finished_at follows the mocked day (the class patch on cet_today), not the wall clock.
        self.clock = patch("django.utils.timezone.now", side_effect=lambda: _at(awarding.cet_today()))
        self.clock.start()

    def tearDown(self):
        self.clock.stop()

    def receipt(self, score, game="series-winner", mode="single"):
        return awarding.award(User.objects.get(pk=self.user.pk), game, mode, score, 5_000)

    def test_first_scoring_game_of_the_day_gets_the_bonus(self, _):
        r = self.receipt(80)
        self.assertEqual(r["first_game_bonus"], 100)
        self.assertEqual(r["awarded"], 180)
        self.assertEqual(r["points"], 180)
        self.assertEqual(GameSession.objects.get().awarded, 180)
        r2 = self.receipt(80)
        self.assertEqual(r2["first_game_bonus"], 0)
        self.assertEqual(r2["awarded"], 80)

    def test_zero_score_counts_for_nothing(self, _):
        r = self.receipt(0)
        self.assertEqual(r["awarded"], 0)
        self.assertEqual(r["first_game_bonus"], 0)
        user = User.objects.get(pk=self.user.pk)
        self.assertEqual((user.points, user.active_days, user.streak_days), (0, 0, 0))
        self.assertEqual(GameSession.objects.count(), 1)  # still logged
        # The bonus is still waiting for the first game that scores.
        self.assertEqual(self.receipt(50)["first_game_bonus"], 100)

    def test_daily_soft_cap_applies_to_game_points_only(self, _):
        self.receipt(500, game="wordle")          # 500 + 100 bonus
        self.receipt(500, game="heatmap")         # 1,000 earned so far (solo Wordle scores once a day)
        self.receipt(500, game="pack-five")       # 1,500
        r = self.receipt(500, game="connections")  # earned_today 1,500 -> half
        self.assertEqual(r["base"], 250)
        self.assertEqual(r["awarded"], 250)
        self.assertEqual(User.objects.get(pk=self.user.pk).points, 100 + 1_500 + 250)

    def test_first_day_counts_as_active_and_starts_the_streak(self, _):
        self.receipt(80)
        user = User.objects.get(pk=self.user.pk)
        self.assertEqual((user.active_days, user.streak_days, user.streak_best, user.last_active_day), (1, 1, 1, DAY))

    def test_consecutive_days_extend_the_streak(self, today):
        self.receipt(80)
        today.return_value = DAY + datetime.timedelta(days=1)
        self.receipt(80)
        user = User.objects.get(pk=self.user.pk)
        self.assertEqual((user.active_days, user.streak_days), (2, 2))

    def test_missed_day_uses_the_freeze_then_breaks(self, today):
        self.receipt(80)
        today.return_value = DAY + datetime.timedelta(days=2)   # skipped the 17th
        self.receipt(80)
        user = User.objects.get(pk=self.user.pk)
        self.assertEqual((user.streak_days, user.streak_freezes), (2, 0))
        today.return_value = DAY + datetime.timedelta(days=4)   # skipped the 19th, no freeze left
        self.receipt(80)
        user = User.objects.get(pk=self.user.pk)
        self.assertEqual((user.streak_days, user.streak_best, user.active_days), (1, 2, 3))

    def test_day_seven_pays_the_milestone_and_refills_the_freeze(self, today):
        User.objects.filter(pk=self.user.pk).update(streak_freezes=0)
        for i in range(6):
            today.return_value = DAY + datetime.timedelta(days=i)
            self.receipt(80)
        today.return_value = DAY + datetime.timedelta(days=6)
        r = self.receipt(80)
        self.assertEqual(r["streak_bonus"], 200)
        self.assertEqual(r["streak"]["days"], 7)
        self.assertEqual(r["streak"]["freezes"], 1)
        self.assertEqual(r["awarded"], 80 + 100 + 200)

    def test_rank_up_is_reported_once(self, _):
        r = self.receipt(100)   # 100 + 100 bonus = 200 -> Role Player
        self.assertEqual(r["rank_up"], {"from": "Rookie", "to": "Role Player"})
        self.assertEqual(r["rank"], "Role Player")
        self.assertEqual(r["progress"]["next_rank"], "Sixth Man")
        self.assertIsNone(self.receipt(50)["rank_up"])

    def test_a_demotion_from_an_old_ladder_rank_is_not_a_rank_up(self, _):
        # The old backend (same database) still writes old-ladder ranks during the deploy window.
        User.objects.filter(pk=self.user.pk).update(rank="All-Star", points=700)
        r = self.receipt(50)   # 700 + 50 + 100 bonus = 850: Sixth Man on the new ladder, below All-Star
        self.assertEqual(r["rank"], "Sixth Man")
        self.assertIsNone(r["rank_up"])

    def test_a_second_solo_wordle_of_the_day_scores_nothing(self, _):
        self.receipt(400, game="wordle")
        before = User.objects.get(pk=self.user.pk)
        r = self.receipt(500, game="wordle")
        self.assertEqual((r["awarded"], r["base"], r["first_game_bonus"], r["streak_bonus"]), (0, 0, 0, 0))
        user = User.objects.get(pk=self.user.pk)
        self.assertEqual(user.points, before.points)
        self.assertEqual((user.active_days, user.streak_days), (before.active_days, before.streak_days))
        self.assertEqual(GameSession.objects.filter(game="wordle").count(), 2)  # still logged
        # Other games and online Wordle still score.
        self.assertEqual(self.receipt(80)["awarded"], 80)
        self.assertEqual(self.receipt(150, game="wordle", mode="match")["awarded"], 150)

    def test_a_zero_wordle_does_not_use_up_the_day(self, _):
        self.receipt(0, game="wordle")
        self.assertEqual(self.receipt(300, game="wordle")["base"], 300)

    def test_a_second_solo_contexto_of_the_day_scores_nothing(self, _):
        self.receipt(200, game="contexto")
        before = User.objects.get(pk=self.user.pk)
        r = self.receipt(150, game="contexto")
        self.assertEqual((r["awarded"], r["base"], r["first_game_bonus"], r["streak_bonus"]), (0, 0, 0, 0))
        self.assertEqual(User.objects.get(pk=self.user.pk).points, before.points)
        self.assertEqual(GameSession.objects.filter(game="contexto").count(), 2)  # still logged
        # Solo Wordle has its own daily play; online Contexto has no lock.
        self.assertEqual(self.receipt(300, game="wordle")["base"], 300)
        self.assertEqual(self.receipt(120, game="contexto", mode="match")["awarded"], 120)

    def test_a_zero_contexto_does_not_use_up_the_day(self, _):
        self.receipt(0, game="contexto")
        self.assertEqual(self.receipt(200, game="contexto")["base"], 200)

    def test_contexto_scores_again_the_next_day(self, today):
        self.receipt(200, game="contexto")
        today.return_value = DAY + datetime.timedelta(days=1)
        self.assertEqual(self.receipt(180, game="contexto")["base"], 180)

    def test_day_is_paris_not_utc(self, today):
        """Two plays on the same Paris day either side of UTC midnight share one day."""
        early = datetime.datetime(2026, 10, 15, 23, 30, tzinfo=datetime.timezone.utc)   # 01:30 Paris, the 16th
        late = datetime.datetime(2026, 10, 16, 0, 30, tzinfo=datetime.timezone.utc)
        with patch("django.utils.timezone.now", return_value=early):
            self.receipt(80)
        with patch("django.utils.timezone.now", return_value=late):
            r = self.receipt(80)
        self.assertEqual(r["first_game_bonus"], 0)
        self.assertEqual(User.objects.get(pk=self.user.pk).active_days, 1)


class StreakAliveTests(SimpleTestCase):
    def _user(self, last, freezes=1):
        return User(last_active_day=last, streak_freezes=freezes)

    def test_today_and_yesterday_are_alive(self):
        self.assertTrue(awarding.streak_alive(self._user(DAY), DAY))
        self.assertTrue(awarding.streak_alive(self._user(DAY - datetime.timedelta(days=1)), DAY))

    def test_two_days_ago_needs_a_freeze(self):
        two = DAY - datetime.timedelta(days=2)
        self.assertTrue(awarding.streak_alive(self._user(two, freezes=1), DAY))
        self.assertFalse(awarding.streak_alive(self._user(two, freezes=0), DAY))

    def test_older_or_never_is_dead(self):
        self.assertFalse(awarding.streak_alive(self._user(DAY - datetime.timedelta(days=3)), DAY))
        self.assertFalse(awarding.streak_alive(self._user(None), DAY))
