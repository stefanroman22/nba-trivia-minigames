import json

from django.test import TestCase
from django.urls import reverse

from trivia.games.who_would_win import _load_seed, validate_rows
from trivia.models import GuessLog


class SeedTests(TestCase):
    def test_seed_loads_and_validates(self):
        rows = _load_seed()
        self.assertGreaterEqual(len(rows), 30)
        self.assertEqual(validate_rows(rows), [])

    def test_validator_catches_bad_rows(self):
        bad = [
            {"qid": "www-001", "a": {"label": "X"}, "b": {"label": "Y"}},
            {"qid": "www-001", "a": {"label": ""}, "b": {"sub": "no label"}},
        ]
        problems = validate_rows(bad)
        self.assertTrue(any("duplicate qid" in p for p in problems))
        self.assertTrue(any("side 'a' needs a label" in p for p in problems))
        self.assertTrue(any("side 'b' needs a label" in p for p in problems))
        self.assertTrue(any("need >= 30" in p for p in problems))


class GetRoundTests(TestCase):
    def test_serves_ten_distinct_matchups_from_seed(self):
        res = self.client.get(reverse("who-would-win"))
        self.assertEqual(res.status_code, 200)
        series = res.json()["series"]
        self.assertEqual(len(series), 10)
        qids = [r["qid"] for r in series]
        self.assertEqual(len(set(qids)), 10)
        for r in series:
            self.assertTrue(r["a"]["label"])
            self.assertTrue(r["b"]["label"])


class TallyTests(TestCase):
    def test_requires_qid(self):
        res = self.client.get(reverse("who-would-win-tally"))
        self.assertEqual(res.status_code, 400)

    def test_groups_guesslog_by_answer_scoped_to_game_and_qid(self):
        for _ in range(3):
            GuessLog.objects.create(game="who-would-win", question_id="www-001", answer="a")
        GuessLog.objects.create(game="who-would-win", question_id="www-001", answer="b")
        # noise: other qid, other game, junk answer — all excluded
        GuessLog.objects.create(game="who-would-win", question_id="www-002", answer="a")
        GuessLog.objects.create(game="fan-favorites", question_id="www-001", answer="a")
        GuessLog.objects.create(game="who-would-win", question_id="www-001", answer="zzz")
        res = self.client.get(reverse("who-would-win-tally"), {"qid": "www-001"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), {"qid": "www-001", "a": 3, "b": 1, "total": 4})

    def test_zero_votes_returns_zeros(self):
        res = self.client.get(reverse("who-would-win-tally"), {"qid": "www-999"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), {"qid": "www-999", "a": 0, "b": 0, "total": 0})

    def test_vote_via_log_guesses_shows_up_in_tally(self):
        # end-to-end: the exact payload the renderer POSTs
        res = self.client.post(
            reverse("log-guesses"),
            json.dumps({
                "game": "who-would-win",
                "entries": [{"question_id": "www-005", "answer": "a",
                             "correct": False, "elapsed_ms": 1200}],
            }),
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 200)
        tally = self.client.get(reverse("who-would-win-tally"), {"qid": "www-005"}).json()
        self.assertEqual(tally["a"], 1)
        self.assertEqual(tally["total"], 1)
