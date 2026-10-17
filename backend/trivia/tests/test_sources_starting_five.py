from unittest import mock

import pandas as pd
from django.test import SimpleTestCase

from trivia.data_pipeline import sources

LAL, BOS = 1610612747, 1610612738


def _team(team_id, first, points):
    rows = []
    for i, pos in enumerate(["F", "F", "C", "G", "G", "", ""]):
        rows.append({
            "gameId": "G1", "teamId": team_id, "personId": team_id * 10 + i,
            "firstName": f"{first}{i}", "familyName": f"Last{i}", "position": pos,
            "points": points if i == 0 else 0,
        })
    return rows


def _box(game_id, timeout=None):
    if game_id == "G1":
        pdf = pd.DataFrame(_team(LAL, "Laker", 100) + _team(BOS, "Celtic", 90))
    else:
        pdf = pd.DataFrame(_team(LAL, "Laker", 100))  # only one team -> skipped
    box = mock.Mock()
    box.player_stats.get_data_frame.return_value = pdf
    return box


def _finder(season_type_nullable=None, **kwargs):
    gid = "G1" if season_type_nullable == "Regular Season" else "G2"
    finder = mock.Mock()
    finder.get_data_frames.return_value = [pd.DataFrame([{"GAME_ID": gid, "GAME_DATE": "2025-01-02"}])]
    return finder


class FetchStartingFiveTests(SimpleTestCase):
    def test_reads_box_score_v3(self):
        with mock.patch.object(sources, "_ensure_relay"), \
                mock.patch("nba_api.stats.endpoints.leaguegamefinder.LeagueGameFinder", side_effect=_finder), \
                mock.patch("nba_api.stats.endpoints.boxscoretraditionalv3.BoxScoreTraditionalV3",
                           side_effect=_box):
            out = sources.fetch_starting_five(["2024-25"], pause=0)

        self.assertEqual(len(out), 1)
        row = out[0]
        self.assertEqual(row["game_id"], "G1")
        self.assertEqual(row["game_date"], "2025-01-02")
        self.assertEqual(row["final_score"], "100 - 90")
        self.assertEqual(row["winning_team"], "Los Angeles Lakers")
        self.assertEqual([p["name"] for p in row["starting_5"]], [f"Laker{i} Last{i}" for i in range(5)])
        self.assertEqual([p["position"] for p in row["starting_5"]], ["F", "F", "C", "G", "G"])
