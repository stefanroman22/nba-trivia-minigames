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
