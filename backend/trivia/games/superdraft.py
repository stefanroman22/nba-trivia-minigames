"""SuperDraft Five — draft-a-lineup game backend (frozen contract #4).

The playable content is a small, static objectives config (Tallest Five / Most
Rings / Most Career Points / Oldest Five). The renderer builds every draft
CLIENT-side from the "players-index" pool (contract #1): it picks one rotating
daily objective by date-hash and, per slot, a random pool constraint guaranteed
to have >= 8 eligible players. This module only publishes the objectives seed.

get_round returns the objectives seed. build_pool publishes it as a single-row
pool (data/superdraft.json) so the pool pipeline treats it like every other game.
"""
import json
import os

from django.conf import settings
from django.http import JsonResponse

GAME_NAME = "SuperDraft Five"
SEED_PATH = os.path.join(settings.BASE_DIR, "trivia", "data_static", "superdraft_seed.json")

# The renderer mirrors these four metrics; the seed is the canonical source.
VALID_METRICS = {"height_in", "rings", "career_pts", "birth_year_desc"}


def _load_seed():
    """The bundled objectives config, or {} when missing/unreadable."""
    if not os.path.exists(SEED_PATH):
        return {}
    try:
        with open(SEED_PATH, "r", encoding="utf-8") as f:
            seed = json.load(f)
    except (OSError, ValueError):
        return {}
    return seed if isinstance(seed, dict) else {}


def get_round(request):
    """The objectives seed (503 until the seed file is published)."""
    seed = _load_seed()
    if not seed.get("objectives"):
        return JsonResponse({"error": "SuperDraft Five content not ready"}, status=503)
    return JsonResponse(seed)


def build_pool():
    """The objectives seed as a single-row pool for build_pools_from_db."""
    seed = _load_seed()
    return [seed] if seed.get("objectives") else []


def validate_rows(rows):
    """Structural check: one row carrying 4 well-formed objectives + a note."""
    problems = []
    if len(rows) != 1:
        problems.append(f"superdraft: pool must be a single row, got {len(rows)}")
        return problems
    row = rows[0]
    if not isinstance(row, dict):
        problems.append("superdraft[0]: not an object")
        return problems
    objectives = row.get("objectives")
    if not isinstance(objectives, list) or len(objectives) < 4:
        problems.append("superdraft[0]: objectives must be a list of >= 4 entries")
        return problems
    seen_keys = set()
    for i, obj in enumerate(objectives):
        where = f"superdraft[0].objectives[{i}]"
        if not isinstance(obj, dict):
            problems.append(f"{where}: not an object")
            continue
        key = obj.get("key")
        if not key:
            problems.append(f"{where}: missing key")
        elif key in seen_keys:
            problems.append(f"{where}: duplicate key {key!r}")
        else:
            seen_keys.add(key)
        if not obj.get("label"):
            problems.append(f"{where}: missing label")
        if obj.get("metric") not in VALID_METRICS:
            problems.append(f"{where}: metric must be one of {sorted(VALID_METRICS)}")
    if not row.get("note"):
        problems.append("superdraft[0]: missing note")
    return problems
