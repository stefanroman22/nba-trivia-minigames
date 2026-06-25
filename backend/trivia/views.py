import os
import json
import random
from django.conf import settings
from django.db.models.functions import Length
from django.http import JsonResponse

from trivia.models import Mvp, Player, PlayoffSeries, StartingFiveGame, Team
from trivia.utils.logo_utils import logo
from trivia.utils.text_utils import wordle_word

# Games read from the central Supabase store (populated by `sync_nba_data`). Each
# endpoint falls back to the bundled JSON/CSV/static source if its table is empty
# or the DB is unreachable, so players never receive an error or stale-empty pool.
#
# NOTE: pandas and nba_api are imported lazily inside the fallbacks that use them.

PLAYOFF_DATA_PATH = os.path.join(settings.BASE_DIR, 'trivia', 'utils', 'playoff_data.json')
STARTING_FIVE_DATA_PATH = os.path.join(settings.BASE_DIR, 'trivia', 'utils', 'starting_five_data.json')
MVP_DATA_PATH = os.path.join(settings.BASE_DIR, 'trivia', 'utils', 'nba_mvps.csv')

# In-memory cache for the fallback datasets (each file is read from disk once).
_dataset_cache = {}


def load_dataset(path):
    """Load and cache a JSON dataset from disk. Returns None if the file is missing."""
    if path not in _dataset_cache:
        if not os.path.exists(path):
            return None
        with open(path, 'r', encoding='utf-8') as f:
            _dataset_cache[path] = json.load(f)
    return _dataset_cache[path]


def _playoff_row(s):
    """Serialize a PlayoffSeries, randomizing which side is team_a/team_b."""
    winner = (s.winner_name, s.winner_abbreviation, s.winner_team_id, s.total_games - s.loser_wins)
    loser = (s.loser_name, s.loser_abbreviation, s.loser_team_id, s.loser_wins)
    a, b = (winner, loser) if random.choice([True, False]) else (loser, winner)
    return {
        'season': s.season,
        'team_a': a[0], 'team_b': b[0],
        'team_a_abbreviation': a[1], 'team_b_abbreviation': b[1],
        'team_a_logo': logo(a[2]), 'team_b_logo': logo(b[2]),
        'team_a_wins': a[3], 'team_b_wins': b[3],
        'winner': s.winner_name,
        'round': s.round,
        'match_id': s.series_id,
        'total_games': s.total_games,
    }


def get_random_playoff_series(request):
    qs = list(PlayoffSeries.objects.order_by('?')[:5])
    if qs:
        return JsonResponse({'series': [_playoff_row(s) for s in qs]})
    # Fallback: bundled JSON (already in the team_a/team_b shape).
    data = load_dataset(PLAYOFF_DATA_PATH)
    if not data:
        return JsonResponse({'error': 'No playoff data available.'}, status=500)
    return JsonResponse({'series': random.sample(data, min(5, len(data)))})


_cached_teams = None


def get_random_nba_teams(request):
    global _cached_teams
    try:
        qs = list(Team.objects.all())
        if qs:
            pool = [
                {"team_id": t.team_id, "full_name": t.full_name,
                 "abbreviation": t.abbreviation, "logo": t.logo or logo(t.team_id)}
                for t in qs
            ]
        else:
            if _cached_teams is None:
                from nba_api.stats.static import teams
                _cached_teams = [
                    {"team_id": t["id"], "full_name": t["full_name"],
                     "abbreviation": t["abbreviation"], "logo": logo(t["id"])}
                    for t in teams.get_teams()
                ]
            pool = _cached_teams
        return JsonResponse({"series": random.sample(pool, min(5, len(pool)))})
    except Exception as e:
        return JsonResponse({"error": str(e), "message": "Error fetching NBA team logos"}, status=500)


def get_mvps(request):
    try:
        qs = list(Mvp.objects.order_by('?')[:5])
        if qs:
            return JsonResponse({'series': [
                {'season': m.season, 'mvp': m.mvp, 'team': m.team, 'team_logo_url': m.team_logo_url}
                for m in qs
            ]})
        import pandas as pd
        mvp_df = pd.read_csv(MVP_DATA_PATH)
        if mvp_df.empty:
            return JsonResponse({'error': 'MVP data is empty.'}, status=500)
        random_mvps = mvp_df.sample(n=min(5, len(mvp_df)))
        return JsonResponse({'series': random_mvps.to_dict(orient='records')})
    except Exception as e:
        return JsonResponse({'error': str(e), 'message': "Error fetching MVP data"}, status=500)


def _starting_five_row(g):
    return {
        'game_id': g.game_id, 'game_date': g.game_date,
        'team_a': g.team_a, 'team_b': g.team_b,
        'team_a_logo': g.team_a_logo, 'team_b_logo': g.team_b_logo,
        'final_score': g.final_score, 'winning_team': g.winning_team,
        'starting_5': g.starting_5,
    }


def get_starting_five(request):
    """Return a random game with its starting five."""
    g = StartingFiveGame.objects.order_by('?').first()
    if g:
        return JsonResponse({"series": [_starting_five_row(g)]})
    data = load_dataset(STARTING_FIVE_DATA_PATH)
    if not data:
        return JsonResponse({'error': 'No games available.'}, status=404)
    return JsonResponse({"series": [random.choice(data)]})


_cached_wordle_names = None


def get_wordle(request):
    global _cached_wordle_names
    try:
        # Sample a few random 5-letter surnames; return the first that cleans to
        # exactly five ASCII letters (accents stripped, e.g. Jokić -> Jokic).
        for ln in (
            Player.objects.annotate(ln=Length('last_name')).filter(ln=5)
            .order_by('?').values_list('last_name', flat=True)[:20]
        ):
            w = wordle_word(ln)
            if w:
                return JsonResponse({'series': [w]}, status=200)
        if _cached_wordle_names is None:
            from nba_api.stats.static import players
            _cached_wordle_names = [
                w for pl in players.get_players() if (w := wordle_word(pl['last_name']))
            ]
        if _cached_wordle_names:
            return JsonResponse({'series': [random.choice(_cached_wordle_names)]}, status=200)
        return JsonResponse({'error': 'no wordle words available'}, status=500)
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
            {"error": "manifest not found; run: manage.py build_pools_from_db"}, status=404
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
