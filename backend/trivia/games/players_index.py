"""players-index — publishes the curated player dataset as a client pool.

The foundation agent authors trivia/data_static/players_curated.json (frozen
contract #1). This module republishes those rows verbatim as the
"players-index" pool (backend/trivia/data/players-index.json), which every
criteria-driven game validates answers against on the client, and which the
socket server fetches via /trivia/pool/players-index/.

get_round exposes one random curated player as {'series': [row]} — a cheap
"random real player" provider some games/tools use; the dataset itself is the
primary product.
"""
import json
import os
import random

from django.conf import settings
from django.http import JsonResponse

CURATED_PATH = os.path.join(
    settings.BASE_DIR, "trivia", "data_static", "players_curated.json"
)


def _load_curated():
    """Curated rows from data_static ([] until the foundation agent ships them)."""
    if not os.path.exists(CURATED_PATH):
        return []
    try:
        with open(CURATED_PATH, "r", encoding="utf-8") as f:
            rows = json.load(f)
    except (OSError, ValueError):
        return []
    return rows if isinstance(rows, list) else []


def build_pool():
    """The full curated dataset, published unmodified as the pool rows."""
    return _load_curated()


def validate_rows(rows):
    """Contract check: >=120 rows, unique person_ids, each row has a stint + tier."""
    problems = []
    if not isinstance(rows, list):
        return ["players-index: pool is not a list"]
    if len(rows) < 120:
        problems.append(f"players-index: only {len(rows)} rows (need >= 120)")
    seen = set()
    for i, row in enumerate(rows):
        if not isinstance(row, dict):
            problems.append(f"players-index[{i}]: not an object")
            break
        pid = row.get("person_id")
        if pid is None:
            problems.append(f"players-index[{i}]: missing person_id")
        elif pid in seen:
            problems.append(f"players-index[{i}]: duplicate person_id {pid}")
        else:
            seen.add(pid)
        if not row.get("teams"):
            problems.append(f"players-index[{i}] ({row.get('full_name')}): no team stints")
        if not row.get("fame_tier"):
            problems.append(f"players-index[{i}] ({row.get('full_name')}): missing fame_tier")
        if len(problems) >= 10:
            break
    return problems


def get_round(request):
    """One random curated player, shaped like every other game's round payload."""
    rows = _load_curated()
    if not rows:
        return JsonResponse(
            {"error": "players_curated.json not published yet"}, status=503
        )
    return JsonResponse({"series": [random.choice(rows)]})
