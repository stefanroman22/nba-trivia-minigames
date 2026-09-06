"""LeContexto - backend round provider.

The game ranks EVERY player in the pool by similarity to a hidden daily secret,
so a round is only playable with the players' full profiles: single-player
loads the whole players-index pool from the CDN and picks the day's secret out
of it client-side (``dailySecret`` in src/Game Renderers/Contexto.tsx, FNV-1a
over the UTC date across the fame tier 1-2 candidates).

Multiplayer therefore gets the very same thing from here: the live pool
(trivia/data_pipeline/live_pool.py), in the same {'series': [...]} array of
PlayerIndexEntry rows. One payload shape, one candidate pool, one
secret-selection algorithm — so the two modes cannot disagree about the day's
secret, and the ranking has the profiles it needs. (Before this, multiplayer
was handed a bare ``{secret, full_name}`` row and the renderer crashed reading
``teams`` off it.)
"""
from django.http import JsonResponse

from trivia.data_pipeline.live_pool import load_players

GAME_NAME = "LeContexto"


def get_round(request):
    """The live pool, exactly as single-player loads it, in the standard envelope."""
    rows = load_players()
    if not rows:
        return JsonResponse({"error": "LeContexto content not ready"}, status=503)
    return JsonResponse({"series": rows})
