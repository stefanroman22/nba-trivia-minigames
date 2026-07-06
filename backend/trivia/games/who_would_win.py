"""Who Would Win — opinion matchups + live community tally.

get_round serves a session of matchups straight from the bundled seed
(always-available fallback; no DB needed). Votes arrive through the shared
/trivia/log-guesses/ flywheel as GuessLog rows (game="who-would-win",
answer="a"|"b", correct=False); the tally endpoint aggregates those rows
live, grouped by answer, so the community split is always current.
"""
import json
import os
import random

from django.conf import settings
from django.db.models import Count
from django.http import JsonResponse
from django.urls import path

GAME_NAME = "Who Would Win"
SEED_PATH = os.path.join(settings.BASE_DIR, "trivia", "data_static", "who_would_win_seed.json")
ROUNDS_PER_SESSION = 10
MAX_LABEL_LEN = 60
MAX_SUB_LEN = 90
MIN_MATCHUPS = 30


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
    """A session's worth of distinct matchups in the standard envelope."""
    rows = _load_seed()
    if not rows:
        return JsonResponse({"error": "Who Would Win content not ready"}, status=503)
    return JsonResponse({"series": random.sample(rows, min(ROUNDS_PER_SESSION, len(rows)))})


def get_tally(request):
    """Live community split for one matchup: GuessLog grouped by answer.

    The flywheel endpoint stores every vote as a GuessLog row; this view is
    the read side. Only "a"/"b" answers count (junk rows are ignored).
    """
    # Lazy import keeps trivia.games importable outside a fully-wired app
    # (data_pipeline.validate relies on that).
    from trivia.models import GuessLog

    qid = (request.GET.get("qid") or "").strip()
    if not qid:
        return JsonResponse({"error": "qid is required"}, status=400)
    counts = {"a": 0, "b": 0}
    qs = (
        GuessLog.objects.filter(game="who-would-win", question_id=qid)
        .values("answer")
        .annotate(n=Count("id"))
    )
    for row in qs:
        if row["answer"] in counts:
            counts[row["answer"]] = row["n"]
    return JsonResponse(
        {"qid": qid, "a": counts["a"], "b": counts["b"], "total": counts["a"] + counts["b"]}
    )


def build_pool():
    """Static pool for build_pools_from_db (seed list; [] when missing)."""
    return _load_seed()


def validate_rows(rows):
    """Per-game pool validation problems (empty list = valid)."""
    problems = []
    if not isinstance(rows, list):
        return ["who-would-win: expected a list"]
    seen = set()
    for i, r in enumerate(rows):
        if not isinstance(r, dict):
            problems.append(f"who-would-win[{i}]: not an object")
            continue
        qid = r.get("qid")
        if not qid or not isinstance(qid, str):
            problems.append(f"who-would-win[{i}]: missing qid")
        elif qid in seen:
            problems.append(f"who-would-win[{i}]: duplicate qid {qid}")
        else:
            seen.add(qid)
        for side in ("a", "b"):
            s = r.get(side)
            if not isinstance(s, dict) or not s.get("label"):
                problems.append(f"who-would-win[{i}]: side '{side}' needs a label")
                continue
            if len(s["label"]) > MAX_LABEL_LEN:
                problems.append(f"who-would-win[{i}]: side '{side}' label too long (>{MAX_LABEL_LEN})")
            if len(str(s.get("sub") or "")) > MAX_SUB_LEN:
                problems.append(f"who-would-win[{i}]: side '{side}' sub too long (>{MAX_SUB_LEN})")
    if len(rows) < MIN_MATCHUPS:
        problems.append(f"who-would-win: need >= {MIN_MATCHUPS} matchups, got {len(rows)}")
    return problems


# Aggregated verbatim by trivia/games/__init__.py under the /trivia/ prefix.
EXTRA_URLS = [
    path("who-would-win/tally/", get_tally, name="who-would-win-tally"),
]
