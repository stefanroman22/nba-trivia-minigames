"""Independent validator for players_curated.json (foundation contract #1).

Checks, in order:
  1. unique person_ids (hard), plus a non-fatal count of ids nba_api's bundled
     static list does not know — see check_ids for why that is not a failure
  2. stint/award years internally consistent with each player's own career span
     (the static players list exposes NO from_year/to_year — those live behind
     the networked CommonPlayerInfo endpoint — so "static career span" is proven
     as internal consistency: draft no later than the season after the debut,
     awards within span, every stint start <= end)
  3. stints ordered and non-overlapping ACROSS a row (checks 2 and 3 together
     cover a stint list; check 2 alone only ever saw one stint at a time)
  4. >= 25 players with 4+ team stints (Career-Path / Heatmap fuel)
  5. >= 45 fame_tier 1 players
  6. career totals plausible for the games the stints add up to
  7. 1:1 parity with data/all-players.json — every real player has a row
  8. sample-check 10 headshot URLs return HTTP 200 (non-fatal if the network
     is blocked — reported, not counted against the run)

Checks 6 and 7 are the gates for the API-generated dataset; while the file is
still the smaller hand-authored one they report without failing the run (see
`_full_dataset` below).

Run: cd backend && DATABASE_URL="" python trivia/games/curated_validate.py
Exit code is non-zero iff a hard (non-network) check fails.
"""
import json
import os
import random
import sys
from datetime import datetime, timezone

from nba_api.stats.static import players as static_players

# backend/ is three levels up: trivia/games/<this file> -> games -> trivia -> backend
sys.path.insert(
    0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
)

from trivia.data_pipeline.curated_players import (  # noqa: E402
    check_cross_stints,
    check_parity,
    check_plausibility,
)

sys.stdout.reconfigure(encoding="utf-8")

CURATED = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "data_static", "players_curated.json",
)
ALL_PLAYERS = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "data", "all-players.json",
)
CURRENT_YEAR = datetime.now(timezone.utc).year
HEADSHOT = "https://cdn.nba.com/headshots/nba/latest/1040x760/{}.png"


def load():
    with open(CURATED, "r", encoding="utf-8") as f:
        return json.load(f)


def load_all_players():
    if not os.path.exists(ALL_PLAYERS):
        return []
    with open(ALL_PLAYERS, "r", encoding="utf-8") as f:
        return json.load(f)


def check_ids(rows):
    """(hard problems, ids the bundled nba_api snapshot does not know).

    Duplicate person_ids stay a hard failure — two rows for one player is always
    a bug. Resolvability is reported but NOT failed on, because the authority it
    used is stale: nba_api ships a static player list frozen at release time
    (5,103 players), while this dataset is generated from the live
    CommonAllPlayers league index (5,208). Every id the snapshot is missing is
    newer than the snapshot's own newest id — a whole draft class' worth — plus
    person_id 200603, whom stats.nba.com serves no identity for at all. Failing
    on those would only assert "this dataset is a subset of a vendored file that
    lags it", which is not a data-quality claim worth making.
    """
    problems = []
    unresolved = []
    static_ids = {p["id"] for p in static_players.get_players()}
    seen = set()
    for r in rows:
        pid = r.get("person_id")
        name = r.get("full_name")
        if pid in seen:
            problems.append(f"duplicate person_id {pid} ({name})")
        seen.add(pid)
        if pid not in static_ids:
            unresolved.append((pid, name))
    return problems, unresolved


