from unittest.mock import patch

from django.test import TestCase

from trivia.models import FactoryEvent, FactoryRun
from trivia.questions.journal import Journal


class JournalTests(TestCase):
    def test_log_summary_and_save(self):
        j = Journal("supply", trigger="manual")
        j.versions = {"fame": 1}
        j.log("generated", "top_up", game="career-path", qid="cp-000001", definition={"person_id": 1})
        j.log("generated", "top_up", game="career-path", qid="cp-000002", definition={"person_id": 2})
        j.log("held_back", "below_minimum", game="contexto", active=3, minimum=30)
        self.assertEqual(j.summary(), {"career-path": {"generated": 2}, "contexto": {"held_back": 1}})
        run = j.save("degraded")
        self.assertEqual((run.kind, run.trigger, run.status), ("supply", "manual", "degraded"))
        self.assertEqual(run.events.count(), 3)
        self.assertEqual(run.summary, j.summary())
        self.assertEqual(run.versions, {"fame": 1})
        self.assertIn("contexto held_back: below_minimum", run.report_md)
        self.assertEqual(run.events.get(qid="cp-000002").detail, {"definition": {"person_id": 2}})

    def test_save_is_all_or_nothing(self):
        j = Journal("supply")
        j.log("generated", "top_up", game="career-path", qid="cp-000001")
        with patch.object(FactoryEvent.objects, "bulk_create", side_effect=RuntimeError("boom")):
            with self.assertRaises(RuntimeError):
                j.save("ok")
        self.assertFalse(FactoryRun.objects.exists())

    def test_mark_rolled_back_flags_events_from_a_point(self):
        j = Journal("supply")
        j.log("generated", game="a")
        j.log("generated", game="b")
        j.mark_rolled_back(since=1)
        self.assertEqual([e["detail"].get("rolled_back") for e in j.events], [None, True])

    def test_mark_rolled_back_leaves_decisions_alone(self):
        j = Journal("supply")
        j.log("refill_decision", "below_target", game="a", active=0, target=5, retired=0)
        j.log("generated", "top_up", game="a")
        j.mark_rolled_back()
        self.assertEqual([e["detail"].get("rolled_back") for e in j.events], [None, True])

    def test_events_without_a_game_stay_out_of_the_summary(self):
        j = Journal("cleanup")
        j.log("cleaned", "past_window", rows=10)
        self.assertEqual(j.summary(), {})
        self.assertEqual(j.save("ok").events.get().detail, {"rows": 10})
