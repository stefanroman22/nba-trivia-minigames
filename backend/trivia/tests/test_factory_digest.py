"""Phase 5 review loop (spec §4.8): the fortnightly digest, band calibration and the review cards."""
import datetime
import json
import os
import tempfile
from io import StringIO

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase
from django.utils import timezone

from trivia.models import FactoryEvent, FactoryRun, GameDailyStats, Question, QuestionStats
from trivia.questions import calibration, specs


class DigestTestCase(TestCase):
    _n = 0

    def setUp(self):
        self.now = timezone.now()
        self.today = self.now.date()

    def run_(self, kind, days_ago=1, status="ok", minutes=5, trigger="schedule"):
        started = self.now - datetime.timedelta(days=days_ago)
        return FactoryRun.objects.create(kind=kind, trigger=trigger, status=status, started_at=started,
                                         finished_at=started + datetime.timedelta(minutes=minutes))

    def events(self, run, action, n, reason="", game="career-path", prefix="cp", **detail):
        FactoryEvent.objects.bulk_create([
            FactoryEvent(run=run, action=action, reason=reason, game=game, qid=f"{prefix}-{i:06d}",
                         detail=dict(detail), created_at=run.started_at + datetime.timedelta(minutes=1))
            for i in range(n)])

    def q(self, game="career-path", status="active", pid=None, **quality):
        DigestTestCase._n += 1
        n = DigestTestCase._n
        definition = {"person_id": pid if pid is not None else 50_000 + n}
        return Question.objects.create(game=game, qid=f"{game[:3]}-q{n:06d}", definition=definition,
                                       content_hash=f"{n:064d}", status=status, quality=quality)

    def stats(self, game, question_id, attempts, correct, days_ago=2):
        QuestionStats.objects.create(game=game, question_id=str(question_id), attempts=attempts, correct=correct,
                                     players=attempts, day=self.today - datetime.timedelta(days=days_ago))

    def calibration_fixture(self, attempts, correct_by_band):
        """Nine active career-path questions, three per band, each answered `attempts` times."""
        for band, difficulties in (("easy", (0.1, 0.2, 0.3)), ("medium", (0.4, 0.5, 0.6)),
                                   ("hard", (0.7, 0.8, 0.9))):
            for d in difficulties:
                row = self.q(band=band, difficulty=d)
                self.stats("career-path", row.definition["person_id"], attempts, correct_by_band[band])

    def digest(self, days=14):
        out = tempfile.mkdtemp()
        call_command("factory_digest", "--days", str(days), "--out", out, stdout=StringIO())
        with open(os.path.join(out, "digest.json"), encoding="utf-8") as f:
            data = json.load(f)
        with open(os.path.join(out, "digest.md"), encoding="utf-8") as f:
            md = f.read()
        return data, md


