"""Who Are Ya — mystery-player rounds served from the bundled seed.

The seed is a list of full PlayerIndexEntry rows (frozen contract #1),
restricted to fame tiers 1-2 so every row is a fair mystery player.
get_round returns exactly one eligible row (multiplayer: both clients get
the same player via the round payload; single-player picks client-side).
"""
import json
import os
import random

from django.conf import settings
from django.http import JsonResponse

GAME_NAME = "Who Are Ya"
SEED_PATH = os.path.join(settings.BASE_DIR, "trivia", "data_static", "who_are_ya_seed.json")

_REQUIRED_KEYS = (
    "person_id", "full_name", "aliases", "fame_tier", "position", "height_in",
    "weight_lb", "birth_year", "country", "college", "draft", "jersey",
    "is_active", "teams", "awards", "career",
)
_POSITIONS = ("G", "F", "C", "G-F", "F-C")


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


def _eligible(row):
    """A fair mystery player: famous (tier 1-2) with at least one team stint."""
    return row.get("fame_tier") in (1, 2) and bool(row.get("teams"))


def get_round(request):
    """One random eligible seed row in the standard {'series': [...]} envelope."""
    rows = [r for r in _load_seed() if _eligible(r)]
    if not rows:
        return JsonResponse({"error": "Who Are Ya content not ready"}, status=503)
    return JsonResponse({"series": [random.choice(rows)]})


def build_pool():
    """Static pool for build_pools_from_db (seed list; [] when missing)."""
    return _load_seed()


def validate_rows(rows):
    """Content-quality problems in a who-are-ya pool (empty list = valid)."""
    problems = []
    seen_ids = set()
    for i, row in enumerate(rows):
        tag = f"row {i} ({row.get('full_name', '?')})"
        for key in _REQUIRED_KEYS:
            if key not in row:
                problems.append(f"{tag}: missing key '{key}'")
        pid = row.get("person_id")
        if not isinstance(pid, int) or pid <= 0:
            problems.append(f"{tag}: person_id must be a positive int")
        elif pid in seen_ids:
            problems.append(f"{tag}: duplicate person_id {pid}")
        else:
            seen_ids.add(pid)
        if not row.get("full_name"):
            problems.append(f"{tag}: empty full_name")
        if row.get("fame_tier") not in (1, 2):
            problems.append(f"{tag}: fame_tier must be 1 or 2 for this game")
        if row.get("position") not in _POSITIONS:
            problems.append(f"{tag}: bad position {row.get('position')!r}")
        by = row.get("birth_year")
        if by is not None and not (1930 <= by <= 2010):
            problems.append(f"{tag}: implausible birth_year {by}")
        jersey = row.get("jersey")
        if jersey is not None and not (0 <= jersey <= 99):
            problems.append(f"{tag}: implausible jersey {jersey}")
        teams = row.get("teams") or []
        if not teams:
            problems.append(f"{tag}: teams must be non-empty")
        for t in teams:
            if not t.get("abbr") or not isinstance(t.get("start_year"), int):
                problems.append(f"{tag}: team stint missing abbr/start_year")
        draft = row.get("draft")
        if draft is not None:
            if not all(k in draft for k in ("year", "round", "pick", "team_abbr")):
                problems.append(f"{tag}: draft missing year/round/pick/team_abbr")
            elif not (1947 <= draft["year"] <= 2026):
                problems.append(f"{tag}: implausible draft year {draft['year']}")
    return problems
