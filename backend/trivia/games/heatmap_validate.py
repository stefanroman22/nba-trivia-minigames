"""Prove every hex of every Heatmap board is solvable (hex + all neighbours).

Run: cd backend && DATABASE_URL="" python trivia/games/heatmap_validate.py
Exits 0 when all 6 boards pass; 1 (with reasons) otherwise. Also importable:
validate_seed(boards, players) -> list[str].

Independent of the generator: re-derives the template, checks structure (28
hexes, ids 0..27, neighbours == compute_neighbors(), criterion shape) and proves
every hex's closed neighbourhood has >= 1 solver in the curated dataset.

Solvability alone is not enough: a set of boards built only from the two or
three broadest criteria in the bank is trivially solvable AND unplayable — it
also leaves the renderer's team-logo hex path permanently dead. So the board set
must additionally clear the variety floors below.
"""
import json
import os
import sys

import django

# Make `backend.settings` importable regardless of the invoking cwd.
_BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _BACKEND_ROOT not in sys.path:
    sys.path.insert(0, _BACKEND_ROOT)

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.settings")
try:
    django.setup()
except Exception:
    pass

from django.conf import settings  # noqa: E402
from trivia.games.heatmap_criteria import (  # noqa: E402
    ROW_WIDTHS, compute_neighbors, player_matches, load_curated,
)

VALID_TYPES = {"team", "award", "country", "draft", "college", "stat", "era"}

# Variety floors. Pure counting over the criteria the boards USE — never over
# the curated pool — so they keep meaning the same thing as the dataset grows.
# Calibrated against the seeds shipped before 2026-09-06, where every board
# reused the same 4 criteria of only 3 types, with ZERO team hexes anywhere.
MIN_DISTINCT_PER_BOARD = 10
MIN_TEAM_HEXES_PER_BOARD = 2
MIN_TYPES_IN_SET = 5
MIN_DISTINCT_IN_SET = 15
MIN_FRANCHISES_IN_SET = 4


def variety_problems(boards):
    """Does the board set actually use the criteria bank? (see floors above)"""
    problems = []
    seen_crits, seen_types, seen_teams = set(), set(), set()
    for b in boards:
        qid = b.get("qid", "<no-qid>")
        crits = [h.get("criterion", {}) for h in b.get("hexes", [])]
        distinct = {(c.get("type"), c.get("value")) for c in crits}
        teams = [c for c in crits if c.get("type") == "team"]
        if len(distinct) < MIN_DISTINCT_PER_BOARD:
            problems.append(
                f"{qid}: only {len(distinct)} distinct criteria on the board "
                f"(need >= {MIN_DISTINCT_PER_BOARD})"
            )
        if len(teams) < MIN_TEAM_HEXES_PER_BOARD:
            problems.append(
                f"{qid}: only {len(teams)} team hexes (need >= "
                f"{MIN_TEAM_HEXES_PER_BOARD}, else the renderer's logo path is dead)"
            )
        seen_crits |= distinct
        seen_types |= {c.get("type") for c in crits}
        seen_teams |= {c.get("value") for c in teams}
    if len(seen_types) < MIN_TYPES_IN_SET:
        problems.append(
            f"board set spans only {len(seen_types)} criterion types "
            f"(need >= {MIN_TYPES_IN_SET}): {sorted(t for t in seen_types if t)}"
        )
    if len(seen_crits) < MIN_DISTINCT_IN_SET:
        problems.append(
            f"board set uses only {len(seen_crits)} distinct criteria "
            f"(need >= {MIN_DISTINCT_IN_SET})"
        )
    if len(seen_teams) < MIN_FRANCHISES_IN_SET:
        problems.append(
            f"board set uses only {len(seen_teams)} distinct franchises "
            f"(need >= {MIN_FRANCHISES_IN_SET})"
        )
    return problems


def validate_seed(boards, players):
    problems = []
    expected_nei = compute_neighbors()
    n_hexes = sum(ROW_WIDTHS)
    for b in boards:
        qid = b.get("qid", "<no-qid>")
        hexes = b.get("hexes", [])
        by_id = {h["id"]: h for h in hexes}
        if len(hexes) != n_hexes or sorted(by_id) != list(range(n_hexes)):
            problems.append(f"{qid}: expected ids 0..{n_hexes - 1}, got {sorted(by_id)}")
            continue
        for h in hexes:
            c = h.get("criterion", {})
            if c.get("type") not in VALID_TYPES or not c.get("value") or not c.get("label"):
                problems.append(f"{qid} hex {h['id']}: bad criterion {c}")
            if sorted(h.get("neighbors", [])) != expected_nei[h["id"]]:
                problems.append(
                    f"{qid} hex {h['id']}: neighbors {sorted(h.get('neighbors', []))} "
                    f"!= template {expected_nei[h['id']]}"
                )
        for h in hexes:
            crits = [h["criterion"]] + [by_id[n]["criterion"] for n in h["neighbors"]]
            solvers = [p for p in players if all(player_matches(p, c) for c in crits)]
            if not solvers:
                labels = " + ".join(c["label"] for c in crits)
                problems.append(f"{qid} hex {h['id']} UNSOLVABLE: {labels}")
    problems.extend(variety_problems(boards))
    return problems


def main():
    seed_path = os.path.join(settings.BASE_DIR, "trivia", "data_static", "heatmap_seed.json")
    with open(seed_path, "r", encoding="utf-8") as f:
        boards = json.load(f)
    players = load_curated()
    problems = validate_seed(boards, players)
    if problems:
        print(f"FAIL — {len(problems)} problem(s):")
        for p in problems:
            print("  -", p)
        sys.exit(1)
    crits = {
        (h["criterion"]["type"], h["criterion"]["value"]) for b in boards for h in b["hexes"]
    }
    print(
        f"OK — all {len(boards)} boards solvable ({len(players)} players) and varied "
        f"({len(crits)} distinct criteria, {len({t for t, _ in crits})} types)."
    )


if __name__ == "__main__":
    main()
