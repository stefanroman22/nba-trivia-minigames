import datetime
from types import SimpleNamespace
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from trivia.models import GameDailyStats, GameSession, Question, SeenQuestion
from trivia.questions import demand
from trivia.questions.games import career_path, contexto, imposter, tictactoe, who_are_ya
from trivia.tests.questions_fixture import fixture_dataset

NOW = timezone.now()  # sessions are stamped with the real clock (auto_now_add)
User = get_user_model()
DS = SimpleNamespace(playable=[])  # the fake modules' capacity() ignores it


def stats(game, plays_per_day, days=14, mode="single", now=NOW):
    for i in range(1, days + 1):
        GameDailyStats.objects.create(game=game, day=now.date() - datetime.timedelta(days=i), mode=mode,
                                      plays=plays_per_day, players=1)


def fake_mod(target=None, minimum=10, capacity="absent"):
    mod = SimpleNamespace(TARGET=target, MINIMUM=minimum)
    if capacity != "absent":
        mod.capacity = lambda dataset: capacity
    return mod


class TargetForTests(TestCase):
    def test_no_stats_keeps_the_static_target(self):
        target, detail = demand.target_for("career-path", career_path, NOW)
        self.assertEqual(target, career_path.TARGET)
        self.assertEqual(detail["mode"], "static")

    def test_stats_older_than_14_days_are_ignored(self):
        GameDailyStats.objects.create(game="career-path", day=NOW.date() - datetime.timedelta(days=15),
                                      mode="single", plays=500, players=9)
        target, detail = demand.target_for("career-path", career_path, NOW)
        self.assertEqual((target, detail["mode"]), (career_path.TARGET, "static"))

    def test_demand_is_clamped_to_capacity(self):
        # 20 plays a day x 10 rounds a play x 90 days of runway = 18,000 questions wanted.
        stats("who-would-win", 12)
        stats("who-would-win", 8, mode="match")
        target, detail = demand.target_for("who-would-win", fake_mod(capacity=400), NOW, DS)
        self.assertEqual(target, 400)
        self.assertEqual((detail["mode"], detail["demand"], detail["capacity"]), ("demand", 18000, 400))
        self.assertEqual(detail["plays_14d"], 280)
        self.assertTrue(detail["capacity_bound"])

    def test_no_capacity_means_no_clamp(self):
        stats("who-would-win", 20)
        target, detail = demand.target_for("who-would-win", fake_mod(), NOW)
        self.assertEqual(target, 18000)
        self.assertNotIn("capacity_bound", detail)
        target, _ = demand.target_for("who-would-win", fake_mod(capacity=None), NOW, DS)
        self.assertEqual(target, 18000)

    def test_below_minimum_clamps_up(self):
        stats("career-path", 1, days=1)  # 1 play in 14 days -> ceil(1/14 x 90) = 7
        target, detail = demand.target_for("career-path", fake_mod(target=500, minimum=50), NOW)
        self.assertEqual((target, detail["demand"]), (50, 7))

    def test_runway_comes_from_the_spec(self):
        stats("career-path", 14)  # 1 a day x 1 round
        with mock.patch.object(demand.specs, "load", return_value={"refill": {"runway_days": 30}}):
            target, detail = demand.target_for("career-path", fake_mod(minimum=0), NOW)
        self.assertEqual((target, detail["runway_days"]), (14 * 30, 30))

    def test_contexto_keeps_its_days_ahead_target(self):
        stats("contexto", 50)
        target, detail = demand.target_for("contexto", contexto, NOW)
        self.assertEqual((target, detail), (contexto.TARGET, {"mode": "days_ahead"}))

    def test_hidden_games_keep_static_targets(self):
        stats("imposter", 50)
        target, detail = demand.target_for("imposter", imposter, NOW)
        self.assertEqual((target, detail), (imposter.TARGET, {"mode": "static"}))


class SaturationTests(TestCase):
    """20% of the last 14 days' players have seen 70% of the active pool -> target >= active x 1.5."""

    def setUp(self):
        self.qids = [f"cp-{i:06d}" for i in range(10)]
        for qid in self.qids:
            Question.objects.create(game="career-path", qid=qid, definition={"q": qid}, content_hash=qid,
                                    status="active")
        Question.objects.create(game="career-path", qid="cp-retired", definition={"q": "r"}, content_hash="r",
                                status="retired")
        stats("career-path", 1, days=1)  # demand ceil(1/14 x 90) = 7

    def _players(self, n, saturated):
        for i in range(n):
            user = User.objects.create(username=f"p{i}", email=f"p{i}@example.com")
            GameSession.objects.create(user=user, game="career-path", mode="single")
            seen = self.qids[:7] if i < saturated else self.qids[:6] + ["cp-retired"]
            SeenQuestion.objects.bulk_create(SeenQuestion(user=user, game="career-path", qid=q) for q in seen)

    def test_share_counts_recent_players_who_saw_70_percent(self):
        self._players(4, saturated=1)
        # Not a recent player: his old session puts him outside the denominator and numerator.
        old = User.objects.create(username="old", email="old@example.com")
        s = GameSession.objects.create(user=old, game="career-path", mode="single")
        GameSession.objects.filter(pk=s.pk).update(finished_at=NOW - datetime.timedelta(days=20))
        SeenQuestion.objects.bulk_create(SeenQuestion(user=old, game="career-path", qid=q) for q in self.qids)
        self.assertEqual(demand.saturation("career-path", NOW), 0.25)

    def test_no_players_or_no_pool_is_zero(self):
        self.assertEqual(demand.saturation("career-path", NOW), 0.0)
        self.assertEqual(demand.saturation("tictactoe", NOW), 0.0)

    def test_saturation_of_a_quarter_raises_the_target_by_half(self):
        self._players(4, saturated=1)
        target, detail = demand.target_for("career-path", fake_mod(minimum=2), NOW)
        self.assertEqual(target, 15)  # ceil(10 active x 1.5), above the demand of 7
        self.assertEqual(detail["saturation"], 0.25)
        self.assertTrue(detail["saturated"])

    def test_saturation_of_a_tenth_does_not(self):
        self._players(10, saturated=1)
        target, detail = demand.target_for("career-path", fake_mod(minimum=2), NOW)
        self.assertEqual(target, 7)
        self.assertEqual(detail["saturation"], 0.1)
        self.assertNotIn("saturated", detail)

    def test_saturation_is_still_capped_by_capacity(self):
        self._players(4, saturated=1)
        target, detail = demand.target_for("career-path", fake_mod(minimum=2, capacity=12), NOW, DS)
        self.assertEqual(target, 12)
        self.assertTrue(detail["capacity_bound"])


class CapacityTests(TestCase):
    def test_capacity_is_the_eligible_pool(self):
        ds = fixture_dataset("ds-1")
        self.assertEqual(career_path.capacity(ds), sum(1 for r in ds.playable if career_path._eligible(r)))
        self.assertEqual(who_are_ya.capacity(ds), sum(1 for r in ds.playable if who_are_ya._eligible(r)))
        self.assertGreater(career_path.capacity(ds), 0)
        self.assertIsNone(tictactoe.capacity(ds))

    def test_target_for_reads_the_module_capacity(self):
        ds = fixture_dataset("ds-1")
        stats("who-are-ya", 1000)
        target, detail = demand.target_for("who-are-ya", who_are_ya, NOW, ds)
        self.assertEqual(target, who_are_ya.capacity(ds))
        self.assertTrue(detail["capacity_bound"])
