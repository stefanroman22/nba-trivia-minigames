from nba_api.stats.endpoints import CommonPlayoffSeries, LeagueGameLog
from nba_api.stats.static import teams, players
from nba_api.stats.endpoints import leaguegamefinder, boxscoretraditionalv2
from datetime import datetime
from django.http import JsonResponse
from trivia.utils.logo_utils import logo
import pandas as pd
import random
import logging
import os
from django.conf import settings
from django.core.cache import cache
from concurrent.futures import ThreadPoolExecutor, as_completed

logger = logging.getLogger(__name__)

def fetch_season_data(season, team_dict, round_map):
    try:
        series_data = CommonPlayoffSeries(season=season, timeout=60).get_data_frames()[0]
        if series_data.empty:
            return []

        log = LeagueGameLog(season=season, season_type_all_star='Playoffs', timeout=60)
        games_df = log.get_data_frames()[0]
        games_df = games_df[['GAME_ID', 'TEAM_ID', 'TEAM_ABBREVIATION', 'WL']]

        merged = pd.merge(series_data[['SERIES_ID', 'GAME_ID']].drop_duplicates(), games_df, on='GAME_ID', how='left')
        merged['win'] = (merged['WL'] == 'W').astype(int)

        win_counts = merged.groupby(['SERIES_ID', 'TEAM_ID', 'TEAM_ABBREVIATION'])['win'].sum().reset_index()
        completed = win_counts[win_counts['win'] == 4]

        season_series = []

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

            if random.choice([True, False]):
                team_a_id, team_a_abbr, team_a_name, team_a_wins = winner_team_id, winner_abbr, team_dict.get(winner_team_id, {}).get('full_name', winner_abbr), 4
                team_b_id, team_b_abbr, team_b_name, team_b_wins = loser_team_id, loser_abbr, team_dict.get(loser_team_id, {}).get('full_name', loser_abbr), loser_wins
            else:
                team_a_id, team_a_abbr, team_a_name, team_a_wins = loser_team_id, loser_abbr, team_dict.get(loser_team_id, {}).get('full_name', loser_abbr), loser_wins
                team_b_id, team_b_abbr, team_b_name, team_b_wins = winner_team_id, winner_abbr, team_dict.get(winner_team_id, {}).get('full_name', winner_abbr), 4

            season_series.append({
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

        return season_series

    except Exception as e:
        print(f"Error processing season {season}: {e}")
        return []

def get_random_playoff_series(request):
    cache_key = 'cached_series_data'
    cached_series_data = cache.get(cache_key)

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
    seasons = []

    for year_offset in range(10):
        start_year = current_year - 1 - year_offset
        season = f"{start_year}-{str(start_year + 1)[-2:]}"
        seasons.append(season)

    # Parallel fetching
    with ThreadPoolExecutor(max_workers=5) as executor:  # Limit workers to avoid rate limiting
        future_to_season = {executor.submit(fetch_season_data, season, team_dict, round_map): season for season in seasons}
        for future in as_completed(future_to_season):
            season_series = future.result()
            all_completed_series.extend(season_series)

    if not all_completed_series:
        return JsonResponse({'message': 'No completed playoff series found in the last 10 seasons.'}, status=404)

    # Cache it permanently (or set a long timeout, e.g., 86400 for 1 day)
    cache.set(cache_key, all_completed_series, timeout=None)

    sampled_series = random.sample(all_completed_series, min(5, len(all_completed_series)))
    return JsonResponse({'series': sampled_series})

cached_teams_data = None
def get_random_nba_teams(request):
    global cached_teams_data

    try:
        if cached_teams_data is  None:
            all_teams = teams.get_teams()
            cached_teams_data = [
                {
                "team_id": t["id"],
                "full_name": t["full_name"],
                "abbreviation": t["abbreviation"],
                "logo": logo(t["id"]),
                }
            for t in all_teams
            ]
        # Pick random subset for the game
        sampled_teams = random.sample(cached_teams_data, min(5, len(cached_teams_data)))
        return JsonResponse({"series": sampled_teams})

    except Exception as e:
        return JsonResponse(
            {"error": str(e), "message": "Error fetching NBA team logos"},
            status=500)
    
def get_mvps(request):
    try:
        # Construct path relative to BASE_DIR
        csv_path = os.path.join(settings.BASE_DIR, 'trivia', 'utils', 'nba_mvps.csv')
        
        
        MVP_DF = pd.read_csv(csv_path)

        if MVP_DF.empty:
            return JsonResponse({'error': 'MVP data is empty.'}, status=500)

        sample_size = min(5, len(MVP_DF))
        random_mvps = MVP_DF.sample(n=sample_size)
        mvps_list = random_mvps.to_dict(orient='records')

        return JsonResponse({'series': mvps_list})
        
    except Exception as e:
        return JsonResponse(
            {'error': str(e), 'message': "Error fetching MVP data"},
            status=500
        )
    
def get_starting_five(request):
    try:
        # Step 1: Pick a random season with known NBA API data
        available_seasons = ['2013-14', '2014-15', '2015-16', '2016-17', '2017-18', 
                             '2018-19', '2019-20', '2020-21', '2021-22', '2022-23', 
                             '2023-24', '2024-25']
        random_season = random.choice(available_seasons)

        # Step 2: Fetch all games for that season
        regular_df = leaguegamefinder.LeagueGameFinder(
            season_nullable=random_season,
            league_id_nullable='00',
            season_type_nullable='Regular Season'
        ).get_data_frames()[0]

        playoffs_df = leaguegamefinder.LeagueGameFinder(
            season_nullable=random_season,
            league_id_nullable='00',
            season_type_nullable='Playoffs'
        ).get_data_frames()[0]

        # Combine both
        all_games_df = pd.concat([regular_df, playoffs_df], ignore_index=True)
        if all_games_df.empty:
            return JsonResponse([{"error": f"No games found in season {random_season}."}], safe=False)

        # Step 3: Pick a random game row
        game_row = all_games_df.sample(1).iloc[0]
        game_id = game_row['GAME_ID']

        # Step 4: Get boxscore to find both teams and scores
        boxscore = boxscoretraditionalv2.BoxScoreTraditionalV2(game_id=game_id)
        players_df = boxscore.player_stats.get_data_frame()
        teams_in_game = players_df['TEAM_ID'].unique()

        if len(teams_in_game) != 2:
            return JsonResponse([{"error": "Unexpected number of teams in game."}], safe=False)

        team_a_id, team_b_id = teams_in_game
        team_a_score = int(players_df[players_df['TEAM_ID'] == team_a_id]['PTS'].sum())
        team_b_score = int(players_df[players_df['TEAM_ID'] == team_b_id]['PTS'].sum())
        final_score = f"{team_a_score} - {team_b_score}"

        # Step 5: Determine winning team
        winning_team_id = team_a_id if team_a_score > team_b_score else team_b_id

        starters_df = players_df[
            (players_df['TEAM_ID'] == winning_team_id) &
            (players_df['START_POSITION'] != '')
        ]

        # Split by position
        forwards = starters_df[starters_df['START_POSITION'] == 'F']
        guards = starters_df[starters_df['START_POSITION'] == 'G']
        centers = starters_df[starters_df['START_POSITION'] == 'C']

        # Ensure exactly required numbers
        def pick_players(df, n):
            # If not enough, pick all available
            return df.head(n) if len(df) >= n else df

        forwards_picked = pick_players(forwards, 2)
        guards_picked = pick_players(guards, 2)
        centers_picked = pick_players(centers, 1)

        # If some positions are missing, fill from remaining players
        remaining_needed = 5 - (len(forwards_picked) + len(guards_picked) + len(centers_picked))
        if remaining_needed > 0:
            others = starters_df[
                ~starters_df['PLAYER_NAME'].isin(
                    list(forwards_picked['PLAYER_NAME']) +
                    list(guards_picked['PLAYER_NAME']) +
                    list(centers_picked['PLAYER_NAME'])
                )
            ].head(remaining_needed)
        else:
            others = pd.DataFrame()

        # Concatenate final 5
        starting_5_df = pd.concat([forwards_picked, guards_picked, centers_picked, others])

        starting_5 = starting_5_df[['PLAYER_NAME', 'START_POSITION']].to_dict('records')
        print(starting_5)
        print("team_a_id:", team_a_id, "team_b_id:", team_b_id, "winning:", winning_team_id)

        all_teams = {t["id"]: t for t in teams.get_teams()}
        print("all_teams keys:", list(all_teams.keys())[:10])  # show some ID
        print("team_a:", int(team_a_id))
        print("team_b:", int(team_b_id))
        print("team_a:", all_teams.get(int(team_a_id)))
        print("team_b:", all_teams.get(int(team_b_id)))
        print("winning:", all_teams.get(int(winning_team_id)))


        # Step 8: Prepare JSON response
        result = [{
            'game_id': game_id,
            'game_date': str(game_row['GAME_DATE']),
            'team_a': all_teams[team_a_id]['full_name'],
            'team_b': all_teams[team_b_id]['full_name'],
            'team_a_logo': logo(team_a_id),
            'team_b_logo': logo(team_b_id),
            'final_score': final_score,
            'winning_team': all_teams[winning_team_id]['full_name'],
            'starting_5': [
                {'name': p['PLAYER_NAME'], 'position': p['START_POSITION']} for p in starting_5
            ]
        }]

        return JsonResponse({"series": result})

    except Exception as e:
        return JsonResponse(
            {'error': str(e), 'message': "Error fetching game data"},
            status=500)


cached_players_data = None
def get_wordle(request):
    global cached_players_data
    try:
        if cached_players_data is None:
            all_players = players.get_players()
            players_last_names = [player['last_name'] for player in all_players]
            cached_players_data = list(filter(lambda name: len(name) == 5, players_last_names))
        
        
        sample_player = random.choice(cached_players_data)
        result = [sample_player]
        return JsonResponse({'series': result}, status=200)
    except Exception as e:
        return JsonResponse({'error', str(e)}, status=500)
    