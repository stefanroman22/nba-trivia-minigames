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
import random

from django.http import JsonResponse

from trivia.data_pipeline.curated_players import check_cross_stints
from trivia.data_pipeline.live_pool import load_players


def build_pool():
    """The full curated dataset, published unmodified as the pool rows."""
    return load_players()


def validate_rows(rows):
    """Contract check: >=120 rows, unique person_ids, each row has a stint + tier.

    Also checks stints ACROSS a row (ordered, no season claimed twice) — the
    per-stint checks elsewhere only ever look at one stint at a time.
    """
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
        problems += [f"players-index[{i}]: {p}" for p in check_cross_stints([row])]
        if len(problems) >= 10:
            break
    return problems


def get_round(request):
    """One random curated player, shaped like every other game's round payload."""
    rows = load_players()
    if not rows:
        return JsonResponse(
            {"error": "players_curated.json not published yet"}, status=503
        )
    return JsonResponse({"series": [random.choice(rows)]})
