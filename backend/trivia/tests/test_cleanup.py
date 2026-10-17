"""Nightly cleanup: compaction of old retired questions, journal pruning and seen rows (spec §4.7)."""
import datetime
import random
from io import StringIO
from unittest import mock

from django.apps import apps
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.db import transaction
from django.test import TestCase
from django.utils import timezone

from trivia.models import FactoryEvent, FactoryRun, Question
from trivia.questions import cleanup, runner
from trivia.questions.hashing import content_hash
from trivia.questions.journal import Journal
from trivia.tests.questions_fixture import fixture_dataset

DAY = datetime.timedelta(days=1)


def question(game, qid, definition, status=Question.STATUS_RETIRED, retired_days=200):
    now = timezone.now()
    return Question.objects.create(
        game=game, qid=qid, definition=definition, content_hash=content_hash(definition), status=status,
        quality={"materialized": True, "payload_sha": "abc"}, players_referenced=[7],
        retired_at=now - retired_days * DAY if status == Question.STATUS_RETIRED else None,
        retired_reason="no longer valid" if status == Question.STATUS_RETIRED else "",
    )


class CleanupTestCase(TestCase):
    def clean(self, now=None):
        journal = Journal("cleanup")
        return cleanup.run(journal, now or timezone.now()), journal


class CompactionTests(CleanupTestCase):
    def test_old_retired_questions_keep_only_their_identity(self):
        old = question("career-path", "cp-1", {"person_id": 7, "teams": ["BOS"]})
        ctx = question("contexto", "ctx-2025-01-01", {"secret_person_id": 7, "day": "2025-01-01", "note": "x"})
        recent = question("career-path", "cp-2", {"person_id": 8}, retired_days=100)
        live = question("career-path", "cp-3", {"person_id": 9}, status=Question.STATUS_ACTIVE)
        before = {q.pk: (q.content_hash, q.retired_at, q.retired_reason) for q in (old, ctx)}

        counts, journal = self.clean()

        self.assertEqual(counts["compacted"], 2)
        old.refresh_from_db()
        ctx.refresh_from_db()
        self.assertEqual((old.definition, old.quality, old.players_referenced), ({}, {}, []))
        self.assertEqual(ctx.definition, {"secret_person_id": 7, "day": "2025-01-01"})
        self.assertEqual((ctx.quality, ctx.players_referenced), ({}, []))
        for q in (old, ctx):
            self.assertEqual((q.content_hash, q.retired_at, q.retired_reason), before[q.pk])
            self.assertEqual(q.status, Question.STATUS_RETIRED)
        for q in (recent, live):
            q.refresh_from_db()
            self.assertEqual(q.players_referenced, [7])
            self.assertTrue(q.definition)
        compacted = {e["game"]: e["detail"]["questions"] for e in journal.events if e["action"] == "compacted"}
        self.assertEqual(compacted, {"career-path": 1, "contexto": 1})

    def test_compaction_runs_once(self):
        question("career-path", "cp-1", {"person_id": 7})
        self.clean()
        counts, journal = self.clean()
        self.assertEqual(counts["compacted"], 0)
        self.assertFalse([e for e in journal.events if e["action"] == "compacted"])


class _Undo(Exception):
    pass


