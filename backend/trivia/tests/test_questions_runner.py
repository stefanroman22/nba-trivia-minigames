import random
from unittest import mock

from django.test import TestCase

from trivia.models import Question
from trivia.questions import runner
from trivia.questions.hashing import content_hash
from trivia.questions.journal import Journal
from trivia.tests.questions_fixture import fixture_dataset
from trivia.tests.test_questions_snapshot import FakeS3


class Cfg:
    bucket = "b"
    public_base = "https://cdn/base"


class RunnerTests(TestCase):
    def setUp(self):
        self.ds = fixture_dataset("ds-1")
        self.rng = random.Random(7)

    def test_top_up_materialize_and_publish(self):
        s3 = FakeS3()
        with mock.patch.object(runner, "current_published_version", return_value=None):
            summary = runner.run(["career-path", "imposter"], publish=True, dry_run=False, rng=self.rng,
                                 dataset=self.ds, s3=s3, cfg=Cfg(), out=lambda *_: None)
        self.assertGreaterEqual(summary["career-path"]["added"], runner_min("career-path"))
        self.assertEqual(Question.objects.filter(game="imposter", status="active").count(), 1)
        self.assertEqual(s3.calls[-1], ("put", "questions/manifest.json"))
        self.assertTrue(summary["version"].endswith(".1"))
        q = Question.objects.filter(game="career-path").first()
        self.assertEqual(q.dataset_version, "ds-1")
        self.assertTrue(q.qid.startswith("cp-"))

    def test_broken_definition_is_retired_with_reason(self):
        Question.objects.create(game="career-path", qid="cp-999999", definition={"person_id": -1},
                                content_hash=content_hash({"person_id": -1}))
        s3 = FakeS3()
        with mock.patch.object(runner, "current_published_version", return_value=None):
            runner.run(["career-path"], publish=True, dry_run=False, rng=self.rng, dataset=self.ds, s3=s3, cfg=Cfg(), out=lambda *_: None)
        q = Question.objects.get(qid="cp-999999")
        self.assertEqual(q.status, "retired")
        self.assertIn("not in the playable pool", q.retired_reason)
        self.assertIsNotNone(q.retired_at)

    def test_below_minimum_publishes_nothing_and_rolls_back(self):
        s3 = FakeS3()
        with mock.patch.object(runner, "current_published_version", return_value=None), \
             mock.patch("trivia.questions.games.career_path.TARGET", 5), \
             mock.patch("trivia.questions.games.career_path.MINIMUM", 50):
            with self.assertRaises(runner.BelowMinimum):
                runner.run(["career-path"], publish=True, dry_run=False, rng=self.rng, dataset=self.ds, s3=s3, cfg=Cfg(), out=lambda *_: None)
        self.assertEqual(s3.calls, [])
        self.assertEqual(Question.objects.count(), 0)

    def test_isolated_maintain_holds_back_only_the_failing_game(self):
        with mock.patch("trivia.questions.games.career_path.TARGET", 5), \
             mock.patch("trivia.questions.games.career_path.MINIMUM", 50):
            per_game, stats = runner.maintain(["career-path", "who-are-ya"], self.ds, self.rng,
                                              out=lambda *_: None, isolate=True)
        self.assertNotIn("career-path", per_game)
        self.assertEqual(stats["career-path"], {"held_back": "career-path: 5 active < minimum 50"})
        self.assertEqual(Question.objects.filter(game="career-path").count(), 0)
        self.assertTrue(per_game["who-are-ya"])
        self.assertTrue(Question.objects.filter(game="who-are-ya", status="active").exists())

    def test_maintain_journals_its_decisions(self):
        journal = Journal("supply")
        with mock.patch("trivia.questions.games.career_path.TARGET", 5), \
             mock.patch("trivia.questions.games.career_path.MINIMUM", 5):
            runner.maintain(["career-path"], self.ds, self.rng, out=lambda *_: None, journal=journal)
        first = journal.events[0]
        self.assertEqual((first["action"], first["reason"], first["game"]),
                         ("refill_decision", "below_target", "career-path"))
        self.assertEqual(first["detail"], {"active": 0, "target": 5, "retired": 0})
        self.assertEqual(sum(1 for e in journal.events if e["action"] == "generated"), 5)

    def test_retirements_are_journaled_with_the_problem(self):
        Question.objects.create(game="career-path", qid="cp-999999", definition={"person_id": -1},
                                content_hash=content_hash({"person_id": -1}))
        journal = Journal("supply")
        with mock.patch("trivia.questions.games.career_path.TARGET", 5), \
             mock.patch("trivia.questions.games.career_path.MINIMUM", 5):
            runner.maintain(["career-path"], self.ds, self.rng, out=lambda *_: None, journal=journal)
        retired = [e for e in journal.events if e["action"] == "retired"]
        self.assertEqual(retired[0]["qid"], "cp-999999")
        self.assertIn("not in the playable pool", retired[0]["detail"]["problems"][0])

    def test_maintain_without_isolate_still_raises(self):
        with mock.patch("trivia.questions.games.career_path.TARGET", 5), \
             mock.patch("trivia.questions.games.career_path.MINIMUM", 50):
            with self.assertRaises(runner.BelowMinimum):
                runner.maintain(["career-path"], self.ds, self.rng, out=lambda *_: None)

    def test_failed_upload_rolls_back_db(self):
        class Boom(FakeS3):
            def put_object(self, *a, **k):
                raise RuntimeError("s3 down")
        with mock.patch.object(runner, "current_published_version", return_value=None):
            with self.assertRaises(runner.RunAborted):
                runner.run(["imposter"], publish=True, dry_run=False, rng=self.rng, dataset=self.ds, s3=Boom(), cfg=Cfg(), out=lambda *_: None)
        self.assertEqual(Question.objects.count(), 0)

    def test_dry_run_writes_nothing(self):
        s3 = FakeS3()
        with mock.patch.object(runner, "current_published_version", return_value=None):
            runner.run(["imposter"], publish=True, dry_run=True, rng=self.rng, dataset=self.ds, s3=s3, cfg=Cfg(), out=lambda *_: None)
        self.assertEqual(Question.objects.count(), 0)
        self.assertEqual(s3.calls, [])


