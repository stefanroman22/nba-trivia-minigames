"""NBA Tic-Tac-Toe — backend round provider (frozen contract #4).

Serves one random 3x3 criteria board from the bundled seed (always available;
DB optional). Also hosts the Python mirror of the frozen criteria semantics
(contract #3, src/utils/criteria.ts) so validate_rows can prove every cell has
at least one valid player in the curated index when it is present.
"""
import json
import os
import random
import re
from datetime import date

from django.conf import settings
from django.http import JsonResponse

GAME_NAME = "NBA Tic-Tac-Toe"
SEED_PATH = os.path.join(settings.BASE_DIR, "trivia", "data_static", "tictactoe_seed.json")
CURATED_PATH = os.path.join(settings.BASE_DIR, "trivia", "data_static", "players_curated.json")

CRITERION_TYPES = {"team", "award", "country", "draft", "college", "stat", "era"}
AWARD_VALUES = {"mvp", "fmvp", "dpoy", "roty", "smoy", "ring", "allstar5plus", "allnba"}
STAT_VALUES = {"20kpts", "25kpts", "ppg20", "rpg10", "apg8", "seasons15plus"}
CURRENT_YEAR = date.today().year


def _load_json(path):
    if not os.path.exists(path):
        return []
    try:
        with open(path, "r", encoding="utf-8") as f:
            rows = json.load(f)
    except (OSError, ValueError):
        return []
    return rows if isinstance(rows, list) else []


def _load_seed():
    """Bundled seed rows (the always-available fallback; DB is optional)."""
    return _load_json(SEED_PATH)


def _decade_start(value):
    """'1990s' / 'decade-1990s' -> 1990; None when the value has no decade."""
    m = re.search(r"(\d{4})s$", value or "")
    return int(m.group(1)) if m else None


def player_matches(p, c):
    """Python mirror of src/utils/criteria.ts playerMatches (contract #3)."""
    t, v = c.get("type"), c.get("value")
    if t == "team":
        return any(s.get("abbr") == v for s in p.get("teams", []))
    if t == "award":
        a = p.get("awards", {}) or {}
        return {
            "mvp": bool(a.get("mvp")),
            "fmvp": bool(a.get("fmvp")),
            "dpoy": bool(a.get("dpoy")),
            "roty": a.get("roty") is not None,
            "smoy": bool(a.get("smoy")),
            "ring": bool(a.get("rings")),
            "allstar5plus": a.get("allstar_count", 0) >= 5,
            "allnba": a.get("allnba_count", 0) > 0,
        }.get(v, False)
    if t == "country":
        if v == "USA":
            return p.get("country") == "USA"
        if v == "INTL":
            return p.get("country") != "USA"
        return p.get("country") == v
    if t == "draft":
        d = p.get("draft")
        if v == "undrafted":
            return d is None
        if not d:
            return False
        if v == "top5":
            return d.get("pick", 99) <= 5
        if v == "lottery":
            return d.get("pick", 99) <= 14
        if v == "round2":
            return d.get("round") == 2
        if isinstance(v, str) and v.startswith("decade-"):
            ds = _decade_start(v)
            return ds is not None and ds <= d.get("year", 0) <= ds + 9
        return False
    if t == "college":
        if v == "none":
            return p.get("college") is None
        return p.get("college") == v
    if t == "stat":
        car = p.get("career", {}) or {}
        return {
            "20kpts": car.get("pts", 0) >= 20000,
            "25kpts": car.get("pts", 0) >= 25000,
            "ppg20": car.get("ppg", 0) >= 20,
            "rpg10": car.get("rpg", 0) >= 10,
            "apg8": car.get("apg", 0) >= 8,
            "seasons15plus": car.get("seasons", 0) >= 15,
        }.get(v, False)
    if t == "era":
        ds = _decade_start(v)
        if ds is None:
            return False
        return any(
            s.get("start_year", 9999) <= ds + 9 and (s.get("end_year") or CURRENT_YEAR) >= ds
            for s in p.get("teams", [])
        )
    return False


def _valid_criterion(c):
    return (
        isinstance(c, dict)
        and c.get("type") in CRITERION_TYPES
        and isinstance(c.get("value"), str) and c["value"]
        and isinstance(c.get("label"), str) and c["label"]
        and (c["type"] != "award" or c["value"] in AWARD_VALUES)
        and (c["type"] != "stat" or c["value"] in STAT_VALUES)
    )


def get_round(request):
    """One random seed board in the standard {'series': [...]} envelope."""
    rows = _load_seed()
    if not rows:
        return JsonResponse({"error": "NBA Tic-Tac-Toe content not ready"}, status=503)
    return JsonResponse({"series": [random.choice(rows)]})


def build_pool():
    """Static pool for build_pools_from_db (seed list; [] when missing)."""
    return _load_seed()


def validate_rows(rows):
    """Structural problems + (when the curated index exists) unsolvable cells."""
    problems = []
    seen_qids = set()
    for i, row in enumerate(rows):
        tag = f"board[{i}]"
        if not isinstance(row, dict):
            problems.append(f"{tag}: not an object")
            continue
        qid = row.get("qid")
        if not isinstance(qid, str) or not qid:
            problems.append(f"{tag}: missing qid")
        elif len(qid) > 50:
            problems.append(f"{tag}: qid too long (>50, breaks question_id)")
        elif qid in seen_qids:
            problems.append(f"{tag}: duplicate qid {qid}")
        else:
            seen_qids.add(qid)
        for axis in ("rows", "cols"):
            crits = row.get(axis)
            if not isinstance(crits, list) or len(crits) != 3:
                problems.append(f"{tag}.{axis}: must be exactly 3 criteria")
                continue
            for j, c in enumerate(crits):
                if not _valid_criterion(c):
                    problems.append(f"{tag}.{axis}[{j}]: invalid criterion {c!r}")
    if problems:
        return problems

    players = _load_json(CURATED_PATH)
    if not players:
        # Foundation dataset not landed yet — structural checks only so the
        # aggregator pipeline never blocks on landing order.
        return problems
    for row in rows:
        for r, rc in enumerate(row["rows"]):
            for cidx, cc in enumerate(row["cols"]):
                if not any(player_matches(p, rc) and player_matches(p, cc) for p in players):
                    problems.append(
                        f"{row['qid']}: cell r{r}c{cidx} unsolvable "
                        f"({rc['value']} x {cc['value']})"
                    )
    return problems
