"""Authoring tool: build 6 solvable Heatmap boards from players_curated.json.

Run: cd backend && DATABASE_URL="" python trivia/data_static/heatmap_gen.py
Overwrites backend/trivia/data_static/heatmap_seed.json. Deterministic (seeded).

Each hex is assigned a Criterion drawn from a broad bank such that the hex's
CLOSED neighbourhood (hex + all neighbours) has >= 1 solving player in the
curated dataset. A board is only emitted once every hex's closed neighbourhood
is solvable (retried with fresh seeds until it is); heatmap_validate.py then
re-proves this independently.
"""
import collections
import json
import os
import random
import sys

import django

# Make `backend.settings` importable regardless of the invoking cwd.
_BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _BACKEND_ROOT not in sys.path:
    sys.path.insert(0, _BACKEND_ROOT)

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.settings")
django.setup()

from django.conf import settings  # noqa: E402
from trivia.games.heatmap_criteria import (  # noqa: E402
    ROW_WIDTHS, compute_neighbors, player_matches, load_curated,
)

# Broad, high-population criteria — big franchises, wide eras/countries, common
# stats/draft/award buckets. Each entry is a valid Criterion dict; team labels
# are FULL current franchise names so the renderer resolves the logo by label.
BANK = [
    {"type": "team", "value": "LAL", "label": "Los Angeles Lakers"},
    {"type": "team", "value": "BOS", "label": "Boston Celtics"},
    {"type": "team", "value": "GSW", "label": "Golden State Warriors"},
    {"type": "team", "value": "CHI", "label": "Chicago Bulls"},
    {"type": "team", "value": "MIA", "label": "Miami Heat"},
    {"type": "team", "value": "NYK", "label": "New York Knicks"},
    {"type": "team", "value": "PHI", "label": "Philadelphia 76ers"},
    {"type": "team", "value": "SAS", "label": "San Antonio Spurs"},
    {"type": "team", "value": "DET", "label": "Detroit Pistons"},
    {"type": "team", "value": "PHX", "label": "Phoenix Suns"},
    {"type": "era", "value": "1990s", "label": "Played in the 90s"},
    {"type": "era", "value": "2000s", "label": "Played in the 2000s"},
    {"type": "era", "value": "2010s", "label": "Played in the 2010s"},
    {"type": "country", "value": "USA", "label": "USA-born"},
    {"type": "country", "value": "INTL", "label": "International"},
    {"type": "draft", "value": "lottery", "label": "Lottery pick"},
    {"type": "draft", "value": "top5", "label": "Top-5 pick"},
    {"type": "draft", "value": "round2", "label": "2nd-round pick"},
    {"type": "draft", "value": "undrafted", "label": "Undrafted"},
    {"type": "award", "value": "allstar5plus", "label": "5+ All-Stars"},
    {"type": "award", "value": "allnba", "label": "All-NBA"},
    {"type": "award", "value": "ring", "label": "Won a ring"},
    {"type": "award", "value": "mvp", "label": "MVP"},
    {"type": "stat", "value": "seasons15plus", "label": "15+ seasons"},
    {"type": "stat", "value": "20kpts", "label": "20,000+ pts"},
    {"type": "stat", "value": "ppg20", "label": "20+ PPG career"},
]

NEI = compute_neighbors()
HEX_IDS = sorted(NEI)

# (type, value) -> frozenset of player indices satisfying that criterion. Filled
# once per run so closed-neighbourhood solvability is a fast set intersection.
_SAT = {}


def _key(c):
    return (c["type"], c["value"])


def _precompute(players):
    _SAT.clear()
    for c in BANK:
        _SAT[_key(c)] = frozenset(i for i, p in enumerate(players) if player_matches(p, c))


def _closed_idx(assign, hid):
    """Indices of players clearing hex `hid`'s closed neighbourhood (self + assigned)."""
    s = _SAT[_key(assign[hid])]
    for n in NEI[hid]:
        if n in assign and s:
            s = s & _SAT[_key(assign[n])]
    return s


