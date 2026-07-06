"""NBA Bingo — backend round provider (frozen contract #4).

Serves one random 16-criterion card per round from the bundled seed. All
gameplay (dealing players, dab validation, scoring) is client-side against
the players-index pool, so this module stays a thin static-content server
plus the seed validator used by build_pools_from_db and the
validate_bingo_seed management command.
"""
import json
import os
import random
import re
from datetime import date

from django.conf import settings
from django.http import JsonResponse

GAME_NAME = "NBA Bingo"
SEED_PATH = os.path.join(settings.BASE_DIR, "trivia", "data_static", "bingo_seed.json")
CURATED_PATH = os.path.join(settings.BASE_DIR, "trivia", "data_static", "players_curated.json")

CELLS_PER_CARD = 16
EXPECTED_CARDS = 10
MIN_MATCHES_PER_CELL = 4
MAX_FAME_TIER_DEALT = 3  # the client only deals fame_tier <= 3 players

CRITERION_TYPES = {"team", "award", "country", "draft", "college", "stat", "era"}
AWARD_VALUES = {"mvp", "fmvp", "dpoy", "roty", "smoy", "ring", "allstar5plus", "allnba"}
STAT_VALUES = {"20kpts", "25kpts", "ppg20", "rpg10", "apg8", "seasons15plus"}
ERA_VALUES = {"1980s", "1990s", "2000s", "2010s", "2020s"}
DRAFT_VALUES = {"top5", "lottery", "round2", "undrafted",
                "decade-1980s", "decade-1990s", "decade-2000s", "decade-2010s", "decade-2020s"}


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


def _load_curated():
    """players_curated.json rows, or [] while the foundation agent hasn't landed it."""
    return _load_json(CURATED_PATH)


def _decade_start(value):
    """'1990s' / 'decade-1990s' -> 1990; None when the value has no decade."""
    m = re.search(r"(\d{4})s$", value)
    return int(m.group(1)) if m else None


def criterion_matches(p, c):
    """Python mirror of src/utils/criteria.ts playerMatches (contract #3)."""
    ctype, value = c.get("type"), c.get("value")
    if ctype == "team":
        return any(t.get("abbr") == value for t in p.get("teams", []))
    if ctype == "award":
        a = p.get("awards", {})
        return {
            "mvp": bool(a.get("mvp")),
            "fmvp": bool(a.get("fmvp")),
            "dpoy": bool(a.get("dpoy")),
            "roty": a.get("roty") is not None,
            "smoy": bool(a.get("smoy")),
            "ring": bool(a.get("rings")),
            "allstar5plus": a.get("allstar_count", 0) >= 5,
            "allnba": a.get("allnba_count", 0) > 0,
        }.get(value, False)
    if ctype == "country":
        if value == "USA":
            return p.get("country") == "USA"
        if value == "INTL":
            return p.get("country") != "USA"
        return p.get("country") == value
    if ctype == "draft":
        draft = p.get("draft")
        if value == "undrafted":
            return draft is None
        if not draft:
            return False
        if value == "top5":
            return draft["pick"] <= 5
        if value == "lottery":
            return draft["pick"] <= 14
        if value == "round2":
            return draft["round"] == 2
        if value.startswith("decade-"):
            d = _decade_start(value)
            return d is not None and d <= draft["year"] <= d + 9
        return False
    if ctype == "college":
        if value == "none":
            return p.get("college") is None
        return p.get("college") == value
    if ctype == "stat":
        career = p.get("career", {})
        return {
            "20kpts": career.get("pts", 0) >= 20000,
            "25kpts": career.get("pts", 0) >= 25000,
            "ppg20": career.get("ppg", 0) >= 20,
            "rpg10": career.get("rpg", 0) >= 10,
            "apg8": career.get("apg", 0) >= 8,
            "seasons15plus": career.get("seasons", 0) >= 15,
        }.get(value, False)
    if ctype == "era":
        d = _decade_start(value)
        if d is None:
            return False
        current_year = date.today().year
        return any(
            t.get("start_year", 9999) <= d + 9 and (t.get("end_year") or current_year) >= d
            for t in p.get("teams", [])
        )
    return False


