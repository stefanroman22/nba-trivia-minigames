"""Validate tictactoe_seed.json: structure + >=1 valid player per cell.

Standalone gate for the tictactoe seed (thin wrapper over validate_rows). Lives
next to the game module it validates; it is NOT a game module itself (the games
package aggregator only imports the slugs in _GAME_MODULES, so this file is
inert to that pipeline).

Usage (from backend/):  DATABASE_URL="" python trivia/games/validate_tictactoe_seed.py
"""
import os
import sys

# backend/ is three levels up: trivia/games/<this file> -> games -> trivia -> backend
_BACKEND_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)
sys.path.insert(0, _BACKEND_ROOT)
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
    have_curated = os.path.exists(CURATED_PATH)
    if not have_curated:
        print("WARN: players_curated.json not found - structural checks only")
    problems = validate_rows(rows)
    if problems:
        print(f"FAIL: {len(problems)} problem(s)")
        for p in problems:
            print(f"  - {p}")
        return 1
    print(
        f"OK: {len(rows)} boards, all cells solvable"
        if have_curated
        else f"OK (structure only): {len(rows)} boards"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
