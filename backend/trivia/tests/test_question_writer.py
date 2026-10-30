"""manage.py question_writer: the prompt-driven question writer's tools (owner, 2026-10-30)."""
import json
import os
import tempfile
from io import StringIO
from unittest.mock import patch

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import SimpleTestCase, TestCase

from trivia.data_pipeline import publish_v3
from trivia.management.commands import question_writer as qw
from trivia.models import DataCorrection, Question, QuestionLabel
from trivia.questions.hashing import content_hash
from trivia.tests.questions_fixture import fixture_dataset


class MatchingMirrorTests(SimpleTestCase):
    """The mirror must judge spellings exactly as src/utils/answerMatch.ts and buildNameLookup do."""

    def setUp(self):
        self.lookup = qw.NameLookup([
            {"person_id": 1, "full_name": "Shaquille O'Neal", "aliases": ["Shaq"]},
            {"person_id": 2, "full_name": "Jaren Jackson Jr.", "aliases": []},
            {"person_id": 3, "full_name": "Gary Payton", "aliases": []},
            {"person_id": 4, "full_name": "Gary Payton II", "aliases": []},
            {"person_id": 5, "full_name": "Patrick Ewing", "aliases": []},
            {"person_id": 6, "full_name": "Patrick Ewing", "aliases": []},
        ])

    def test_normalize_drops_accents_and_punctuation_like_the_frontend(self):
        self.assertEqual(qw.normalize("  Nikola  Jokić "), "nikola jokic")
        self.assertEqual(qw.normalize("Karl-Anthony Towns"), "karlanthony towns")
        self.assertEqual(qw.normalize("A.C. Green"), "ac green")

    def test_lookup_ignores_spaces_aliases_and_a_missing_suffix(self):
        self.assertEqual(self.lookup.to_ids("Shaquille O Neal"), [1])
        self.assertEqual(self.lookup.to_ids("shaq"), [1])
        self.assertEqual(self.lookup.to_ids("Jaren Jackson"), [2])
        self.assertEqual(self.lookup.to_ids("Gary Payton"), [3, 4])  # the exact name first
        self.assertEqual(self.lookup.to_ids("Patrick Ewing"), [5, 6])  # namesakes: toId keeps the first

    def test_match_answer_is_exact_after_normalizing(self):
        answers = [{"answer": "Tim Hardaway Jr.", "aliases": []}]
        self.assertEqual(qw.match_answer("tim hardaway jr", answers), 0)
        self.assertEqual(qw.match_answer("Tim Hardaway", answers), -1)  # Career Path has no suffix fallback

    def test_player_forms_cover_what_fans_type(self):
        forms = qw.player_forms("Karl-Anthony Towns", ["KAT"], ["Big Body"])
        self.assertEqual(forms["Karl Anthony Towns"], "hyphen typed as a space")
        self.assertIn("KAT", forms)
        self.assertEqual(forms["Big Body"], "you listed it")
        self.assertIn("Tim Hardaway", qw.player_forms("Tim Hardaway Jr."))
        self.assertIn("A C Green", qw.player_forms("A.C. Green"))
        self.assertEqual(qw.player_forms("Charles R. Jones")["Charles Jones"], "middle initial left out")


class _WriterTestCase(TestCase):
    def setUp(self):
        self.ds = fixture_dataset()
        p = patch.object(publish_v3, "curated_dataset", return_value=self.ds)
        p.start()
        self.addCleanup(p.stop)
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)

    def file(self, name, data):
        path = os.path.join(self._tmp.name, name)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f)
        return path

    def run_cmd(self, *args):
        buf = StringIO()
        call_command("question_writer", *args, stdout=buf)
        return buf.getvalue()

    def live(self, game, qid, d, status=Question.STATUS_ACTIVE):
        return Question.objects.create(game=game, qid=qid, definition=d, content_hash=content_hash(d), status=status)


class CheckTests(_WriterTestCase):
    def test_a_good_proposal_passes_and_lists_what_it_accepts(self):
        path = self.file("p.json", {"game": "who-are-ya", "questions": [{"definition": {"person_id": 406}}]})
        out = self.run_cmd("check", "--game", "who-are-ya", "--file", path)
        self.assertIn("PASS", out)
        self.assertIn("accepts Shaquille O'Neal", out)

    def test_a_duplicate_of_a_live_question_fails(self):
        self.live("who-are-ya", "way-000001", {"person_id": 406})
        path = self.file("p.json", {"game": "who-are-ya", "questions": [{"definition": {"person_id": 406}}]})
        with self.assertRaises(CommandError):
            self.run_cmd("check", "--game", "who-are-ya", "--file", path)

    def test_two_proposals_for_the_same_question_fail(self):
        tick = {"definition": {"person_id": 406}}
        path = self.file("p.json", {"game": "who-are-ya", "questions": [tick, tick]})
        report = os.path.join(self._tmp.name, "r.json")
        with self.assertRaises(CommandError):
            self.run_cmd("check", "--game", "who-are-ya", "--file", path, "--report", report)
        results = json.load(open(report, encoding="utf-8"))["results"]
        self.assertTrue(results[0]["ok"])
        self.assertFalse(results[1]["ok"])

    def test_a_spelling_the_game_would_reject_fails_the_proposal(self):
        path = self.file("p.json", {"game": "who-are-ya", "questions": [
            {"definition": {"person_id": 406}, "typed_forms": {"Shaquille O'Neal": ["Big Diesel"]}}]})
        report = os.path.join(self._tmp.name, "r.json")
        with self.assertRaises(CommandError):
            self.run_cmd("check", "--game", "who-are-ya", "--file", path, "--report", report)
        [res] = json.load(open(report, encoding="utf-8"))["results"]
        self.assertEqual([r["typed"] for r in res["rejected_spellings"]], ["Big Diesel"])

    def test_the_export_is_the_duplicate_reference_when_given(self):
        export = self.file("e.json", {"game": "who-are-ya", "corrections": [], "questions": [
            {"qid": "way-000009", "status": "active", "definition": {"person_id": 406},
             "content_hash": content_hash({"person_id": 406}), "label": None}]})
        path = self.file("p.json", {"game": "who-are-ya", "questions": [{"definition": {"person_id": 406}}]})
        with self.assertRaises(CommandError):
            self.run_cmd("check", "--game", "who-are-ya", "--file", path, "--existing", export)


