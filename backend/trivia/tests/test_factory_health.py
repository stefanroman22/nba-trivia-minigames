"""Factory health check: the nightly watchdog that reports a silent Checker failure."""
from datetime import timedelta
from io import StringIO

from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone

from trivia.models import FactoryEvent, FactoryRun, Question
from trivia.questions import health


class HealthTestCase(TestCase):
    def setUp(self):
        self.now = timezone.now()

    def run_(self, kind, hours_ago, status="ok", events=()):
        started = self.now - timedelta(hours=hours_ago)
        run = FactoryRun.objects.create(kind=kind, status=status, started_at=started,
                                        finished_at=started + timedelta(minutes=5))
        for action, game, qid in events:
            FactoryEvent.objects.create(run=run, action=action, game=game, qid=qid,
                                        created_at=started + timedelta(minutes=1))
        return run

    def pending(self, n, hours_ago=48, start=0):
        Question.objects.bulk_create([
            Question(game="career-path", qid=f"cp-{i:06d}", definition={"person_id": i},
                     content_hash=f"{i:064d}", status="pending") for i in range(start, start + n)])
        Question.objects.filter(qid__in=[f"cp-{i:06d}" for i in range(start, start + n)]).update(
            created_at=self.now - timedelta(hours=hours_ago))

    def codes(self):
        return [f["code"] for f in health.check(self.now)]


class CheckerTests(HealthTestCase):
    def test_a_checker_run_that_checked_nothing_while_questions_were_pending_is_reported(self):
        self.pending(5)
        self.run_("checker", hours_ago=2)
        findings = health.check(self.now)
        self.assertEqual([f["code"] for f in findings], ["checker_idle"])
        self.assertEqual(findings[0]["severity"], "error")
        self.assertIn("5", findings[0]["text"])

    def test_rejected_verdicts_alone_still_count_as_idle(self):
        self.pending(5)
        self.run_("checker", hours_ago=2, events=[("rejected", "career-path", "cp-000000")])
        self.assertEqual(self.codes(), ["checker_idle"])

    def test_a_checker_run_that_approved_one_question_is_fine(self):
        self.pending(5)
        self.run_("checker", hours_ago=2, events=[("approved", "career-path", "cp-000000")])
        self.assertEqual(self.codes(), [])

    def test_only_questions_pending_when_the_run_started_count(self):
        self.pending(5, hours_ago=1)  # staged after the Checker ran
        self.run_("checker", hours_ago=2)
        self.assertEqual(self.codes(), [])

    def test_the_newest_checker_run_decides(self):
        self.pending(5)
        self.run_("checker", hours_ago=26, events=[("approved", "career-path", "cp-000000")])
        self.run_("checker", hours_ago=2)
        self.assertEqual(self.codes(), ["checker_idle"])

    def test_no_checker_run_for_48_hours_while_questions_are_pending(self):
        self.pending(5)
        self.run_("checker", hours_ago=48, events=[("approved", "career-path", "cp-000000")])
        findings = health.check(self.now)
        self.assertEqual([f["code"] for f in findings], ["checker_missing"])
        self.assertEqual(findings[0]["severity"], "error")

    def test_no_checker_run_and_nothing_pending_is_fine(self):
        self.assertEqual(self.codes(), [])

    def test_pending_rows_of_games_the_checker_does_not_check_are_ignored(self):
        Question.objects.create(game="imposter", qid="imposter-pool", definition={}, content_hash="i" * 64,
                                status="pending")
        self.assertEqual(self.codes(), [])


