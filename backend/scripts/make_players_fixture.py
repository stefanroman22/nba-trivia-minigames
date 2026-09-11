"""Write trivia/tests/fixtures/players_fixture.json: a ~250-row slice of
players_curated.json that exercises every generator rule (tiers 1-4, 3-7 stint
journeymen, undrafted, non-US, zero-award rows, never-played rows)."""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
SRC = os.path.join(BACKEND, "trivia", "data_static", "players_curated.json")
DST = os.path.join(BACKEND, "trivia", "tests", "fixtures", "players_fixture.json")


def main():
    with open(SRC, encoding="utf-8") as f:
        rows = json.load(f)
    rows.sort(key=lambda r: r["person_id"])
    tier12 = [r for r in rows if r.get("fame_tier") in (1, 2)]
    journey = [r for r in rows if r.get("fame_tier") in (3, 4) and 3 <= len(r.get("teams") or []) <= 7][:80]
    undrafted = [r for r in rows if r.get("teams") and r.get("draft") is None][:15]
    foreign = [r for r in rows if r.get("teams") and r.get("country") not in (None, "USA")][:30]
    never = [r for r in rows if not r.get("teams")][:5]
    seen, out = set(), []
    for r in tier12 + journey + undrafted + foreign + never:
        if r["person_id"] not in seen:
            seen.add(r["person_id"])
            out.append(r)
    os.makedirs(os.path.dirname(DST), exist_ok=True)
    with open(DST, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"wrote {len(out)} rows -> {DST}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
