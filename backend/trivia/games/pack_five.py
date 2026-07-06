"""Pack 5 — stat-trumps card pack (frozen contract #4).

Rows are PlayerIndexEntry-shaped (contract #1) and come from the bundled seed.
Single-player deals its 11-card pack CLIENT-side from the players-index pool;
this endpoint exists to publish the game's static pool (data/pack-five.json)
and to hand back a ready-dealt comparable pack ({'series': [...11 rows]}).

A row is "packable" when fame_tier is 1-3 and it carries the five trump stats
Pack 5 compares: career ppg / rpg / apg, ring count (len(awards.rings)) and
awards.allstar_count. Fame-tier 4 deep cuts are never dealt.
"""
import json
import os
import random

from django.conf import settings
from django.http import JsonResponse

GAME_NAME = "Pack 5"
SEED_PATH = os.path.join(settings.BASE_DIR, "trivia", "data_static", "pack_five_seed.json")

PACK_SIZE = 11          # 11 cards dealt => 10 comparisons (matches the renderer)
MAX_FAME_DEALT = 3      # fame-tier 4 players are never dealt


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
    rows = _packable(_load_seed())
    if len(rows) < PACK_SIZE:
        return JsonResponse({"error": "Pack 5 content not ready"}, status=503)
    pack = random.sample(rows, PACK_SIZE)
    return JsonResponse({"series": pack})


def build_pool():
    """Packable seed rows, published as the static pack-five pool."""
    return _packable(_load_seed())


def validate_rows(rows):
    """Structural + trump-stat problems for build_pools_from_db."""
    problems = []
    for i, row in enumerate(rows):
        where = f"pack-five[{i}]"
        if not isinstance(row, dict):
            problems.append(f"{where}: not an object")
            continue
        if not isinstance(row.get("person_id"), int):
            problems.append(f"{where}: person_id must be an int (real NBA id)")
        if not row.get("full_name"):
            problems.append(f"{where}: missing full_name")
        if not isinstance(row.get("aliases"), list):
            problems.append(f"{where}: aliases must be a list")
        if row.get("fame_tier") not in (1, 2, 3, 4):
            problems.append(f"{where}: fame_tier must be 1-4")
        career = row.get("career")
        if not isinstance(career, dict):
            problems.append(f"{where}: missing career block")
        else:
            for stat in ("ppg", "rpg", "apg"):
                v = career.get(stat)
                if not isinstance(v, (int, float)):
                    problems.append(f"{where}: career.{stat} must be a number")
                elif v < 0:
                    problems.append(f"{where}: career.{stat} must be >= 0")
        awards = row.get("awards")
        if not isinstance(awards, dict):
            problems.append(f"{where}: missing awards block")
        else:
            if not isinstance(awards.get("allstar_count"), int) or awards.get("allstar_count") < 0:
                problems.append(f"{where}: awards.allstar_count must be a non-negative int")
            rings = awards.get("rings")
            if not isinstance(rings, list) or not all(isinstance(y, int) for y in rings):
                problems.append(f"{where}: awards.rings must be a list of years (ints)")
    # A playable pool must be able to deal at least one full pack.
    packable = _packable(rows)
    if len(packable) < PACK_SIZE:
        problems.append(
            f"pool has only {len(packable)} packable rows; need >= {PACK_SIZE} to deal a pack"
        )
    return problems
