"""Nightly roll-ups of GuessLog / GameSession into the anonymous stats tables (spec §4.7)."""
import datetime
from io import StringIO
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase

from trivia.models import (
    FactoryRun, GameDailyStats, GameSession, GuessLog, QuestionStats, RollupWatermark, WrongAnswerStats,
)
from trivia.questions import rollup
from trivia.questions.journal import Journal
from trivia.utils.text_utils import normalize_answer

User = get_user_model()
UTC = datetime.timezone.utc
DAY = datetime.date(2026, 10, 14)


def at(day=DAY, hour=12):
    return datetime.datetime.combine(day, datetime.time(hour), tzinfo=UTC)


NOW = at(DAY + datetime.timedelta(days=2))


def guess(answer="x", correct=False, user=None, elapsed=None, game="career-path", qid="cp-1", when=None):
    row = GuessLog.objects.create(user=user, game=game, question_id=qid, answer=answer,
                                  correct=correct, elapsed_ms=elapsed)
    GuessLog.objects.filter(pk=row.pk).update(created_at=when or at())  # created_at is auto_now_add
    return row


def session(user=None, game="career-path", mode="single", when=None):
    row = GameSession.objects.create(user=user, game=game, mode=mode, score=10, duration_ms=1000)
    GameSession.objects.filter(pk=row.pk).update(finished_at=when or at())
    return row


def snapshot(model):
    return sorted(model.objects.values_list(*[f.name for f in model._meta.fields if f.name != "id"]))


class RollupTestCase(TestCase):
    def setUp(self):
        self.ann = User.objects.create_user(username="Ann", email="ann@example.com", password="Str0ng!Passw0rd")
        self.bob = User.objects.create_user(username="Bob", email="bob@example.com", password="Str0ng!Passw0rd")

    def roll(self, batch=5000, now=None):
        journal = Journal("rollup")
        return rollup.run(journal, batch=batch, now=now or NOW), journal


class NormalizeAnswerTests(TestCase):
    def test_twin_of_the_client_normalize_answer(self):
        self.assertEqual(normalize_answer("  Kareem  Abdul-Jabbar "), "kareem abduljabbar")
        self.assertEqual(normalize_answer("Nikola Jokić"), "nikola jokic")
        self.assertEqual(normalize_answer("D’Angelo Russell, Jr."), "dangelo russell jr")
        self.assertEqual(normalize_answer("..."), "")


