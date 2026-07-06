"""Standalone validator for the NBA Imposter content (seed + built pool).

Run offline (sqlite fallback — never touches Supabase):

    DATABASE_URL="" python trivia/games/imposter_validate.py

Checks:
  * the seed loads and yields a mystery_pool of >= MIN_MYSTERY unique names
  * every mystery name resolves to a REAL fame-tier-1 row in players_curated.json
  * build_pool() output passes validate_rows() with zero problems
  * get_round() returns the seed (200) with a mystery_pool
Exit code 0 on success, 1 on any problem.
"""
import io
import json
import os
import sys

import django

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.settings")
django.setup()

from django.conf import settings  # noqa: E402

from trivia.games import imposter  # noqa: E402

CURATED_PATH = os.path.join(settings.BASE_DIR, "trivia", "data_static", "players_curated.json")


def main():
    problems = []

    pool = imposter.build_pool()
    problems.extend(imposter.validate_rows(pool))

    # Cross-check every mystery name against real fame-tier-1 curated rows.
    with io.open(CURATED_PATH, encoding="utf-8") as f:
        curated = json.load(f)
    tier1 = {p["full_name"] for p in curated if p.get("fame_tier") == 1}
    for name in pool:
        if name not in tier1:
            problems.append(f"mystery name not a fame-tier-1 curated player: {name!r}")

    # get_round should hand back the seed with a non-empty mystery_pool.
    resp = imposter.get_round(None)
    if resp.status_code != 200:
        problems.append(f"get_round returned {resp.status_code}, expected 200")
    else:
        body = json.loads(resp.content)
        if not body.get("mystery_pool"):
            problems.append("get_round body missing a non-empty mystery_pool")

    if problems:
        print("IMPOSTER VALIDATION FAILED:")
        for p in problems:
            print("  -", p)
        return 1

    print(
        f"IMPOSTER VALIDATION PASSED: {len(pool)} unique fame-tier-1 mystery names; "
        f"build_pool + validate_rows + get_round all clean."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
