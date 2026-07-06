"""Career Path Challenge — one mystery journeyman per round (frozen contract #4).

Rows are PlayerIndexEntry-shaped (contract #1) and come from the bundled seed.
Single-player rounds are picked CLIENT-side from the players-index pool; this
endpoint exists for multiplayer shared rounds (both players get the same row)
and for publishing the game's static pool (data/career-path.json).
"""
import json
import os
import random

from django.conf import settings
from django.http import JsonResponse

GAME_NAME = "Career Path Challenge"
SEED_PATH = os.path.join(settings.BASE_DIR, "trivia", "data_static", "career_path_seed.json")

# maxPoints is 700 => stints * 100 caps at 7; fewer than 3 stints is no game.
MIN_STINTS, MAX_STINTS = 3, 7


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


def _eligible(rows):
    return [
        r for r in rows
        if isinstance(r, dict)
        and isinstance(r.get("teams"), list)
        and MIN_STINTS <= len(r["teams"]) <= MAX_STINTS
    ]


def get_round(request):
    """One eligible player row, weighted toward fame-tier 2-3 journeymen."""
    rows = _eligible(_load_seed())
    if not rows:
        return JsonResponse({"error": "Career Path Challenge content not ready"}, status=503)
    weights = [3 if r.get("fame_tier") in (2, 3) else 1 for r in rows]
    pick = random.choices(rows, weights=weights, k=1)[0]
    return JsonResponse({"series": [pick]})


def build_pool():
    """Eligible seed rows, published as the static career-path pool."""
    return _eligible(_load_seed())


def validate_rows(rows):
    """Structural + eligibility problems for build_pools_from_db."""
    problems = []
    for i, row in enumerate(rows):
        where = f"career-path[{i}]"
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
        teams = row.get("teams")
        if not isinstance(teams, list) or not (MIN_STINTS <= len(teams) <= MAX_STINTS):
            problems.append(f"{where}: needs {MIN_STINTS}-{MAX_STINTS} team stints")
            continue
        for j, t in enumerate(teams):
            stint = f"{where}.teams[{j}]"
            if not (isinstance(t, dict) and t.get("abbr") and t.get("name")):
                problems.append(f"{stint}: needs abbr + name")
                continue
            if not isinstance(t.get("start_year"), int):
                problems.append(f"{stint}: start_year must be an int")
            end = t.get("end_year")
            if end is not None and (not isinstance(end, int) or end < t.get("start_year", 0)):
                problems.append(f"{stint}: end_year must be null or >= start_year")
            if end is None and j != len(teams) - 1:
                problems.append(f"{stint}: only the last stint may be current (end_year null)")
            for stat in ("gp", "ppg"):
                v = t.get(stat)
                if v is not None and not isinstance(v, (int, float)):
                    problems.append(f"{stint}: {stat} must be a number or null")
        draft = row.get("draft")
        if draft is not None and not (
            isinstance(draft, dict)
            and all(isinstance(draft.get(k), int) for k in ("year", "round", "pick"))
            and draft.get("team_abbr")
        ):
            problems.append(f"{where}: draft must be null or {{year,round,pick,team_abbr}}")
    return problems
