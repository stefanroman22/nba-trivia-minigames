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
import json
from django.conf import settings
from django.core.cache import cache
from concurrent.futures import ThreadPoolExecutor, as_completed
PLAYOFF_DATA_PATH = os.path.join(settings.BASE_DIR, 'trivia', 'utils', 'playoff_data.json')
STARTING_FIVE_DATA_PATH = os.path.join(settings.BASE_DIR, 'trivia', 'utils', 'starting_five_data.json')

logger = logging.getLogger(__name__)

_cached_data = None

def get_random_playoff_series(request):
    global _cached_data

    # Load data into memory only once
    if _cached_data is None:
        if not os.path.exists(PLAYOFF_DATA_PATH):
            return JsonResponse(
                {'error': f'Data file not found at {PLAYOFF_DATA_PATH}. Run the data generation script first.'},
                status=500
            )

        with open(PLAYOFF_DATA_PATH, 'r', encoding='utf-8') as f:
            _cached_data = json.load(f)

    # Pick 5 random series
    sampled_series = random.sample(_cached_data, min(5, len(_cached_data)))
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
    
_cached_starting_five = None
def get_starting_five(request):
    """
    Returns a random game with starting five from pre-generated JSON file.
    """
    global _cached_starting_five

    # Load data once and cache it in memory
    if _cached_starting_five is None:
        if not os.path.exists(STARTING_FIVE_DATA_PATH):
            return JsonResponse(
                {'error': 'Data file not found. Run the data generation script first.'},
                status=500
            )
        with open(STARTING_FIVE_DATA_PATH, 'r', encoding='utf-8') as f:
            _cached_starting_five = json.load(f)

    if not _cached_starting_five:
        return JsonResponse(
            {'error': 'No games available in the local dataset.'},
            status=404
        )

    # Pick one random game
    random_game = random.choice(_cached_starting_five)
    return JsonResponse({"series": [random_game]})

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
    