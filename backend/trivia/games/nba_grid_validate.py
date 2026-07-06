"""Standalone seed validator: every NBA Grid intersection needs >=3 curated players.

Run:  cd backend && DATABASE_URL="" python -m trivia.games.nba_grid_validate
Exit: 0 when every cell of every config has >=3 valid players, else 1.

`player_matches` is a faithful field-for-field port of src/utils/criteria.ts
(same switch, same edge cases). The curated dataset is read from
data_static/players_curated.json by default; set NBA_GRID_CURATED to point at an
alternate fixture (used to prove coverage before the foundation agent publishes
the canonical file — a subset fixture is a sound lower bound since the real
curated pool is a superset).
"""
import json
import os
import re
import sys
from datetime import date

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # .../trivia
SEED_PATH = os.path.join(BASE, "data_static", "nba_grid_seed.json")
CURATED_PATH = os.environ.get("NBA_GRID_CURATED") or os.path.join(
    BASE, "data_static", "players_curated.json"
)
CURRENT_YEAR = date.today().year
MIN_PER_CELL = 3


def _decade_start(value):
    m = re.search(r"(\d{4})s$", value)
    return int(m.group(1)) if m else None


def player_matches(p, c):
    t, v = c["type"], c["value"]
    if t == "team":
        return any(s.get("abbr") == v for s in p.get("teams", []))
    if t == "award":
        a = p.get("awards", {})
        return {
            "mvp": len(a.get("mvp", [])) > 0,
            "fmvp": len(a.get("fmvp", [])) > 0,
            "dpoy": len(a.get("dpoy", [])) > 0,
            "roty": a.get("roty") is not None,
            "smoy": len(a.get("smoy", [])) > 0,
            "ring": len(a.get("rings", [])) > 0,
            "allstar5plus": a.get("allstar_count", 0) >= 5,
            "allnba": a.get("allnba_count", 0) > 0,
        }.get(v, False)
    if t == "country":
        if v == "USA":
            return p.get("country") == "USA"
        if v == "INTL":
            return p.get("country") != "USA"
        return p.get("country") == v
    if t == "draft":
        d = p.get("draft")
        if v == "undrafted":
            return d is None
        if not d:
            return False
        if v == "top5":
            return d["pick"] <= 5
        if v == "lottery":
            return d["pick"] <= 14
        if v == "round2":
            return d["round"] == 2
        if v.startswith("decade-"):
            ds = _decade_start(v)
            return ds is not None and ds <= d["year"] <= ds + 9
        return False
    if t == "college":
        return p.get("college") is None if v == "none" else p.get("college") == v
    if t == "stat":
        car = p.get("career", {})
        return {
            "20kpts": car.get("pts", 0) >= 20000,
            "25kpts": car.get("pts", 0) >= 25000,
            "ppg20": car.get("ppg", 0) >= 20,
            "rpg10": car.get("rpg", 0) >= 10,
            "apg8": car.get("apg", 0) >= 8,
            "seasons15plus": car.get("seasons", 0) >= 15,
        }.get(v, False)
    if t == "era":
        ds = _decade_start(v)
        if ds is None:
            return False
        return any(
            s.get("start_year", 9999) <= ds + 9
            and (s.get("end_year") or CURRENT_YEAR) >= ds
            for s in p.get("teams", [])
        )
    return False


def validate_seed(seed, players):
    problems = []
    for cfg in seed:
        qid = cfg.get("qid", "?")
        rows, cols = cfg.get("rows", []), cfg.get("cols", [])
        if len(rows) != 3 or len(cols) != 3:
            problems.append(f"{qid}: needs exactly 3 rows + 3 cols")
            continue
        for r, rc in enumerate(rows):
            for c, cc in enumerate(cols):
                hits = [
                    pl["full_name"]
                    for pl in players
                    if player_matches(pl, rc) and player_matches(pl, cc)
                ]
                if len(hits) < MIN_PER_CELL:
                    problems.append(
                        f"{qid} r{r}c{c} [{rc['label']} x {cc['label']}]: "
                        f"only {len(hits)} valid ({', '.join(hits) or 'none'})"
                    )
    return problems


def main():
    if not os.path.exists(CURATED_PATH):
        print(
            f"MISSING {CURATED_PATH} — foundation agent must publish "
            "players_curated.json first (or set NBA_GRID_CURATED to a fixture)"
        )
        return 1
    seed = json.load(open(SEED_PATH, encoding="utf-8"))
    players = json.load(open(CURATED_PATH, encoding="utf-8"))
    problems = validate_seed(seed, players)
    if problems:
        print(f"FAIL — {len(problems)} thin/invalid cell(s):")
        for p in problems:
            print("  -", p)
        return 1
    print(
        f"OK — {len(seed)} configs, all 9 cells each have "
        f">={MIN_PER_CELL} valid players (checked against {len(players)} curated rows)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