class DigestTests(DigestTestCase):
    def setUp(self):
        super().setUp()
        checker = self.run_("checker", days_ago=3, minutes=12)
        self.events(checker, "approved", 200, reason="all_confirmed")
        self.events(checker, "unsure", 20, reason="unconfirmed", prefix="un")
        self.events(checker, "quarantined", 5, reason="contradicted", prefix="qa")
        self.events(checker, "audit_passed", 18, reason="all_confirmed", prefix="au")
        self.events(checker, "quarantined", 2, reason="contradicted", prefix="am", audit=True)
        self.events(checker, "checker_miss", 1, reason="audit_invalid", prefix="am")
        # The doctor retired a question the Checker had approved (a miss) and one it never checked.
        checked = self.q(checked={"verdict": "valid"}, status="retired")
        unchecked = self.q(status="retired")
        doctor = self.run_("doctor", days_ago=2)
        for row in (checked, unchecked):
            FactoryEvent.objects.create(run=doctor, action="retired", reason="doctor", game=row.game, qid=row.qid,
                                        created_at=doctor.started_at)
        # Older than the window: none of it counts.
        old = self.run_("checker", days_ago=20)
        self.events(old, "approved", 50, prefix="old")
        self.events(old, "checker_miss", 3, prefix="old")
        supply = self.run_("supply", days_ago=1, status="degraded", minutes=30)
        FactoryEvent.objects.create(run=supply, action="held_back", reason="below_minimum", game="contexto",
                                    created_at=supply.started_at)
        FactoryEvent.objects.create(run=supply, action="held_back", reason="below_minimum", game="tictactoe",
                                    created_at=supply.started_at)
        self.events(supply, "rejected", 3, reason="duplicate")
        self.events(supply, "rejected", 2, reason="low_interest", prefix="li")
        self.events(checker, "rejected", 1, reason="stale", prefix="st")
        self.run_("supply", days_ago=2, minutes=10)
        # career-path: 14 plays in the last 14 days (1 a day) and 60 live questions -> 60 days of runway.
        for i in range(1, 15):
            GameDailyStats.objects.create(game="career-path", day=self.today - datetime.timedelta(days=i),
                                          mode="solo", plays=1, players=1)
        for _ in range(60):
            self.q()

    def test_checker_kpis(self):
        data, _ = self.digest()
        kpis = data["kpis"]
        self.assertEqual(kpis["checker_approved"], 200)
        self.assertEqual(kpis["checker_misses"], 2)
        self.assertAlmostEqual(kpis["checker_miss_rate"], 0.01)
        self.assertAlmostEqual(kpis["unsure_share"], 20 / 245)
        self.assertAlmostEqual(kpis["audit_error_rate"], 0.1)

    def test_runway_held_back_and_rejections(self):
        data, _ = self.digest()
        runway = data["runway"]["career-path"]
        self.assertEqual(runway["active"], 60)
        self.assertAlmostEqual(runway["days"], 60.0)
        self.assertEqual(runway["target_days"], 90)
        self.assertFalse(runway["ok"])
        self.assertIsNone(data["runway"]["who-are-ya"]["days"])  # no plays: no data
        self.assertEqual(data["kpis"]["held_back"], 2)
        self.assertEqual(data["kpis"]["held_back_max_per_run"], 2)
        self.assertEqual(data["rejections"], {"duplicate": 3, "low_interest": 2, "stale": 1})

    def test_run_durations_and_markdown(self):
        data, md = self.digest()
        self.assertEqual(data["runs"]["supply"]["count"], 2)
        self.assertEqual(data["runs"]["supply"]["max_s"], 1800)
        self.assertEqual(data["runs"]["checker"]["count"], 1)  # the 20-day-old run is outside
        self.assertIn("## KPIs", md)
        self.assertIn("1.00%", md)  # Checker miss rate
        self.assertIn("career-path", md)

    def test_the_digest_is_read_only(self):
        before = FactoryRun.objects.count()
        self.digest()
        self.assertEqual(FactoryRun.objects.count(), before)


class EmptyDigestTests(DigestTestCase):
    def test_no_data_is_null_and_says_so(self):
        data, md = self.digest()
        self.assertIsNone(data["kpis"]["checker_miss_rate"])
        self.assertIsNone(data["kpis"]["unsure_share"])
        self.assertIsNone(data["kpis"]["audit_error_rate"])
        self.assertIsNone(data["kpis"]["false_alarm_share"])
        self.assertIsNone(data["kpis"]["quarantined_per_week"])
        self.assertIn("no data", md)

    def test_median_pending_to_active_is_from_the_last_generation(self):
        self.events(self.run_("supply", days_ago=4), "generated", 1)
        self.events(self.run_("checker", days_ago=3), "approved", 1)
        self.assertEqual(self.digest()[0]["kpis"]["median_pending_to_active_h"], 24.0)

    def test_the_digest_prints_a_calibration_proposal(self):
        self.calibration_fixture(40, {"easy": 30, "medium": 10, "hard": 20})
        data, md = self.digest()
        cal = data["calibration"]["career-path"]
        self.assertEqual(cal["answers"], 360)
        self.assertFalse(cal["monotonic"])
        self.assertIsNotNone(cal["proposal"])
        self.assertIn('"easy": [0, ', md)


class CalibrationTests(DigestTestCase):
    def test_monotonic_solve_rates_propose_nothing(self):
        self.calibration_fixture(40, {"easy": 30, "medium": 20, "hard": 10})
        self.assertIsNone(calibration.propose_band_edges("career-path"))

    def test_inverted_medium_and_hard_propose_strictly_increasing_edges(self):
        self.calibration_fixture(40, {"easy": 30, "medium": 10, "hard": 20})
        bands = calibration.propose_band_edges("career-path")
        self.assertIsNotNone(bands)
        self.assertEqual(set(bands), {"easy", "medium", "hard"})
        e1, e2 = bands["easy"][1], bands["medium"][1]
        self.assertEqual(bands["easy"][0], 0)
        self.assertEqual(bands["hard"], [e2, 1])
        self.assertEqual(bands["medium"][0], e1)
        self.assertTrue(0 < e1 < e2 < 1)
        self.assertAlmostEqual(e1, 0.3667, places=3)
        self.assertAlmostEqual(e2, 0.6333, places=3)
        spec = specs.load("career-path")
        spec["difficulty"]["bands"] = bands
        specs.validate("career-path", spec)  # a valid spec file

    def test_fewer_than_300_answers_propose_nothing(self):
        self.calibration_fixture(30, {"easy": 25, "medium": 5, "hard": 15})  # 270 answers
        self.assertIsNone(calibration.propose_band_edges("career-path"))

    def test_answers_outside_the_window_do_not_count(self):
        for band, d in (("easy", 0.1), ("medium", 0.5), ("hard", 0.9)):
            row = self.q(band=band, difficulty=d)
            self.stats("career-path", row.definition["person_id"], 200, {"easy": 150, "medium": 50, "hard": 100}[band],
                       days_ago=30)
        self.assertIsNone(calibration.propose_band_edges("career-path", days=14))


