"""Phase 5 doctor signal scan (spec §4.9): signals, quarantine, queue, random audit."""
import datetime
import os
import tempfile
from io import StringIO
from unittest.mock import patch

from django.core.management import call_command
from django.test import TestCase

from trivia.models import FactoryRun, Question, QuestionReport, QuestionStats, WrongAnswerStats
from trivia.questions import doctor
from trivia.questions.journal import Journal

UTC = datetime.timezone.utc
WEDNESDAY = datetime.datetime(2026, 10, 14, 2, 0, tzinfo=UTC)
THURSDAY = datetime.datetime(2026, 10, 15, 2, 0, tzinfo=UTC)
DAY = datetime.date(2026, 10, 10)


class DoctorTestCase(TestCase):
    _n = 0

    def q(self, game="career-path", pid=None, qid=None, status="active", band="medium", definition=None, **quality):
        DoctorTestCase._n += 1
        n = DoctorTestCase._n
        if definition is None:
            definition = {"secret_person_id": pid, "day": f"2026-10-{n % 28 + 1:02d}"} if game == "contexto" \
                else {"person_id": pid if pid is not None else 10_000 + n}
        quality = {"band": band, **quality} if band else quality
        return Question.objects.create(game=game, qid=qid or f"{game[:3]}-{n:06d}", definition=definition,
                                       content_hash=f"{n:064d}", status=status, quality=quality)

    def stats(self, game, question_id, attempts, correct, day=DAY, players=None):
        QuestionStats.objects.create(game=game, question_id=str(question_id), day=day, attempts=attempts,
                                     correct=correct, players=attempts if players is None else players)

    def wrong(self, game, question_id, answer, count, players):
        WrongAnswerStats.objects.create(game=game, question_id=str(question_id), answer_norm=answer, count=count,
                                        players=players, first_seen=WEDNESDAY, last_seen=WEDNESDAY)

    def report(self, game, question_id, note="wrong"):
        return QuestionReport.objects.create(game=game, question_id=str(question_id), note=note)

    def scan(self, now=WEDNESDAY):
        journal = Journal("doctor")
        summary = doctor.scan(now, journal)
        return summary, journal

    def actions(self, journal, action):
        return [e for e in journal.events if e["action"] == action]


class ResolverTests(DoctorTestCase):
    def test_person_games_resolve_by_person_id(self):
        cp = self.q("career-path", pid=77)
        way = self.q("who-are-ya", pid=77)
        self.assertEqual(doctor.question_for("career-path", "77"), cp)
        self.assertEqual(doctor.question_for("who-are-ya", "77"), way)

    def test_contexto_resolves_by_secret_and_prefers_the_live_day(self):
        self.q("contexto", pid=5, status="retired")
        live = self.q("contexto", pid=5)
        self.q("contexto", pid=5, status="retired")
        self.assertEqual(doctor.question_for("contexto", "5"), live)

    def test_tictactoe_strips_the_cell(self):
        board = self.q("tictactoe", qid="ttt-0007", definition={"rows": [], "cols": []})
        self.assertEqual(doctor.question_for("tictactoe", "ttt-0007:1-2"), board)
        self.assertEqual(doctor.question_for("tictactoe", "ttt-0007"), board)

    def test_editorial_games_resolve_by_qid(self):
        row = self.q("fan-favorites", qid="ff-0001", definition={"prompt": "x"})
        self.assertEqual(doctor.question_for("fan-favorites", "ff-0001"), row)

    def test_unknown_ids_resolve_to_nothing(self):
        self.q("career-path", pid=77)
        self.assertIsNone(doctor.question_for("career-path", "78"))
        self.assertIsNone(doctor.question_for("career-path", "not-a-number"))
        self.assertIsNone(doctor.question_for("tictactoe", "ttt-9999:0-0"))
        self.assertIsNone(doctor.question_for("playoff", "match-1"))

    def test_stats_for_unknown_ids_are_ignored(self):
        self.stats("career-path", "999", 40, 0)
        self.report("career-path", "999")
        summary, journal = self.scan()
        self.assertEqual((summary["quarantined"], summary["flagged"]), (0, 0))
        self.assertEqual(QuestionReport.objects.get().status, "new")