def _closed_ok(assign, hid):
    """Is hex `hid`'s closed neighbourhood (self + assigned neighbours) solvable?"""
    return len(_closed_idx(assign, hid)) >= 1


def _neighbors_ok(assign, hid):
    """Every ASSIGNED neighbour of hid still has a non-empty closed neighbourhood."""
    return all(_closed_ok(assign, n) for n in NEI[hid] if n in assign)


def _fill(rng):
    """Row-major constructive fill: for each hex pick a RANDOM criterion (favouring
    variety) that keeps its own solver intersection non-empty while every
    already-placed neighbour stays solvable. Because a hex is re-validated as each
    later neighbour lands, a completed assignment is guaranteed solvable at every
    hex. Returns None on a dead end (build_board restarts with a fresh seed)."""
    order = list(HEX_IDS)  # row-major: each hex's up/left neighbours are already placed
    assign = {}
    for hid in order:
        # Candidate criteria (prefer not duplicating an adjacent hex for nicer boards).
        no_dup = [c for c in BANK if not any(assign.get(n) == c for n in NEI[hid])]
        for cands in (no_dup, BANK):
            valid, roomy = [], []
            for c in cands:
                assign[hid] = c
                if _closed_ok(assign, hid) and _neighbors_ok(assign, hid):
                    valid.append(c)
                    if len(_closed_idx(assign, hid)) >= 2:  # leave room for future neighbours
                        roomy.append(c)
                del assign[hid]
            pool = roomy or valid
            if pool:
                assign[hid] = rng.choice(pool)
                break
        else:
            return None
    return assign


# Target board mix (for the variety score) — teams bring logos; eras/stats add flavour.
_WANT_TEAMS = 7


def _variety_score(assign):
    types = collections.Counter(assign[h]["type"] for h in HEX_IDS)
    teams = types.get("team", 0)
    distinct = len({(assign[h]["type"], assign[h]["value"]) for h in HEX_IDS})
    # reward: distinct criteria, a healthy team count (capped), and type spread.
    return distinct + min(teams, _WANT_TEAMS) * 3 + len(types) * 4


def build_board(qid, base_seed, used_sigs):
    """Best-variety board whose every hex closed neighbourhood is solvable (retry
    seeds); avoids repeating an already-emitted board signature."""
    best, best_score = None, -1
    for attempt in range(600):
        rng = random.Random(base_seed + attempt)
        assign = _fill(rng)
        if assign is None or not all(_closed_ok(assign, h) for h in HEX_IDS):
            continue
        sig = tuple(sorted((assign[h]["type"], assign[h]["value"]) for h in HEX_IDS))
        if sig in used_sigs:
            continue
        score = _variety_score(assign)
        if score > best_score:
            best, best_score = assign, score
        # good-enough board: plenty of distinct criteria, all 7 types, target teams.
        if best_score >= 40:
            break
    if best is None:
        raise RuntimeError(
            f"could not build a fully-solvable board {qid} in 600 attempts — "
            f"broaden BANK or enrich the curated dataset."
        )
    used_sigs.add(tuple(sorted((best[h]["type"], best[h]["value"]) for h in HEX_IDS)))
    return {
        "qid": qid,
        "hexes": [{"id": h, "criterion": best[h], "neighbors": NEI[h]} for h in HEX_IDS],
    }


def main():
    players = load_curated()
    _precompute(players)
    boards = []
    used_sigs = set()
    for i in range(1, 7):
        boards.append(build_board(f"hm-board-{i}", 1000 + i * 1000, used_sigs))
    out = os.path.join(settings.BASE_DIR, "trivia", "data_static", "heatmap_seed.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(boards, f, ensure_ascii=False, indent=2)
    print(f"wrote {out} ({len(boards)} boards, {len(players)} players)")


if __name__ == "__main__":
    main()