class SpecEditTests(TestCase):
    def setUp(self):
        self.before = specs.load("career-path")

    def test_a_bands_only_change_is_accepted(self):
        after = json.loads(json.dumps(self.before))
        after["difficulty"]["bands"] = {"easy": [0, 0.3], "medium": [0.3, 0.6], "hard": [0.6, 1]}
        self.assertEqual(calibration.spec_edit_problems("career-path", self.before, after), [])

    def test_any_other_change_is_refused(self):
        after = json.loads(json.dumps(self.before))
        after["difficulty"]["bands"] = {"easy": [0, 0.3], "medium": [0.3, 0.6], "hard": [0.6, 1]}
        after["refill"]["minimum"] = 1
        self.assertTrue(calibration.spec_edit_problems("career-path", self.before, after))

    def test_invalid_bands_are_refused(self):
        after = json.loads(json.dumps(self.before))
        after["difficulty"]["bands"] = {"easy": [0, 0.6], "medium": [0.3, 0.6], "hard": [0.6, 1]}
        self.assertTrue(calibration.spec_edit_problems("career-path", self.before, after))


GOOD = {"title": "Lower the career-path solve-rate floor", "category": "backend", "priority": "P1",
        "body": "Checker miss rate 1.2% (target < 0.5%)."}


class ReviewCardsTests(TestCase):
    def call(self, data):
        d = tempfile.mkdtemp()
        src, dst = os.path.join(d, "cards.json"), os.path.join(d, "valid.json")
        with open(src, "w", encoding="utf-8") as f:
            f.write(data if isinstance(data, str) else json.dumps(data))
        buf = StringIO()
        call_command("validate_review_cards", src, "--out", dst, stdout=buf)
        with open(dst, encoding="utf-8") as f:
            return json.load(f), buf.getvalue()

    def test_a_good_file_is_accepted(self):
        cards, _ = self.call({"cards": [GOOD, {**GOOD, "category": "AI", "priority": "P2"}]})
        self.assertEqual(len(cards), 2)
        self.assertEqual(cards[0], GOOD)

    def test_no_cards_is_fine(self):
        self.assertEqual(self.call({"cards": []})[0], [])

    def test_more_than_three_cards_are_refused(self):
        cards, out = self.call({"cards": [GOOD] * 4})
        self.assertEqual(cards, [])
        self.assertIn("at most 3", out)

    def test_a_missing_field_is_refused(self):
        card = {k: v for k, v in GOOD.items() if k != "body"}
        self.assertEqual(self.call({"cards": [GOOD, card]})[0], [])

    def test_an_unknown_category_is_refused(self):
        self.assertEqual(self.call({"cards": [{**GOOD, "category": "growth"}]})[0], [])

    def test_bad_priority_long_title_or_body_are_refused(self):
        for card in ({**GOOD, "priority": "P3"}, {**GOOD, "title": "x" * 81}, {**GOOD, "body": "x" * 2001},
                     {**GOOD, "title": "two\nlines"}, {**GOOD, "extra": "field"}):
            self.assertEqual(self.call({"cards": [card]})[0], [], card)

    def test_a_missing_or_malformed_file_gives_no_cards(self):
        self.assertEqual(self.call("not json")[0], [])
        d = tempfile.mkdtemp()
        dst = os.path.join(d, "valid.json")
        call_command("validate_review_cards", os.path.join(d, "absent.json"), "--out", dst, stdout=StringIO())
        with open(dst, encoding="utf-8") as f:
            self.assertEqual(json.load(f), [])

    def test_a_spec_edit_beyond_the_bands_fails_the_command(self):
        d = tempfile.mkdtemp()
        before = specs.load("career-path")
        before["refill"]["minimum"] = 1  # the file on disk differs from this "before" outside the bands
        path = os.path.join(d, "before.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(before, f)
        with self.assertRaises(CommandError):
            call_command("validate_review_cards", "--spec-edit", "career-path", path, stdout=StringIO())

    def test_an_unchanged_spec_passes(self):
        d = tempfile.mkdtemp()
        path = os.path.join(d, "before.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(specs.load("career-path"), f)
        call_command("validate_review_cards", "--spec-edit", "career-path", path, stdout=StringIO())
