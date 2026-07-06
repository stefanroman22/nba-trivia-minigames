"""Standalone validator for the Pack 5 seed + published pool.

Runs pack_five.validate_rows over the bundled seed and (if present) the
published static pool, plus a deal-simulation sanity check. Exit non-zero on
any problem. Run from the backend/ dir:

    DATABASE_URL="" python trivia/games/validate_pack_five.py
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.abspath(os.path.join(HERE, "..", ".."))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.settings")
os.environ.setdefault("DATABASE_URL", "")

import django  # noqa: E402

django.setup()

from trivia.games import pack_five  # noqa: E402

SEED_PATH = pack_five.SEED_PATH
POOL_PATH = os.path.join(BACKEND_DIR, "trivia", "data", "pack-five.json")


def _load(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def main():
    failures = []

    # 1) Seed structural + trump-stat validation.
    seed = _load(SEED_PATH)
    seed_problems = pack_five.validate_rows(seed)
    print(f"[seed] {SEED_PATH}")
    print(f"[seed] rows={len(seed)} packable={len(pack_five._packable(seed))}")
    if seed_problems:
        failures.extend(f"seed: {p}" for p in seed_problems)

    # 2) Published pool (if generated) validation.
    if os.path.exists(POOL_PATH):
        pool = _load(POOL_PATH)
        pool_problems = pack_five.validate_rows(pool)
        print(f"[pool] {POOL_PATH}")
        print(f"[pool] rows={len(pool)} packable={len(pack_five._packable(pool))}")
        if pool_problems:
            failures.extend(f"pool: {p}" for p in pool_problems)
    else:
        print(f"[pool] MISSING (generate with build_pool): {POOL_PATH}")
        failures.append("pool: data/pack-five.json not generated")

    # 3) Deal simulation — build_pool must yield >= PACK_SIZE and a full pack.
    pool = pack_five.build_pool()
    print(f"[deal] build_pool packable rows={len(pool)} (need >= {pack_five.PACK_SIZE})")
    if len(pool) < pack_five.PACK_SIZE:
        failures.append(f"deal: build_pool returned {len(pool)} rows; need >= {pack_five.PACK_SIZE}")

    # 4) Every dealable row must expose all five trump stats numerically.
    for r in pack_five._packable(seed):
        c, a = r["career"], r["awards"]
        for k in ("ppg", "rpg", "apg"):
            if not isinstance(c.get(k), (int, float)):
                failures.append(f"deal: {r.get('full_name')} career.{k} not numeric")
        if not isinstance(a.get("allstar_count"), int):
            failures.append(f"deal: {r.get('full_name')} awards.allstar_count not int")
        if not isinstance(a.get("rings"), list):
            failures.append(f"deal: {r.get('full_name')} awards.rings not list")

    if failures:
        print("\nFAIL:")
        for f in failures:
            print("  -", f)
        sys.exit(1)
    print("\nOK: Pack 5 seed + pool valid; a full pack can be dealt.")


if __name__ == "__main__":
    main()
