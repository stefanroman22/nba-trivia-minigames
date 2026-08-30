"""NBA-API source fetchers for the central data store.

Every fetcher returns a plain list of dicts shaped for the corresponding model
in trivia.models. They are network-bound (the NBA blocks datacenter IPs, so
these must run from a residential IP) and therefore wrapped in retry/backoff.
Nothing here touches the database — the sync command validates and upserts.
"""

import csv
import time

from trivia.utils.logo_utils import logo


def current_season():
    """Most-recent NBA season label, e.g. '2025-26' (rolls over each October)."""
    from datetime import datetime

    now = datetime.now()
    start = now.year if now.month >= 10 else now.year - 1
    return f"{start}-{str(start + 1)[-2:]}"


def retry(fn, *, attempts=4, base_delay=1.5, label=""):
    """Call fn() with exponential backoff. Raises the last error if all fail."""
    last = None
    for i in range(attempts):
        try:
            return fn()
        except Exception as e:  # noqa: BLE001 - we want to retry on anything network-y
            last = e
            wait = base_delay * (2**i)
            print(f"  [retry] {label} attempt {i + 1}/{attempts} failed: {str(e)[:80]} (waiting {wait:.0f}s)")
            time.sleep(wait)
    raise last


def season_label(start_year):
    return f"{start_year}-{str(start_year + 1)[-2:]}"


def history_seasons(first_start_year=1946, last_start_year=None):
    """All season labels from first_start_year-.. up to last_start_year (inclusive)."""
    from datetime import datetime

    if last_start_year is None:
        # The "current" NBA season started in the previous calendar year for most
        # of the season; use last completed season's start year.
        last_start_year = datetime.now().year - 1
    return [season_label(y) for y in range(first_start_year, last_start_year + 1)]


# ---------------------------------------------------------------------------
#  Teams  (bundled static list — no network, always reliable)
# ---------------------------------------------------------------------------
def fetch_teams():
    from nba_api.stats.static import teams

    return [
        {
            "team_id": t["id"],
            "full_name": t["full_name"],
            "abbreviation": t["abbreviation"],
            "logo": logo(t["id"]),
        }
        for t in teams.get_teams()
    ]


# ---------------------------------------------------------------------------
#  Players  (LIVE CommonAllPlayers, all-time; falls back to bundled static)
# ---------------------------------------------------------------------------
def fetch_players(season=None, per_call_timeout=20):
    """All players (historical + active) with roster status, freshest available.

    Uses the current season so new draftees/signings are picked up (roster status
    is computed for that season); the all-time list itself includes everyone.
    """
    season = season or current_season()
    try:
        def _call():
            from nba_api.stats.endpoints import CommonAllPlayers

            return CommonAllPlayers(
                is_only_current_season=0,
                league_id="00",
                season=season,
                timeout=per_call_timeout,
            ).get_data_frames()[0]

        df = retry(_call, label="CommonAllPlayers")
        out = []
        for _, r in df.iterrows():
            disp = (r.get("DISPLAY_FIRST_LAST") or "").strip()
            lcf = (r.get("DISPLAY_LAST_COMMA_FIRST") or "").strip()
            last = lcf.split(",")[0].strip() if "," in lcf else (disp.split(" ")[-1] if disp else "")
            first = disp[: -len(last)].strip() if last and disp.endswith(last) else ""
            try:
                from_year = int(r["FROM_YEAR"]) if r.get("FROM_YEAR") else None
            except (ValueError, TypeError):
                from_year = None
            try:
                to_year = int(r["TO_YEAR"]) if r.get("TO_YEAR") else None
            except (ValueError, TypeError):
                to_year = None
            out.append(
                {
                    "person_id": int(r["PERSON_ID"]),
                    "full_name": disp,
                    "first_name": first,
                    "last_name": last,
                    "from_year": from_year,
                    "to_year": to_year,
                    "is_active": int(r.get("ROSTERSTATUS") or 0) == 1,
                }
            )
        if out:
            return out
        raise ValueError("CommonAllPlayers returned 0 usable rows")
    except Exception as e:
        print(f"  [players] live fetch failed ({str(e)[:60]}); falling back to bundled static list")
        from nba_api.stats.static import players

        return [
            {
                "person_id": int(p["id"]),
                "full_name": p["full_name"],
                "first_name": p.get("first_name", ""),
                "last_name": p.get("last_name", ""),
                "from_year": None,
                "to_year": None,
                "is_active": bool(p.get("is_active")),
            }
            for p in players.get_players()
        ]


