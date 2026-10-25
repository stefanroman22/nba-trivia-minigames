"""The admin panel's question labeling (trivia.admin_questions): Tic-Tac-Toe questions listed with their board,
labeled Easy / Medium / Hard by the owner, unreviewed ones counted as hard."""
import datetime

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from trivia.models import Question, QuestionLabel, QuestionStats

User = get_user_model()

# A published board (ttt-0001): every cell has enough valid players in the live dataset.
BOARD = {
    "rows": [{"type": "team", "label": "Philadelphia 76ers", "value": "PHI"},
             {"type": "team", "label": "Toronto Raptors", "value": "TOR"},
             {"type": "team", "label": "San Antonio Spurs", "value": "SAS"}],
    "cols": [{"type": "award", "label": "NBA Champion", "value": "ring"},
             {"type": "award", "label": "Finals MVP", "value": "fmvp"},
             {"type": "award", "label": "All-NBA", "value": "allnba"}],
}
URL = "/api/admin/questions/"


class AdminQuestionsTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create_user(username="admin", email="admin@test.dev", password="x", is_staff=True)
        cls.player = User.objects.create_user(username="player", email="player@test.dev", password="x")
        cls.q1 = Question.objects.create(game="tictactoe", qid="ttt-0001", definition=BOARD, content_hash="h1",
                                         quality={"difficulty": 0.42, "band": "medium"})
        other = {**BOARD, "cols": BOARD["cols"][::-1]}
        cls.q2 = Question.objects.create(game="tictactoe", qid="ttt-0002", definition=other, content_hash="h2")
        Question.objects.create(game="tictactoe", qid="ttt-0003", definition=BOARD, content_hash="h3", status=Question.STATUS_RETIRED)
        cls.other_game = Question.objects.create(game="contexto", qid="ctx-0001", definition={"secret": 1}, content_hash="c1")
        day = datetime.date(2026, 10, 20)
        QuestionStats.objects.create(game="tictactoe", question_id="ttt-0001:4", day=day, attempts=10, correct=3)
        QuestionStats.objects.create(game="tictactoe", question_id="ttt-0001:4", day=day + datetime.timedelta(days=1), attempts=10, correct=1)
        QuestionStats.objects.create(game="tictactoe", question_id="ttt-0001:0", day=day, attempts=5, correct=5)

    def setUp(self):
        self.api = APIClient()

    def label(self, q, difficulty):
        return self.api.post(f"{URL}{q.pk}/label/", {"difficulty": difficulty}, format="json")

    def test_only_admins(self):
        self.assertIn(self.api.get(URL, {"game": "tictactoe"}).status_code, (401, 403))
        self.api.force_authenticate(self.player)
        self.assertEqual(self.api.get(URL, {"game": "tictactoe"}).status_code, 403)
        self.assertEqual(self.label(self.q1, "easy").status_code, 403)
        self.assertFalse(QuestionLabel.objects.exists())

    def test_list_defaults_every_active_question_to_hard_and_shows_the_board(self):
        self.api.force_authenticate(self.admin)
        res = self.api.get(URL, {"game": "tictactoe"})
        self.assertEqual(res.status_code, 200, res.content)
        body = res.json()
        self.assertEqual(body["counts"], {"total": 2, "reviewed": 0, "unreviewed": 2, "easy": 0, "medium": 0, "hard": 2})
        self.assertEqual([r["qid"] for r in body["rows"]], ["ttt-0001", "ttt-0002"])  # the retired board is left out
        first = body["rows"][0]
        self.assertEqual(first["label"], {"difficulty": "hard", "reviewed": False, "updated_at": None})
        self.assertEqual(first["factory"], {"band": "medium", "difficulty": 0.42})
        board = first["board"]
        self.assertIsNone(board["error"])
        self.assertEqual(board["rows"][0], "Philadelphia 76ers")
        self.assertEqual(board["cols"], ["NBA Champion", "Finals MVP", "All-NBA"])
        self.assertEqual(len(board["cells"]), 9)
        self.assertTrue(all(c["count"] >= 3 and 1 <= len(c["top"]) <= 3 for c in board["cells"]))
        # Guesses are logged per cell (`<qid>:<cell>`): cell 4 is 4 of 20 over two days, the board 9 of 25.
        self.assertEqual((board["cells"][4]["attempts"], board["cells"][4]["accuracy"]), (20, 0.2))
        self.assertEqual(first["plays"], {"attempts": 25, "correct": 9, "accuracy": 0.36})
        self.assertEqual(body["rows"][1]["plays"]["accuracy"], None)

    def test_labeling_updates_the_counts_and_the_filters(self):
        self.api.force_authenticate(self.admin)
        res = self.label(self.q1, "easy")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()["label"]["difficulty"], "easy")
        self.assertEqual(res.json()["counts"], {"total": 2, "reviewed": 1, "unreviewed": 1, "easy": 1, "medium": 0, "hard": 1})
        self.assertEqual(QuestionLabel.objects.get(question=self.q1).labeled_by, self.admin)
        self.assertEqual(self.label(self.q1, "medium").json()["counts"]["medium"], 1)  # a change, not a second label
        self.assertEqual(QuestionLabel.objects.count(), 1)
        self.label(self.q2, "hard")
        for flt, qids in (("medium", ["ttt-0001"]), ("hard", ["ttt-0002"]), ("unreviewed", []), ("easy", [])):
            self.assertEqual([r["qid"] for r in self.api.get(URL, {"game": "tictactoe", "filter": flt}).json()["rows"]], qids, flt)

    def test_search_sort_and_paging(self):
        self.api.force_authenticate(self.admin)
        self.assertEqual(self.api.get(URL, {"game": "tictactoe", "q": "raptors"}).json()["total"], 2)
        self.assertEqual(self.api.get(URL, {"game": "tictactoe", "q": "0002"}).json()["total"], 1)
        self.assertEqual(self.api.get(URL, {"game": "tictactoe", "q": "lakers"}).json()["total"], 0)
        acc = self.api.get(URL, {"game": "tictactoe", "sort": "accuracy"}).json()["rows"]
        self.assertEqual([r["qid"] for r in acc], ["ttt-0001", "ttt-0002"])  # played first, the unplayed last
        page = self.api.get(URL, {"game": "tictactoe", "limit": 1, "offset": 1}).json()
        self.assertEqual((page["total"], [r["qid"] for r in page["rows"]]), (2, ["ttt-0002"]))

    def test_bad_input_and_other_games(self):
        self.api.force_authenticate(self.admin)
        self.assertEqual(self.label(self.q1, "impossible").status_code, 400)
        self.assertEqual(self.label(self.other_game, "easy").status_code, 400)
        self.assertEqual(self.api.post(f"{URL}999999/label/", {"difficulty": "easy"}, format="json").status_code, 404)
        self.assertEqual(self.api.get(URL, {"game": "contexto"}).status_code, 400)
        self.assertEqual(self.api.get(URL, {"game": "tictactoe", "filter": "nope"}).status_code, 400)

    def test_games_overview_carries_the_counts(self):
        self.api.force_authenticate(self.admin)
        self.label(self.q1, "easy")
        games = {g["id"]: g for g in self.api.get("/api/admin/games/").json()["games"]}
        self.assertEqual(games["tictactoe"]["questions"]["total"], 2)
        self.assertEqual(games["tictactoe"]["questions"]["easy"], 1)
        self.assertIsNone(games["contexto"]["questions"])
