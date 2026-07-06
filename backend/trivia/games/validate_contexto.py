"""Standalone validator for the LeContexto secret-candidate seed.

Run: DATABASE_URL="" python backend/trivia/games/validate_contexto.py
Exit code 0 = valid, 1 = problems found (printed one per line).

Pure Python (no Django import) so it runs standalone in any shell.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SEED_PATH = os.path.join(HERE, "..", "data_static", "contexto_seed.json")
CURATED_PATH = os.path.join(HERE, "..", "data_static", "players_curated.json")


def validate_seed(rows, curated):
    """Return a list of problems. `curated` may be None (skip the id cross-check)."""
    problems = []
    if not isinstance(rows, list):
        return [f"seed: expected a list, got {type(rows).__name__}"]
    if len(rows) < 40:
        problems.append(f"seed: need >= 40 rows for a healthy daily rotation, got {len(rows)}")
    curated_ids = None
    if isinstance(curated, list):
        curated_ids = {p.get("person_id") for p in curated if isinstance(p, dict)}
    seen = set()
    for i, r in enumerate(rows):
        if not isinstance(r, dict):
            problems.append(f"seed[{i}]: not an object")
            continue
        pid = r.get("person_id")
        if not isinstance(pid, int):
            problems.append(f"seed[{i}]: person_id must be an int, got {pid!r}")
        else:
            if pid in seen:
                problems.append(f"seed[{i}]: duplicate person_id {pid}")
            seen.add(pid)
            if curated_ids is not None and pid not in curated_ids:
                problems.append(f"seed[{i}]: person_id {pid} not found in players_curated.json")
        name = r.get("full_name")
        if not isinstance(name, str) or not name.strip():
            problems.append(f"seed[{i}]: full_name must be a non-empty string")
        if r.get("fame_tier") not in (1, 2):
            problems.append(f"seed[{i}]: fame_tier must be 1 or 2, got {r.get('fame_tier')!r}")
    return problems


def _load(path):
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def main():
    rows = _load(SEED_PATH)
    if rows is None:
        print("seed: contexto_seed.json is missing")
        return 1
    curated = _load(CURATED_PATH)  # None when the foundation pool isn't authored yet
    problems = validate_seed(rows, curated)
    if problems:
        for p in problems:
            print(p)
        return 1
    checked = "with players-index cross-check" if curated is not None else "shape-only (no players_curated.json yet)"
    print(f"contexto_seed.json OK - {len(rows)} rows ({checked})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