# ---------------------------------------------------------------------------
#  Playoff series  (derived entirely from the playoff game log)
# ---------------------------------------------------------------------------
def _reconstruct_rounds(series):
    """Assign a round label to every series by reconstructing the bracket.

    The Finals is the series whose clinching game is latest; each team entered a
    series by winning its previous (earlier) series, so we walk backward from the
    Finals assigning increasing depth (0 = Finals). Era-independent, and never
    yields "Unknown". `series` items have: teams(frozenset), winner_id, latest(date).
    """
    n = len(series)
    by_date = sorted(range(n), key=lambda i: series[i]["latest"])
    tser = {}  # team_id -> sorted [(date, series_index)]
    for i, s in enumerate(series):
        for t in s["teams"]:
            tser.setdefault(t, []).append((s["latest"], i))
    for t in tser:
        tser[t].sort()

    depth = {by_date[-1]: 0}  # latest-clinching series = Finals
    for i in reversed(by_date):  # latest -> earliest
        if i not in depth:
            continue
        for t in series[i]["teams"]:
            prev = None
            for _, j in tser[t]:
                if j == i:
                    break
                if series[j]["winner_id"] == t:
                    prev = j  # latest earlier series this team won = its feeder
            if prev is not None and prev not in depth:
                depth[prev] = depth[i] + 1

    labels = {0: "NBA Finals", 1: "Conference Finals", 2: "Conference Semifinals", 3: "First Round"}
    return {i: labels.get(depth.get(i, 99), "First Round") for i in range(n)}


def _fetch_playoff_season(season, per_call_timeout=15):
    """All completed playoff series for a season, derived from the playoff game log.

    Games are grouped into team-vs-team matchups (two teams meet exactly once per
    playoff), capturing every series in every era (best-of-3/5/7). Team names come
    straight from the log (historically accurate, incl. relocated/defunct teams);
    round labels come from bracket reconstruction (see _reconstruct_rounds) — no
    "Unknown" and no dependency on CommonPlayoffSeries' unaligned GAME_IDs.
    """
    from collections import defaultdict

    from nba_api.stats.endpoints import LeagueGameLog

    log = retry(
        lambda: LeagueGameLog(
            season=season, season_type_all_star="Playoffs", timeout=per_call_timeout
        ).get_data_frames()[0],
        label=f"GameLog {season}",
    )
    if log.empty:
        return []

    games = defaultdict(list)
    for _, r in log[["GAME_ID", "TEAM_ID", "TEAM_ABBREVIATION", "TEAM_NAME", "WL", "GAME_DATE"]].iterrows():
        games[str(r["GAME_ID"])].append(r)

    # frozenset(team_ids) -> {"wins": {tid: n}, "latest": date, "info": {tid: (abbr, name)}}
    matchups = {}
    for rows in games.values():
        tids = {int(rr["TEAM_ID"]) for rr in rows}
        if len(tids) != 2:
            continue
        m = matchups.setdefault(frozenset(tids), {"wins": {}, "latest": "", "info": {}})
        for rr in rows:
            tid = int(rr["TEAM_ID"])
            m["info"][tid] = (rr["TEAM_ABBREVIATION"] or "", rr["TEAM_NAME"] or "")
            m["wins"].setdefault(tid, 0)  # ensure both teams present (so sweeps count)
            if rr["WL"] == "W":
                m["wins"][tid] += 1
            d = str(rr["GAME_DATE"])
            if d > m["latest"]:
                m["latest"] = d

    series = []
    for m in matchups.values():
        if len(m["wins"]) != 2:
            continue
        (win_id, ww), (lose_id, lw) = sorted(m["wins"].items(), key=lambda kv: kv[1], reverse=True)
        # Completed series only: winner clinched (>=2 in any format) and led
        # (drops single play-in games, which leave a 1-0 "matchup").
        if ww < 2 or ww <= lw:
            continue
        series.append({"teams": frozenset((win_id, lose_id)), "winner_id": win_id,
                       "loser_id": lose_id, "ww": ww, "lw": lw, "latest": m["latest"], "info": m["info"]})
    if not series:
        return []

    rounds = _reconstruct_rounds(series)
    out = []
    for i, s in enumerate(series):
        win_id, lose_id = s["winner_id"], s["loser_id"]
        w_abbr, w_name = s["info"].get(win_id, ("", str(win_id)))
        l_abbr, l_name = s["info"].get(lose_id, ("", str(lose_id)))
        lo, hi = sorted((win_id, lose_id))
        out.append(
            {
                "season": season,
                "series_id": f"{season}-{lo}-{hi}",  # stable per matchup -> idempotent upsert
                "round": rounds[i],
                "winner_team_id": win_id,
                "winner_name": w_name or w_abbr,
                "winner_abbreviation": w_abbr,
                "loser_team_id": lose_id,
                "loser_name": l_name or l_abbr,
                "loser_abbreviation": l_abbr,
                "loser_wins": s["lw"],
                "total_games": s["ww"] + s["lw"],
            }
        )
    return out


