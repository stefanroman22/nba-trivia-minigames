"""Phase 4 Checker jobs: export pending questions as batches, apply verdicts."""
import json
import os
import random
import shutil
import tempfile
from io import StringIO
from unittest.mock import patch

from django.core.management import call_command
from django.test import TestCase

from trivia.data_pipeline import publish_v3
from trivia.models import FactoryRun, Question, QuestionLabel
from trivia.questions import checker, runner
from trivia.questions.games import GAME_MODULES
from trivia.questions.hashing import content_hash
from trivia.tests.questions_fixture import fixture_dataset

BREF = "https://www.basketball-reference.com/players/x/x01.html"


class CheckerJobsTestCase(TestCase):
    def setUp(self):
        self.ds = fixture_dataset("ds-chk")
        for p in (patch.object(publish_v3, "curated_dataset", return_value=self.ds),
                  patch("trivia.questions.games.career_path.TARGET", 3),
                  patch("trivia.questions.games.career_path.MINIMUM", 0),
                  patch("trivia.questions.games.contexto.TARGET", 3),
                  patch("trivia.questions.games.contexto.MINIMUM", 0),
                  patch("trivia.questions.games.tictactoe.TARGET", 2),
                  patch("trivia.questions.games.tictactoe.MINIMUM", 0)):
            p.start()
            self.addCleanup(p.stop)
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.tmp = self._tmp.name
        self.gh = os.path.join(self.tmp, "gh-output")
        env = patch.dict(os.environ, {"GITHUB_OUTPUT": self.gh})
        env.start()
        self.addCleanup(env.stop)

    def stage(self, games=("career-path", "contexto", "tictactoe")):
        runner.maintain(list(games), self.ds, random.Random(5), out=lambda *_: None, stage=True)

    def gh_output(self):
        with open(self.gh, encoding="utf-8") as f:
            return f.read()

    def export(self, *args):
        out = os.path.join(self.tmp, "batches")
        call_command("export_checker_batches", "--out", out, *args, stdout=StringIO())
        return out


class ExportTests(CheckerJobsTestCase):
    def _questions(self, out):
        names = sorted(n for n in os.listdir(out) if n.startswith("batch-"))
        batches = []
        for n in names:
            with open(os.path.join(out, n), encoding="utf-8") as f:
                batches.append(json.load(f))
        return batches, [q for b in batches for q in b["questions"]]

    def test_contexto_days_come_first_then_the_games_in_order(self):
        self.stage()
        _, questions = self._questions(self.export())
        games = [q["game"] for q in questions]
        self.assertEqual(games[:3], ["contexto"] * 3)
        days = [Question.objects.get(game="contexto", qid=q["qid"]).definition["day"] for q in questions[:3]]
        self.assertEqual(days, sorted(days))
        self.assertEqual(sorted(games[3:]), sorted(["career-path"] * 3 + ["tictactoe"] * 2))

    def test_limit_and_batch_size(self):
        self.stage()
        batches, questions = self._questions(self.export("--limit", "5", "--batch-size", "2"))
        self.assertEqual([len(b["questions"]) for b in batches], [2, 2, 1])
        self.assertIn('batches=["001", "002", "003"]', self.gh_output())
        self.assertIn("count=5", self.gh_output())

    def test_each_question_carries_its_view_and_sha(self):
        self.stage(("career-path",))
        batches, questions = self._questions(self.export())
        self.assertEqual(batches[0]["checker_version"], checker.CHECKER_VERSION)
        self.assertEqual(batches[0]["allowed_sites"], list(checker.ALLOWED_SITES))
        for q in questions:
            row = Question.objects.get(game=q["game"], qid=q["qid"])
            m = GAME_MODULES[q["game"]].materialize(row.definition, self.ds)
            self.assertEqual(q["view"], GAME_MODULES[q["game"]].checker_view(m, self.ds))
            self.assertEqual(q["payload_sha"], row.quality["payload_sha"])

    def test_a_pending_row_that_no_longer_materializes_is_skipped(self):
        Question.objects.create(game="career-path", qid="cp-999999", definition={"person_id": -1},
                                content_hash=content_hash({"person_id": -1}), status="pending")
        _, questions = self._questions(self.export())
        self.assertNotIn("cp-999999", [q["qid"] for q in questions])

    def _export_pending(self, n, *args):
        """Export n plain pending rows (their views stubbed) and return the exported questions."""
        Question.objects.all().delete()
        shutil.rmtree(os.path.join(self.tmp, "batches"), ignore_errors=True)
        Question.objects.bulk_create([
            Question(game="career-path", qid=f"cp-{i:06d}", definition={"person_id": i},
                     content_hash=f"{i:064d}", status="pending") for i in range(n)])
        with patch("trivia.questions.checker_jobs._view", return_value=({"q": 1}, "s" * 64)):
            return self._questions(self.export("--batch-size", "50", *args))[1]

    def test_tictactoe_difficulties_take_turns(self):
        Question.objects.all().delete()
        shutil.rmtree(os.path.join(self.tmp, "batches"), ignore_errors=True)
        bands = ["easy"] * 4 + ["medium"] * 4 + ["hard"] * 2 + [None]  # None: no label = hard
        for i, band in enumerate(bands):
            row = Question.objects.create(game="tictactoe", qid=f"ttt-{i:04d}", definition={"n": i},
                                          content_hash=f"{i:064d}", status="pending")
            if band:
                QuestionLabel.objects.create(question=row, difficulty=band, source="rule")
        with patch("trivia.questions.checker_jobs._view", return_value=({"q": 1}, "s" * 64)):
            questions = self._questions(self.export("--limit", "6"))[1]
        self.assertEqual([q["qid"] for q in questions],
                         ["ttt-0000", "ttt-0004", "ttt-0008", "ttt-0001", "ttt-0005", "ttt-0009"])

    def test_auto_limit_is_150_while_150_or_more_are_pending_else_60(self):
        for pending, exported in ((20, 20), (149, 60), (150, 150), (200, 150)):
            with self.subTest(pending=pending):
                self.assertEqual(len(self._export_pending(pending, "--limit", "auto")), exported)

    def test_the_default_limit_is_auto(self):
        self.assertEqual(len(self._export_pending(160)), 150)

    def test_nothing_pending(self):
        out = self.export()
        self.assertEqual([n for n in os.listdir(out) if n.startswith("batch-")], [])
        self.assertIn("batches=[]", self.gh_output())
        self.assertIn("count=0", self.gh_output())


