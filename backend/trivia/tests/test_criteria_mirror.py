"""The four server-side mirrors of src/utils/criteria.ts must agree, exactly.

`playerMatches` is frozen contract #3: the client validates every Heatmap / NBA
Grid / Tic-Tac-Toe / Bingo answer with it, and four Python ports re-implement it
so the seed validators can prove a board is solvable. A divergence between them
is a wrong answer on screen, so anything that changes one has to change all
five — this module is the lockstep check for the cases where they used to
differ from reality.
"""
from django.test import TestCase

from trivia.games import bingo, tictactoe
from trivia.games.heatmap_criteria import player_matches as heatmap_matches
from trivia.games.nba_grid_validate import player_matches as grid_matches

# The four ports take the same row shape; only `draft` matters here.
MIRRORS = {
    "heatmap_criteria": heatmap_matches,
    "nba_grid_validate": grid_matches,
    "tictactoe": tictactoe.player_matches,
    "bingo": bingo.criterion_matches,
}


def _player(draft):
    return {
        "person_id": 1, "full_name": "Test Player", "aliases": [], "fame_tier": 1,
        "position": "C", "height_in": 85, "weight_lb": 250, "birth_year": 1936,
        "country": "USA", "college": None, "draft": draft, "jersey": 13,
        "is_active": False,
        "teams": [{"abbr": "GSW", "name": "Philadelphia Warriors",
                   "start_year": 1959, "end_year": 1973, "gp": 1045, "ppg": 30.1}],
        "awards": {"mvp": [], "fmvp": [], "dpoy": [], "roty": 1960, "smoy": [],
                   "allstar_count": 13, "allnba_count": 10, "rings": []},
        "career": {"pts": 31419, "reb": 23924, "ast": 4643,
                   "ppg": 30.1, "rpg": 22.9, "apg": 4.4, "seasons": 14},
    }


# Territorial picks (21 rows in the dataset, Wilt Chamberlain among them) are
# reported by drafthistory as round 0 / pick 0.
TERRITORIAL = _player({"year": 1959, "round": 0, "pick": 0, "team_abbr": "PHW"})
FIRST_OVERALL = _player({"year": 2003, "round": 1, "pick": 1, "team_abbr": "CLE"})
PICK_14 = _player({"year": 1996, "round": 1, "pick": 14, "team_abbr": "CHH"})
PICK_15 = _player({"year": 1996, "round": 1, "pick": 15, "team_abbr": "PHX"})


class TerritorialPickTests(TestCase):
    """A territorial pick is not a top-5 pick and not a lottery pick."""

    def _crit(self, value):
        return {"type": "draft", "value": value, "label": value}

    def test_no_mirror_counts_a_territorial_pick_as_top5_or_lottery(self):
        for name, matches in MIRRORS.items():
            for value in ("top5", "lottery"):
                self.assertFalse(
                    matches(TERRITORIAL, self._crit(value)),
                    f"{name} counted a round-0/pick-0 territorial pick as {value}",
                )

    def test_a_territorial_pick_is_still_drafted(self):
        for name, matches in MIRRORS.items():
            self.assertFalse(
                matches(TERRITORIAL, self._crit("undrafted")),
                f"{name} called a territorial pick undrafted",
            )
            self.assertFalse(
                matches(TERRITORIAL, self._crit("round2")),
                f"{name} called a round-0 pick a second-rounder",
            )
            self.assertTrue(
                matches(TERRITORIAL, self._crit("decade-1950s")),
                f"{name} lost a territorial pick's draft decade",
            )

    def test_real_picks_are_unaffected_at_the_boundaries(self):
        for name, matches in MIRRORS.items():
            self.assertTrue(matches(FIRST_OVERALL, self._crit("top5")), name)
            self.assertTrue(matches(FIRST_OVERALL, self._crit("lottery")), name)
            self.assertFalse(matches(PICK_14, self._crit("top5")), name)
            self.assertTrue(matches(PICK_14, self._crit("lottery")), name)
            self.assertFalse(matches(PICK_15, self._crit("lottery")), name)