class SupplyRefreshBacklogTests(HealthTestCase):
    def test_a_held_back_game_in_the_newest_supply_run_is_reported(self):
        self.run_("supply", hours_ago=20, status="degraded", events=[("held_back", "contexto", "")])
        findings = health.check(self.now)
        self.assertEqual([f["code"] for f in findings], ["held_back"])
        self.assertEqual(findings[0]["severity"], "warn")
        self.assertIn("contexto", findings[0]["text"])

    def test_a_newer_supply_run_without_held_back_clears_it(self):
        self.run_("supply", hours_ago=30, status="degraded", events=[("held_back", "contexto", "")])
        self.run_("supply", hours_ago=2, events=[("generated", "contexto", "ctx-1")])
        self.assertEqual(self.codes(), [])

    def test_no_refresh_run_is_no_finding(self):
        self.run_("supply", hours_ago=2)
        self.assertEqual(self.codes(), [])

    def test_a_failed_newest_refresh_is_reported(self):
        self.run_("refresh", hours_ago=50)
        self.run_("refresh", hours_ago=3, status="failed")
        findings = health.check(self.now)
        self.assertEqual([f["code"] for f in findings], ["refresh_failed"])
        self.assertEqual(findings[0]["severity"], "error")

    def test_an_ok_newest_refresh_after_a_failed_one_is_fine(self):
        self.run_("refresh", hours_ago=50, status="failed")
        self.run_("refresh", hours_ago=3)
        self.assertEqual(self.codes(), [])

    def test_a_backlog_over_300_is_reported(self):
        self.pending(301)
        self.run_("checker", hours_ago=2, events=[("approved", "career-path", "cp-000000")])
        self.assertEqual(self.codes(), ["backlog"])

    def test_300_pending_is_not_a_backlog(self):
        self.pending(300)
        self.run_("checker", hours_ago=2, events=[("approved", "career-path", "cp-000000")])
        self.assertEqual(self.codes(), [])


class NeedsOwnerTests(HealthTestCase):
    def setUp(self):
        super().setUp()
        self.pending(1)
        self.run_("checker", hours_ago=2, events=[("approved", "career-path", "cp-other")])

    def needs_owner(self, days_ago, qid="cp-000000"):
        run = self.run_("checker", hours_ago=days_ago * 24 + 3, events=[])
        FactoryEvent.objects.create(run=run, action="needs_owner", reason="unsure_twice", game="career-path",
                                    qid=qid, created_at=self.now - timedelta(days=days_ago))

    def test_a_recent_needs_owner_still_pending_is_reported(self):
        self.needs_owner(days_ago=2)
        self.needs_owner(days_ago=1)  # the same question twice is one entry
        findings = health.check(self.now)
        self.assertEqual([f["code"] for f in findings], ["needs_owner"])
        self.assertEqual(findings[0]["severity"], "warn")
        self.assertIn("career-path/cp-000000", findings[0]["text"])
        self.assertEqual(findings[0]["text"].count("cp-000000"), 1)

    def test_a_question_whose_status_changed_since_is_resolved(self):
        self.needs_owner(days_ago=2)
        Question.objects.filter(qid="cp-000000").update(status="active")
        self.assertEqual(self.codes(), [])

    def test_a_needs_owner_older_than_7_days_is_dropped(self):
        self.needs_owner(days_ago=8)
        self.assertEqual(self.codes(), [])


class CommandTests(HealthTestCase):
    def call(self, *args):
        buf = StringIO()
        call_command("factory_health", *args, stdout=buf, stderr=StringIO())
        return buf.getvalue()

    def test_slack_output_is_one_block_and_the_run_is_journaled(self):
        self.pending(5)
        self.run_("checker", hours_ago=2)
        self.run_("supply", hours_ago=20, status="degraded", events=[("held_back", "contexto", "")])
        output = self.call("--slack")
        lines = output.strip().splitlines()
        self.assertTrue(lines[0].startswith("Factory health —"))
        self.assertEqual(len(lines), 3)
        self.assertIn("checker_idle", lines[1])
        self.assertIn("held_back", lines[2])
        run = FactoryRun.objects.filter(kind="health").get()
        self.assertEqual(run.status, "degraded")
        self.assertEqual(sorted(run.events.values_list("reason", flat=True)), ["checker_idle", "held_back"])

    def test_slack_output_is_empty_when_all_is_well(self):
        self.assertEqual(self.call("--slack"), "")
        run = FactoryRun.objects.filter(kind="health").get()
        self.assertEqual(run.status, "ok")
        self.assertEqual(run.events.count(), 0)

    def test_plain_output_lists_the_findings(self):
        self.pending(5)
        output = self.call()
        self.assertIn("checker_missing", output)
        self.assertNotIn("Factory health —", output)

    def test_the_health_run_does_not_report_itself(self):
        self.pending(5)
        self.call()
        self.assertEqual(self.codes(), ["checker_missing"])
