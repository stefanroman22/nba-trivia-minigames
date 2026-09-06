"""Pack 5 — stat-trumps card pack (frozen contract #4).

Single-player deals its 11-card pack CLIENT-side from the players-index pool;
this endpoint hands multiplayer a ready-dealt pack ({'series': [...11 rows]})
so both players compare the same cards. It deals from the SAME live pool
(trivia/data_pipeline/live_pool.py) under the same rule the renderer uses.

A row is "packable" when fame_tier is 1-3 and it carries the five trump stats
Pack 5 compares: career ppg / rpg / apg, ring count (len(awards.rings)) and
awards.allstar_count. Fame-tier 4 deep cuts are never dealt.
"""
import random

from django.http import JsonResponse

from trivia.data_pipeline.live_pool import load_players

GAME_NAME = "Pack 5"

PACK_SIZE = 11          # 11 cards dealt => 10 comparisons (matches the renderer)
MAX_FAME_DEALT = 3      # fame-tier 4 players are never dealt


def _is_packable(r):
    """True when the row carries all five trump stats Pack 5 compares."""
    if not isinstance(r, dict):
        return False
    if r.get("fame_tier") not in (1, 2, 3):
        return False
    career = r.get("career")
    if not isinstance(career, dict):
        return False
    if not all(isinstance(career.get(k), (int, float)) for k in ("ppg", "rpg", "apg")):
        return False
    awards = r.get("awards")
    if not isinstance(awards, dict):
        return False
    if not isinstance(awards.get("allstar_count"), int):
        return False
    if not isinstance(awards.get("rings"), list):
        return False
    return True


def _packable(rows):
    return [r for r in rows if _is_packable(r)]


def get_round(request):
    """One ready-dealt pack of PACK_SIZE comparable players, left -> right."""
    rows = _packable(load_players())
    if len(rows) < PACK_SIZE:
        return JsonResponse({"error": "Pack 5 content not ready"}, status=503)
    pack = random.sample(rows, PACK_SIZE)
    return JsonResponse({"series": pack})