class ApplyTests(_WriterTestCase):
    def test_adds_a_live_question_with_its_label_and_skips_a_duplicate(self):
        self.live("who-are-ya", "way-000001", {"person_id": 17})
        path = self.file("a.json", {"game": "who-are-ya", "add": [
            {"definition": {"person_id": 406}, "difficulty": "easy", "reason": "owner guideline: a household name"},
            {"definition": {"person_id": 17}}]})
        out = self.run_cmd("apply", "--file", path, "--report", os.path.join(self._tmp.name, "r.json"))
        row = Question.objects.get(game="who-are-ya", definition={"person_id": 406})
        self.assertEqual(row.status, Question.STATUS_ACTIVE)
        self.assertEqual(row.created_by, "writer")
        self.assertEqual(row.label.difficulty, "easy")
        self.assertEqual(row.label.source, QuestionLabel.RULE)
        self.assertIn("duplicate of way-000001", out)
        self.assertEqual(Question.objects.filter(game="who-are-ya").count(), 2)

    def test_a_dry_run_keeps_nothing(self):
        path = self.file("a.json", {"game": "who-are-ya", "add": [{"definition": {"person_id": 406}}],
                                    "aliases": [{"person_id": 406, "add": ["Big Diesel"]}]})
        out = self.run_cmd("apply", "--file", path, "--dry-run", "--report", os.path.join(self._tmp.name, "r.json"))
        self.assertIn("DRY RUN", out)
        self.assertFalse(Question.objects.exists())
        self.assertFalse(DataCorrection.objects.filter(created_by="writer").exists())

    def test_labels_never_overwrite_an_owner_label(self):
        mine = self.live("tictactoe", "ttt-0001", {"rows": [], "cols": []})
        QuestionLabel.objects.create(question=mine, difficulty="easy", source=QuestionLabel.OWNER)
        other = self.live("tictactoe", "ttt-0002", {"rows": [], "cols": [1]})
        path = self.file("a.json", {"game": "tictactoe", "labels": [
            {"qid": "ttt-0001", "difficulty": "hard"}, {"qid": "ttt-0002", "difficulty": "medium", "reason": "r"}]})
        self.run_cmd("apply", "--file", path, "--report", os.path.join(self._tmp.name, "r.json"))
        mine.refresh_from_db()
        other.refresh_from_db()
        self.assertEqual(mine.label.difficulty, "easy")
        self.assertEqual((other.label.difficulty, other.label.source), ("medium", QuestionLabel.RULE))

    def test_extra_spellings_become_an_active_alias_correction(self):
        path = self.file("a.json", {"game": "who-are-ya",
                                    "aliases": [{"person_id": 406, "add": ["Big Diesel"], "reason": "fans type it"}]})
        self.run_cmd("apply", "--file", path, "--report", os.path.join(self._tmp.name, "r.json"))
        c = DataCorrection.objects.get(created_by="writer")
        self.assertEqual((c.field_path, c.status, c.created_by), ("aliases", DataCorrection.STATUS_ACTIVE, "writer"))
        self.assertIn("Big Diesel", c.new_value)


class ExportTests(_WriterTestCase):
    def test_exports_every_row_with_its_label_and_the_active_corrections(self):
        row = self.live("tictactoe", "ttt-0001", {"rows": [], "cols": []}, status=Question.STATUS_RETIRED)
        QuestionLabel.objects.create(question=row, difficulty="medium", source=QuestionLabel.RULE)
        mine = DataCorrection.objects.create(person_id=406, field_path="aliases", new_value=["Shaq", "Diesel"],
                                             status=DataCorrection.STATUS_ACTIVE)
        out = os.path.join(self._tmp.name, "x.json")
        self.run_cmd("export", "--game", "tictactoe", "--out", out)
        data = json.load(open(out, encoding="utf-8"))
        self.assertEqual(data["questions"][0]["label"]["difficulty"], "medium")
        self.assertEqual(data["questions"][0]["status"], "retired")
        self.assertEqual(data["corrections"][-1], {"id": mine.pk, "person_id": 406, "field_path": "aliases",
                                                   "new_value": ["Shaq", "Diesel"]})
        self.assertEqual(len(data["corrections"]),
                         DataCorrection.objects.filter(status=DataCorrection.STATUS_ACTIVE).count())
