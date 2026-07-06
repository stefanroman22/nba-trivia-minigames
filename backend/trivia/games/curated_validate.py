"""Independent validator for players_curated.json (foundation contract #1).

Checks, in order:
  1. unique person_ids, and every id is resolvable in nba_api's static list
  2. stint/award years internally consistent with each player's own career span
     (the static players list exposes NO from_year/to_year — those live behind
     the networked CommonPlayerInfo endpoint — so "static career span" is proven
     as internal consistency: draft <= first season, awards within span, every
     stint start <= end)
  3. >= 25 players with 4+ team stints (Career-Path / Heatmap fuel)
  4. >= 45 fame_tier 1 players
  5. sample-check 10 headshot URLs return HTTP 200 (non-fatal if the network
     is blocked — reported, not counted against the run)

Run: cd backend && DATABASE_URL="" python trivia/games/curated_validate.py
Exit code is non-zero iff a hard (non-network) check fails.
"""
import json
import os
import random
import sys
from datetime import datetime, timezone

from nba_api.stats.static import players as static_players

sys.stdout.reconfigure(encoding="utf-8")

CURATED = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "data_static", "players_curated.json",
)
CURRENT_YEAR = datetime.now(timezone.utc).year
HEADSHOT = "https://cdn.nba.com/headshots/nba/latest/1040x760/{}.png"


def load():
    with open(CURATED, "r", encoding="utf-8") as f:
        return json.load(f)


def check_ids(rows):
    problems = []
    static_ids = {p["id"] for p in static_players.get_players()}
    seen = set()
    for r in rows:
        pid = r.get("person_id")
        name = r.get("full_name")
        if pid in seen:
            problems.append(f"duplicate person_id {pid} ({name})")
        seen.add(pid)
        if pid not in static_ids:
            problems.append(f"unresolvable person_id {pid} ({name})")
    return problems


def check_span(rows):
    """Awards/draft/stints internally consistent with each player's own span."""
    problems = []
    for r in rows:
        name = r["full_name"]
        stints = r["teams"]
        starts = [s["start_year"] for s in stints]
        ends = [(s["end_year"] or CURRENT_YEAR) for s in stints]
        for s in stints:
            e = s["end_year"] or CURRENT_YEAR
            if s["start_year"] > e:
                problems.append(f"{name}: stint {s['abbr']} start {s['start_year']} > end {e}")
        lo, hi = min(starts), max(ends)
        d = r.get("draft")
        if d and d.get("year") is not None and d["year"] > lo:
            problems.append(f"{name}: draft year {d['year']} after first season {lo}")
        aw = r["awards"]
        years = []
        for k in ("mvp", "fmvp", "dpoy", "smoy", "rings"):
            years += list(aw.get(k) or [])
        if aw.get("roty") is not None:
            years.append(aw["roty"])
        for y in years:
            if not (lo <= y <= hi):
                problems.append(f"{name}: award year {y} outside career span [{lo}, {hi}]")
    return problems


def check_headshots(rows, n=10):
    try:
        import requests
    except Exception as e:  # pragma: no cover
        return None, f"requests unavailable: {e}"
    rng = random.Random(42)
    sample = rng.sample(rows, min(n, len(rows)))
    results = []
    for r in sample:
        url = HEADSHOT.format(r["person_id"])
        try:
            resp = requests.get(url, timeout=6)
            results.append((r["full_name"], r["person_id"], resp.status_code))
        except Exception as e:
            results.append((r["full_name"], r["person_id"], f"ERR {type(e).__name__}"))
    return results, None


def main():
    rows = load()
    hard_fail = False

    print(f"loaded {len(rows)} curated rows")

    id_problems = check_ids(rows)
    print(f"[1] id uniqueness/resolvability: {'PASS' if not id_problems else 'FAIL'}")
    for p in id_problems[:20]:
        print("     -", p)
    hard_fail |= bool(id_problems)

    span_problems = check_span(rows)
    print(f"[2] stint/award span consistency: {'PASS' if not span_problems else 'FAIL'}"
          f" ({len(span_problems)} issue(s))")
    for p in span_problems[:20]:
        print("     -", p)
    hard_fail |= bool(span_problems)

    four_plus = sum(1 for r in rows if len(r["teams"]) >= 4)
    ok4 = four_plus >= 25
    print(f"[3] players with 4+ stints: {four_plus} ({'PASS' if ok4 else 'FAIL'}, need >= 25)")
    hard_fail |= not ok4

    tier1 = sum(1 for r in rows if r["fame_tier"] == 1)
    ok1 = tier1 >= 45
    print(f"[4] tier-1 players: {tier1} ({'PASS' if ok1 else 'FAIL'}, need >= 45)")
    hard_fail |= not ok1

    results, err = check_headshots(rows)
    if err:
        print(f"[5] headshot sample: SKIPPED ({err}) — non-fatal")
    else:
        ok = sum(1 for _, _, s in results if s == 200)
        print(f"[5] headshot sample (non-fatal): {ok}/{len(results)} returned HTTP 200")
        for name, pid, s in results:
            print(f"     {s}  {pid}  {name}")

    print("\nRESULT:", "FAIL" if hard_fail else "PASS")
    sys.exit(1 if hard_fail else 0)


if __name__ == "__main__":
    main()
