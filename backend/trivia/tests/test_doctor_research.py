"""Phase 5 doctor research (spec §4.9): export cases, apply the doctor's verdicts, and the
Checker's confirmation of a proposed data correction."""
import datetime
import json
import os
from io import StringIO

from django.core.management import call_command

from trivia.models import DataCorrection, FactoryRun, Question, WrongAnswerStats
from trivia.questions import checker, corrections, doctor, health
from trivia.questions.games import GAME_MODULES
from trivia.tests.test_checker_jobs import BREF, CheckerJobsTestCase
from trivia.tests.test_doctor import WEDNESDAY, DoctorTestCase

WIKI = "https://en.wikipedia.org/wiki/Someone"
NBA = "https://www.nba.com/player/1/someone"


class DoctorResearchTestCase(CheckerJobsTestCase):
    def setUp(self):
        super().setUp()
        DataCorrection.objects.all().delete()  # without the seeded ones (migration 0014)
        self.stage(("career-path",))
        self.rows = list(Question.objects.filter(game="career-path").order_by("id"))
        self.dir = os.path.join(self.tmp, "doctor-verdicts")
        os.makedirs(self.dir)
        self._files = 0

    def pid(self, row):
        return row.definition["person_id"]

    def curated(self, pid):
        return next(r for r in self.ds.rows if r["person_id"] == pid)

    def quarantine(self, row, **extra):
        row.status = "quarantined"
        row.quality = {**row.quality, "doctor": {"signals": [{"signal": "reports", "count": 3}],
                                                 "at": WEDNESDAY.isoformat(), "reports": ["wrong team"]},
                       **extra}
        row.save()
        return row

    def queue(self, row):
        row.status = "active"
        row.quality = {**row.quality, "doctor_queue": True,
                       "doctor": {"signals": [{"signal": "reports", "count": 1}], "at": WEDNESDAY.isoformat(),
                                  "reports": ["hmm"]}}
        row.save()
        return row

    def write(self, verdict, name=None):
        self._files += 1
        with open(os.path.join(self.dir, name or f"verdict-{self._files:03d}.json"), "w", encoding="utf-8") as f:
            json.dump(verdict, f)

    def verdict(self, row, kind, **kw):
        return {"game": row.game, "qid": row.qid, "verdict": kind, "rationale": "researched", "sources": [BREF], **kw}

    def correction(self, row, path="teams[0].end_year", sources=(BREF, WIKI), old=None, new=None, pid=None):
        pid = self.pid(row) if pid is None else pid
        current = corrections.read(self.curated(self.pid(row)), path)
        return {"person_id": pid, "field_path": path, "old_value": current if old is None else old,
                "new_value": current + 1 if new is None else new, "sources": list(sources)}

    def apply(self):
        buf = StringIO()
        call_command("apply_doctor_verdicts", self.dir, stdout=buf)
        return buf.getvalue()

    def run_(self):
        return FactoryRun.objects.order_by("-id").first()

    def reasons(self, action):
        return sorted(self.run_().events.filter(action=action).values_list("reason", flat=True))


class ExportCasesTests(DoctorResearchTestCase):
    def export_cases(self, *args):
        out = os.path.join(self.tmp, "doctor")
        call_command("export_doctor_cases", "--out", out, *args, stdout=StringIO())
        found = {}
        for n in sorted(os.listdir(out)):
            with open(os.path.join(out, n), encoding="utf-8") as f:
                found[n] = json.load(f)
        return found

    def test_quarantined_and_queued_questions_become_cases(self):
        queued = self.queue(self.rows[0])
        quarantined = self.quarantine(self.rows[1])
        self.rows[2].status = "active"
        self.rows[2].save()  # live, no signal: not a case
        pid = self.pid(quarantined)
        WrongAnswerStats.objects.create(game="career-path", question_id=str(pid), answer_norm="kobe bryant",
                                        count=12, players=6, first_seen=WEDNESDAY, last_seen=WEDNESDAY)
        files = self.export_cases()
        self.assertEqual(list(files), ["case-001.json", "case-002.json"])
        first, second = files["case-001.json"], files["case-002.json"]
        self.assertEqual((first["qid"], second["qid"]), (quarantined.qid, queued.qid))  # out of play first
        mod = GAME_MODULES["career-path"]
        self.assertEqual(first["view"], mod.checker_view(mod.materialize(quarantined.definition, self.ds), self.ds))
        self.assertEqual(first["players"], [self.curated(pid)])
        self.assertEqual(first["wrong_answers"], [{"question_id": str(pid), "answer": "kobe bryant",
                                                   "count": 12, "players": 6}])
        self.assertEqual(first["reports"], ["wrong team"])
        self.assertEqual(first["signals"], [{"signal": "reports", "count": 3}])
        self.assertEqual(first["status"], "quarantined")
        self.assertEqual(first["allowed_sites"], list(checker.ALLOWED_SITES))
        self.assertIn('cases=["001", "002"]', self.gh_output())
        self.assertIn("count=2", self.gh_output())

    def test_limit(self):
        for row in self.rows[:3]:
            self.quarantine(row)
        self.assertEqual(len(self.export_cases("--limit", "2")), 2)

    def test_nothing_to_research(self):
        self.assertEqual(self.export_cases(), {})
        self.assertIn("cases=[]", self.gh_output())
        self.assertIn("count=0", self.gh_output())