class SolveRateTests(DoctorTestCase):
    def test_below_three_percent_with_30_attempts_is_a_weak_signal(self):
        row = self.q(pid=1)
        self.stats("career-path", 1, 20, 0, day=DAY)
        self.stats("career-path", 1, 10, 0, day=DAY + datetime.timedelta(days=1))  # summed over days
        summary, journal = self.scan()
        row.refresh_from_db()
        self.assertEqual(row.status, "active")
        self.assertTrue(row.quality["doctor_queue"])
        self.assertEqual([s["signal"] for s in row.quality["doctor"]["signals"]], ["solve_rate"])
        self.assertEqual(row.quality["doctor"]["at"], WEDNESDAY.isoformat())
        self.assertEqual(summary["flagged"], 1)
        self.assertEqual(len(self.actions(journal, "flagged")), 1)

    def test_fewer_than_30_attempts_is_no_signal(self):
        row = self.q(pid=1)
        self.stats("career-path", 1, 29, 0)
        self.scan()
        row.refresh_from_db()
        self.assertNotIn("doctor_queue", row.quality)

    def test_many_guesses_from_few_players_who_mostly_solve_is_no_signal(self):
        row = self.q("contexto", pid=1)
        self.stats("contexto", 1, 400, 8, players=10)  # 2 % per guess, 80 % of players solve
        self.scan()
        row.refresh_from_db()
        self.assertNotIn("doctor_queue", row.quality)

    def test_few_players_solving_is_a_signal_whatever_the_guess_count(self):
        row = self.q("contexto", pid=1)
        self.stats("contexto", 1, 40, 1, players=40)  # 2.5 % of players solve
        self.scan()
        row.refresh_from_db()
        self.assertTrue(row.quality["doctor_queue"])
        signal = row.quality["doctor"]["signals"][0]
        self.assertEqual((signal["solve_rate"], signal["players"]), (0.025, 40))

    def test_no_players_is_no_signal(self):
        row = self.q(pid=1)
        self.stats("career-path", 1, 40, 0, players=0)
        self.scan()
        row.refresh_from_db()
        self.assertNotIn("doctor_queue", row.quality)

    def test_far_below_the_band_median_is_a_signal(self):
        for pid in (2, 3, 4):
            self.q(pid=pid)
            self.stats("career-path", pid, 100, 50)  # band median 0.5
        low = self.q(pid=1)
        self.stats("career-path", 1, 100, 15)  # 0.15 < 0.4 x 0.5, above 3 %
        fine = self.q(pid=5)
        self.stats("career-path", 5, 100, 25)  # 0.25 >= 0.2
        other_band = self.q(pid=6, band="hard")
        self.stats("career-path", 6, 100, 15)  # alone in its band: its own median
        self.scan()
        for row in (low, fine, other_band):
            row.refresh_from_db()
        self.assertTrue(low.quality["doctor_queue"])
        self.assertEqual(low.quality["doctor"]["signals"][0]["band_median"], 0.5)
        self.assertNotIn("doctor_queue", fine.quality)
        self.assertNotIn("doctor_queue", other_band.quality)


class ClusterTests(DoctorTestCase):
    def setUp(self):
        self.row = self.q(pid=1)

    def test_five_players_and_15_percent_is_a_signal(self):
        self.wrong("career-path", 1, "kobe bryant", 15, 5)
        self.wrong("career-path", 1, "other", 85, 4)  # big but from too few players: no cluster itself
        self.scan()
        self.row.refresh_from_db()
        signal = self.row.quality["doctor"]["signals"][0]
        self.assertEqual((signal["signal"], signal["answer"], signal["players"]), ("wrong_cluster", "kobe bryant", 5))

    def test_four_players_is_no_signal(self):
        self.wrong("career-path", 1, "kobe bryant", 15, 4)
        self.wrong("career-path", 1, "other", 85, 4)
        self.scan()
        self.row.refresh_from_db()
        self.assertNotIn("doctor_queue", self.row.quality)

    def test_under_15_percent_is_no_signal(self):
        self.wrong("career-path", 1, "kobe bryant", 14, 10)
        self.wrong("career-path", 1, "other", 86, 4)
        self.scan()
        self.row.refresh_from_db()
        self.assertNotIn("doctor_queue", self.row.quality)


