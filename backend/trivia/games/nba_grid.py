"""NBA Grid — backend round provider + community rarity tally (frozen contract #4).

Serves the 3x3 immaculate-grid configs from the bundled seed file (DB optional,
the seed is the always-available fallback) and exposes a rarity tally endpoint
that aggregates correct picks from GuessLog per cell.
"""
import json
import os
import random
from collections import defaultdict

from django.conf import settings
from django.http import JsonResponse
from django.urls import path

from trivia.models import GuessLog

GAME_NAME = "NBA Grid"
SEED_PATH = os.path.join(settings.BASE_DIR, "trivia", "data_static", "nba_grid_seed.json")

_ALLOWED_TYPES = {"team", "award", "country", "draft", "college", "stat", "era"}


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
    """One random grid config in the standard {'series': [...]} envelope."""
    rows = _load_seed()
    if not rows:
        return JsonResponse({"error": "NBA Grid content not ready"}, status=503)
    return JsonResponse({"series": [random.choice(rows)]})


def build_pool():
    """Static pool for build_pools_from_db (seed list; [] when missing)."""
    return _load_seed()


def _criterion_ok(c):
    return (
        isinstance(c, dict)
        and c.get("type") in _ALLOWED_TYPES
        and isinstance(c.get("value"), str) and c["value"]
        and isinstance(c.get("label"), str) and c["label"]
    )


def validate_rows(rows):
    """Shape-only validation (never needs the curated file at request time).

    Deep intersection coverage (>=3 valid players per cell) is asserted
    separately by the committed nba_grid_validate.py against players_curated.
    """
    problems = []
    seen = set()
    for i, row in enumerate(rows):
        if not isinstance(row, dict):
            problems.append(f"row {i}: not an object")
            continue
        qid = row.get("qid")
        if not isinstance(qid, str) or not qid:
            problems.append(f"row {i}: missing qid")
        elif len(qid) > 50:
            problems.append(f"row {i}: qid too long (>50, breaks question_id)")
        elif qid in seen:
            problems.append(f"row {i}: duplicate qid {qid}")
        else:
            seen.add(qid)
        for axis in ("rows", "cols"):
            val = row.get(axis)
            if not isinstance(val, list) or len(val) != 3:
                problems.append(f"row {i} ({qid}): {axis} must be exactly 3 criteria")
                continue
            for j, c in enumerate(val):
                if not _criterion_ok(c):
                    problems.append(f"row {i} ({qid}): {axis}[{j}] malformed criterion")
    return problems


def nba_grid_tally(request):
    """{cell: {answer: count}} from correct GuessLog picks for a single grid qid.

    Cell keys are the "r<r>c<c>" suffix the renderer logs as "<qid>:<cell>".
    Only correct=True rows count — the community's *picks* are correct claims;
    wrong guesses are noise for rarity.
    """
    qid = request.GET.get("qid", "").strip()
    if not qid:
        return JsonResponse({"error": "qid required"}, status=400)
    out = defaultdict(lambda: defaultdict(int))
    rows = (
        GuessLog.objects.filter(
            game="nba-grid", correct=True, question_id__startswith=f"{qid}:"
        )
        .values_list("question_id", "answer")
        .iterator()
    )
    for question_id, answer in rows:
        cell = question_id.split(":", 1)[1] if ":" in question_id else ""
        if cell and answer:
            out[cell][answer] += 1
    return JsonResponse({cell: dict(c) for cell, c in out.items()})


EXTRA_URLS = [path("nba-grid/tally/", nba_grid_tally, name="nba-grid-tally")]
