"""The Heatmap — hex-grid category board backend (frozen contract #4).

Serves one random board from the bundled seed (always works offline). The seed
is authored + solvability-proven at build time by heatmap_gen.py /
heatmap_validate.py; validate_rows here is a cheap structural gate for the
publish pipeline (no DB / curated data needed).
"""
import json
import os
import random

from django.conf import settings
from django.http import JsonResponse

from trivia.games.heatmap_criteria import ROW_WIDTHS, compute_neighbors

GAME_NAME = "The Heatmap"
SEED_PATH = os.path.join(settings.BASE_DIR, "trivia", "data_static", "heatmap_seed.json")
_VALID_TYPES = {"team", "award", "country", "draft", "college", "stat", "era"}


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
    """One random seed row in the standard {'series': [...]} envelope."""
    rows = _load_seed()
    if not rows:
        return JsonResponse({"error": "The Heatmap content not ready"}, status=503)
    return JsonResponse({"series": [random.choice(rows)]})


def build_pool():
    """Static pool for build_pools_from_db (all seed boards; [] when missing)."""
    return _load_seed()


def validate_rows(rows):
    """Cheap structural validation (no curated data needed)."""
    problems = []
    expected_nei = compute_neighbors()
    n = sum(ROW_WIDTHS)
    for b in rows:
        qid = b.get("qid", "<no-qid>")
        hexes = b.get("hexes", [])
        ids = sorted(h.get("id") for h in hexes)
        if len(hexes) != n or ids != list(range(n)):
            problems.append(f"{qid}: expected ids 0..{n - 1}")
            continue
        for h in hexes:
            c = h.get("criterion", {})
            if c.get("type") not in _VALID_TYPES or not c.get("value") or not c.get("label"):
                problems.append(f"{qid} hex {h.get('id')}: bad criterion")
            if sorted(h.get("neighbors", [])) != expected_nei[h["id"]]:
                problems.append(f"{qid} hex {h.get('id')}: neighbors != template")
    return problems