class QuestionStatsTests(RollupTestCase):
    def test_three_rows_are_counted(self):
        guess("LeBron James", correct=True, user=self.ann, elapsed=1000)
        guess("Kobe", user=self.bob, elapsed=3000)
        guess("Kobe", elapsed=2000)
        totals, _ = self.roll()
        s = QuestionStats.objects.get()
        self.assertEqual((s.game, s.question_id, s.day), ("career-path", "cp-1", DAY))
        self.assertEqual((s.attempts, s.correct, s.skips), (3, 1, 0))
        self.assertEqual((s.time_ms_sum, s.time_ms_p50), (6000, 2000))
        self.assertEqual(s.time_sample, [1000, 2000, 3000])
        self.assertEqual(s.players, 3)  # Ann, Bob, one anonymous guest
        self.assertEqual(totals["answers"], 3)

    def test_rerun_adds_nothing(self):
        guess("LeBron James", correct=True, user=self.ann, elapsed=1000)
        guess("Kobe", user=self.bob, elapsed=3000)
        guess("Kobe", elapsed=2000)
        session(user=self.ann)
        self.roll()
        before = [snapshot(m) for m in (QuestionStats, WrongAnswerStats, GameDailyStats)]
        totals, journal = self.roll()
        self.assertEqual([snapshot(m) for m in (QuestionStats, WrongAnswerStats, GameDailyStats)], before)
        self.assertEqual((totals["answers"], totals["plays"]), (0, 0))
        self.assertEqual(journal.events, [])

    def test_batch_boundary_counts_every_row_and_moves_the_watermark(self):
        rows = [guess(f"wrong {i}", user=self.ann if i % 2 else None, elapsed=100 * (i + 1)) for i in range(7)]
        totals, journal = self.roll(batch=3)
        s = QuestionStats.objects.get()
        self.assertEqual(s.attempts, 7)
        self.assertEqual(s.time_ms_sum, sum(100 * (i + 1) for i in range(7)))
        self.assertEqual(s.time_ms_p50, 400)
        self.assertEqual(s.players, 2)  # Ann once across three batches, plus the guest once
        self.assertEqual(RollupWatermark.objects.get(name="guess_log").last_id, rows[-1].pk)
        counted = [e for e in journal.events if e["reason"] == "guess_log"]
        self.assertEqual([e["detail"]["rows"] for e in counted], [3, 3, 1])
        self.assertEqual(totals["answers"], 7)

    def test_new_rows_merge_into_the_same_day(self):
        guess("a", correct=True, user=self.ann, elapsed=1000)
        self.roll()
        guess("b", user=self.ann, elapsed=5000)
        guess("c", user=self.bob, elapsed=3000)
        self.roll()
        s = QuestionStats.objects.get()
        self.assertEqual((s.attempts, s.correct, s.time_ms_sum, s.time_ms_p50), (3, 1, 9000, 3000))
        self.assertEqual(s.players, 2)

    def test_days_and_questions_are_separate_rows(self):
        guess("a", qid="cp-1", when=at(DAY))
        guess("a", qid="cp-1", when=at(DAY + datetime.timedelta(days=1), hour=0))
        guess("a", qid="cp-2", when=at(DAY))
        self.roll()
        self.assertEqual(sorted(QuestionStats.objects.values_list("question_id", "day", "attempts")),
                         [("cp-1", DAY, 1), ("cp-1", DAY + datetime.timedelta(days=1), 1), ("cp-2", DAY, 1)])

    def test_time_sample_is_capped_and_p50_follows_it(self):
        for i in range(250):
            guess("x", elapsed=i)
        self.roll(batch=100)
        s = QuestionStats.objects.get()
        self.assertEqual(len(s.time_sample), rollup.SAMPLE_CAP)
        self.assertEqual(s.time_sample, sorted(s.time_sample))
        self.assertEqual(s.time_ms_sum, sum(range(250)))
        self.assertLessEqual(abs(s.time_ms_p50 - 124), 10)

    def test_p50_merge_weights_the_stored_sample_by_the_rows_it_stands_for(self):
        QuestionStats.objects.create(game="career-path", question_id="cp-1", day=DAY, attempts=4800,
                                     time_ms_sum=4800 * 10_000, time_ms_p50=10_000,
                                     time_sample=list(range(9_900, 10_100)), players=100)
        for i in range(250):  # few rows next to 4800, but more than the 200 stored values
            guess("x", elapsed=900 + i)
        self.roll()
        s = QuestionStats.objects.get()
        self.assertEqual(s.attempts, 5050)
        self.assertEqual(len(s.time_sample), rollup.SAMPLE_CAP)
        self.assertGreaterEqual(s.time_ms_p50, 9_900)

    def test_rows_newer_than_the_cutoff_wait_for_a_later_run(self):
        now = at(hour=12)
        old = guess("a", when=at(hour=11))
        fresh = guess("b", when=now - datetime.timedelta(minutes=5))
        self.roll(now=now)
        self.assertEqual(QuestionStats.objects.get().attempts, 1)
        mark = RollupWatermark.objects.get(name="guess_log").last_id
        self.assertEqual(mark, old.pk)
        self.assertLess(mark, fresh.pk)
        self.roll(now=at(hour=13))
        self.assertEqual(QuestionStats.objects.get().attempts, 2)
        self.assertEqual(RollupWatermark.objects.get(name="guess_log").last_id, fresh.pk)

    def test_an_older_row_behind_a_fresh_id_waits_too(self):
        now = at(hour=12)
        fresh = guess("a", when=now - datetime.timedelta(minutes=1))
        guess("b", when=at(hour=11))  # higher id, old timestamp: must not move the watermark past `fresh`
        self.roll(now=now)
        self.assertFalse(QuestionStats.objects.exists())
        self.assertLess(RollupWatermark.objects.get(name="guess_log").last_id, fresh.pk)

    def test_rows_without_time_count_but_add_no_time(self):
        guess("x", elapsed=None)
        self.roll()
        s = QuestionStats.objects.get()
        self.assertEqual((s.attempts, s.time_ms_sum, s.time_ms_p50, s.time_sample), (1, 0, None, []))

    def test_an_answer_that_normalizes_to_nothing_is_a_skip(self):
        guess("...")
        self.roll()
        self.assertEqual(QuestionStats.objects.get().skips, 1)
        self.assertFalse(WrongAnswerStats.objects.exists())


