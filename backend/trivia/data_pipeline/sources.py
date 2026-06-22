"""NBA-API source fetchers for the central data store.

Every fetcher returns a plain list of dicts shaped for the corresponding model
in trivia.models. They are network-bound (the NBA blocks datacenter IPs, so
these must run from a residential IP) and therefore wrapped in retry/backoff.
Nothing here touches the database — the sync command validates and upserts.
"""

import csv
import time

from trivia.utils.logo_utils import logo

ROUND_MAP = {
    "1": "First Round",
    "2": "Conference Semifinals",
    "3": "Conference Finals",
    "4": "NBA Finals",
}


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
def fetch_players(season="2025-26", per_call_timeout=20):
    """All players (historical + active) with roster status, freshest available."""
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
#  Playoff series  (CommonPlayoffSeries + LeagueGameLog, stored canonically)
# ---------------------------------------------------------------------------
def _fetch_playoff_season(season, per_call_timeout=15):
    """All completed playoff series for a season, derived from the playoff game log.

    Games are grouped into team-vs-team matchups (two teams meet exactly once per
    playoff), which captures every series in every era (best-of-3/5/7). Keying on
    CommonPlayoffSeries.SERIES_ID instead drops series for older seasons because
    its GAME_IDs don't align with the game log. Team names come straight from the
    log (historically accurate, incl. relocated/defunct franchises); round labels
    are a best-effort lookup from CommonPlayoffSeries.
    """
    from collections import defaultdict

    from nba_api.stats.endpoints import CommonPlayoffSeries, LeagueGameLog

    log = retry(
        lambda: LeagueGameLog(
            season=season, season_type_all_star="Playoffs", timeout=per_call_timeout
        ).get_data_frames()[0],
        label=f"GameLog {season}",
    )
    if log.empty:
        return []

    # Best-effort GAME_ID -> round label.
    game_round = {}
    try:
        ps = retry(
            lambda: CommonPlayoffSeries(season=season, timeout=per_call_timeout).get_data_frames()[0],
            label=f"PlayoffSeries {season}",
        )
        for _, r in ps.iterrows():
            sid = str(r["SERIES_ID"])
            game_round[str(r["GAME_ID"])] = ROUND_MAP.get(sid[7] if len(sid) > 7 else "", "Unknown")
    except Exception:  # noqa: BLE001 - round label is optional
        pass

    games = defaultdict(list)
    for _, r in log[["GAME_ID", "TEAM_ID", "TEAM_ABBREVIATION", "TEAM_NAME", "WL"]].iterrows():
        games[str(r["GAME_ID"])].append(r)

    matchups = {}  # frozenset(team_ids) -> {team_id: wins}
    info = {}      # team_id -> (abbreviation, name)
    rounds = {}    # frozenset -> round label
    for gid, rows in games.items():
        tids = {int(rr["TEAM_ID"]) for rr in rows}
        if len(tids) != 2:
            continue
        key = frozenset(tids)
        m = matchups.setdefault(key, {})
        for rr in rows:
            tid = int(rr["TEAM_ID"])
            info[tid] = (rr["TEAM_ABBREVIATION"] or "", rr["TEAM_NAME"] or "")
            m.setdefault(tid, 0)  # ensure both teams present (so sweeps count)
            if rr["WL"] == "W":
                m[tid] += 1
        if key not in rounds and gid in game_round:
            rounds[key] = game_round[gid]

    out = []
    for key, wins in matchups.items():
        if len(wins) != 2:
            continue
        (win_id, winner_wins), (lose_id, loser_wins) = sorted(
            wins.items(), key=lambda kv: kv[1], reverse=True
        )
        # Completed series only: winner clinched (>=2 in any format), and led
        # (drops single play-in games, which leave a 1-0 "matchup").
        if winner_wins < 2 or winner_wins <= loser_wins:
            continue
        w_abbr, w_name = info.get(win_id, ("", str(win_id)))
        l_abbr, l_name = info.get(lose_id, ("", str(lose_id)))
        lo, hi = sorted((win_id, lose_id))
        out.append(
            {
                "season": season,
                "series_id": f"{season}-{lo}-{hi}",  # stable per matchup -> idempotent upsert
                "round": rounds.get(key, "Unknown"),
                "winner_team_id": win_id,
                "winner_name": w_name or w_abbr,
                "winner_abbreviation": w_abbr,
                "loser_team_id": lose_id,
                "loser_name": l_name or l_abbr,
                "loser_abbreviation": l_abbr,
                "loser_wins": loser_wins,
                "total_games": winner_wins + loser_wins,
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
