"""Award seasons for Guess the MVP: one row per (season, award) for the five major awards.

Pure (no Django, no DB): ``build(rows, mvps_csv, logo_for)`` takes the curated
player rows (active DataCorrections already overlaid) and the MVP CSV rows
(sources.load_mvps shape, or the Mvp table rows the CSV is synced into). Each row::

    {"season": "2024-25", "mvp": ..., "team": ..., "team_logo_url": ...,
     "award": "MVP", "winners": [{"name", "person_id", "team", "team_logo_url"}],
     "prompt": "Who was the MVP in 2024-25?"}

The MVP rows keep their four CSV fields exactly, so an old client and the
multiplayer relay (which deals the rows unchanged) keep working. The other awards
come from the rows' ``awards`` years; their ``mvp`` / ``team`` / ``team_logo_url``
are the first winner's, so a stale client still shows something sensible.
Co-winners share one row (Rookie of the Year 1971, 1995, 2000), sorted by name.

A winner's team is the stint covering the award season: a stint's start_year is
its first season's start year and end_year its last season's end year (null while
ongoing). When no stint covers the season, or stints of two franchises do (a trade
season), team and logo are null.
"""

AWARDS = (
    ("MVP", "mvp"),
    ("Finals MVP", "fmvp"),
    ("Defensive Player of the Year", "dpoy"),
    ("Rookie of the Year", "roty"),
    ("Sixth Man of the Year", "smoy"),
)
AWARD_ORDER = {award: i for i, (award, _) in enumerate(AWARDS)}


def season_label(end_year):
    """2025 -> "2024-25" (the CSV's format)."""
    return f"{end_year - 1}-{end_year % 100:02d}"


def end_year(season):
    """"2024-25" -> 2025."""
    return int(str(season)[:4]) + 1


def prompt(award, season):
    return f"Who was the {award} in {season}?"


def award_rank(row):
    """Sort rank of a row's award (rows without one are MVP rows)."""
    return AWARD_ORDER.get(row.get("award"), 0)


def _years(awards, key):
    value = (awards or {}).get(key)
    if value is None:
        return []
    return [value] if isinstance(value, int) else list(value)


def _logo(logo_for, abbr):
    if logo_for is None or not abbr:
        return None
    url = logo_for.get(abbr) if isinstance(logo_for, dict) else logo_for(abbr)
    return url or None


def stint_team(stints, year, logo_for=None):
    """(team, logo) for the season ending in `year`; (None, None) when no stint or
    more than one franchise covers it. `logo_for`: {abbr: url} or abbr -> url."""
    covering = [
        s for s in stints or []
        if s.get("start_year") is not None and s["start_year"] <= year - 1
        and (s.get("end_year") is None or s["end_year"] >= year)
    ]
    if len({s.get("abbr") for s in covering}) != 1:
        return None, None
    stint = covering[0]
    return stint.get("name") or stint.get("abbr"), _logo(logo_for, stint.get("abbr"))


def _row(season, award, winners, mvp=None):
    winners = sorted(winners, key=lambda w: w["name"] or "")
    first = winners[0]
    base = mvp or {"season": season, "mvp": first["name"], "team": first["team"],
                   "team_logo_url": first["team_logo_url"]}
    return {"season": base["season"], "mvp": base["mvp"], "team": base["team"],
            "team_logo_url": base["team_logo_url"], "award": award, "winners": winners,
            "prompt": prompt(award, base["season"])}


def build(rows, mvps_csv, logo_for=None):
    """Every award season, ordered by season then award (AWARDS order)."""
    players = [r for r in rows if isinstance(r, dict)]
    mvp_ids = {}
    winners = {}
    for r in players:
        awards = r.get("awards")
        for y in _years(awards, "mvp"):
            mvp_ids.setdefault(y, []).append(r.get("person_id"))
        for award, key in AWARDS[1:]:
            for y in _years(awards, key):
                team, logo = stint_team(r.get("teams"), y, logo_for)
                winners.setdefault((y, award), []).append(
                    {"name": r.get("full_name"), "person_id": r.get("person_id"),
                     "team": team, "team_logo_url": logo})

    out = []
    for m in mvps_csv:
        y = end_year(m["season"])
        ids = mvp_ids.get(y, [])
        winner = {"name": m["mvp"], "person_id": ids[0] if len(ids) == 1 else None,
                  "team": m["team"] or None, "team_logo_url": m["team_logo_url"] or None}
        out.append((y, _row(m["season"], "MVP", [winner], mvp=m)))
    for (y, award), names in winners.items():
        out.append((y, _row(season_label(y), award, names)))
    out.sort(key=lambda pair: (pair[0], AWARD_ORDER[pair[1]["award"]]))
    return [row for _, row in out]