def fetch_playoff_series(seasons, per_call_timeout=15, pause=0.4):
    """Fetch completed playoff series for the given season labels (sequential, polite)."""
    out = []
    for s in seasons:
        try:
            rows = _fetch_playoff_season(s, per_call_timeout=per_call_timeout)
            print(f"  [playoff] {s}: {len(rows)} series")
            out.extend(rows)
        except Exception as e:  # noqa: BLE001
            print(f"  [playoff] {s}: FAILED ({str(e)[:60]}) — skipped")
        time.sleep(pause)
    return out


# ---------------------------------------------------------------------------
#  Starting five  (LeagueGameFinder + BoxScoreTraditionalV2; box scores ~1996+)
# ---------------------------------------------------------------------------
def fetch_starting_five(seasons, max_games_per_season=40, per_call_timeout=15, pause=0.6):
    import pandas as pd
    from nba_api.stats.endpoints import leaguegamefinder, boxscoretraditionalv2
    from nba_api.stats.static import teams as static_teams
    import random

    all_teams = {t["id"]: t for t in static_teams.get_teams()}
    out = []
    for season in seasons:
        try:
            def _games():
                reg = leaguegamefinder.LeagueGameFinder(
                    season_nullable=season, league_id_nullable="00",
                    season_type_nullable="Regular Season", timeout=per_call_timeout,
                ).get_data_frames()[0]
                po = leaguegamefinder.LeagueGameFinder(
                    season_nullable=season, league_id_nullable="00",
                    season_type_nullable="Playoffs", timeout=per_call_timeout,
                ).get_data_frames()[0]
                return pd.concat([reg, po], ignore_index=True)

            all_games_df = retry(_games, label=f"GameFinder {season}")
            if all_games_df.empty:
                print(f"  [starting5] {season}: no games")
                continue
            game_ids = list(all_games_df["GAME_ID"].unique())
            random.shuffle(game_ids)
            game_ids = game_ids[:max_games_per_season]
            kept = 0
            for game_id in game_ids:
                try:
                    box = boxscoretraditionalv2.BoxScoreTraditionalV2(
                        game_id=game_id, timeout=per_call_timeout
                    )
                    pdf = box.player_stats.get_data_frame()
                    tids = pdf["TEAM_ID"].unique()
                    if len(tids) != 2:
                        continue
                    a, b = int(tids[0]), int(tids[1])
                    a_pts = int(pdf[pdf["TEAM_ID"] == a]["PTS"].sum())
                    b_pts = int(pdf[pdf["TEAM_ID"] == b]["PTS"].sum())
                    win_id = a if a_pts > b_pts else b
                    starters = pdf[(pdf["TEAM_ID"] == win_id) & (pdf["START_POSITION"] != "")]
                    if starters.empty:
                        continue
                    s5 = [
                        {"name": r["PLAYER_NAME"], "position": r["START_POSITION"]}
                        for _, r in starters.head(5).iterrows()
                    ]
                    row = all_games_df[all_games_df["GAME_ID"] == game_id].iloc[0]
                    out.append(
                        {
                            "game_id": str(game_id),
                            "game_date": str(row["GAME_DATE"]),
                            "season": season,
                            "team_a": all_teams.get(a, {}).get("full_name", str(a)),
                            "team_b": all_teams.get(b, {}).get("full_name", str(b)),
                            "team_a_logo": logo(a),
                            "team_b_logo": logo(b),
                            "final_score": f"{a_pts} - {b_pts}",
                            "winning_team": all_teams.get(win_id, {}).get("full_name", str(win_id)),
                            "starting_5": s5,
                        }
                    )
                    kept += 1
                except Exception:  # noqa: BLE001
                    continue
                time.sleep(pause)
            print(f"  [starting5] {season}: {kept} games")
        except Exception as e:  # noqa: BLE001
            print(f"  [starting5] {season}: FAILED ({str(e)[:60]}) — skipped")
    return out