def check_span(rows):
    """(hard problems, players drafted the season after they debuted).

    Awards/draft/stints internally consistent with each player's own span. The
    draft rule is "not after the debut" with one season of slack, because six
    real players broke the strict version: five BAA-era men (Biasatti,
    Rothenberg, Kaftan, Shannon, Bud Grant) played a season and were drafted the
    following year, and Spencer Haywood is the landmark hardship case — he was
    on the 1970-71 Sonics before Buffalo drafted him in 1971. A draft two or
    more seasons after a debut is still a hard failure; the one-season cases are
    returned so they stay visible instead of disappearing into the tolerance.
    """
    problems = []
    late_drafts = []
    for r in rows:
        name = r["full_name"]
        stints = r["teams"]
        starts = [s["start_year"] for s in stints]
        ends = [(s["end_year"] or CURRENT_YEAR) for s in stints]
        for s in stints:
            e = s["end_year"] or CURRENT_YEAR
            if s["start_year"] > e:
                problems.append(f"{name}: stint {s['abbr']} start {s['start_year']} > end {e}")
        if not stints:
            # A player who has never taken the floor has no career span, so
            # there is nothing here for a draft year or an award year to be
            # inside or outside of. (min() of no starts used to raise.)
            continue
        lo, hi = min(starts), max(ends)
        d = r.get("draft")
        if d and d.get("year") is not None and d["year"] > lo:
            if d["year"] > lo + 1:
                problems.append(f"{name}: draft year {d['year']} after first season {lo}")
            else:
                late_drafts.append((name, d["year"], lo))
        aw = r["awards"]
        years = []
        for k in ("mvp", "fmvp", "dpoy", "smoy", "rings"):
            years += list(aw.get(k) or [])
        if aw.get("roty") is not None:
            years.append(aw["roty"])
        for y in years:
            if not (lo <= y <= hi):
                problems.append(f"{name}: award year {y} outside career span [{lo}, {hi}]")
    return problems, late_drafts


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
    all_players = load_all_players()
    hard_fail = False

    print(f"loaded {len(rows)} curated rows")

    id_problems, unresolved = check_ids(rows)
    print(f"[1] id uniqueness: {'PASS' if not id_problems else 'FAIL'}")
    for p in id_problems[:20]:
        print("     -", p)
    hard_fail |= bool(id_problems)
    print(f"[1b] ids the bundled nba_api snapshot does not know (non-fatal): "
          f"{len(unresolved)}/{len(rows)}")
    for pid, name in unresolved[:20]:
        print(f"     {pid}  {name}")
    if len(unresolved) > 20:
        print(f"     ...and {len(unresolved) - 20} more")

    span_problems, late_drafts = check_span(rows)
    print(f"[2] stint/award span consistency: {'PASS' if not span_problems else 'FAIL'}"
          f" ({len(span_problems)} issue(s))")
    for p in span_problems[:20]:
        print("     -", p)
    hard_fail |= bool(span_problems)
    print(f"[2b] drafted the season after debuting (non-fatal): {len(late_drafts)}")
    for name, year, first in late_drafts[:20]:
        print(f"     {name}: drafted {year}, first season {first}")

    stint_problems = check_cross_stints(rows)
    print(f"[3] stint ordering/overlap: {'PASS' if not stint_problems else 'FAIL'}"
          f" ({len(stint_problems)} issue(s))")
    for p in stint_problems[:20]:
        print("     -", p)
    hard_fail |= bool(stint_problems)

    four_plus = sum(1 for r in rows if len(r["teams"]) >= 4)
    ok4 = four_plus >= 25
    print(f"[4] players with 4+ stints: {four_plus} ({'PASS' if ok4 else 'FAIL'}, need >= 25)")
    hard_fail |= not ok4

    tier1 = sum(1 for r in rows if r["fame_tier"] == 1)
    ok1 = tier1 >= 45
    print(f"[5] tier-1 players: {tier1} ({'PASS' if ok1 else 'FAIL'}, need >= 45)")
    hard_fail |= not ok1

    # The hand-authored dataset carries estimated averages and covers a subset of
    # the league, so its own gates only go hard once the API-generated dataset has
    # replaced it (Priority-0 rebuild).
    full_dataset = len(rows) >= len(all_players) > 0
    staged = "" if full_dataset else " (staged: reported, not enforced yet)"

    plausibility_problems = check_plausibility(rows)
    print(f"[6] career totals plausible: {'PASS' if not plausibility_problems else 'FAIL'}"
          f" ({len(plausibility_problems)} issue(s)){staged}")
    for p in plausibility_problems[:20]:
        print("     -", p)
    hard_fail |= bool(plausibility_problems) and full_dataset

    parity_problems = check_parity(rows, all_players)
    print(f"[7] parity with all-players.json ({len(all_players)} names): "
          f"{'PASS' if not parity_problems else 'FAIL'} "
          f"({len(parity_problems)} issue(s)){staged}")
    for p in parity_problems[:20]:
        print("     -", p)
    hard_fail |= bool(parity_problems) and full_dataset

    results, err = check_headshots(rows)
    if err:
        print(f"[8] headshot sample: SKIPPED ({err}) — non-fatal")
    else:
        ok = sum(1 for _, _, s in results if s == 200)
        print(f"[8] headshot sample (non-fatal): {ok}/{len(results)} returned HTTP 200")
        for name, pid, s in results:
            print(f"     {s}  {pid}  {name}")

    print("\nRESULT:", "FAIL" if hard_fail else "PASS")
    sys.exit(1 if hard_fail else 0)


if __name__ == "__main__":
    main()
