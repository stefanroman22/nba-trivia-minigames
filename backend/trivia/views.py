from nba_api.stats.endpoints import CommonPlayoffSeries, LeagueGameLog
from nba_api.stats.static import teams
from datetime import datetime
from django.http import JsonResponse
import pandas as pd
import random

# === Add this at the top of your file ===
cached_series_data = None

# === Your view function ===
def get_random_playoff_series(request):
    global cached_series_data

    try:
        if cached_series_data is not None:
            # Serve from cache
            sampled_series = random.sample(cached_series_data, min(5, len(cached_series_data)))
            return JsonResponse({'series': sampled_series})

        current_year = datetime.now().year
        team_dict = {t['id']: t for t in teams.get_teams()}
        round_map = {
            '1': 'First Round',
            '2': 'Conference Semifinals',
            '3': 'Conference Finals',
            '4': 'NBA Finals'
        }

        all_completed_series = []

        for year_offset in range(10):
            start_year = current_year - 1 - year_offset
            season = f"{start_year}-{str(start_year + 1)[-2:]}"  

            try:
                series_data = CommonPlayoffSeries(season=season, timeout=30).get_data_frames()[0]
                if series_data.empty:
                    continue

                log = LeagueGameLog(season=season, season_type_all_star='Playoffs', timeout=30)
                games_df = log.get_data_frames()[0]
                games_df = games_df[['GAME_ID', 'TEAM_ID', 'TEAM_ABBREVIATION', 'WL']]

                merged = pd.merge(series_data[['SERIES_ID', 'GAME_ID']].drop_duplicates(), games_df, on='GAME_ID', how='left')
                merged['win'] = (merged['WL'] == 'W').astype(int)

                win_counts = merged.groupby(['SERIES_ID', 'TEAM_ID', 'TEAM_ABBREVIATION'])['win'].sum().reset_index()
                completed = win_counts[win_counts['win'] == 4]

                for _, row in completed.iterrows():
                    series_id = row['SERIES_ID']
                    winner_team_id = row['TEAM_ID']
                    winner_abbr = row['TEAM_ABBREVIATION']
                    series_games = merged[merged['SERIES_ID'] == series_id]
                    total_games = series_games['GAME_ID'].nunique()

                    if total_games < 4 or series_games['TEAM_ID'].nunique() != 2:
                        continue

                    opponent_rows = series_games[series_games['TEAM_ID'] != winner_team_id]
                    if opponent_rows.empty:
                        continue
                    opponent_row = opponent_rows.iloc[0]
                    loser_team_id = opponent_row['TEAM_ID']
                    loser_abbr = opponent_row['TEAM_ABBREVIATION']
                    loser_wins = series_games[
                        (series_games['TEAM_ID'] == loser_team_id) & (series_games['win'] == 1)
                    ].shape[0]

                    round_code = str(series_id)[7]
                    round_label = round_map.get(round_code, 'Unknown')

                    def logo(team_id):
                        return f"https://cdn.nba.com/logos/nba/{team_id}/primary/L/logo.svg" if team_id else None

                    if random.choice([True, False]):
                        team_a_id, team_a_abbr, team_a_name, team_a_wins = winner_team_id, winner_abbr, team_dict.get(winner_team_id, {}).get('full_name', winner_abbr), 4
                        team_b_id, team_b_abbr, team_b_name, team_b_wins = loser_team_id, loser_abbr, team_dict.get(loser_team_id, {}).get('full_name', loser_abbr), loser_wins
                    else:
                        team_a_id, team_a_abbr, team_a_name, team_a_wins = loser_team_id, loser_abbr, team_dict.get(loser_team_id, {}).get('full_name', loser_abbr), loser_wins
                        team_b_id, team_b_abbr, team_b_name, team_b_wins = winner_team_id, winner_abbr, team_dict.get(winner_team_id, {}).get('full_name', winner_abbr), 4

                    all_completed_series.append({
                        'season': season,
                        'team_a': team_a_name,
                        'team_b': team_b_name,
                        'team_a_abbreviation': team_a_abbr,
                        'team_b_abbreviation': team_b_abbr,
                        'team_a_logo': logo(team_a_id),
                        'team_b_logo': logo(team_b_id),
                        'team_a_wins': team_a_wins,
                        'team_b_wins': team_b_wins,
                        'winner': team_dict.get(winner_team_id, {}).get('full_name', winner_abbr),
                        'round': round_label,
                        'match_id': series_games['GAME_ID'].iloc[0],
                        'total_games': total_games
                    })

            except Exception as e:
                print(f"Error processing season {season}: {e}")
                continue

        if not all_completed_series:
            return JsonResponse({'message': 'No completed playoff series found in the last 10 seasons.'}, status=404)

        # Cache it
        cached_series_data = all_completed_series

        sampled_series = random.sample(all_completed_series, min(5, len(all_completed_series)))
        return JsonResponse({'series': sampled_series})

    except Exception as e:
        return JsonResponse({'error': str(e), 'message': 'Error fetching playoff series data'}, status=500)