class GeneratorUnchangedTests(CleanupTestCase):
    GAMES = ["career-path", "contexto"]

    def generate(self, keep=False):
        """Run supply for GAMES with a fixed seed; return what it generated. Rolled back
        unless keep, so the same starting state can be generated from twice."""
        journal = Journal("supply")
        with mock.patch("trivia.questions.games.career_path.TARGET", 8), \
             mock.patch("trivia.questions.games.career_path.MINIMUM", 0), \
             mock.patch("trivia.questions.games.contexto.TARGET", 8), \
             mock.patch("trivia.questions.games.contexto.MINIMUM", 0):
            try:
                with transaction.atomic():
                    runner.maintain(self.GAMES, fixture_dataset("ds-1"), random.Random(11),
                                    out=lambda *_: None, journal=journal)
                    if not keep:
                        raise _Undo
            except _Undo:
                pass
        return [(e["game"], e["qid"], e["detail"]["definition"]) for e in journal.events
                if e["action"] == "generated"]

    def test_generator_output_is_identical_after_compaction(self):
        first = self.generate(keep=True)
        Question.objects.update(status=Question.STATUS_RETIRED, retired_at=timezone.now() - 200 * DAY,
                                retired_reason="test")
        retired_hashes = set(Question.objects.values_list("content_hash", flat=True))

        before = self.generate()
        counts, _ = self.clean()
        after = self.generate()

        self.assertTrue(first)
        self.assertEqual(counts["compacted"], len(retired_hashes))
        self.assertEqual({g for g, _, _ in before}, set(self.GAMES))
        # The retired rows matter: their hashes (and Contexto's secrets) steer generation.
        self.assertFalse({content_hash(d) for _, _, d in before} & retired_hashes)
        self.assertEqual(before, after)


class JournalAndSeenTests(CleanupTestCase):
    def test_old_journal_events_go_and_runs_stay(self):
        now = timezone.now()
        run = FactoryRun.objects.create(kind="supply", status="ok", started_at=now - 300 * DAY,
                                        finished_at=now - 300 * DAY)
        old = FactoryEvent.objects.create(run=run, action="generated", created_at=now - 181 * DAY)
        new = FactoryEvent.objects.create(run=run, action="generated", created_at=now - 179 * DAY)

        counts, journal = self.clean(now)

        self.assertEqual(counts["factory_events"], 1)
        self.assertEqual(list(FactoryEvent.objects.all()), [new])
        self.assertFalse(FactoryEvent.objects.filter(pk=old.pk).exists())
        self.assertTrue(FactoryRun.objects.filter(pk=run.pk).exists())
        cleaned = [e for e in journal.events if e["action"] == "cleaned"]
        self.assertEqual(len(cleaned), 1)
        self.assertEqual(cleaned[0]["detail"]["factory_events"], 1)

    def test_seen_rows_of_retired_questions_go(self):
        try:
            seen = apps.get_model("trivia", "SeenQuestion")
        except LookupError:  # the model arrives with seen tracking; until then this step is a no-op
            self.assertEqual(self.clean()[0]["seen_questions"], 0)
            return
        user = get_user_model().objects.create_user(username="ann", email="a@example.com", password="x")
        question("career-path", "cp-1", {"person_id": 7}, retired_days=1)
        question("career-path", "cp-2", {"person_id": 8}, status=Question.STATUS_ACTIVE)
        for qid in ("cp-1", "cp-2"):
            seen.objects.create(user=user, game="career-path", qid=qid, seen_at=timezone.now())

        counts, _ = self.clean()

        self.assertEqual(counts["seen_questions"], 1)
        self.assertEqual(list(seen.objects.values_list("qid", flat=True)), ["cp-2"])


class CommandTests(TestCase):
    def test_command_journals_a_cleanup_run(self):
        question("career-path", "cp-1", {"person_id": 7})
        out = StringIO()
        call_command("factory_cleanup", "--trigger", "schedule", stdout=out)
        run = FactoryRun.objects.get(kind="cleanup")
        self.assertEqual((run.status, run.trigger), ("ok", "schedule"))
        self.assertEqual(set(run.events.values_list("action", flat=True)), {"compacted", "cleaned"})
        self.assertIn("compacted 1", out.getvalue())

    def test_a_failed_cleanup_is_still_on_record(self):
        with mock.patch.object(cleanup, "run", side_effect=RuntimeError("boom")):
            with self.assertRaises(RuntimeError):
                call_command("factory_cleanup", stdout=StringIO())
        self.assertEqual(FactoryRun.objects.get(kind="cleanup").status, "failed")