class TicTacToeIndexLabelTests(CheckerJobsTestCase):
    def test_published_items_carry_the_difficulty_label(self):
        self.stage(("tictactoe",))
        rows = list(Question.objects.filter(game="tictactoe").order_by("id"))
        Question.objects.filter(id__in=[r.id for r in rows]).update(status="active")
        QuestionLabel.objects.create(question=rows[0], difficulty="easy", source="rule")
        items = {qid: item for qid, item, _ in runner.materialize_active(["tictactoe"], self.ds)["tictactoe"]}
        self.assertEqual(items[rows[0].qid], [rows[0].qid, "easy"])
        self.assertEqual(items[rows[1].qid], [rows[1].qid, "hard"])  # no label = hard


class ApplyTests(CheckerJobsTestCase):
    def setUp(self):
        super().setUp()
        self.stage(("career-path",))
        self.rows = list(Question.objects.filter(game="career-path", status="pending").order_by("id"))
        self.dir = os.path.join(self.tmp, "verdicts")
        os.makedirs(self.dir)

    def verdict(self, row, verdict="valid", status="confirmed", sha=None, sources=(BREF,)):
        return {"game": row.game, "qid": row.qid, "payload_sha": sha or row.quality["payload_sha"],
                "verdict": verdict, "summary": "checked",
                "claims": [{"claim": "teams", "status": status, "sources": list(sources)}]}

    def write(self, name, verdicts):
        with open(os.path.join(self.dir, name), "w", encoding="utf-8") as f:
            json.dump({"verdicts": verdicts}, f)

    def apply(self):
        buf = StringIO()
        call_command("apply_checker_verdicts", self.dir, stdout=buf)
        return buf.getvalue()

    def test_valid_goes_live_with_its_check_recorded(self):
        row = self.rows[0]
        self.write("verdicts-001.json", [self.verdict(row)])
        self.apply()
        row.refresh_from_db()
        self.assertEqual(row.status, "active")
        self.assertEqual(row.quality["checked"]["verdict"], "valid")
        self.assertEqual(row.quality["checked"]["payload_sha"], row.quality["payload_sha"])
        self.assertIn("approved=1\n", self.gh_output())
        self.assertIn("changed=1\n", self.gh_output())
        self.assertIn("games=career-path\n", self.gh_output())

    def test_invalid_is_quarantined_with_the_evidence(self):
        row = self.rows[0]
        self.write("verdicts-001.json", [self.verdict(row, "invalid", "contradicted")])
        self.apply()
        row.refresh_from_db()
        self.assertEqual(row.status, "quarantined")
        self.assertEqual(row.quality["check_failed"]["claims"][0]["status"], "contradicted")
        self.assertIn("approved=0\n", self.gh_output())
        self.assertIn("changed=1\n", self.gh_output())  # any change publishes, not only approvals

    def test_unsure_twice_goes_to_the_owner(self):
        row = self.rows[0]
        self.write("verdicts-001.json", [self.verdict(row, "unsure", "unverified", sources=())])
        self.apply()
        output = self.apply()
        row.refresh_from_db()
        self.assertEqual(row.status, "pending")
        self.assertEqual(row.quality["unsure_count"], 2)
        self.assertIn("changed=0\n", self.gh_output())  # nothing players see changed
        self.assertIn("::warning::", output)
        run = FactoryRun.objects.order_by("-id").first()
        self.assertTrue(run.events.filter(action="needs_owner", qid=row.qid).exists())

    def test_a_valid_claim_without_an_approved_source_is_not_published(self):
        row = self.rows[0]
        self.write("verdicts-001.json", [self.verdict(row, sources=("https://example.com/x",))])
        self.apply()
        row.refresh_from_db()
        self.assertEqual(row.status, "pending")

    def test_a_stale_verdict_does_not_apply(self):
        row = self.rows[0]
        self.write("verdicts-001.json", [self.verdict(row, sha="f" * 64)])
        self.apply()
        row.refresh_from_db()
        self.assertEqual(row.status, "pending")
        self.assertTrue(FactoryRun.objects.get().events.filter(action="rejected", reason="stale").exists())

    def test_only_pending_questions_of_staged_games_can_change(self):
        row = self.rows[0]
        row.status = "active"
        row.save()
        Question.objects.create(game="imposter", qid="imposter-pool", definition={"rule": "fame_tier<=2"},
                                content_hash="i" * 64, status="pending")
        self.write("verdicts-001.json", [self.verdict(row),
                                         {"game": "imposter", "qid": "imposter-pool", "payload_sha": "x",
                                          "verdict": "valid", "claims": []}])
        self.apply()
        reasons = sorted(FactoryRun.objects.get().events.filter(action="rejected").values_list("reason", flat=True))
        self.assertEqual(reasons, ["not_pending", "not_staged"])
        self.assertEqual(Question.objects.get(game="imposter").status, "pending")

    def test_a_malformed_file_is_journaled_and_the_rest_still_applies(self):
        with open(os.path.join(self.dir, "verdicts-001.json"), "w", encoding="utf-8") as f:
            f.write("{not json")
        self.write("verdicts-002.json", [self.verdict(self.rows[1])])
        self.apply()
        self.rows[1].refresh_from_db()
        self.assertEqual(self.rows[1].status, "active")
        run = FactoryRun.objects.get()
        self.assertEqual(run.kind, "checker")
        self.assertTrue(run.events.filter(action="rejected", reason="malformed_file").exists())
        approved = run.events.get(action="approved")
        self.assertEqual(approved.detail["claims"][0]["sources"], [BREF])


