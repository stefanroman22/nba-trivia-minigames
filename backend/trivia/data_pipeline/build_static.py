import csv

from nba_api.stats.static import players, teams

from trivia.data_pipeline.live_pool import load_dataset
from trivia.utils.logo_utils import logo


def build_name_logo_pool():
    """Team -> {team_id, full_name, abbreviation, logo} for the Name->Logo game."""
    return [
        {
            "team_id": t["id"],
            "full_name": t["full_name"],
            "abbreviation": t["abbreviation"],
            "logo": logo(t["id"]),
        }
        for t in teams.get_teams()
    ]


def build_all_players_pool():
    """Full names of all players (current + historical) — the curated dataset.

    It used to come from nba_api's bundled static list, which lags the live
    league index by a whole draft class and spells the accented names without
    accents. players_curated.json is generated FROM the live index and
    ``generate_players_curated --rewrite-all-players`` writes exactly this list,
    so rebuilding it from anywhere else would silently undo the 1:1 parity
    between the two files — and leave the starting-five autocomplete on
    spellings the pool no longer uses.
    """
    return [row["full_name"] for row in load_dataset()]


def build_wordle_pool():
    """Five-letter player surnames for the Wordle game."""
    return [p["last_name"] for p in players.get_players() if len(p["last_name"]) == 5]


def build_mvps_pool(csv_path):
    """MVP rows read from the committed CSV (no network)."""
    with open(csv_path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))
