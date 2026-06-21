import os
import json
import random
import pandas as pd
from django.conf import settings
from django.http import JsonResponse
from nba_api.stats.static import teams, players
from trivia.utils.logo_utils import logo

PLAYOFF_DATA_PATH = os.path.join(settings.BASE_DIR, 'trivia', 'utils', 'playoff_data.json')
STARTING_FIVE_DATA_PATH = os.path.join(settings.BASE_DIR, 'trivia', 'utils', 'starting_five_data.json')
MVP_DATA_PATH = os.path.join(settings.BASE_DIR, 'trivia', 'utils', 'nba_mvps.csv')

# In-memory cache for the pre-generated datasets (each file is read from disk once).
_dataset_cache = {}


def load_dataset(path):
    """Load and cache a JSON dataset from disk. Returns None if the file is missing."""
    if path not in _dataset_cache:
        if not os.path.exists(path):
            return None
        with open(path, 'r', encoding='utf-8') as f:
            _dataset_cache[path] = json.load(f)
    return _dataset_cache[path]


def get_random_playoff_series(request):
    data = load_dataset(PLAYOFF_DATA_PATH)
    if data is None:
        return JsonResponse(
            {'error': f'Data file not found at {PLAYOFF_DATA_PATH}. Run the data generation script first.'},
            status=500,
        )
    return JsonResponse({'series': random.sample(data, min(5, len(data)))})


_cached_teams = None


def get_random_nba_teams(request):
    global _cached_teams
    try:
        if _cached_teams is None:
            _cached_teams = [
                {
                    "team_id": t["id"],
                    "full_name": t["full_name"],
                    "abbreviation": t["abbreviation"],
                    "logo": logo(t["id"]),
                }
                for t in teams.get_teams()
            ]
        return JsonResponse({"series": random.sample(_cached_teams, min(5, len(_cached_teams)))})
    except Exception as e:
        return JsonResponse({"error": str(e), "message": "Error fetching NBA team logos"}, status=500)


def get_mvps(request):
    try:
        mvp_df = pd.read_csv(MVP_DATA_PATH)
        if mvp_df.empty:
            return JsonResponse({'error': 'MVP data is empty.'}, status=500)
        random_mvps = mvp_df.sample(n=min(5, len(mvp_df)))
        return JsonResponse({'series': random_mvps.to_dict(orient='records')})
    except Exception as e:
        return JsonResponse({'error': str(e), 'message': "Error fetching MVP data"}, status=500)


def get_starting_five(request):
    """Return a random game with its starting five from the pre-generated dataset."""
    data = load_dataset(STARTING_FIVE_DATA_PATH)
    if data is None:
        return JsonResponse({'error': 'Data file not found. Run the data generation script first.'}, status=500)
    if not data:
        return JsonResponse({'error': 'No games available in the local dataset.'}, status=404)
    return JsonResponse({"series": [random.choice(data)]})


_cached_wordle_names = None


def get_wordle(request):
    global _cached_wordle_names
    try:
        if _cached_wordle_names is None:
            _cached_wordle_names = [
                p['last_name'] for p in players.get_players() if len(p['last_name']) == 5
            ]
        return JsonResponse({'series': [random.choice(_cached_wordle_names)]}, status=200)
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


def _game_data_dir():
    return getattr(
        settings, "GAME_DATA_DIR", os.path.join(settings.BASE_DIR, "trivia", "data")
    )


def get_manifest(request):
    """Serve the versioned manifest of all published pools."""
    data = load_dataset(os.path.join(_game_data_dir(), "manifest.json"))
    if data is None:
        return JsonResponse(
            {"error": "manifest not found; run: manage.py refresh_game_data"}, status=404
        )
    return JsonResponse(data)


def get_pool(request, game):
    """Serve a whole game pool so the client can randomize locally / cache it."""
    safe = os.path.basename(game)  # block path traversal
    if safe == "manifest":
        return JsonResponse({"error": "use /trivia/manifest/"}, status=404)
    data = load_dataset(os.path.join(_game_data_dir(), f"{safe}.json"))
    if data is None:
        return JsonResponse({"error": f"pool '{game}' not found"}, status=404)
    return JsonResponse(
        {"pool": data, "count": len(data) if isinstance(data, list) else None}
    )
