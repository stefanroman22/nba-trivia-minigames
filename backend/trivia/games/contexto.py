"""LeContexto - backend round provider.

Serves a day-seeded secret player from the bundled seed so a multiplayer room
can share ONE secret (single-player picks the same secret client-side by the
same UTC date, so both agree). Bundled seed is the always-available fallback;
the DB is optional.
"""
import datetime
import json
import os
import zlib

from django.conf import settings
from django.http import JsonResponse

GAME_NAME = "LeContexto"
SEED_PATH = os.path.join(settings.BASE_DIR, "trivia", "data_static", "contexto_seed.json")


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


def _pick_daily(rows):
    """Deterministic secret for today's UTC date (stable within the day)."""
    key = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
    idx = zlib.crc32(key.encode("utf-8")) % len(rows)
    return rows[idx]


def get_round(request):
    """The day's shared secret in the standard {'series': [...]} envelope."""
    rows = _load_seed()
    if not rows:
        return JsonResponse({"error": "LeContexto content not ready"}, status=503)
    row = _pick_daily(rows)
    return JsonResponse({"series": [{"secret": row["person_id"], "full_name": row.get("full_name")}]})


def build_pool():
    """Static pool for build_pools_from_db (seed list; [] when missing)."""
    return _load_seed()


def validate_rows(rows):
    """Per-game pool validation problems (empty list = valid)."""
    problems = []
    if not isinstance(rows, list):
        return ["contexto: expected a list"]
    seen = set()
    for i, r in enumerate(rows):
        if not isinstance(r, dict) or not isinstance(r.get("person_id"), int):
            problems.append(f"contexto[{i}]: missing int person_id")
            break
        if r["person_id"] in seen:
            problems.append(f"contexto[{i}]: duplicate person_id {r['person_id']}")
            break
        seen.add(r["person_id"])
        if r.get("fame_tier") not in (1, 2):
            problems.append(f"contexto[{i}]: fame_tier must be 1 or 2")
            break
    return problems
