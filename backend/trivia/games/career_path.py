"""Career Path Challenge — one mystery journeyman per round (frozen contract #4).

Single-player picks its mystery player CLIENT-side out of the whole
players-index pool. This endpoint exists for multiplayer shared rounds (both
players get the same row), so it applies the SAME eligibility rule to the SAME
live pool (trivia/data_pipeline/live_pool.py) at request time — 3-7 team
stints, weighted toward fame-tier 2-3 journeymen, exactly like
``isEligible``/``pickMystery`` in src/Game Renderers/CareerPath.tsx.
"""
import random

from django.http import JsonResponse

from trivia.data_pipeline.live_pool import load_players

GAME_NAME = "Career Path Challenge"

# maxPoints is 700 => stints * 100 caps at 7; fewer than 3 stints is no game.
MIN_STINTS, MAX_STINTS = 3, 7


def _eligible(rows):
    return [
        r for r in rows
        if isinstance(r, dict)
        and isinstance(r.get("teams"), list)
        and MIN_STINTS <= len(r["teams"]) <= MAX_STINTS
    ]


def get_round(request):
    """One eligible player row, weighted toward fame-tier 2-3 journeymen."""
    rows = _eligible(load_players())
    if not rows:
        return JsonResponse({"error": "Career Path Challenge content not ready"}, status=503)
    weights = [3 if r.get("fame_tier") in (2, 3) else 1 for r in rows]
    pick = random.choices(rows, weights=weights, k=1)[0]
    return JsonResponse({"series": [pick]})
