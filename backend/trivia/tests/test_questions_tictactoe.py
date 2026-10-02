import random

from django.test import SimpleTestCase

from trivia.questions.base import Invalid, load_dataset_from_rows
from trivia.questions.games import tictactoe as ttt
from trivia.tests.questions_fixture import fixture_dataset


class TicTacToeQuestionTests(SimpleTestCase):
    def test_seed_boards_load(self):
        seeds = ttt.seed_definitions()
        self.assertGreaterEqual(len(seeds), 8)
        self.assertEqual(set(seeds[0]), {"rows", "cols"})

    def test_generate_produces_solvable_bounded_boards(self):
        ds = fixture_dataset()
        defs = ttt.generate(ds, set(), random.Random(3), 3)
        self.assertEqual(len(defs), 3)
        for d in defs:
            m = ttt.materialize(d, ds)
            self.assertEqual(len(m["valid"]), 9)
            for cell in m["valid"]:
                self.assertTrue(ttt.MIN_VALID <= len(cell) <= ttt.MAX_VALID, len(cell))
            self.assertEqual(ttt.validate(m), [])
            self.assertEqual(sorted(set(ttt.players_referenced(d, m))), sorted({pid for cell in m["valid"] for pid in cell}))

    def test_materialize_rejects_unsolvable_cell(self):
        ds = fixture_dataset()
        d = {"rows": [{"type": "team", "value": "ZZZ", "label": "Nobody"}] * 3,
             "cols": [{"type": "award", "value": "mvp", "label": "Won MVP"}] * 3}
        with self.assertRaises(Invalid):
            ttt.materialize(d, ds)

    def _okc_dataset(self, reverse=False):
        sonics = {"abbr": "OKC", "name": "Seattle SuperSonics", "start_year": 1990, "end_year": 2008, "gp": 400, "ppg": 10.0}
        thunder = {"abbr": "OKC", "name": "Oklahoma City Thunder", "start_year": 2008, "end_year": 2015, "gp": 300, "ppg": 12.0}
        rows = []
        for i in range(25):
            teams = [sonics, thunder]
            rows.append({"person_id": 9000 + i, "full_name": f"Okc Fixture {i}",
                         "teams": list(reversed(teams)) if (reverse and i % 2) else teams})
        return load_dataset_from_rows(rows, "okc-1")

    def test_team_criteria_labels_use_most_recent_stint_name(self):
        for reverse in (False, True):
            teams = {t["value"]: t["label"] for t in ttt._team_criteria(self._okc_dataset(reverse))}
            self.assertEqual(teams["OKC"], "Oklahoma City Thunder")

    def test_materialize_relabels_stale_team_rows(self):
        ds = self._okc_dataset()
        stale = {"type": "team", "value": "OKC", "label": "Seattle SuperSonics"}
        col = {"type": "draft", "value": "undrafted", "label": "Undrafted"}
        d = {"rows": [stale] * 3, "cols": [col] * 3}
        m = ttt.materialize(d, ds)
        for r in m["rows"]:
            self.assertEqual(r, {"type": "team", "value": "OKC", "label": "Oklahoma City Thunder"})
        self.assertEqual(d["rows"][0]["label"], "Seattle SuperSonics")  # stored definition untouched

    def _names(self, stints_per_player, n=25):
        rows = [{"person_id": 8000 + i, "full_name": f"Stint Fixture {i}", "teams": list(stints_per_player)}
                for i in range(n)]
        return ttt._team_criteria(load_dataset_from_rows(rows, "stint-1"))

    def test_team_criteria_skips_stand_in_names(self):
        bullets = {"abbr": "BAL", "name": "Baltimore Bullets", "start_year": 1947, "end_year": 1954}
        stand_in = {"abbr": "BAL", "name": "BAL", "start_year": 1954, "end_year": 1955}
        for stints in ([bullets, stand_in], [stand_in, bullets]):
            self.assertEqual(self._names(stints), [{"type": "team", "value": "BAL", "label": "Baltimore Bullets"}])

    def test_team_criteria_all_stand_in_falls_back_to_abbr(self):
        stints = [{"abbr": "BAL", "name": "BAL", "start_year": 1954, "end_year": 1955},
                  {"abbr": "BAL", "name": "", "start_year": 1950, "end_year": 1951}]
        self.assertEqual(self._names(stints), [{"type": "team", "value": "BAL", "label": "BAL"}])

    def test_team_criteria_tie_prefers_open_ended_stint(self):
        finished = {"abbr": "XXX", "name": "Old Name", "start_year": 2020, "end_year": 2022}
        active = {"abbr": "XXX", "name": "Current Name", "start_year": 2020, "end_year": None}
        for stints in ([finished, active], [active, finished]):
            self.assertEqual(self._names(stints)[0]["label"], "Current Name")

    def test_materialize_keeps_stored_label_for_unknown_abbr(self):
        col = {"type": "draft", "value": "undrafted", "label": "Undrafted"}
        d = {"rows": [{"type": "team", "value": "ZZZ", "label": "Stored Label"}] * 3, "cols": [col] * 3}
        with self.assertRaisesRegex(Invalid, "Stored Label"):
            ttt.materialize(d, self._okc_dataset())

    def test_qid(self):
        self.assertEqual(ttt.qid_for({}, 42), "ttt-0042")