class ReportAndStrengthTests(DoctorTestCase):
    def test_one_report_queues_and_keeps_the_note(self):
        row = self.q(pid=1)
        rep = self.report("career-path", 1, "wrong team in 2004")
        self.scan()
        row.refresh_from_db()
        rep.refresh_from_db()
        self.assertTrue(row.quality["doctor_queue"])
        self.assertEqual(row.quality["doctor"]["reports"], ["wrong team in 2004"])
        self.assertEqual(rep.status, "handled")

    def test_three_reports_quarantine(self):
        row = self.q(pid=1)
        for i in range(3):
            self.report("career-path", 1, f"note {i}")
        summary, journal = self.scan()
        row.refresh_from_db()
        self.assertEqual(row.status, "quarantined")
        self.assertEqual(row.quality["doctor"]["reports"], ["note 0", "note 1", "note 2"])
        self.assertEqual(row.quality["doctor"]["signals"], [{"signal": "reports", "count": 3}])
        self.assertEqual(summary["quarantined"], 1)
        event = self.actions(journal, "quarantined")[0]
        self.assertEqual((event["reason"], event["game"], event["qid"]), ("signal", "career-path", row.qid))
        self.assertEqual(set(QuestionReport.objects.values_list("status", flat=True)), {"handled"})

    def test_anomaly_and_cluster_together_quarantine(self):
        row = self.q(pid=1)
        self.stats("career-path", 1, 40, 0)
        self.wrong("career-path", 1, "kobe bryant", 20, 8)
        self.wrong("career-path", 1, "other", 20, 4)
        self.scan()
        row.refresh_from_db()
        self.assertEqual(row.status, "quarantined")
        self.assertEqual(sorted(s["signal"] for s in row.quality["doctor"]["signals"]),
                         ["solve_rate", "wrong_cluster"])

    def test_a_tictactoe_cell_signal_reaches_its_board(self):
        board = self.q("tictactoe", qid="ttt-0001", definition={"rows": [], "cols": []})
        self.stats("tictactoe", "ttt-0001:0-1", 40, 0)
        self.wrong("tictactoe", "ttt-0001:0-1", "kobe bryant", 20, 8)
        self.report("tictactoe", "ttt-0001:2-2")
        self.scan()
        board.refresh_from_db()
        self.assertEqual(board.status, "quarantined")
        self.assertEqual(board.quality["doctor"]["signals"][0]["question_id"], "ttt-0001:0-1")

    def test_pending_rows_are_never_touched(self):
        row = self.q(pid=1, status="pending")
        for _ in range(3):
            self.report("career-path", 1)
        self.stats("career-path", 1, 40, 0)
        before = dict(row.quality)
        summary, journal = self.scan(THURSDAY)
        row.refresh_from_db()
        self.assertEqual((row.status, row.quality), ("pending", before))
        self.assertEqual(set(QuestionReport.objects.values_list("status", flat=True)), {"new"})
        self.assertEqual(journal.events, [])