class ApplyDoctorVerdictTests(DoctorResearchTestCase):
    def test_a_sourced_correction_is_proposed_and_the_question_stays_quarantined(self):
        row = self.quarantine(self.rows[0])
        fix = self.correction(row)
        self.write(self.verdict(row, "data_correction", corrections=[fix]))
        self.apply()
        c = DataCorrection.objects.get()
        self.assertEqual((c.status, c.created_by, c.person_id, c.field_path), ("proposed", "doctor", fix["person_id"],
                                                                                fix["field_path"]))
        self.assertEqual((c.old_value, c.new_value, c.sources), (fix["old_value"], fix["new_value"], [BREF, WIKI]))
        run = self.run_()
        self.assertEqual((run.kind, c.run_id), ("doctor", run.pk))
        row.refresh_from_db()
        self.assertEqual(row.status, "quarantined")
        self.assertIn("proposed=1\n", self.gh_output())
        self.assertTrue(run.events.filter(action="correction_proposed", qid=row.qid).exists())

    def test_sources_on_one_domain_are_rejected(self):
        row = self.quarantine(self.rows[0])
        other = BREF.replace("x01", "y01")
        self.write(self.verdict(row, "data_correction",
                                corrections=[self.correction(row, sources=(BREF, other, "https://example.com/a"))]))
        self.apply()
        self.assertFalse(DataCorrection.objects.exists())
        self.assertEqual(self.reasons("rejected"), ["too_few_domains"])

    def test_an_old_value_that_is_not_the_current_value_is_rejected(self):
        row = self.quarantine(self.rows[0])
        current = corrections.read(self.curated(self.pid(row)), "teams[0].end_year")
        self.write(self.verdict(row, "data_correction", corrections=[self.correction(row, old=current - 5)]))
        self.apply()
        self.assertFalse(DataCorrection.objects.exists())
        self.assertEqual(self.reasons("rejected"), ["old_value_mismatch"])

    def test_an_unknown_person_or_path_is_rejected(self):
        row = self.quarantine(self.rows[0])
        bad_person = self.correction(row, pid=-12345)
        bad_path = {**self.correction(row), "field_path": "teams[99].end_year"}
        self.write(self.verdict(row, "data_correction", corrections=[bad_person, bad_path]))
        self.apply()
        self.assertFalse(DataCorrection.objects.exists())
        self.assertEqual(self.reasons("rejected"), ["invalid_path", "unknown_person"])

    def test_a_field_with_an_open_correction_is_not_proposed_twice(self):
        row = self.quarantine(self.rows[0])
        fix = self.correction(row)
        DataCorrection.objects.create(person_id=fix["person_id"], field_path=fix["field_path"], new_value=1,
                                      status=DataCorrection.STATUS_PROPOSED)
        self.write(self.verdict(row, "data_correction", corrections=[fix]))
        self.apply()
        self.assertEqual(DataCorrection.objects.count(), 1)
        self.assertEqual(self.reasons("rejected"), ["correction_exists"])

    def test_reband_sets_the_band_and_releases_for_a_recheck(self):
        row = self.quarantine(self.rows[0])
        band = "hard" if row.quality.get("band") != "hard" else "easy"
        self.write(self.verdict(row, "reband", band=band))
        self.apply()
        row.refresh_from_db()
        self.assertEqual((row.status, row.quality["band"]), ("pending", band))
        self.assertIn("doctor_released_at", row.quality)
        self.assertNotIn("doctor", row.quality)
        self.stage(("career-path",))  # the next supply run re-scores: the doctor's band holds
        row.refresh_from_db()
        self.assertEqual(row.quality["band"], band)

    def test_reband_to_an_unknown_band_is_rejected(self):
        row = self.quarantine(self.rows[0])
        self.write(self.verdict(row, "reband", band="impossible"))
        self.apply()
        row.refresh_from_db()
        self.assertEqual(row.status, "quarantined")
        self.assertEqual(self.reasons("rejected"), ["invalid_band"])

    def test_retire(self):
        quarantined = self.quarantine(self.rows[0])
        live = self.queue(self.rows[1])
        self.write(self.verdict(quarantined, "retire", rationale="two readings"))
        self.write(self.verdict(live, "retire"))
        self.apply()
        for row in (quarantined, live):
            row.refresh_from_db()
            self.assertEqual(row.status, "retired")
            self.assertIsNotNone(row.retired_at)
        self.assertIn("two readings", quarantined.retired_reason)
        self.assertIn("changed=1\n", self.gh_output())  # only the live one leaves production

    def test_false_alarm_goes_back_to_pending_never_straight_to_active(self):
        row = self.quarantine(self.rows[0])
        self.write(self.verdict(row, "false_alarm"))
        self.apply()
        row.refresh_from_db()
        self.assertEqual(row.status, "pending")
        self.assertNotIn("doctor", row.quality)
        self.assertNotIn("doctor_queue", row.quality)
        self.assertIn("doctor_released_at", row.quality)
        self.assertTrue(self.run_().events.filter(action="released", reason="false_alarm").exists())

    def test_false_alarm_on_a_queued_live_question_only_clears_the_queue(self):
        row = self.queue(self.rows[0])
        self.write(self.verdict(row, "false_alarm"))
        self.apply()
        row.refresh_from_db()
        self.assertEqual(row.status, "active")
        self.assertNotIn("doctor_queue", row.quality)
        self.assertIn("doctor_released_at", row.quality)

    def test_needs_owner_is_an_event_the_health_check_reports(self):
        row = self.quarantine(self.rows[0])
        self.write(self.verdict(row, "needs_owner", rationale="sources disagree"))
        output = self.apply()
        row.refresh_from_db()
        self.assertEqual(row.status, "quarantined")
        self.assertIn("::warning::", output)
        run = self.run_()
        self.assertEqual(run.status, "degraded")
        self.assertTrue(run.events.filter(action="needs_owner", qid=row.qid).exists())
        found = [f for f in health.check(run.finished_at) if f["code"] == "needs_owner"]
        self.assertEqual(len(found), 1)
        self.assertIn(f"career-path/{row.qid}", found[0]["text"])

    def test_editorial_kinds_are_deferred(self):
        a, b, c = (self.quarantine(r) for r in self.rows[:3])
        self.write(self.verdict(a, "fix_answers", answers=["Kobe Bryant"]))
        self.write(self.verdict(b, "add_alias", alias={"answer": "Kobe Bryant", "alias": "kobe"}))
        self.write(self.verdict(c, "add_alias", alias="kobe"))
        self.apply()
        self.assertEqual(self.reasons("deferred"), ["add_alias", "fix_answers"])
        self.assertEqual(self.reasons("rejected"), ["malformed_alias"])
        self.assertEqual(set(Question.objects.filter(pk__in=[a.pk, b.pk, c.pk]).values_list("status", flat=True)),
                         {"quarantined"})

    def test_unknown_kinds_unknown_questions_and_duplicates_are_rejected(self):
        row = self.quarantine(self.rows[0])
        plain = self.rows[1]
        plain.status = "active"
        plain.save()
        self.write(self.verdict(row, "retire"))
        self.write(self.verdict(row, "false_alarm"))  # second verdict for the same question
        self.write(self.verdict(self.rows[2], "make_it_up"))
        self.write(self.verdict(plain, "retire"))  # not quarantined, not queued
        self.apply()
        row.refresh_from_db()
        plain.refresh_from_db()
        self.assertEqual((row.status, plain.status), ("retired", "active"))
        self.assertEqual(self.reasons("rejected"), ["duplicate", "not_in_research", "unknown_verdict"])

    def test_a_malformed_file_is_journaled_and_the_rest_still_applies(self):
        row = self.quarantine(self.rows[0])
        with open(os.path.join(self.dir, "verdict-000.json"), "w", encoding="utf-8") as f:
            f.write("{not json")
        self.write(["not", "an", "object"], name="verdict-009.json")
        self.write(self.verdict(row, "retire"))
        self.apply()
        row.refresh_from_db()
        self.assertEqual(row.status, "retired")
        self.assertEqual(self.reasons("rejected"), ["malformed_file", "malformed_file"])

    def test_evidence_is_capped(self):
        row = self.quarantine(self.rows[0])
        self.write(self.verdict(row, "retire", rationale="x" * 9000, sources=[BREF] * 50))
        self.apply()
        event = self.run_().events.get(action="retired")
        self.assertLessEqual(len(event.detail["rationale"]), 2000)
        self.assertLessEqual(len(event.detail["sources"]), 10)