class ApplyConflictAndSizeTests(ApplyTests):
    def test_a_contradiction_anywhere_beats_a_valid_verdict_for_the_same_question(self):
        row = self.rows[0]
        self.write("verdicts-001.json", [self.verdict(row)])
        self.write("verdicts-002.json", [self.verdict(row, "invalid", "contradicted")])
        self.apply()
        row.refresh_from_db()
        self.assertEqual(row.status, "quarantined")

    def test_valid_and_unsure_for_the_same_question_is_unsure(self):
        row = self.rows[0]
        self.write("verdicts-001.json", [self.verdict(row), self.verdict(row, "unsure", "unverified", sources=())])
        self.apply()
        row.refresh_from_db()
        self.assertEqual(row.status, "pending")
        self.assertEqual(row.quality["unsure_count"], 1)

    def test_evidence_is_capped(self):
        row = self.rows[0]
        v = self.verdict(row, "invalid", "contradicted")
        v["claims"][0]["claim"] = "x" * 5000
        v["claims"][0]["found"] = "y" * 5000
        v["claims"][0]["sources"] = [BREF] * 50
        v["claims"] += [dict(v["claims"][0]) for _ in range(100)]
        self.write("verdicts-001.json", [v])
        self.apply()
        row.refresh_from_db()
        claims = row.quality["check_failed"]["claims"]
        self.assertLessEqual(len(claims), 50)
        self.assertLessEqual(len(claims[0]["claim"]), 500)
        self.assertLessEqual(len(claims[0]["found"]), 500)
        self.assertLessEqual(len(claims[0]["sources"]), 10)


