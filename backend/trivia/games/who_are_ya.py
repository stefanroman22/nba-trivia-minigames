"""Who Are Ya — mystery-player rounds drawn from the live players-index pool.

Single-player samples its mystery player CLIENT-side from the whole pool;
multiplayer takes it from here so both clients get the same player. Both apply
the same rule to the same live dataset
(trivia/data_pipeline/live_pool.py) at request time: fame tier 1-2 with at
least one team stint — ``isEligible`` in src/Game Renderers/WhoAreYa.tsx.
get_round returns exactly one eligible row in the standard envelope.
"""
import random

from django.http import JsonResponse

from trivia.data_pipeline.live_pool import load_players

GAME_NAME = "Who Are Ya"

# A fair mystery player is a famous one; tier 3-4 deep cuts are unguessable.
ELIGIBLE_FAME_TIERS = (1, 2)


def _eligible(row):
    """A fair mystery player: famous (tier 1-2) with at least one team stint."""
    return (
        isinstance(row, dict)
        and row.get("fame_tier") in ELIGIBLE_FAME_TIERS
        and bool(row.get("teams"))
    )


def get_round(request):
    """One random eligible pool row in the standard {'series': [...]} envelope."""
    rows = [r for r in load_players() if _eligible(r)]
    if not rows:
        return JsonResponse({"error": "Who Are Ya content not ready"}, status=503)
    return JsonResponse({"series": [random.choice(rows)]})