class CorrectionConfirmationTests(DoctorResearchTestCase):
    def setUp(self):
        super().setUp()
        self.target = self.rows[0]
        self.pid_ = self.pid(self.target)
        current = corrections.read(self.curated(self.pid_), "teams[0].end_year")
        self.fix = DataCorrection.objects.create(
            person_id=self.pid_, field_path="teams[0].end_year", old_value=current, new_value=current + 1,
            sources=[BREF, WIKI], status=DataCorrection.STATUS_PROPOSED, created_by="doctor")
        self.vdir = os.path.join(self.tmp, "verdicts")
        os.makedirs(self.vdir)

    def checker_verdict(self, verdict="valid", status="confirmed", sources=(BREF, WIKI), cid=None):
        return {"kind": "correction", "id": self.fix.pk if cid is None else cid, "verdict": verdict,
                "summary": "checked", "claims": [{"claim": "new value", "status": status, "sources": list(sources)}]}

    def apply_checker(self, *verdicts):
        with open(os.path.join(self.vdir, "verdicts-001.json"), "w", encoding="utf-8") as f:
            json.dump({"verdicts": list(verdicts)}, f)
        call_command("apply_checker_verdicts", self.vdir, stdout=StringIO())

    def test_corrections_mode_exports_each_proposed_correction(self):
        DataCorrection.objects.create(person_id=self.pid_, field_path="jersey", new_value=1,
                                      status=DataCorrection.STATUS_ACTIVE)
        out = self.export("--mode", "corrections")
        self.assertEqual(sorted(os.listdir(out)), ["correction-001.json"])
        with open(os.path.join(out, "correction-001.json"), encoding="utf-8") as f:
            item = json.load(f)
        self.assertEqual(item["kind"], "correction")
        self.assertEqual((item["id"], item["person_id"], item["field_path"]),
                         (self.fix.pk, self.pid_, "teams[0].end_year"))
        self.assertEqual((item["old_value"], item["new_value"], item["sources"]),
                         (self.fix.old_value, self.fix.new_value, [BREF, WIKI]))
        self.assertEqual(item["player"], self.curated(self.pid_)["full_name"])
        self.assertEqual(item["row"]["teams"], self.curated(self.pid_)["teams"])
        self.assertIn('batches=["001"]', self.gh_output())
        self.assertIn("count=1", self.gh_output())

    def test_a_confirmed_correction_goes_active_and_re_pends_the_questions_on_that_player(self):
        quarantined = self.quarantine(self.target)
        pending = Question.objects.create(game="who-are-ya", qid="way-1", definition={"person_id": self.pid_},
                                          content_hash="w" * 64, status="pending",
                                          players_referenced=[self.pid_], quality={"doctor_queue": True})
        other = self.quarantine(self.rows[1])
        self.apply_checker(self.checker_verdict())
        self.fix.refresh_from_db()
        self.assertEqual(self.fix.status, "active")
        self.assertIsNotNone(self.fix.decided_at)
        for row in (quarantined, pending, other):
            row.refresh_from_db()
        self.assertEqual((quarantined.status, pending.status, other.status), ("pending", "pending", "quarantined"))
        for row in (quarantined, pending):
            self.assertIn("doctor_released_at", row.quality)
            self.assertNotIn("doctor", row.quality)
            self.assertNotIn("doctor_queue", row.quality)
        self.assertIn("changed=1\n", self.gh_output())  # the dataset changed: publish re-stages live questions
        run = FactoryRun.objects.get(kind="checker")
        self.assertTrue(run.events.filter(action="correction_confirmed").exists())

    def test_one_confirming_domain_is_not_enough(self):
        self.apply_checker(self.checker_verdict(sources=(BREF,)))
        self.fix.refresh_from_db()
        self.assertEqual(self.fix.status, "proposed")

    def test_a_contradicted_correction_is_rejected(self):
        self.apply_checker(self.checker_verdict("invalid", "contradicted"))
        self.fix.refresh_from_db()
        self.assertEqual(self.fix.status, "rejected")
        self.assertIsNotNone(self.fix.decided_at)

    def test_a_correction_whose_old_value_moved_since_it_was_proposed_is_not_applied(self):
        self.fix.old_value = self.fix.old_value - 3
        self.fix.save()
        self.apply_checker(self.checker_verdict())
        self.fix.refresh_from_db()
        self.assertEqual(self.fix.status, "rejected")
        self.assertTrue(FactoryRun.objects.get().events.filter(action="rejected", reason="stale_correction").exists())

    def test_unsure_stays_proposed(self):
        self.apply_checker(self.checker_verdict("unsure", "unverified", sources=()))
        self.fix.refresh_from_db()
        self.assertEqual(self.fix.status, "proposed")

    def test_only_proposed_corrections_can_be_confirmed(self):
        self.fix.status = DataCorrection.STATUS_REJECTED
        self.fix.save()
        self.apply_checker(self.checker_verdict(), self.checker_verdict(cid=999999))
        self.fix.refresh_from_db()
        self.assertEqual(self.fix.status, "rejected")
        reasons = FactoryRun.objects.get().events.filter(action="rejected").values_list("reason", flat=True)
        self.assertEqual(sorted(reasons), ["not_proposed", "not_proposed"])


