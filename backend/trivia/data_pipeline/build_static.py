import csv

from nba_api.stats.static import players, teams

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
    """Full names of all players (current + historical)."""
    return [p["full_name"] for p in players.get_players()]


def build_wordle_pool():
    """Five-letter player surnames for the Wordle game."""
    return [p["last_name"] for p in players.get_players() if len(p["last_name"]) == 5]


def build_mvps_pool(csv_path):
    """MVP rows read from the committed CSV (no network)."""
    with open(csv_path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))