class WrongAnswerStatsTests(RollupTestCase):
    def test_wrong_answers_are_normalized_and_merged(self):
        guess("Le-Bron  James", user=self.ann, when=at(hour=9))
        guess("lebron james", user=self.bob, when=at(hour=10))
        guess("LeBron James", correct=True, user=self.ann)  # right answers are not wrong-answer stats
        self.roll()
        w = WrongAnswerStats.objects.get()
        self.assertEqual((w.answer_norm, w.count, w.players), ("lebron james", 2, 2))
        self.assertEqual((w.first_seen, w.last_seen), (at(hour=9), at(hour=10)))
        later = DAY + datetime.timedelta(days=1)
        guess("LEBRON JAMES.", user=self.ann, when=at(later))
        self.roll()
        w.refresh_from_db()
        self.assertEqual((w.count, w.players), (3, 2))  # Ann again: no new player
        self.assertEqual((w.first_seen, w.last_seen), (at(hour=9), at(later)))

    def test_guests_count_once_per_day(self):
        guess("kobe", when=at(hour=9))
        guess("kobe", when=at(hour=10))
        guess("kobe", when=at(DAY + datetime.timedelta(days=1)))
        self.roll(batch=1)
        self.assertEqual(WrongAnswerStats.objects.get().players, 2)


class PlayersTests(RollupTestCase):
    def test_guests_vs_users(self):
        guess("a", user=self.ann)
        guess("b", user=self.ann)
        guess("c", user=self.bob)
        guess("d")
        guess("e")
        self.roll(batch=2)
        self.assertEqual(QuestionStats.objects.get().players, 3)  # Ann, Bob, and the guests as one


class GameDailyStatsTests(RollupTestCase):
    def test_sessions_roll_into_game_daily_stats(self):
        session(user=self.ann)
        session(user=self.ann)
        session(user=self.bob)
        session()
        session()
        session(mode="match", user=self.ann)
        session(game="contexto", user=self.bob, when=at(DAY + datetime.timedelta(days=1)))
        totals, journal = self.roll(batch=2)
        rows = sorted(GameDailyStats.objects.values_list("game", "day", "mode", "plays", "players"))
        self.assertEqual(rows, [
            ("career-path", DAY, "match", 1, 1),
            ("career-path", DAY, "single", 5, 3),
            ("contexto", DAY + datetime.timedelta(days=1), "single", 1, 1),
        ])
        self.assertEqual(RollupWatermark.objects.get(name="game_session").last_id,
                         GameSession.objects.order_by("-id").first().pk)
        self.assertEqual(totals["plays"], 7)
        self.assertEqual([e["detail"]["rows"] for e in journal.events if e["reason"] == "game_session"], [2, 2, 2, 1])

    def test_sessions_newer_than_the_cutoff_wait_for_a_later_run(self):
        now = at(hour=12)
        session(user=self.ann, when=at(hour=11))
        fresh = session(user=self.bob, when=now - datetime.timedelta(minutes=5))
        self.roll(now=now)
        self.assertEqual(GameDailyStats.objects.get().plays, 1)
        self.assertLess(RollupWatermark.objects.get(name="game_session").last_id, fresh.pk)
        self.roll(now=at(hour=13))
        self.assertEqual((GameDailyStats.objects.get().plays, GameDailyStats.objects.get().players), (2, 2))


class CommandTests(RollupTestCase):
    def test_command_journals_a_rollup_run(self):
        guess("a", user=self.ann)
        session(user=self.ann)
        out = StringIO()
        call_command("rollup_answers", "--batch", "10", stdout=out)
        run = FactoryRun.objects.get()
        self.assertEqual((run.kind, run.status), ("rollup", "ok"))
        self.assertEqual(sorted(run.events.values_list("action", "reason")),
                         [("counted", "game_session"), ("counted", "guess_log")])
        self.assertIn("1 answers", out.getvalue())

    def test_a_failed_run_is_journaled_and_rolls_back_its_batch(self):
        guess("a", user=self.ann)
        with mock.patch.object(rollup, "_fold_wrong_answers", side_effect=RuntimeError("boom")):
            with self.assertRaises(RuntimeError):
                call_command("rollup_answers", stdout=StringIO())
        self.assertEqual(FactoryRun.objects.get().status, "failed")
        self.assertFalse(QuestionStats.objects.exists())
        self.assertEqual(RollupWatermark.objects.filter(name="guess_log", last_id__gt=0).count(), 0)