class ReleaseMarkerScanTests(DoctorTestCase):
    """A released question is judged only on what players did after its release."""
    RELEASED = datetime.datetime(2026, 10, 12, 3, 0, tzinfo=datetime.timezone.utc)

    def released(self, pid):
        return self.q(pid=pid, doctor_released_at=self.RELEASED.isoformat())

    def test_stats_from_before_the_release_do_not_flag_it_again(self):
        row = self.released(1)
        self.stats("career-path", 1, 40, 0, day=datetime.date(2026, 10, 11))
        self.stats("career-path", 1, 40, 0, day=datetime.date(2026, 10, 12))  # the release day began before it
        self.scan()
        row.refresh_from_db()
        self.assertNotIn("doctor_queue", row.quality)

    def test_stats_after_the_release_still_count(self):
        row = self.released(1)
        self.stats("career-path", 1, 40, 0, day=datetime.date(2026, 10, 11))
        self.stats("career-path", 1, 30, 0, day=datetime.date(2026, 10, 13))
        self.scan()
        row.refresh_from_db()
        self.assertTrue(row.quality["doctor_queue"])
        self.assertEqual(row.quality["doctor"]["signals"][0]["attempts"], 30)

    def test_wrong_answers_last_seen_before_the_release_are_ignored(self):
        row = self.released(1)
        before = self.RELEASED - datetime.timedelta(days=1)
        WrongAnswerStats.objects.create(game="career-path", question_id="1", answer_norm="kobe bryant", count=20,
                                        players=8, first_seen=before, last_seen=before)
        self.scan()
        row.refresh_from_db()
        self.assertNotIn("doctor_queue", row.quality)
        WrongAnswerStats.objects.filter(answer_norm="kobe bryant").update(last_seen=WEDNESDAY)
        self.scan()
        row.refresh_from_db()
        self.assertTrue(row.quality["doctor_queue"])

    def test_release_helper(self):
        row = self.q(pid=1, status="quarantined", doctor={"signals": []}, doctor_queue=True)
        doctor.release(row, WEDNESDAY)
        self.assertEqual(row.status, "pending")
        self.assertEqual(row.quality["doctor_released_at"], WEDNESDAY.isoformat())
        self.assertNotIn("doctor", row.quality)
        self.assertNotIn("doctor_queue", row.quality)
