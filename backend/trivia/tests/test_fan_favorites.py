import json
import os

from django.conf import settings
from django.test import TestCase
from django.urls import reverse

from trivia.data_pipeline.validate import validate_pool
from trivia.models import FanFavoritesQuestion, GameSession, GuessLog
from trivia.utils.fan_favorites import (
    LIVE_STANDINGS_MIN_GUESSES,
    load_seed,
    refresh_live_standings,
)


def _answers(n=6, prefix="Player"):
    return [
        {"answer": f"{prefix} {i}", "count": 40 - i, "aliases": []} for i in range(n)
    ]


class FanFavoritesEndpointTests(TestCase):
    def test_empty_db_serves_seed_fallback(self):
        res = self.client.get(reverse("fan-favorites"))
        self.assertEqual(res.status_code, 200)
        series = res.json()["series"]
        self.assertEqual(len(series), 1)
        q = series[0]
        self.assertTrue(q["qid"])
        self.assertTrue(q["prompt"])
        self.assertGreaterEqual(len(q["answers"]), 6)
        for a in q["answers"]:
            self.assertIn("answer", a)
            self.assertIn("count", a)

    def test_db_question_is_served(self):
        FanFavoritesQuestion.objects.create(
            qid="ff-test", prompt="Name a test player", survey_date="2026-07-01",
            answers=_answers(),
        )
        res = self.client.get(reverse("fan-favorites"))
        self.assertEqual(res.status_code, 200)
        q = res.json()["series"][0]
        self.assertEqual(q["qid"], "ff-test")
        self.assertEqual(q["survey_date"], "2026-07-01")
        self.assertEqual(len(q["answers"]), 6)


class LogGuessesEndpointTests(TestCase):
    def _post(self, body):
        return self.client.post(
            reverse("log-guesses"), json.dumps(body), content_type="application/json"
        )

    def test_creates_rows(self):
        res = self._post({
            "game": "fan-favorites",
            "entries": [
                {"question_id": "ff-001", "answer": "LeBron James",
                 "correct": True, "elapsed_ms": 1200},
                {"question_id": "ff-001", "answer": "Zzz Wrong", "correct": False},
            ],
        })
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["logged"], 2)
        self.assertEqual(GuessLog.objects.count(), 2)
        row = GuessLog.objects.get(answer="LeBron James")
        self.assertTrue(row.correct)
        self.assertEqual(row.elapsed_ms, 1200)
        self.assertIsNone(row.user)

    def test_caps_entries_at_100(self):
        entries = [{"answer": f"a{i}"} for i in range(150)]
        res = self._post({"game": "wordle", "entries": entries})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["logged"], 100)
        self.assertEqual(GuessLog.objects.count(), 100)

    def test_missing_game_is_400(self):
        res = self._post({"entries": [{"answer": "x"}]})
        self.assertEqual(res.status_code, 400)
        res = self._post({"game": "", "entries": [{"answer": "x"}]})
        self.assertEqual(res.status_code, 400)

    def test_junk_entries_are_skipped_not_500(self):
        res = self._post({
            "game": "fan-favorites",
            "entries": [
                "not-a-dict", 42, None,
                {"answer": ""}, {"answer": "   "}, {"no_answer": True},
                {"answer": "Good One", "elapsed_ms": "junk"},
                {"answer": "Neg Time", "elapsed_ms": -5},
            ],
        })
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["logged"], 2)
        self.assertIsNone(GuessLog.objects.get(answer="Good One").elapsed_ms)
        self.assertIsNone(GuessLog.objects.get(answer="Neg Time").elapsed_ms)

    def test_entries_must_be_a_list(self):
        res = self._post({"game": "wordle", "entries": "nope"})
        self.assertEqual(res.status_code, 400)