def runner_min(slug):
    from trivia.questions.games import GAME_MODULES
    return GAME_MODULES[slug].MINIMUM


class StagingTests(TestCase):
    """stage=True (phase 4): new and changed questions wait for the Checker as pending."""

    def setUp(self):
        self.ds = fixture_dataset("ds-1")
        self.rng = random.Random(7)
        for p in (mock.patch("trivia.questions.games.career_path.TARGET", 5),
                  mock.patch("trivia.questions.games.career_path.MINIMUM", 0)):
            p.start()
            self.addCleanup(p.stop)

    def _maintain(self, games=("career-path",), stage=True, **kw):
        return runner.maintain(list(games), self.ds, self.rng, out=lambda *_: None, stage=stage, **kw)

    def test_new_questions_are_pending_and_not_published(self):
        per_game, stats = self._maintain()
        self.assertEqual(per_game["career-path"], [])
        self.assertEqual(Question.objects.filter(game="career-path", status="pending").count(), 5)
        self.assertEqual(stats["career-path"]["pending"], 5)

    def test_pending_questions_count_toward_the_target(self):
        self._maintain()
        _, stats = self._maintain()
        self.assertEqual(stats["career-path"]["added"], 0)
        self.assertEqual(Question.objects.filter(game="career-path").count(), 5)

    def test_the_minimum_counts_active_questions_only(self):
        with mock.patch("trivia.questions.games.career_path.MINIMUM", 1):
            _, stats = self._maintain(isolate=True)
        self.assertIn("held_back", stats["career-path"])

    def test_live_questions_get_a_payload_sha_and_stay_active(self):
        self._maintain(stage=False)
        self._maintain()
        rows = list(Question.objects.filter(game="career-path"))
        self.assertEqual(len(rows), 5)
        self.assertTrue(all(r.status == "active" and len(r.quality["payload_sha"]) == 64 for r in rows))

    def test_a_changed_view_sends_a_live_question_back_to_pending(self):
        self._maintain(stage=False)
        row = Question.objects.filter(game="career-path").first()
        row.quality = {**row.quality, "payload_sha": "0" * 64, "checked": {"verdict": "valid"}}
        row.save()
        journal = Journal("supply")
        per_game, _ = self._maintain(journal=journal)
        row.refresh_from_db()
        self.assertEqual(row.status, "pending")
        self.assertNotIn("checked", row.quality)
        self.assertNotIn(row.qid, [qid for qid, _, _ in per_game["career-path"]])
        self.assertTrue(any(e["action"] == "staged_for_recheck" and e["qid"] == row.qid for e in journal.events))

    def test_an_unchanged_checked_question_keeps_its_check(self):
        self._maintain(stage=False)
        row = Question.objects.filter(game="career-path").first()
        row.quality = {**row.quality, "checked": {"verdict": "valid"}}
        row.save()
        self._maintain()
        row.refresh_from_db()
        self.assertEqual(row.status, "active")
        self.assertEqual(row.quality["checked"], {"verdict": "valid"})

    def test_games_outside_the_checker_are_not_staged(self):
        self._maintain(games=("imposter",))
        self.assertEqual(Question.objects.get(game="imposter").status, "active")
