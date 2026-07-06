"""NBA Bingo backend: criterion matching mirror, seed validation, endpoint."""
from django.test import TestCase
from django.urls import reverse

from trivia.games import bingo


def _player(**overrides):
    """Minimal players_curated-shaped row; override per test."""
    row = {
        "person_id": 1, "full_name": "Test Player", "aliases": [], "fame_tier": 2,
        "position": "G", "height_in": 78, "weight_lb": 200, "birth_year": 1980,
        "country": "USA", "college": "Duke",
        "draft": {"year": 2001, "round": 1, "pick": 3, "team_abbr": "ATL"},
        "jersey": 1, "is_active": False,
        "teams": [{"abbr": "ATL", "name": "Hawks", "start_year": 2001, "end_year": 2010, "gp": 600, "ppg": 18.0}],
        "awards": {"mvp": [], "fmvp": [], "dpoy": [], "roty": None, "smoy": [],
                   "allstar_count": 0, "allnba_count": 0, "rings": []},
        "career": {"pts": 12000, "reb": 3000, "ast": 4000, "ppg": 18.0, "rpg": 4.5, "apg": 6.0, "seasons": 10},
    }
    row.update(overrides)
    return row


def _cells(n=16):
    """n structurally-valid, distinct cells (team cycle keeps values unique)."""
    abbrs = ["LAL", "BOS", "CHI", "MIA", "NYK", "SAS", "GSW", "PHI",
             "DAL", "HOU", "DEN", "PHX", "UTA", "POR", "ATL", "DET"]
    return [{"type": "team", "value": a, "label": f"Played for {a}"} for a in abbrs[:n]]


class CriterionMatchesTests(TestCase):
    def test_team_any_stint(self):
        self.assertTrue(bingo.criterion_matches(_player(), {"type": "team", "value": "ATL", "label": ""}))
        self.assertFalse(bingo.criterion_matches(_player(), {"type": "team", "value": "LAL", "label": ""}))

    def test_awards(self):
        p = _player(awards={"mvp": [2005], "fmvp": [], "dpoy": [], "roty": 2002, "smoy": [],
                            "allstar_count": 6, "allnba_count": 2, "rings": [2006]})
        for value in ("mvp", "roty", "ring", "allstar5plus", "allnba"):
            self.assertTrue(bingo.criterion_matches(p, {"type": "award", "value": value, "label": ""}), value)
        for value in ("fmvp", "dpoy", "smoy"):
            self.assertFalse(bingo.criterion_matches(p, {"type": "award", "value": value, "label": ""}), value)

    def test_country(self):
        intl = _player(country="Germany")
        self.assertTrue(bingo.criterion_matches(intl, {"type": "country", "value": "INTL", "label": ""}))
        self.assertTrue(bingo.criterion_matches(intl, {"type": "country", "value": "Germany", "label": ""}))
        self.assertFalse(bingo.criterion_matches(intl, {"type": "country", "value": "USA", "label": ""}))

    def test_draft(self):
        p = _player()  # pick 3, round 1, 2001
        self.assertTrue(bingo.criterion_matches(p, {"type": "draft", "value": "top5", "label": ""}))
        self.assertTrue(bingo.criterion_matches(p, {"type": "draft", "value": "lottery", "label": ""}))
        self.assertTrue(bingo.criterion_matches(p, {"type": "draft", "value": "decade-2000s", "label": ""}))
        self.assertFalse(bingo.criterion_matches(p, {"type": "draft", "value": "round2", "label": ""}))
        und = _player(draft=None)
        self.assertTrue(bingo.criterion_matches(und, {"type": "draft", "value": "undrafted", "label": ""}))

    def test_college_and_stats(self):
        self.assertTrue(bingo.criterion_matches(_player(), {"type": "college", "value": "Duke", "label": ""}))
        self.assertTrue(bingo.criterion_matches(_player(college=None), {"type": "college", "value": "none", "label": ""}))
        big = _player(career={"pts": 26000, "reb": 11000, "ast": 4000, "ppg": 21.0, "rpg": 10.5, "apg": 3.0, "seasons": 16})
        for value in ("20kpts", "25kpts", "ppg20", "rpg10", "seasons15plus"):
            self.assertTrue(bingo.criterion_matches(big, {"type": "stat", "value": value, "label": ""}), value)
        self.assertFalse(bingo.criterion_matches(big, {"type": "stat", "value": "apg8", "label": ""}))

    def test_era_overlap_and_open_ended_stint(self):
        p = _player()  # 2001-2010
        self.assertTrue(bingo.criterion_matches(p, {"type": "era", "value": "2000s", "label": ""}))
        self.assertTrue(bingo.criterion_matches(p, {"type": "era", "value": "2010s", "label": ""}))
        self.assertFalse(bingo.criterion_matches(p, {"type": "era", "value": "1990s", "label": ""}))
        active = _player(teams=[{"abbr": "ATL", "name": "Hawks", "start_year": 2018, "end_year": None, "gp": None, "ppg": None}])
        self.assertTrue(bingo.criterion_matches(active, {"type": "era", "value": "2020s", "label": ""}))


class ValidateRowsTests(TestCase):
    def test_valid_rows_pass_structural_checks(self):
        rows = [{"qid": "bingo-001", "cells": _cells()}]
        problems = [p for p in bingo.validate_rows(rows) if "players_curated" not in p]
        self.assertEqual(problems, [])

    def test_flags_wrong_cell_count(self):
        problems = bingo.validate_rows([{"qid": "bingo-001", "cells": _cells(15)}])
        self.assertTrue(any("16 cells" in p for p in problems))

    def test_flags_bad_criterion_value_and_type(self):
        rows = [{"qid": "bingo-001", "cells": _cells(14) + [
            {"type": "award", "value": "slam-dunk-champ", "label": "x"},
            {"type": "vibes", "value": "elite", "label": "x"},
        ]}]
        problems = bingo.validate_rows(rows)
        self.assertTrue(any("slam-dunk-champ" in p for p in problems))
        self.assertTrue(any("vibes" in p for p in problems))

    def test_flags_duplicate_cells_and_duplicate_qids(self):
        dup_cells = _cells(15) + [{"type": "team", "value": "LAL", "label": "again"}]
        rows = [{"qid": "bingo-001", "cells": dup_cells},
                {"qid": "bingo-001", "cells": _cells()}]
        problems = bingo.validate_rows(rows)
        self.assertTrue(any("duplicate criterion" in p for p in problems))
        self.assertTrue(any("duplicate qid" in p for p in problems))


class GetRoundTests(TestCase):
    def test_serves_one_card_from_seed(self):
        res = self.client.get(reverse("bingo"))
        self.assertEqual(res.status_code, 200)
        series = res.json()["series"]
        self.assertEqual(len(series), 1)
        card = series[0]
        self.assertTrue(card["qid"].startswith("bingo-"))
        self.assertEqual(len(card["cells"]), 16)
        self.assertIn(card["cells"][0]["type"],
                      {"team", "award", "country", "draft", "college", "stat", "era"})


class SeedIntegrityTests(TestCase):
    def test_bundled_seed_is_structurally_valid(self):
        rows = bingo._load_seed()
        self.assertEqual(len(rows), bingo.EXPECTED_CARDS)
        problems = [p for p in bingo.validate_rows(rows) if "players_curated" not in p]
        self.assertEqual(problems, [], problems)
