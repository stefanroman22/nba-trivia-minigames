"""Build + validate the who_are_ya seed from players_curated.json.

Usage (from backend/, sqlite fallback):
  DATABASE_URL="" python trivia/scripts/build_who_are_ya_seed.py          # build + validate
  DATABASE_URL="" python trivia/scripts/build_who_are_ya_seed.py --check  # validate committed seed only

Selects every fame-tier 1-2 row with a non-empty teams list. Exits non-zero
on any validation problem so CI/agents can gate on it. When the curated
dataset is absent, the hand-authored seed is kept and validated as-is.
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.settings")
import django  # noqa: E402

django.setup()

from trivia.games.who_are_ya import SEED_PATH, _load_seed, validate_rows  # noqa: E402

CURATED_PATH = os.path.join(os.path.dirname(SEED_PATH), "players_curated.json")


def build():
    if not os.path.exists(CURATED_PATH):
        print(f"NOTE: {CURATED_PATH} not found - keeping hand-authored seed as-is.")
        return _load_seed()
    with open(CURATED_PATH, "r", encoding="utf-8") as f:
        curated = json.load(f)
    rows = [r for r in curated if r.get("fame_tier") in (1, 2) and r.get("teams")]
    with open(SEED_PATH, "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=1)
    print(f"Wrote {len(rows)} rows -> {SEED_PATH}")
    return rows


def main():
    rows = _load_seed() if "--check" in sys.argv else build()
    problems = validate_rows(rows)
    print(f"{len(rows)} seed rows, {len(problems)} problems")
    for p in problems:
        print(f"  PROBLEM: {p}")
    if problems or len(rows) < 20:
        print("FAIL: seed invalid or too small (< 20 rows)")
        sys.exit(1)
    print("OK")


if __name__ == "__main__":
    main()
