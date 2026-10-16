"""Data corrections: sourced fixes overlaid on the curated rows (spec §4.9)."""
import copy
import json
import os
import tempfile
from unittest import mock

from django.test import SimpleTestCase, TestCase

from trivia.data_pipeline import live_pool, publish_v3
from trivia.models import DataCorrection
from trivia.questions import corrections
from trivia.questions.journal import Journal


def _rows():
    return [
        {"person_id": 2, "full_name": "Byron Scott", "jersey": None, "is_active": False,
         "draft": {"year": 1983, "round": 1, "pick": 4, "team_abbr": "SDC"},
         "teams": [{"abbr": "LAL", "start_year": 1983, "end_year": 1993},
                   {"abbr": "IND", "start_year": 1993, "end_year": 1995},
                   {"abbr": "MEM", "start_year": 1995, "end_year": 1996}],
         "awards": {"mvp": [], "smoy": [], "roty": None, "rings": [1985, 1987, 1988]}},
        {"person_id": 3, "full_name": "Grant Long", "jersey": 43, "is_active": False,
         "draft": {"year": 1988, "round": 2, "pick": 33, "team_abbr": "MIA"},
         "teams": [{"abbr": "MIA", "start_year": 1988, "end_year": 1994}],
         "awards": {"mvp": [], "smoy": [], "roty": None, "rings": []}},
    ]


def _fix(person_id, field_path, new_value, status=DataCorrection.STATUS_ACTIVE, **kw):
    return DataCorrection(person_id=person_id, field_path=field_path, new_value=new_value,
                          status=status, **kw)


class ApplyTests(SimpleTestCase):
    def test_overlays_a_stint_year_without_touching_the_input(self):
        rows = _rows()
        before = copy.deepcopy(rows)
        out = corrections.apply(rows, [_fix(2, "teams[1].end_year", 1994)])
        self.assertEqual(out[0]["teams"][1]["end_year"], 1994)
        self.assertEqual(out[0]["teams"][0], before[0]["teams"][0])
        self.assertEqual(out[1], before[1])
        self.assertEqual(rows, before)  # the caller's rows are never mutated

    def test_overlays_a_nested_award_list_and_a_top_level_scalar(self):
        out = corrections.apply(_rows(), [_fix(3, "awards.smoy", [1990, 1991]),
                                          _fix(2, "jersey", 4),
                                          _fix(2, "draft.team_abbr", "LAC")])
        self.assertEqual(out[1]["awards"]["smoy"], [1990, 1991])
        self.assertEqual(out[0]["jersey"], 4)
        self.assertEqual(out[0]["draft"]["team_abbr"], "LAC")

    def test_two_corrections_on_one_row_both_land(self):
        out = corrections.apply(_rows(), [_fix(2, "teams[0].end_year", 1992),
                                          _fix(2, "teams[1].start_year", 1992)])
        self.assertEqual((out[0]["teams"][0]["end_year"], out[0]["teams"][1]["start_year"]), (1992, 1992))

    def test_the_overlaid_value_is_a_copy_of_the_correction(self):
        fix = _fix(3, "awards.smoy", [1990])
        out = corrections.apply(_rows(), [fix])
        out[1]["awards"]["smoy"].append(1999)
        self.assertEqual(fix.new_value, [1990])

    def test_invalid_paths_are_skipped_and_journaled(self):
        bad = [
            _fix(2, "awards.xyz", 1),          # missing key
            _fix(2, "teams[9].end_year", 1),   # index out of range
            _fix(2, "awards[0]", 1),           # index into a dict
            _fix(2, "teams.abbr", "X"),        # key on a list
            _fix(2, "jersey.number", 4),       # step into a scalar
            _fix(2, "nickname", "B"),          # would add a new top-level key
            _fix(2, "teams[x].end_year", 1),   # malformed
            _fix(2, "", 1),                    # empty
            _fix(2, "person_id", 7),           # the row's identity
            _fix(99, "jersey", 4),             # no such player
        ]
        journal = Journal("test")
        rows = _rows()
        out = corrections.apply(rows, bad + [_fix(3, "jersey", 44)], journal=journal)
        self.assertEqual(out[0], _rows()[0])
        self.assertEqual(out[1]["jersey"], 44)  # the valid one still lands
        skipped = [e for e in journal.events if e["action"] == "correction_skipped"]
        self.assertEqual(len(skipped), len(bad))
        self.assertEqual({e["detail"]["field_path"] for e in skipped}, {c.field_path for c in bad})
        self.assertEqual(skipped[-1]["reason"], "unknown_person")
        self.assertTrue(all(e["reason"] == "invalid_path" for e in skipped[:-1]))

    def test_invalid_paths_without_a_journal_do_not_raise(self):
        out = corrections.apply(_rows(), [_fix(2, "teams[9].end_year", 1)])
        self.assertEqual(out, _rows())

    def test_only_active_corrections_are_applied(self):
        statuses = [DataCorrection.STATUS_PROPOSED, DataCorrection.STATUS_CHECKING,
                    DataCorrection.STATUS_REJECTED, DataCorrection.STATUS_REDUNDANT]
        out = corrections.apply(_rows(), [_fix(2, "jersey", 4, status=s) for s in statuses])
        self.assertEqual(out, _rows())

    def test_no_corrections_returns_the_same_rows(self):
        rows = _rows()
        self.assertIs(corrections.apply(rows, []), rows)


