"""Tic-Tac-Toe difficulty rules (trivia.questions.games.tictactoe_difficulty) and the tictactoe_difficulty command,
on the live player dataset: award / draft boards are hard with their reasons, generated easy boards pass the easy
rules on all 9 pairs, and an owner label is never overwritten by a rule."""
import random
from io import StringIO

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from trivia.admin_questions import _dataset
from trivia.models import Question, QuestionLabel
from trivia.questions.games import tictactoe_difficulty as D

User = get_user_model()

HARD_BOARD = {
    "rows": [{"type": "team", "label": "Philadelphia 76ers", "value": "PHI"},
             {"type": "team", "label": "Toronto Raptors", "value": "TOR"},
             {"type": "team", "label": "San Antonio Spurs", "value": "SAS"}],
    "cols": [{"type": "award", "label": "Sixth Man", "value": "smoy"},
             {"type": "draft", "label": "Lottery pick", "value": "lottery"},
             {"type": "award", "label": "All-NBA", "value": "allnba"}],
}
BROAD = {D._key(c) for c in D.POSITIONS + D.ORIGINS + D.DECADES}


class RulesTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.ds = _dataset()

    def test_award_and_draft_columns_are_hard_with_the_reasons(self):
        band, reason = D.classify(HARD_BOARD, self.ds)
        self.assertEqual(band, "hard")
        self.assertIn("Sixth Man: an award whose rule most players don't know", reason)
        self.assertIn("Lottery pick: a draft fact", reason)

    def test_a_team_by_decade_cell_needs_a_stint_with_that_team_in_that_decade(self):
        from trivia.questions.games.tictactoe import pair_matches
        by_name = {p["full_name"]: p for p in self.ds.playable}
        era = {"type": "era", "value": "2020s", "label": "Played in the 2020s"}
        team = lambda abbr: {"type": "team", "value": abbr, "label": abbr}  # noqa: E731
        self.assertFalse(pair_matches(by_name["Kyrie Irving"], team("BOS"), era))  # Celtics 2017-19 only
        self.assertTrue(pair_matches(by_name["Kyrie Irving"], team("DAL"), era))
        self.assertTrue(pair_matches(by_name["Jayson Tatum"], era, team("BOS")))  # either order

    def test_the_rules_see_the_active_corrections(self):
        # The owner's position standard (NBA listing + Basketball-Reference, migration 0018) and Eddie Johnson's 1989
        # Sixth Man (0014) are overlaid, as the publisher does.
        from trivia.games.tictactoe import player_matches
        by_name = {p["full_name"]: p for p in self.ds.playable}
        center = {"type": "position", "value": "center", "label": "Center"}
        guard = {"type": "position", "value": "guard", "label": "Guard"}
        self.assertTrue(player_matches(by_name["Chris Bosh"], center))
        self.assertTrue(player_matches(by_name["Jayson Tatum"], guard))  # G-F: a hybrid counts for both
        self.assertFalse([p["full_name"] for p in self.ds.playable if not p.get("position")])
        self.assertIn(1989, next(p for p in self.ds.playable if p["person_id"] == 698)["awards"]["smoy"])

    def test_current_teams_are_todays_thirty(self):
        teams = D.current_teams(self.ds)
        self.assertEqual(len(teams), 30)
        self.assertIn("OKC", {t["value"] for t in teams})

    def test_generated_boards_pass_the_easy_rules_on_every_pair(self):
        boards = D.generate_easy(self.ds, set(), set(), random.Random(3), 12)
        self.assertEqual(len(boards), 12)
        current = {t["value"] for t in D.current_teams(self.ds)}
        dup_keys = set()
        for b in boards:
            self.assertEqual(D.classify(b, self.ds)[0], "easy", b)
            self.assertTrue({r["value"] for r in b["rows"]} <= current)
            groups = [D._group(c) for c in b["cols"]]
            self.assertLessEqual(groups.count("position"), 2)
            self.assertLessEqual(groups.count("origin"), 1)
            self.assertLessEqual(groups.count("decade"), 1)
            self.assertTrue(all(D._key(c) in BROAD or c["type"] == "country" for c in b["cols"]))
            dk = "|".join(sorted(D._key(c) for c in b["rows"] + b["cols"]))
            self.assertNotIn(dk, dup_keys)
            dup_keys.add(dk)


class CommandTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(username="owner", email="o@test.dev", password="x", is_staff=True)
        self.mine = Question.objects.create(game="tictactoe", qid="ttt-0001", definition=HARD_BOARD, content_hash="h1")
        self.other = Question.objects.create(game="tictactoe", qid="ttt-0002", definition={**HARD_BOARD, "cols": HARD_BOARD["cols"][::-1]}, content_hash="h2")
        QuestionLabel.objects.create(question=self.mine, difficulty="medium", source=QuestionLabel.OWNER, labeled_by=self.owner)

    def run_cmd(self, *args):
        out = StringIO()
        call_command("tictactoe_difficulty", *args, stdout=out)
        return out.getvalue()

    def test_label_rules_keeps_owner_labels(self):
        self.assertIn("hard 1", self.run_cmd("--label-rules"))
        self.assertEqual(QuestionLabel.objects.get(question=self.mine).difficulty, "medium")
        rule = QuestionLabel.objects.get(question=self.other)
        self.assertEqual((rule.difficulty, rule.source), ("hard", QuestionLabel.RULE))
        self.assertTrue(rule.reason.startswith("Hard by rule:"))

    def test_generate_easy_creates_labeled_boards_and_the_panel_counts_them(self):
        self.assertIn("3 easy board(s) as active", self.run_cmd("--generate-easy", "3", "--status", "active", "--seed", "5"))
        made = Question.objects.filter(created_by="easy-rules")
        self.assertEqual(made.count(), 3)
        self.assertEqual(sorted(made.values_list("qid", flat=True)), ["ttt-0003", "ttt-0004", "ttt-0005"])
        self.assertTrue(all(q.label.difficulty == "easy" and q.label.source == QuestionLabel.RULE for q in made))
        self.run_cmd("--label-rules")
        api = APIClient()
        api.force_authenticate(self.owner)
        counts = api.get("/api/admin/questions/", {"game": "tictactoe"}).json()["counts"]
        self.assertEqual(counts, {"total": 5, "reviewed": 1, "unreviewed": 4, "by_rule": 4, "easy": 3, "medium": 1, "hard": 1})
        # The owner confirming a rule label makes it his.
        q = made.first()
        res = api.post(f"/api/admin/questions/{q.pk}/label/", {"difficulty": "easy"}, format="json").json()
        self.assertEqual((res["label"]["source"], res["label"]["reviewed"], res["counts"]["reviewed"]), ("owner", True, 2))

    def test_dry_run_writes_nothing(self):
        self.run_cmd("--generate-easy", "2", "--label-rules", "--dry-run")
        self.assertFalse(Question.objects.filter(created_by="easy-rules").exists())
        self.assertEqual(QuestionLabel.objects.count(), 1)
