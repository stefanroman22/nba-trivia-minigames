import random
from unittest import mock

from django.test import TestCase

from trivia.models import Question
from trivia.questions import runner
from trivia.questions.hashing import content_hash
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