def _valid_value(cell):
    """Is this cell's value legal for its type? (contract #3 vocabulary)."""
    ctype, value = cell.get("type"), cell.get("value")
    if not isinstance(value, str) or not value:
        return False
    if ctype == "award":
        return value in AWARD_VALUES
    if ctype == "stat":
        return value in STAT_VALUES
    if ctype == "era":
        return value in ERA_VALUES
    if ctype == "draft":
        return value in DRAFT_VALUES
    return True  # team / country / college: free strings, coverage-checked below


def validate_rows(rows, strict=False):
    """Per-game pool validation problems (contract #4 signature + strict mode).

    Structural checks always run. Player-coverage checks run only when
    players_curated.json exists; strict=True (the management command) turns a
    missing curated file into a problem instead of silently skipping.
    """
    problems = []
    seen_qids = set()
    for i, row in enumerate(rows):
        where = f"row {i} (qid={row.get('qid') if isinstance(row, dict) else None!r})"
        if not isinstance(row, dict) or not isinstance(row.get("qid"), str):
            problems.append(f"{where}: missing/invalid qid")
            continue
        if row["qid"] in seen_qids:
            problems.append(f"{where}: duplicate qid")
        seen_qids.add(row["qid"])
        cells = row.get("cells")
        if not isinstance(cells, list) or len(cells) != CELLS_PER_CARD:
            problems.append(f"{where}: expected {CELLS_PER_CARD} cells, got "
                            f"{len(cells) if isinstance(cells, list) else type(cells).__name__}")
            continue
        seen_cells = set()
        for j, cell in enumerate(cells):
            if not isinstance(cell, dict) or cell.get("type") not in CRITERION_TYPES:
                problems.append(f"{where} cell {j}: invalid type {cell.get('type')!r}"
                                if isinstance(cell, dict) else f"{where} cell {j}: not an object")
                continue
            if not _valid_value(cell):
                problems.append(f"{where} cell {j}: invalid value {cell.get('value')!r} for type {cell['type']!r}")
            if not isinstance(cell.get("label"), str) or not cell["label"]:
                problems.append(f"{where} cell {j}: missing label")
            key = (cell.get("type"), cell.get("value"))
            if key in seen_cells:
                problems.append(f"{where} cell {j}: duplicate criterion {key!r}")
            seen_cells.add(key)

    curated = _load_curated()
    if not curated:
        if strict:
            problems.append(f"players_curated.json missing/empty at {CURATED_PATH} — "
                            "cannot verify cell coverage")
        return problems

    dealable = [p for p in curated if p.get("fame_tier", 4) <= MAX_FAME_TIER_DEALT]
    for row in rows:
        if not isinstance(row, dict):
            continue
        for j, cell in enumerate(row.get("cells") or []):
            if not isinstance(cell, dict) or cell.get("type") not in CRITERION_TYPES:
                continue  # already reported above
            n = sum(1 for p in dealable if criterion_matches(p, cell))
            if n < MIN_MATCHES_PER_CELL:
                problems.append(
                    f"row (qid={row.get('qid')!r}) cell {j} {cell.get('type')}={cell.get('value')!r}: "
                    f"only {n} matching fame<={MAX_FAME_TIER_DEALT} players (need >= {MIN_MATCHES_PER_CELL})"
                )
    return problems


def get_round(request):
    """One random authored card in the standard {'series': [...]} envelope."""
    rows = _load_seed()
    if not rows:
        return JsonResponse({"error": "NBA Bingo content not ready"}, status=503)
    return JsonResponse({"series": [random.choice(rows)]})


def build_pool():
    """Static pool for build_pools_from_db (all authored cards; [] when missing)."""
    return _load_seed()