class AuditTests(ApplyTests):
    """Random audit (spec §4.9): live questions marked audit_due by the doctor are re-checked."""
    CHECKED = {"verdict": "valid", "at": "2026-10-01T07:00:00+00:00", "payload_sha": "old", "checker_version": 1}

    def make_due(self, row, checked=True):
        row.status = "active"
        row.quality = {**row.quality, "audit_due": True, "audit_selected": "2026-10-15"}
        if checked:
            row.quality["checked"] = dict(self.CHECKED)
        row.save()

    def export_files(self, *args):
        out = self.export(*args)
        found = {}
        for n in sorted(os.listdir(out)):
            with open(os.path.join(out, n), encoding="utf-8") as f:
                found[n] = json.load(f)
        return found

    def test_audit_mode_exports_only_live_questions_due_for_audit(self):
        due, live, pending = self.rows[0], self.rows[1], self.rows[2]
        self.make_due(due)
        live.status = "active"
        live.save()
        files = self.export_files("--mode", "audit")
        self.assertEqual(list(files), ["audit-001.json"])
        batch = files["audit-001.json"]
        self.assertEqual(batch["kind"], "audit")
        self.assertEqual(batch["batch"], "001")
        self.assertEqual([q["qid"] for q in batch["questions"]], [due.qid])
        self.assertEqual(batch["questions"][0]["payload_sha"], due.quality["payload_sha"])
        self.assertIn('batches=["001"]', self.gh_output())
        self.assertNotIn(pending.qid, json.dumps(files))

    def test_pending_mode_is_unchanged_and_skips_audits(self):
        self.make_due(self.rows[0])
        files = self.export_files()
        self.assertTrue(all(n.startswith("batch-") for n in files))
        self.assertNotIn("kind", files["batch-001.json"])
        self.assertNotIn(self.rows[0].qid, [q["qid"] for b in files.values() for q in b["questions"]])

    def test_valid_clears_the_audit_and_refreshes_the_check(self):
        row = self.rows[0]
        self.make_due(row)
        self.write("verdicts-001.json", [self.verdict(row)])
        self.apply()
        row.refresh_from_db()
        self.assertEqual(row.status, "active")
        self.assertNotIn("audit_due", row.quality)
        self.assertEqual(row.quality["checked"]["payload_sha"], row.quality["payload_sha"])
        self.assertNotEqual(row.quality["checked"]["at"], self.CHECKED["at"])
        self.assertIn("approved=0\n", self.gh_output())
        self.assertIn("changed=0\n", self.gh_output())  # nothing players see changed
        self.assertTrue(FactoryRun.objects.get().events.filter(action="audit_passed", qid=row.qid).exists())

    def test_invalid_quarantines_and_records_the_checker_miss(self):
        row = self.rows[0]
        self.make_due(row)
        self.write("verdicts-001.json", [self.verdict(row, "invalid", "contradicted")])
        self.apply()
        row.refresh_from_db()
        self.assertEqual(row.status, "quarantined")
        self.assertNotIn("audit_due", row.quality)
        self.assertEqual(row.quality["check_failed"]["claims"][0]["status"], "contradicted")
        self.assertIn("changed=1\n", self.gh_output())  # leaves production
        events = FactoryRun.objects.get().events
        self.assertTrue(events.filter(action="quarantined", qid=row.qid).exists())
        miss = events.get(action="checker_miss", qid=row.qid)
        self.assertEqual(miss.detail["checked_at"], self.CHECKED["at"])

    def test_invalid_without_a_prior_check_is_no_checker_miss(self):
        row = self.rows[0]
        self.make_due(row, checked=False)
        self.write("verdicts-001.json", [self.verdict(row, "invalid", "contradicted")])
        self.apply()
        row.refresh_from_db()
        self.assertEqual(row.status, "quarantined")
        self.assertFalse(FactoryRun.objects.get().events.filter(action="checker_miss").exists())

    def test_unsure_keeps_the_audit_due(self):
        row = self.rows[0]
        self.make_due(row)
        self.write("verdicts-001.json", [self.verdict(row, "unsure", "unverified", sources=())])
        self.apply()
        row.refresh_from_db()
        self.assertEqual(row.status, "active")
        self.assertTrue(row.quality["audit_due"])
        self.assertEqual(row.quality["checked"], self.CHECKED)
        self.assertNotIn("unsure_count", row.quality)

    def test_a_stale_audit_verdict_does_not_apply(self):
        row = self.rows[0]
        self.make_due(row)
        self.write("verdicts-001.json", [self.verdict(row, "invalid", "contradicted", sha="f" * 64)])
        self.apply()
        row.refresh_from_db()
        self.assertEqual(row.status, "active")
        self.assertTrue(FactoryRun.objects.get().events.filter(action="rejected", reason="stale").exists())
