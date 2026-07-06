import json
import os
import tempfile
from unittest import mock

from django.test import TestCase
from django.urls import reverse

from trivia.games import who_are_ya

REQUIRED_KEYS = {
    "person_id", "full_name", "aliases", "fame_tier", "position", "height_in",
    "weight_lb", "birth_year", "country", "college", "draft", "jersey",
    "is_active", "teams", "awards", "career",
}


def _row(**overrides):
    """Minimal valid PlayerIndexEntry row for validator tests."""
    row = {
        "person_id": 2544,
        "full_name": "LeBron James",
        "aliases": ["lebron", "king james"],
        "fame_tier": 1,
        "position": "F",
        "height_in": 81,
        "weight_lb": 250,
        "birth_year": 1984,
        "country": "USA",
        "college": None,
        "draft": {"year": 2003, "round": 1, "pick": 1, "team_abbr": "CLE"},
        "jersey": 23,
        "is_active": True,
        "teams": [
            {"abbr": "CLE", "name": "Cleveland Cavaliers", "start_year": 2003, "end_year": 2010, "gp": 548, "ppg": 27.8},
            {"abbr": "LAL", "name": "Los Angeles Lakers", "start_year": 2018, "end_year": None, "gp": 450, "ppg": 26.9},
        ],
        "awards": {"mvp": [2009, 2010, 2012, 2013], "fmvp": [2012, 2013, 2016, 2020], "dpoy": [],
                   "roty": 2004, "smoy": [], "allstar_count": 20, "allnba_count": 20,
                   "rings": [2012, 2013, 2016, 2020]},
        "career": {"pts": 40000, "reb": 11000, "ast": 11000, "ppg": 27.1, "rpg": 7.5, "apg": 7.4, "seasons": 21},
    }
    row.update(overrides)
    return row


class WhoAreYaEndpointTests(TestCase):
    def test_round_serves_one_eligible_seed_row(self):
        res = self.client.get(reverse("who-are-ya"))
        self.assertEqual(res.status_code, 200)
        series = res.json()["series"]
        self.assertEqual(len(series), 1)
        row = series[0]
        self.assertTrue(REQUIRED_KEYS.issubset(row.keys()))
        self.assertIn(row["fame_tier"], (1, 2))
        self.assertGreater(len(row["teams"]), 0)

    def test_missing_seed_returns_503(self):
        with mock.patch.object(who_are_ya, "SEED_PATH", os.path.join(tempfile.gettempdir(), "nope.json")):
            res = self.client.get(reverse("who-are-ya"))
        self.assertEqual(res.status_code, 503)


class WhoAreYaValidatorTests(TestCase):
    def test_valid_row_passes(self):
        self.assertEqual(who_are_ya.validate_rows([_row()]), [])

    def test_flags_bad_fame_tier(self):
        probs = who_are_ya.validate_rows([_row(fame_tier=3)])
        self.assertTrue(any("fame_tier" in p for p in probs))

    def test_flags_missing_teams_and_bad_birth_year(self):
        probs = who_are_ya.validate_rows([_row(teams=[]), _row(person_id=1, birth_year=1890)])
        self.assertTrue(any("teams" in p for p in probs))
        self.assertTrue(any("birth_year" in p for p in probs))

    def test_flags_duplicate_person_id_and_missing_key(self):
        bad = _row()
        del bad["jersey"]
        probs = who_are_ya.validate_rows([_row(), _row(), bad])
        self.assertTrue(any("duplicate" in p for p in probs))
        self.assertTrue(any("jersey" in p for p in probs))

    def test_bundled_seed_is_valid(self):
        rows = who_are_ya._load_seed()
        self.assertGreaterEqual(len(rows), 20)
        self.assertEqual(who_are_ya.validate_rows(rows), [])
