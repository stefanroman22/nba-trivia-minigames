from django.http import JsonResponse

from trivia.data_pipeline.live_pool import load_dataset as load_curated_dataset
from trivia.models import Player


def get_all_players(request):
    """All player full names: the central store, else the bundled curated dataset
    (the same list data/all-players.json is published from, memoized by live_pool)."""
    try:
        names = list(Player.objects.values_list("full_name", flat=True))
        if not names:
            names = [row["full_name"] for row in load_curated_dataset()]
        return JsonResponse({"players": names})
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)
