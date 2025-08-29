from django.http import JsonResponse
from nba_api.stats.static import players

def get_all_players(request):
    """
    Returns all NBA players as JSON with their full names.
    """
    try:
        # Get all players (current + historical)
        all_players = players.get_players()

        # Extract full names
        player_names = [player['full_name'] for player in all_players]

        return JsonResponse({'players': player_names})

    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)