class CuratedDatasetVersionTests(TestCase):
    def setUp(self):
        self._dir = tempfile.TemporaryDirectory()
        self.addCleanup(self._dir.cleanup)
        self.path = os.path.join(self._dir.name, "players_curated.json")
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(_rows(), f)
        with open(self.path, "rb") as f:
            self.base = f"curated-{publish_v3.sha256_hex(f.read())[:12]}"
        patcher = mock.patch.object(live_pool, "CURATED_PATH", self.path)
        patcher.start()
        self.addCleanup(patcher.stop)

    def _end_year(self, ds):
        return next(r for r in ds.rows if r["person_id"] == 2)["teams"][1]["end_year"]

    def test_no_active_corrections_keeps_the_version_byte_identical(self):
        DataCorrection.objects.create(person_id=2, field_path="teams[1].end_year", new_value=1994,
                                      status=DataCorrection.STATUS_PROPOSED)
        DataCorrection.objects.create(person_id=2, field_path="teams[1].end_year", new_value=1994,
                                      status=DataCorrection.STATUS_REJECTED)
        ds = publish_v3.curated_dataset()
        self.assertEqual(ds.version, self.base)
        self.assertEqual(self._end_year(ds), 1995)

    def test_active_corrections_are_overlaid_and_suffix_the_version(self):
        DataCorrection.objects.create(person_id=2, field_path="teams[1].end_year", new_value=1994,
                                      status=DataCorrection.STATUS_ACTIVE)
        DataCorrection.objects.create(person_id=3, field_path="awards.smoy", new_value=[1990],
                                      status=DataCorrection.STATUS_ACTIVE)
        DataCorrection.objects.create(person_id=3, field_path="jersey", new_value=1,
                                      status=DataCorrection.STATUS_PROPOSED)
        ds = publish_v3.curated_dataset()
        self.assertEqual(ds.version, f"{self.base}+c2")
        self.assertEqual(self._end_year(ds), 1994)
        self.assertEqual(next(r for r in ds.rows if r["person_id"] == 3)["awards"]["smoy"], [1990])

    def test_an_invalid_active_correction_never_breaks_the_load(self):
        DataCorrection.objects.create(person_id=2, field_path="teams[9].end_year", new_value=1,
                                      status=DataCorrection.STATUS_ACTIVE)
        journal = Journal("test")
        ds = publish_v3.curated_dataset(journal=journal)
        self.assertEqual(ds.version, f"{self.base}+c1")
        self.assertEqual([r for r in ds.rows], _rows())
        self.assertEqual([e["action"] for e in journal.events], ["correction_skipped"])


class MarkRedundantTests(TestCase):
    def test_an_active_correction_the_regeneration_already_has_becomes_redundant(self):
        rows = _rows()
        rows[0]["teams"][1]["end_year"] = 1994  # nba_api now has the fix
        same = DataCorrection.objects.create(person_id=2, field_path="teams[1].end_year", new_value=1994,
                                             status=DataCorrection.STATUS_ACTIVE)
        differs = DataCorrection.objects.create(person_id=3, field_path="awards.smoy", new_value=[1990],
                                                status=DataCorrection.STATUS_ACTIVE)
        proposed = DataCorrection.objects.create(person_id=2, field_path="jersey", new_value=None,
                                                 status=DataCorrection.STATUS_PROPOSED)
        broken = DataCorrection.objects.create(person_id=2, field_path="nickname", new_value=None,
                                               status=DataCorrection.STATUS_ACTIVE)
        journal = Journal("test")
        marked = corrections.mark_redundant(rows, journal=journal)
        self.assertEqual([c.pk for c in marked], [same.pk])
        for c in (same, differs, proposed, broken):
            c.refresh_from_db()
        self.assertEqual(same.status, DataCorrection.STATUS_REDUNDANT)
        self.assertIsNotNone(same.decided_at)
        self.assertEqual(differs.status, DataCorrection.STATUS_ACTIVE)
        self.assertEqual(proposed.status, DataCorrection.STATUS_PROPOSED)
        self.assertEqual(broken.status, DataCorrection.STATUS_ACTIVE)
        self.assertEqual([e["action"] for e in journal.events], ["correction_redundant"])
        # a redundant correction no longer counts toward the dataset version
        self.assertEqual(len(corrections.active_corrections()), 2)
