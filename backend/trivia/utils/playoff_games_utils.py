import json
import os
import random
import time
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
from nba_api.stats.static import teams
from trivia.utils.logo_utils import logo



def fetch_season_data(season, team_dict, round_map, per_call_timeout=12):
    """
    Fetches all completed playoff series for a given NBA season
    with robust headers, optional proxy, and randomized team ordering.
    """
    try:
        from nba_api.stats.endpoints import CommonPlayoffSeries, LeagueGameLog
        import pandas as pd

        print(f"Fetching data for season {season}...")

        # Fetch playoff series metadata
        series_data = CommonPlayoffSeries(
            season=season,
            timeout=per_call_timeout,
        ).get_data_frames()[0]

        if series_data.empty:
            print(f"No series data found for {season}")
            return []

        # Fetch playoff game logs
        log = LeagueGameLog(
            season=season,
            season_type_all_star='Playoffs',
            timeout=per_call_timeout,
        )
        games_df = log.get_data_frames()[0][['GAME_ID', 'TEAM_ID', 'TEAM_ABBREVIATION', 'WL']]

        # Merge series and games
        merged = pd.merge(
            series_data[['SERIES_ID', 'GAME_ID']].drop_duplicates(),
            games_df,
            on='GAME_ID',
            how='left'
        )
        merged['win'] = (merged['WL'] == 'W').astype(int)

        # Count wins per team per series
        win_counts = merged.groupby(['SERIES_ID', 'TEAM_ID', 'TEAM_ABBREVIATION'])['win'].sum().reset_index()

        # Only completed series (someone reached 4 wins)
        completed = win_counts[win_counts['win'] == 4]

        out = []

        # Build structured series data
        for _, row in completed.iterrows():
            series_id = row['SERIES_ID']
            winner_team_id = row['TEAM_ID']
            winner_abbr = row['TEAM_ABBREVIATION']

            series_games = merged[merged['SERIES_ID'] == series_id]
            total_games = series_games['GAME_ID'].nunique()

            # Skip invalid data
            if total_games < 4 or series_games['TEAM_ID'].nunique() != 2:
                continue

            opponent_rows = series_games[series_games['TEAM_ID'] != winner_team_id]
            if opponent_rows.empty:
                continue

            opponent_row = opponent_rows.iloc[0]
            loser_team_id = opponent_row['TEAM_ID']
            loser_abbr = opponent_row['TEAM_ABBREVIATION']

            # Count how many games the losing team won
            loser_wins = series_games[
                (series_games['TEAM_ID'] == loser_team_id) & (series_games['win'] == 1)
            ].shape[0]

            # Determine round from series_id
            round_code = str(series_id)[7]
            round_label = round_map.get(round_code, 'Unknown')

            # Randomly assign winner/loser to team_a or team_b
            if random.choice([True, False]):
                team_a_id, team_a_abbr, team_a_name, team_a_wins = winner_team_id, winner_abbr, team_dict.get(winner_team_id, {}).get('full_name', winner_abbr), 4
                team_b_id, team_b_abbr, team_b_name, team_b_wins = loser_team_id, loser_abbr, team_dict.get(loser_team_id, {}).get('full_name', loser_abbr), loser_wins
            else:
                team_a_id, team_a_abbr, team_a_name, team_a_wins = loser_team_id, loser_abbr, team_dict.get(loser_team_id, {}).get('full_name', loser_abbr), loser_wins
                team_b_id, team_b_abbr, team_b_name, team_b_wins = winner_team_id, winner_abbr, team_dict.get(winner_team_id, {}).get('full_name', winner_abbr), 4

            out.append({
                'season': season,
                'team_a': team_a_name,
                'team_b': team_b_name,
                'team_a_abbreviation': team_a_abbr,
                'team_b_abbreviation': team_b_abbr,
                'team_a_logo': logo(team_a_id),  # assumes you have a logo() helper
                'team_b_logo': logo(team_b_id),
                'team_a_wins': team_a_wins,
                'team_b_wins': team_b_wins,
                'winner': team_dict.get(winner_team_id, {}).get('full_name', winner_abbr),
                'round': round_label,
                'match_id': series_games['GAME_ID'].iloc[0],
                'total_games': total_games
            })

        return out

    except Exception as e:
        print(f"Error processing season {season}: {e}")
        return []


def build_local_playoff_database(output_path="playoff_data.json", num_seasons=20, per_call_timeout=12):
    """
    Fetches playoff series from the last N seasons and saves them to a local JSON file.
    """
    current_year = datetime.now().year
    team_dict = {t['id']: t for t in teams.get_teams()}

    # Mapping for playoff rounds
    round_map = {
        '1': 'First Round',
        '2': 'Conference Semifinals',
        '3': 'Conference Finals',
        '4': 'NBA Finals'
    }

    # Generate season strings like "2023-24", "2022-23", etc.
    seasons = []
    for year_offset in range(num_seasons):
        start_year = current_year - 1 - year_offset
        season = f"{start_year}-{str(start_year + 1)[-2:]}"
        seasons.append(season)

    all_series = []

    # Fetch multiple seasons in parallel
    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = {
            executor.submit(fetch_season_data, season, team_dict, round_map, per_call_timeout): season
            for season in seasons
        }

        for future in as_completed(futures):
            season_series = future.result()
            if season_series:
                all_series.extend(season_series)

    # Save everything to a local JSON file
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(all_series, f, indent=2)

    print(f"\n✅ Saved {len(all_series)} series to: {os.path.abspath(output_path)}\n")


if __name__ == "__main__":
    # Save directly to trivia/utils/playoff_data.json
    script_dir = os.path.dirname(os.path.abspath(__file__))
    output_path = os.path.join(script_dir, "playoff_data.json")

    # Build local database for last 20 seasons
    build_local_playoff_database(output_path=output_path, num_seasons=20)
