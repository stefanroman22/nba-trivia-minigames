"""Owner-run bulk commands: factory_supply and seed_who_would_win_votes."""
import json
import os
import tempfile
from io import StringIO
from unittest.mock import patch

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase

from trivia.data_pipeline import publish_v3
from trivia.models import FactoryRun, Question
from trivia.questions import runner
from trivia.tests.questions_fixture import fixture_dataset


class FactorySupplyTests(TestCase):
    def setUp(self):
        p = patch.object(publish_v3, "curated_dataset", return_value=fixture_dataset("ds-bulk"))
        p.start()
        self.addCleanup(p.stop)

    def test_rounds_stop_once_nothing_is_added_and_each_round_is_journaled(self):
        results = [({}, {"tictactoe": {"added": 5}}), ({}, {"tictactoe": {"added": 2}}),
                   ({}, {"tictactoe": {"added": 0}}), ({}, {"tictactoe": {"added": 9}})]
        with patch.object(runner, "maintain", side_effect=results) as m:
            call_command("factory_supply", "--games", "tictactoe", "--rounds", "4", stdout=StringIO())
        self.assertEqual(m.call_count, 3)
        for call in m.call_args_list:
            self.assertTrue(call.kwargs["stage"])
            self.assertTrue(call.kwargs["isolate"])
        self.assertEqual(FactoryRun.objects.filter(kind="supply").count(), 3)

    def test_unknown_game_is_refused(self):
        with self.assertRaises(CommandError):
            call_command("factory_supply", "--games", "nope", stdout=StringIO())

    def test_real_maintenance_only_adds_pending_questions(self):
        call_command("factory_supply", "--games", "tictactoe", "--rounds", "1", "--rng-seed", "1",
                     stdout=StringIO())
        rows = Question.objects.filter(game="tictactoe")
        self.assertTrue(rows.exists())
        self.assertFalse(rows.exclude(status=Question.STATUS_PENDING).exists())


class SeedVotesTests(TestCase):
    def setUp(self):
        self.live = Question.objects.create(game="who-would-win", qid="www-001", definition={},
                                            content_hash="h1", status=Question.STATUS_ACTIVE)
        Question.objects.create(game="who-would-win", qid="www-002", definition={}, content_hash="h2",
                                status=Question.STATUS_RETIRED)
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)

    def seed(self, votes):
        path = os.path.join(self._tmp.name, "votes.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(votes, f)
        call_command("seed_who_would_win_votes", path, stdout=StringIO())

    def test_seeds_live_matchups_and_skips_the_rest(self):
        self.seed({"www-001": {"a": 63, "b": 38}, "www-002": {"a": 1, "b": 1},
                   "www-404": {"a": 1, "b": 1}})
        self.live.refresh_from_db()
        self.assertEqual(self.live.quality["seed_votes"], {"a": 63, "b": 38})
        self.assertNotIn("seed_votes", Question.objects.get(qid="www-002").quality or {})
        run = FactoryRun.objects.order_by("-id").first()
        self.assertEqual(run.events.filter(action="rejected").count(), 2)

    def test_bad_counts_are_rejected(self):
        self.seed({"www-001": {"a": -1, "b": 5}})
        self.live.refresh_from_db()
        self.assertNotIn("seed_votes", self.live.quality or {})
        self.seed({"www-001": {"a": 501, "b": 5}})
        self.live.refresh_from_db()
        self.assertNotIn("seed_votes", self.live.quality or {})

    def test_clear_removes_every_seed(self):
        self.seed({"www-001": {"a": 10, "b": 5}})
        call_command("seed_who_would_win_votes", "--clear", stdout=StringIO())
        self.live.refresh_from_db()
        self.assertNotIn("seed_votes", self.live.quality or {})