class IdempotenceTests(DoctorTestCase):
    def test_a_queued_question_is_not_flagged_again(self):
        row = self.q(pid=1)
        self.stats("career-path", 1, 40, 0)
        self.scan()
        summary, journal = self.scan()
        self.assertEqual((summary["flagged"], journal.events), (0, []))
        row.refresh_from_db()
        self.assertTrue(row.quality["doctor_queue"])

    def test_a_quarantined_question_is_not_quarantined_again(self):
        self.q(pid=1)
        for _ in range(3):
            self.report("career-path", 1)
        self.scan()
        summary, journal = self.scan()
        self.assertEqual((summary["quarantined"], journal.events), (0, []))

    def test_new_reports_on_a_queued_question_are_kept_without_a_new_event(self):
        row = self.q(pid=1)
        self.report("career-path", 1, "first")
        self.scan()
        self.report("career-path", 1, "second")
        summary, journal = self.scan()
        row.refresh_from_db()
        self.assertEqual(journal.events, [])
        self.assertEqual(row.quality["doctor"]["reports"], ["first", "second"])
        self.assertEqual(set(QuestionReport.objects.values_list("status", flat=True)), {"handled"})

    def test_a_queued_question_reaching_three_reports_is_quarantined(self):
        row = self.q(pid=1)
        self.report("career-path", 1, "a")
        self.report("career-path", 1, "b")
        self.scan()
        self.report("career-path", 1, "c")
        summary, journal = self.scan()
        row.refresh_from_db()
        self.assertEqual(row.status, "quarantined")
        self.assertEqual(row.quality["doctor"]["reports"], ["a", "b", "c"])
        self.assertEqual(len(self.actions(journal, "quarantined")), 1)

    def test_a_report_on_a_quarantined_question_is_attached_quietly(self):
        row = self.q(pid=1, status="quarantined")
        self.report("career-path", 1, "late")
        summary, journal = self.scan()
        row.refresh_from_db()
        self.assertEqual(row.quality["doctor"]["reports"], ["late"])
        self.assertEqual(journal.events, [])
        self.assertEqual(QuestionReport.objects.get().status, "handled")


class AuditSelectionTests(DoctorTestCase):
    def setUp(self):
        self.rows = [self.q(pid=i) for i in range(25)]
        self.q(pid=100, status="pending")
        self.q(pid=101, status="quarantined")

    def due(self):
        return set(Question.objects.filter(quality__audit_due=True).values_list("id", flat=True))

    def test_twenty_active_questions_on_thursday(self):
        summary, journal = self.scan(THURSDAY)
        self.assertEqual(summary["audit_selected"], 20)
        self.assertEqual(len(self.actions(journal, "audit_selected")), 20)
        due = Question.objects.filter(id__in=self.due())
        self.assertEqual(set(due.values_list("status", flat=True)), {"active"})

    def test_not_on_other_days(self):
        for day in range(7):
            now = WEDNESDAY - datetime.timedelta(days=day)
            if now.weekday() == 3:
                continue
            with self.subTest(now=now):
                self.assertEqual(self.scan(now)[0]["audit_selected"], 0)
        self.assertEqual(self.due(), set())

    def test_a_rerun_the_same_day_picks_the_same_twenty(self):
        self.scan(THURSDAY)
        first = self.due()
        summary, journal = self.scan(THURSDAY)
        self.assertEqual((summary["audit_selected"], journal.events), (0, []))
        self.assertEqual(self.due(), first)

    def test_selection_is_deterministic_for_a_date(self):
        self.scan(THURSDAY)
        first = self.due()
        for row in Question.objects.all():
            row.quality = {"band": "medium"}
            row.save()
        self.scan(THURSDAY)
        self.assertEqual(self.due(), first)

    def test_rows_already_due_from_an_earlier_week_are_skipped(self):
        earlier = self.rows[:3]
        for row in earlier:
            row.quality = {**row.quality, "audit_due": True, "audit_selected": "2026-10-08"}
            row.save()
        summary, _ = self.scan(THURSDAY)
        self.assertEqual(summary["audit_selected"], 20)
        self.assertEqual(len(self.due()), 23)


class CommandTests(DoctorTestCase):
    def test_journal_and_github_output(self):
        self.q(pid=1)
        for _ in range(3):
            self.report("career-path", 1)
        with tempfile.TemporaryDirectory() as tmp:
            gh = os.path.join(tmp, "out")
            with patch.dict(os.environ, {"GITHUB_OUTPUT": gh}), \
                    patch("trivia.management.commands.doctor_scan.timezone.now", return_value=WEDNESDAY):
                call_command("doctor_scan", stdout=StringIO())
            with open(gh, encoding="utf-8") as f:
                self.assertIn("quarantined=1\n", f.read())
        run = FactoryRun.objects.get()
        self.assertEqual((run.kind, run.status), ("doctor", "ok"))
        self.assertTrue(run.events.filter(action="quarantined", reason="signal").exists())
