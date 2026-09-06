"""NBA Imposter — party game backend (frozen contract #4).

Imposter is a FRIEND-ROOM-ONLY social-deduction game whose live logic is owned
by the authoritative turn engine (multiplayer_server/src/turnGames.js). Its
``pickMystery`` draws the mystery player straight from the players-index pool
with exactly one rule: ``(fame_tier || 4) <= 2``.

This module mirrors THAT rule over the same live pool
(trivia/data_pipeline/live_pool.py) so the published ``imposter`` pool and the
admin panel describe what the game actually does. It used to publish a
separately hand-authored fame-tier-1 name list that nothing ever read, which
disagreed with the live game by 50 players.

``get_round`` hands back ``{"mystery_pool": [...]}`` (a name list, not a
"round" — the documented exception to the {'series': [...]} envelope);
``build_pool`` publishes those same names as the static ``imposter`` pool
(data/imposter.json).
"""
from django.http import JsonResponse

from trivia.data_pipeline.live_pool import load_players

GAME_NAME = "NBA Imposter"

MAX_MYSTERY_TIER = 2  # turnGames.js pickMystery: (p.fame_tier || 4) <= 2
MIN_MYSTERY = 20      # a playable mystery pool needs at least this many names


def _is_mystery(row):
    """The turn server's eligibility rule, mirrored exactly."""
    if not isinstance(row, dict):
        return False
    name = row.get("full_name")
    if not isinstance(name, str) or not name.strip():
        return False
    return (row.get("fame_tier") or 4) <= MAX_MYSTERY_TIER


def _mystery_pool(rows):
    """The mystery-player names the live game can draw, in pool order."""
    return [r["full_name"] for r in rows if _is_mystery(r)]


def get_round(request):
    """Hand back ``{"mystery_pool": [...]}``; 503 when the pool is unavailable."""
    pool = _mystery_pool(load_players())
    if not pool:
        return JsonResponse({"error": "NBA Imposter content not ready"}, status=503)
    return JsonResponse({"mystery_pool": pool})


def build_pool():
    """The mystery-player names, published as the static ``imposter`` pool."""
    return _mystery_pool(load_players())


def validate_rows(rows):
    """Structural problems for build_pools_from_db (each row is a name string)."""
    problems = []
    seen = set()
    for i, row in enumerate(rows):
        where = f"imposter[{i}]"
        if not isinstance(row, str) or not row.strip():
            problems.append(f"{where}: mystery name must be a non-empty string")
            continue
        key = row.strip().lower()
        if key in seen:
            problems.append(f"{where}: duplicate mystery name {row!r}")
        seen.add(key)
    if len(rows) < MIN_MYSTERY:
        problems.append(
            f"mystery pool has only {len(rows)} names; need >= {MIN_MYSTERY}"
        )
    return problems
