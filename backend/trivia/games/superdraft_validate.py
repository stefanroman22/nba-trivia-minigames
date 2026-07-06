"""Standalone seed validator for SuperDraft Five.

Run from backend/:  python -m trivia.games.superdraft_validate
Exits non-zero if the objectives seed is malformed, or if the players-index pool
can't back the renderer's runtime guarantees.

Checks:
  1. Seed structure: >= 4 objectives, each {key, label, metric in VALID_METRICS},
     unique keys, and a non-empty note (mirrors superdraft.validate_rows).
  2. Constraint supply: from players_curated.json, the renderer's candidate pool
     constraints (franchise abbr / country / draft decade) that each have >= 8
     eligible players must number >= 5, so five DISTINCT slots can always be drawn.
  3. Metric coverage: every objective's metric resolves to real data for a healthy
     majority of players (no all-null column the grader would divide into noise).
"""
import json
import os
import sys
from collections import Counter

HERE = os.path.dirname(__file__)
SEED = os.path.join(HERE, "..", "data_static", "superdraft_seed.json")
CURATED = os.path.join(HERE, "..", "data_static", "players_curated.json")

# Mirrors superdraft.VALID_METRICS (kept local so this validator stays standalone
# — importing the Django module would require configured settings).
VALID_METRICS = {"height_in", "rings", "career_pts", "birth_year_desc"}

MIN_ELIGIBLE = 8   # a slot constraint must offer this many players (renderer rule)
MIN_SLOTS = 5      # five distinct slots per draft


def _load(path):
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _valid_constraints(curated):
    """Every (kind, value) with >= MIN_ELIGIBLE eligible players (renderer logic)."""
    franchises = Counter()
    for p in curated:
        for abbr in {t["abbr"] for t in p.get("teams", []) if t.get("abbr")}:
            franchises[abbr] += 1
    countries = Counter(p.get("country") for p in curated if p.get("country"))
    decades = Counter(
        (p["draft"]["year"] // 10) * 10 for p in curated if p.get("draft")
    )
    out = []
    out += [("team", a) for a, n in franchises.items() if n >= MIN_ELIGIBLE]
    out += [("country", c) for c, n in countries.items() if n >= MIN_ELIGIBLE]
    out += [("draft", d) for d, n in decades.items() if n >= MIN_ELIGIBLE]
    return out


def _metric_coverage(curated, metric):
    """Count players for whom this objective's metric resolves to real data."""
    if metric == "height_in":
        return sum(1 for p in curated if isinstance(p.get("height_in"), (int, float)))
    if metric == "birth_year_desc":
        return sum(1 for p in curated if isinstance(p.get("birth_year"), (int, float)))
    if metric == "career_pts":
        return sum(
            1 for p in curated
            if isinstance((p.get("career") or {}).get("pts"), (int, float))
        )
    if metric == "rings":
        # rings is a list; every well-formed row supplies it (0 is meaningful data).
        return sum(1 for p in curated if isinstance((p.get("awards") or {}).get("rings"), list))
    return 0


def _validate_seed(seed):
    """Same contract as superdraft.validate_rows, on the raw seed dict."""
    problems = []
    if not isinstance(seed, dict):
        return ["superdraft_seed.json: not an object"]
    objectives = seed.get("objectives")
    if not isinstance(objectives, list) or len(objectives) < 4:
        return ["superdraft_seed.json: objectives must be a list of >= 4 entries"]
    seen_keys = set()
    for i, obj in enumerate(objectives):
        where = f"objectives[{i}]"
        if not isinstance(obj, dict):
            problems.append(f"{where}: not an object")
            continue
        key = obj.get("key")
        if not key:
            problems.append(f"{where}: missing key")
        elif key in seen_keys:
            problems.append(f"{where}: duplicate key {key!r}")
        else:
            seen_keys.add(key)
        if not obj.get("label"):
            problems.append(f"{where}: missing label")
        if obj.get("metric") not in VALID_METRICS:
            problems.append(f"{where}: metric must be one of {sorted(VALID_METRICS)}")
    if not seed.get("note"):
        problems.append("superdraft_seed.json: missing note")
    return problems


def validate(seed, curated):
    problems = []

    # 1. Seed structure.
    if not seed or not isinstance(seed, dict) or not seed.get("objectives"):
        return ["superdraft_seed.json missing or has no objectives"]
    problems += _validate_seed(seed)

    objectives = seed.get("objectives", [])

    if curated is None:
        problems.append("players_curated.json missing -- skipped supply/coverage checks")
        return problems

    # 2. Constraint supply.
    constraints = _valid_constraints(curated)
    if len(constraints) < MIN_SLOTS:
        problems.append(
            f"only {len(constraints)} pool constraints have >= {MIN_ELIGIBLE} "
            f"eligible players; need >= {MIN_SLOTS} to draw distinct slots"
        )

    # 3. Metric coverage.
    n = len(curated)
    for obj in objectives:
        metric = obj.get("metric")
        if metric not in VALID_METRICS:
            continue
        covered = _metric_coverage(curated, metric)
        if covered < n * 0.75:
            problems.append(
                f"objective {obj.get('key')!r}: metric {metric} resolves for only "
                f"{covered}/{n} players (need >= 75%)"
            )
    return problems


def main():
    seed = _load(SEED)
    curated = _load(CURATED)
    problems = validate(seed, curated)
    if problems:
        print(f"FAIL: {len(problems)} problem(s):")
        for p in problems:
            print("  -", p)
        return 1
    objectives = seed["objectives"]
    constraints = _valid_constraints(curated)
    print(
        f"OK: {len(objectives)} objectives valid; "
        f"{len(constraints)} pool constraints with >= {MIN_ELIGIBLE} eligible "
        f"({len(curated)} curated players)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