class LogSessionEndpointTests(TestCase):
    def _post(self, body):
        return self.client.post(
            reverse("log-session"), json.dumps(body), content_type="application/json"
        )

    def test_creates_session(self):
        res = self._post({
            "game": "fan-favorites", "mode": "match", "score": 250,
            "duration_ms": 61_000,
        })
        self.assertEqual(res.status_code, 200)
        s = GameSession.objects.get()
        self.assertEqual(s.game, "fan-favorites")
        self.assertEqual(s.mode, "match")
        self.assertEqual(s.score, 250)
        self.assertEqual(s.duration_ms, 61_000)
        self.assertIsNone(s.user)

    def test_clamps_score_and_duration(self):
        res = self._post({
            "game": "wordle", "mode": "bogus", "score": -50,
            "duration_ms": 999_999_999_999,
        })
        self.assertEqual(res.status_code, 200)
        s = GameSession.objects.get()
        self.assertEqual(s.mode, "single")  # unknown mode falls back
        self.assertEqual(s.score, 0)
        self.assertEqual(s.duration_ms, 86_400_000)

    def test_junk_score_and_duration_default_to_zero(self):
        res = self._post({"game": "wordle", "score": "junk", "duration_ms": None})
        self.assertEqual(res.status_code, 200)
        s = GameSession.objects.get()
        self.assertEqual(s.score, 0)
        self.assertEqual(s.duration_ms, 0)

    def test_missing_game_is_400(self):
        res = self._post({"score": 100})
        self.assertEqual(res.status_code, 400)
        self.assertEqual(GameSession.objects.count(), 0)


class SeedLoaderTests(TestCase):
    def test_load_seed_returns_24_normalized_questions(self):
        seed = load_seed()
        self.assertEqual(len(seed), 24)
        for q in seed:
            self.assertTrue(q["qid"])
            self.assertTrue(q["prompt"])
            self.assertIn("survey_date", q)
            self.assertGreaterEqual(len(q["answers"]), 6)


class RefreshLiveStandingsTests(TestCase):
    def _seed_question(self):
        return FanFavoritesQuestion.objects.create(
            qid="ff-live", prompt="Name a live player", answers=_answers(),
        )

    def _log(self, answer, n):
        GuessLog.objects.bulk_create([
            GuessLog(game="fan-favorites", question_id="ff-live",
                     answer=answer, correct=True)
            for _ in range(n)
        ])

    def test_reranks_once_threshold_reached(self):
        q = self._seed_question()
        # Skew the guesses hard toward the last-ranked seed answer.
        self._log("Player 5", 400)
        self._log("Player 0", 100)
        self.assertGreaterEqual(GuessLog.objects.count(), LIVE_STANDINGS_MIN_GUESSES)
        updated = refresh_live_standings()
        self.assertEqual(updated, 1)
        q.refresh_from_db()
        self.assertEqual(q.answers[0]["answer"], "Player 5")
        self.assertEqual(q.answers[0]["count"], 80)  # 400/500 -> /100 scale
        self.assertEqual(q.answers[1]["answer"], "Player 0")
        self.assertEqual(q.answers[1]["count"], 20)

    def test_below_threshold_is_untouched(self):
        q = self._seed_question()
        before = q.answers
        self._log("Player 5", LIVE_STANDINGS_MIN_GUESSES - 1)
        updated = refresh_live_standings()
        self.assertEqual(updated, 0)
        q.refresh_from_db()
        self.assertEqual(q.answers, before)

    def test_only_correct_guesses_count(self):
        q = self._seed_question()
        before = q.answers
        GuessLog.objects.bulk_create([
            GuessLog(game="fan-favorites", question_id="ff-live",
                     answer="Player 5", correct=False)
            for _ in range(LIVE_STANDINGS_MIN_GUESSES)
        ])
        self.assertEqual(refresh_live_standings(), 0)
        q.refresh_from_db()
        self.assertEqual(q.answers, before)


class FanFavoritesValidateTests(TestCase):
    def test_bundled_pool_is_valid(self):
        path = os.path.join(
            settings.BASE_DIR, "trivia", "data", "fan-favorites.json"
        )
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        self.assertEqual(validate_pool("fan-favorites", data), [])

    def test_five_answers_is_rejected(self):
        bad = [{"qid": "ff-bad", "prompt": "Name someone", "answers": _answers(5)}]
        self.assertTrue(validate_pool("fan-favorites", bad))

    def test_missing_qid_is_rejected(self):
        bad = [{"prompt": "Name someone", "answers": _answers()}]
        self.assertTrue(validate_pool("fan-favorites", bad))
