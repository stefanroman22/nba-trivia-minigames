"""NBA Connections — backend round provider (frozen contract #4).

Serves one random board from the bundled seed. DB is optional; the seed file is
the always-available fallback. build_pool()/validate_rows() feed the pool
pipeline. Ambiguity (cross-group) checks live in connections_validate.py — this
module only does structural validation so builds never require players_curated.
"""
import json
import os
import random

from django.conf import settings
from django.http import JsonResponse

GAME_NAME = "NBA Connections"
SEED_PATH = os.path.join(settings.BASE_DIR, "trivia", "data_static", "connections_seed.json")


def _load_seed():
    """Bundled seed rows (the always-available fallback; DB is optional)."""
    if not os.path.exists(SEED_PATH):
        return []
    try:
        with open(SEED_PATH, "r", encoding="utf-8") as f:
            rows = json.load(f)
    except (OSError, ValueError):
        return []
    return rows if isinstance(rows, list) else []


def get_round(request):
    """One random seed board in the standard {'series': [...]} envelope."""
    rows = _load_seed()
    if not rows:
        return JsonResponse({"error": "NBA Connections content not ready"}, status=503)
    return JsonResponse({"series": [random.choice(rows)]})


def build_pool():
    """Static pool for build_pools_from_db (seed list; [] when missing)."""
    return _load_seed()


def validate_rows(rows):
    """Structural problems only (16 unique tiles, 4x4 partition, tiers 1-4).

    The richer cross-group ambiguity check lives in connections_validate.py so
    the pool pipeline never depends on players_curated.json being present.
    """
    problems = []
    for b in rows:
        qid = b.get("qid", "?")
        tiles = b.get("tiles", [])
        groups = b.get("groups", [])
        if len(tiles) != 16 or len(set(tiles)) != 16:
            problems.append(f"{qid}: tiles not 16-unique")
            continue
        if len(groups) != 4 or any(len(g.get("members", [])) != 4 for g in groups):
            problems.append(f"{qid}: not four 4-member groups")
            continue
        union = [m for g in groups for m in g["members"]]
        if set(union) != set(tiles) or len(union) != 16 or len(set(union)) != 16:
            problems.append(f"{qid}: partition broken (tiles != union of groups)")
        if sorted(g.get("difficulty") for g in groups) != [1, 2, 3, 4]:
            problems.append(f"{qid}: difficulties must be exactly 1,2,3,4")
    return problems
