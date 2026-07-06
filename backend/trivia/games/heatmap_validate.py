"""Prove every hex of every Heatmap board is solvable (hex + all neighbours).

Run: cd backend && DATABASE_URL="" python trivia/games/heatmap_validate.py
Exits 0 when all 6 boards pass; 1 (with reasons) otherwise. Also importable:
validate_seed(boards, players) -> list[str].

Independent of the generator: re-derives the template, checks structure (28
hexes, ids 0..27, neighbours == compute_neighbors(), criterion shape) and proves
every hex's closed neighbourhood has >= 1 solver in the curated dataset.
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
    print(f"OK — all {len(boards)} boards solvable ({len(players)} players).")


if __name__ == "__main__":
    main()
