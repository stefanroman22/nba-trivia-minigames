"""SuperDraft Five — draft-a-lineup game backend (frozen contract #4).

The whole draft is built CLIENT-side from the players-index pool
(src/Game Renderers/SuperDraft.tsx): one rotating daily objective picked by
date-hash, and per slot a random pool constraint (a franchise / a country / a
draft decade) guaranteed to have >= 8 eligible players. The objectives live in
the renderer; the only thing a round needs from the server is the player pool.

So the round IS the live pool (trivia/data_pipeline/live_pool.py), served in
the standard {'series': [...]} envelope — the same rows single-player pulls
from the CDN. Multiplayer used to receive the raw objectives config here, which
carries no 'series' at all, so the socket server saw an empty round and the
match failed to start.
"""
from django.http import JsonResponse

from trivia.data_pipeline.live_pool import load_players

GAME_NAME = "SuperDraft Five"


def get_round(request):
    """The live pool, exactly as single-player loads it, in the standard envelope."""
    rows = load_players()
    if not rows:
        return JsonResponse({"error": "SuperDraft Five content not ready"}, status=503)
    return JsonResponse({"series": rows})