# ---------------------------------------------------------------------------
#  Curated players  (two bulk endpoints + three per-player endpoints)
# ---------------------------------------------------------------------------
def _int(value, default=None):
    """int(value) for API fields that arrive as str/float/None/''."""
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def fetch_draft_history(per_call_timeout=30):
    """Every draft pick ever, keyed for lookup by person_id.

    BULK — one call covers all ~8.4k picks, so this is fetched once and indexed
    rather than queried per player. Crucially the team here is the team as it
    was ON DRAFT NIGHT (Seattle for Kevin Durant, Atlanta for Luka Dončić,
    Charlotte for Shai Gilgeous-Alexander) — never the player's later franchise.
    """
    from nba_api.stats.endpoints import drafthistory

    data = retry(
        lambda: drafthistory.DraftHistory(timeout=per_call_timeout).get_normalized_dict(),
        label="DraftHistory",
    )
    out = []
    for r in data.get("DraftHistory", []):
        pid = _int(r.get("PERSON_ID"))
        year = _int(r.get("SEASON"))
        if not pid or year is None:
            continue
        out.append(
            {
                "person_id": pid,
                "year": year,
                "round": _int(r.get("ROUND_NUMBER"), 0),
                "pick": _int(r.get("OVERALL_PICK"), 0),
                "team_id": _int(r.get("TEAM_ID"), 0),
                "team_abbr": (r.get("TEAM_ABBREVIATION") or "").strip(),
                "organization": (r.get("ORGANIZATION") or "").strip(),
                "organization_type": (r.get("ORGANIZATION_TYPE") or "").strip(),
            }
        )
    return out


def fetch_franchise_history(per_call_timeout=30):
    """Every franchise NAME era (active + defunct) as {team_id, name, start/end_year}.

    BULK — feeds era-accurate stint naming: team_id 1610612760 is the Seattle
    SuperSonics through 2007-08 and the Oklahoma City Thunder from 2008-09.
    The endpoint also returns one whole-franchise summary row per team (widest
    span, current name); callers resolve a season to the NARROWEST matching era,
    which ignores those summaries and picks Bobcats over Hornets for 2004-2013.
    """
    from nba_api.stats.endpoints import franchisehistory

    data = retry(
        lambda: franchisehistory.FranchiseHistory(timeout=per_call_timeout).get_normalized_dict(),
        label="FranchiseHistory",
    )
    out = []
    for key in ("FranchiseHistory", "DefunctTeams"):
        for r in data.get(key, []):
            team_id = _int(r.get("TEAM_ID"))
            start = _int(r.get("START_YEAR"))
            end = _int(r.get("END_YEAR"))
            name = f"{(r.get('TEAM_CITY') or '').strip()} {(r.get('TEAM_NAME') or '').strip()}".strip()
            if not team_id or start is None or end is None or not name:
                continue
            out.append({"team_id": team_id, "name": name, "start_year": start, "end_year": end})
    return out


def fetch_player_profile(person_id, per_call_timeout=30, pause=0.6):
    """The three per-player endpoints behind one curated row, raw.

    Returns {"info": [...], "career": [...], "career_totals": [...], "awards": [...]}
    exactly as the API gives it — the caller caches this and assembles rows from
    it offline, so re-shaping a row never re-hits the network. Raises if any of
    the three endpoints is still failing after retry(): a partially fetched
    player must never become a null-filled row.
    """
    import random

    from nba_api.stats.endpoints import commonplayerinfo, playercareerstats, playerawards

    def _paced(fn, label):
        result = retry(fn, label=f"{label} {person_id}")
        time.sleep(pause + random.uniform(0, pause / 2))  # polite + jittered
        return result

    info = _paced(
        lambda: commonplayerinfo.CommonPlayerInfo(
            player_id=person_id, timeout=per_call_timeout
        ).get_normalized_dict(),
        "CommonPlayerInfo",
    )
    career = _paced(
        lambda: playercareerstats.PlayerCareerStats(
            player_id=person_id, timeout=per_call_timeout
        ).get_normalized_dict(),
        "PlayerCareerStats",
    )
    awards = _paced(
        lambda: playerawards.PlayerAwards(
            player_id=person_id, timeout=per_call_timeout
        ).get_normalized_dict(),
        "PlayerAwards",
    )
    return {
        "info": info.get("CommonPlayerInfo", []),
        "career": career.get("SeasonTotalsRegularSeason", []),
        "career_totals": career.get("CareerTotalsRegularSeason", []),
        "awards": awards.get("PlayerAwards", []),
    }


# ---------------------------------------------------------------------------
#  MVPs  (committed CSV — complete back to 1955-56)
# ---------------------------------------------------------------------------
def load_mvps(csv_path):
    with open(csv_path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    return [
        {
            "season": r["season"].strip(),
            "mvp": r["mvp"].strip(),
            "team": r["team"].strip(),
            "team_logo_url": (r.get("team_logo_url") or "").strip(),
        }
        for r in rows
        if r.get("season")
    ]
