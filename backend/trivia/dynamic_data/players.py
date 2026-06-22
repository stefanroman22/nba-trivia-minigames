from django.http import JsonResponse

from trivia.models import Player


def get_all_players(request):
    """Returns all NBA player full names from the central store (fallback: bundled list)."""
    try:
        names = list(Player.objects.values_list("full_name", flat=True))
        if names:
            return JsonResponse({"players": names})

        # Fallback: bundled static list (lazy import keeps nba_api off cold start).
        from nba_api.stats.static import players

        return JsonResponse({"players": [p["full_name"] for p in players.get_players()]})
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)
