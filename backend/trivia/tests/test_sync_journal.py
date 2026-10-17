"""sync_nba_data --journal records the cloud refresh as FactoryRun(kind="refresh").

Spec §4.13: a failed refresh must be visible (factory_health's refresh_failed) and the
workflow must not look green, so a dataset failure fails the run and the command.
"""
from io import StringIO
from unittest import mock

from django.core.management import CommandError, call_command
from django.test import TestCase

from trivia.data_pipeline import sources
from trivia.models import FactoryRun

TEAMS = [{"team_id": 1610612700 + i, "full_name": f"Team {i}", "abbreviation": f"T{i:02d}", "logo": ""}
         for i in range(30)]
PLAYERS = [{"person_id": 1 + i, "full_name": f"Player {i}", "first_name": "Player", "last_name": str(i),
            "from_year": 2000, "to_year": 2010, "is_active": False} for i in range(1000)]


def _sync(*args):
    out = StringIO()
    call_command("sync_nba_data", "--datasets", "teams,players", *args, stdout=out)
    return out.getvalue()


class SyncJournalTests(TestCase):
    def setUp(self):
        for name, value in (("fetch_teams", lambda: TEAMS), ("fetch_players", lambda **kw: PLAYERS)):
            patcher = mock.patch.object(sources, name, side_effect=value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_journal_records_an_ok_run_with_one_event_per_dataset(self):
        _sync("--journal", "--trigger", "schedule")
        run = FactoryRun.objects.get(kind="refresh")
        self.assertEqual((run.status, run.trigger), (FactoryRun.STATUS_OK, "schedule"))
        events = {e.reason: e for e in run.events.all()}
        self.assertEqual(set(events), {"teams", "players"})
        self.assertEqual({e.action for e in events.values()}, {"synced"})
        self.assertEqual(events["teams"].detail["rows"], 30)
        self.assertEqual(events["players"].detail["rows"], 1000)

    def test_a_failing_fetcher_fails_the_run_and_the_command(self):
        with mock.patch.object(sources, "fetch_players", side_effect=TimeoutError("relay timed out")):
            with self.assertRaises(CommandError):
                _sync("--journal")
        run = FactoryRun.objects.get(kind="refresh")
        self.assertEqual((run.status, run.trigger), (FactoryRun.STATUS_FAILED, "manual"))
        failed = run.events.get(action="failed")
        self.assertEqual(failed.reason, "players")
        self.assertIn("relay timed out", failed.detail["error"])
        self.assertTrue(run.events.filter(action="synced", reason="teams").exists())

    def test_a_validation_failure_fails_the_run(self):
        with mock.patch.object(sources, "fetch_teams", side_effect=lambda: TEAMS[:5]):
            with self.assertRaises(CommandError):
                _sync("--journal")
        run = FactoryRun.objects.get(kind="refresh")
        self.assertEqual(run.status, FactoryRun.STATUS_FAILED)
        self.assertIn("only 5", run.events.get(action="failed", reason="teams").detail["error"])

    def test_without_journal_nothing_is_written_and_a_failure_still_exits_cleanly(self):
        with mock.patch.object(sources, "fetch_players", side_effect=TimeoutError("relay timed out")):
            out = _sync()
        self.assertIn("fetch FAILED", out)
        self.assertFalse(FactoryRun.objects.exists())
