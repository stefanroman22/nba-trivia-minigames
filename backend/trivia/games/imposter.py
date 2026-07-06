"""NBA Imposter — party game backend (frozen contract #4).

Imposter is a FRIEND-ROOM-ONLY social-deduction game whose live logic is owned
by the authoritative turn engine (multiplayer_server/src/turnGames.js); the
server draws the mystery player from the players-index pool. This Django module
exists to publish the game's static content — the ``mystery_pool`` of
universally-known (fame-tier-1) NBA players the game is built around — and to
keep the frozen endpoint/pool contract shape.

Seed shape: ``{"mystery_pool": ["LeBron James", ...]}`` — names drawn verbatim
from players_curated.json (fame_tier == 1). ``get_round`` hands the seed back so
a caller can read ``mystery_pool``; ``build_pool`` publishes those names as the
static ``imposter`` pool (data/imposter.json).
"""
import json
import os

from django.conf import settings
from django.http import JsonResponse

GAME_NAME = "NBA Imposter"
SEED_PATH = os.path.join(settings.BASE_DIR, "trivia", "data_static", "imposter_seed.json")

MIN_MYSTERY = 20  # a playable mystery pool needs at least this many names


def _load_seed():
    """The bundled seed dict, or ``{}`` when missing/unreadable."""
    if not os.path.exists(SEED_PATH):
        return {}
    try:
        with open(SEED_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _mystery_pool(seed):
    """The list of mystery-player names from a seed dict (non-empty strings)."""
    pool = seed.get("mystery_pool")
    if not isinstance(pool, list):
        return []
    return [n for n in pool if isinstance(n, str) and n.strip()]


def get_round(request):
    """Hand back the seed (``{"mystery_pool": [...]}``); 503 when unavailable."""
    pool = _mystery_pool(_load_seed())
    if not pool:
        return JsonResponse({"error": "NBA Imposter content not ready"}, status=503)
    return JsonResponse({"mystery_pool": pool})


def build_pool():
    """The mystery-player names, published as the static ``imposter`` pool."""
    return _mystery_pool(_load_seed())


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
