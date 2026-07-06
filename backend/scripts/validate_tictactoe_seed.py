"""Validate tictactoe_seed.json: structure + >=1 valid player per cell.

Usage (from backend/):  DATABASE_URL="" python scripts/validate_tictactoe_seed.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.settings")
os.environ.setdefault("DATABASE_URL", "")

import django  # noqa: E402

django.setup()

from trivia.games.tictactoe import CURATED_PATH, build_pool, validate_rows  # noqa: E402


def main():
    rows = build_pool()
    if not rows:
        print("FAIL: tictactoe_seed.json missing or empty")
        return 1
    if not os.path.exists(CURATED_PATH):
        print("WARN: players_curated.json not found - structural checks only")
    problems = validate_rows(rows)
    if problems:
        print(f"FAIL: {len(problems)} problem(s)")
        for p in problems:
            print(f"  - {p}")
        return 1
    print(
        f"OK: {len(rows)} boards, all cells solvable"
        if os.path.exists(CURATED_PATH)
        else f"OK (structure only): {len(rows)} boards"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
