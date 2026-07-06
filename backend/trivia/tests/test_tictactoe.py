"""NBA Tic-Tac-Toe backend: seed integrity, matcher semantics, endpoint shape."""
from django.test import TestCase
from django.urls import reverse

from trivia.games.tictactoe import build_pool, player_matches, validate_rows

DIRK = {
    "person_id": 1717, "full_name": "Dirk Nowitzki", "aliases": ["dirk"], "fame_tier": 1,
    "position": "F", "height_in": 84, "weight_lb": 245, "birth_year": 1978,
    "country": "Germany", "college": None,
    "draft": {"year": 1998, "round": 1, "pick": 9, "team_abbr": "MIL"},
    "jersey": 41, "is_active": False,
    "teams": [{"abbr": "DAL", "name": "Dallas Mavericks", "start_year": 1998, "end_year": 2019, "gp": 1522, "ppg": 20.7}],
    "awards": {"mvp": [2007], "fmvp": [2011], "dpoy": [], "roty": None, "smoy": [],
               "allstar_count": 14, "allnba_count": 12, "rings": [2011]},
    "career": {"pts": 31560, "reb": 11489, "ast": 3651, "ppg": 20.7, "rpg": 7.5, "apg": 2.4, "seasons": 21},
}


class PlayerMatchesTests(TestCase):
    def test_team_any_stint(self):
        self.assertTrue(player_matches(DIRK, {"type": "team", "value": "DAL", "label": "Mavericks"}))
        self.assertFalse(player_matches(DIRK, {"type": "team", "value": "LAL", "label": "Lakers"}))

    def test_award_country_stat_draft_era(self):
        self.assertTrue(player_matches(DIRK, {"type": "award", "value": "fmvp", "label": "Finals MVP"}))
        self.assertTrue(player_matches(DIRK, {"type": "country", "value": "INTL", "label": "International"}))
        self.assertFalse(player_matches(DIRK, {"type": "country", "value": "USA", "label": "USA"}))
        self.assertTrue(player_matches(DIRK, {"type": "stat", "value": "25kpts", "label": "25k pts"}))
        self.assertTrue(player_matches(DIRK, {"type": "draft", "value": "lottery", "label": "Lottery"}))
        self.assertFalse(player_matches(DIRK, {"type": "draft", "value": "top5", "label": "Top 5"}))
        self.assertTrue(player_matches(DIRK, {"type": "era", "value": "1990s", "label": "90s"}))
        self.assertFalse(player_matches(DIRK, {"type": "era", "value": "2020s", "label": "2020s"}))
        self.assertTrue(player_matches(DIRK, {"type": "college", "value": "none", "label": "No college"}))

    def test_undrafted_and_decade_draft(self):
        udf = dict(DIRK, draft=None)
        self.assertTrue(player_matches(udf, {"type": "draft", "value": "undrafted", "label": "Undrafted"}))
        self.assertTrue(player_matches(DIRK, {"type": "draft", "value": "decade-1990s", "label": "Drafted in 90s"}))


class SeedTests(TestCase):
    def test_pool_has_eight_valid_boards(self):
        rows = build_pool()
        self.assertEqual(len(rows), 8)
        self.assertEqual(validate_rows(rows), [])
        self.assertEqual(len({r["qid"] for r in rows}), 8)

    def test_validate_rejects_bad_board(self):
        bad = [{"qid": "x", "rows": [], "cols": []}]
        self.assertTrue(validate_rows(bad))


class EndpointTests(TestCase):
    def test_get_round_returns_one_board(self):
        res = self.client.get(reverse("tictactoe"))
        self.assertEqual(res.status_code, 200)
        series = res.json()["series"]
        self.assertEqual(len(series), 1)
        board = series[0]
        self.assertEqual(len(board["rows"]), 3)
        self.assertEqual(len(board["cols"]), 3)
        self.assertIn("qid", board)
