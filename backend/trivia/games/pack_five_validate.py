"""Standalone validator for the Pack 5 seed + published pool.

Run from the backend/ dir:  DATABASE_URL="" python trivia/games/pack_five_validate.py
Exits non-zero (and prints the problems) if the seed can't deal a valid pack.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SEED = os.path.join(HERE, "..", "data_static", "pack_five_seed.json")

# Re-implement the checks without importing Django so the script runs anywhere.
PACK_SIZE = 11


def _packable(r):
    if not isinstance(r, dict) or r.get("fame_tier") not in (1, 2, 3):
        return False
    c = r.get("career") or {}
    a = r.get("awards") or {}
    return (
        all(isinstance(c.get(k), (int, float)) for k in ("ppg", "rpg", "apg"))
        and isinstance(a.get("allstar_count"), int)
        and isinstance(a.get("rings"), list)
    )


def main():
    with open(SEED, "r", encoding="utf-8") as f:
        rows = json.load(f)

    problems = []
    ids, names = set(), set()
    for i, r in enumerate(rows):
        w = f"seed[{i}]"
        pid = r.get("person_id")
        if not isinstance(pid, int):
            problems.append(f"{w}: person_id must be an int")
        elif pid in ids:
            problems.append(f"{w}: duplicate person_id {pid}")
        else:
            ids.add(pid)
        name = r.get("full_name")
        if not name:
            problems.append(f"{w}: missing full_name")
        elif name in names:
            problems.append(f"{w}: duplicate name {name}")
        else:
            names.add(name)
        c = r.get("career") or {}
        for stat in ("ppg", "rpg", "apg"):
            if not isinstance(c.get(stat), (int, float)):
                problems.append(f"{w} ({name}): career.{stat} not numeric")
        a = r.get("awards") or {}
        if not isinstance(a.get("allstar_count"), int):
            problems.append(f"{w} ({name}): awards.allstar_count not an int")
        if not isinstance(a.get("rings"), list):
            problems.append(f"{w} ({name}): awards.rings not a list")

    packable = [r for r in rows if _packable(r)]
    if len(packable) < PACK_SIZE:
        problems.append(f"only {len(packable)} packable rows; need >= {PACK_SIZE}")

    fame = {}
    for r in rows:
        fame[r.get("fame_tier")] = fame.get(r.get("fame_tier"), 0) + 1

    print(f"seed rows:      {len(rows)}")
    print(f"packable rows:  {len(packable)}  (need >= {PACK_SIZE})")
    print(f"fame tiers:     {dict(sorted((k, v) for k, v in fame.items() if k is not None))}")
    print(f"unique ids:     {len(ids)}")
    if problems:
        print(f"\nFAIL — {len(problems)} problem(s):")
        for p in problems:
            print(f"  - {p}")
        sys.exit(1)
    print("\nPASS — seed can deal valid Pack 5 packs.")


if __name__ == "__main__":
    main()
