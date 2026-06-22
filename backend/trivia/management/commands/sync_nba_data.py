"""Gather NBA data from the NBA API into the central Supabase store.

Autonomous + self-checking: every dataset is fetched with retry/backoff,
VALIDATED before anything touches the DB, and UPSERTED (never deleted), so a
bad or partial fetch can never serve players bad data — at worst it leaves the
existing good data in place. Each attempt is recorded in the SyncRun table.

MUST run from a residential IP (the NBA blocks datacenter IPs).

Examples:
  # Full historical backfill (playoffs back to 1946-47, deep starting-five):
  python manage.py sync_nba_data --full
  # Routine refresh (players + recent seasons), what the scheduler runs:
  python manage.py sync_nba_data
  # Just one dataset:
  python manage.py sync_nba_data --datasets players
"""

import os
import re

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import transaction

from trivia.data_pipeline import sources
from trivia.models import Mvp, Player, PlayoffSeries, StartingFiveGame, SyncRun, Team

ALL_DATASETS = ["teams", "players", "mvps", "playoff", "starting-five"]
SEASON_RE = re.compile(r"^\d{4}-\d{2}$")


def recent_seasons(n):
    from datetime import datetime

    last_start = datetime.now().year - 1
    return [sources.season_label(last_start - i) for i in range(n)]


# ---------------------------------------------------------------------------
#  Validators: return (clean_rows, problems). Reject malformed rows; never
#  let garbage reach the DB. An empty/failed fetch yields a problem and the
#  upsert is skipped (existing data is preserved because we only ever upsert).
# ---------------------------------------------------------------------------
def validate_teams(rows):
    clean = [r for r in rows if r.get("team_id") and r.get("full_name")]
    problems = [] if len(clean) >= 30 else [f"teams: only {len(clean)} (<30)"]
    return clean, problems


def validate_players(rows):
    clean = [r for r in rows if r.get("person_id") and r.get("full_name")]
    problems = [] if len(clean) >= 1000 else [f"players: only {len(clean)} (<1000)"]
    return clean, problems


def validate_mvps(rows):
    clean = [r for r in rows if SEASON_RE.match(r.get("season", "")) and r.get("mvp")]
    problems = [] if len(clean) >= 60 else [f"mvps: only {len(clean)} (<60)"]
    return clean, problems


def validate_playoff(rows):
    clean = []
    for r in rows:
        if not SEASON_RE.match(r.get("season", "")):
            continue
        if not r.get("winner_name") or not r.get("loser_name"):
            continue
        if not (0 <= r.get("loser_wins", -1) <= 3):
            continue
        # best-of-3/5/7 across NBA history -> 2..7 total games
        if not (2 <= r.get("total_games", 0) <= 7):
            continue
        clean.append(r)
    problems = [] if clean else ["playoff: 0 valid series"]
    return clean, problems


def validate_starting_five(rows):
    clean = [
        r
        for r in rows
        if r.get("game_id") and isinstance(r.get("starting_5"), list) and r["starting_5"]
    ]
    problems = [] if clean else ["starting-five: 0 valid games"]
    return clean, problems


# ---------------------------------------------------------------------------
#  Upserts: bulk, transactional, non-destructive (Postgres ON CONFLICT).
# ---------------------------------------------------------------------------
def _bulk_upsert(model, dicts, unique_fields, update_fields, batch=500):
    objs = [model(**d) for d in dicts]
    with transaction.atomic():
        for i in range(0, len(objs), batch):
            model.objects.bulk_create(
                objs[i : i + batch],
                update_conflicts=True,
                unique_fields=unique_fields,
                update_fields=update_fields,
            )
    return len(objs)


class Command(BaseCommand):
    help = "Fetch + validate + upsert NBA data into the central store (residential IP only)."

    def add_arguments(self, parser):
        parser.add_argument("--datasets", default=",".join(ALL_DATASETS))
        parser.add_argument("--full", action="store_true", help="Full historical backfill")
        parser.add_argument("--seasons", type=int, default=2, help="Recent seasons (non-full mode)")
        parser.add_argument("--season-list", default=None, help="Explicit seasons e.g. '1993-94,1994-95' (gap-fill; overrides --full/--seasons for playoff & starting-five)")
        parser.add_argument("--first-year", type=int, default=1946, help="Earliest playoff start year (full)")
        parser.add_argument("--sf-first-year", type=int, default=1996, help="Earliest starting-five start year (full)")
        parser.add_argument("--max-games", type=int, default=40, help="Starting-five games per season")
        parser.add_argument("--timeout", type=int, default=15, help="Per NBA-API-call timeout (s)")
        parser.add_argument("--mvps-csv", default=None)

    def _run(self, dataset, fetch, validate, upsert):
        """Fetch -> validate -> upsert one dataset, logging a SyncRun either way."""
        self.stdout.write(self.style.MIGRATE_HEADING(f"[{dataset}] fetching..."))
        try:
            rows = fetch()
        except Exception as e:  # noqa: BLE001
            self._log(dataset, "failed", 0, f"fetch error: {str(e)[:300]}")
            self.stdout.write(self.style.ERROR(f"[{dataset}] fetch FAILED: {str(e)[:120]}"))
            return
        clean, problems = validate(rows)
        if problems:
            self._log(dataset, "failed", len(clean), "; ".join(problems))
            self.stdout.write(self.style.ERROR(f"[{dataset}] validation FAILED, skipping upsert: {problems}"))
            return
        n = upsert(clean)
        self._log(dataset, "success", n, f"upserted {n} rows")
        self.stdout.write(self.style.SUCCESS(f"[{dataset}] upserted {n} rows"))

    def _log(self, dataset, status, rows, detail):
        try:
            SyncRun.objects.create(dataset=dataset, status=status, rows=rows, detail=detail[:2000])
        except Exception:  # noqa: BLE001 - logging must never break a sync
            pass

    def handle(self, *args, **opts):
        datasets = [d.strip() for d in opts["datasets"].split(",") if d.strip()]
        full = opts["full"]

        if "teams" in datasets:
            self._run(
                "teams", sources.fetch_teams, validate_teams,
                lambda c: _bulk_upsert(Team, c, ["team_id"], ["full_name", "abbreviation", "logo"]),
            )

        if "players" in datasets:
            self._run(
                "players", lambda: sources.fetch_players(per_call_timeout=opts["timeout"]), validate_players,
                lambda c: _bulk_upsert(
                    Player, c, ["person_id"],
                    ["full_name", "first_name", "last_name", "from_year", "to_year", "is_active"],
                ),
            )

        if "mvps" in datasets:
            csv_path = opts["mvps_csv"] or os.path.join(settings.BASE_DIR, "trivia", "utils", "nba_mvps.csv")
            self._run(
                "mvps", lambda: sources.load_mvps(csv_path), validate_mvps,
                lambda c: _bulk_upsert(Mvp, c, ["season"], ["mvp", "team", "team_logo_url"]),
            )

        if "playoff" in datasets:
            if opts["season_list"]:
                seasons = [s.strip() for s in opts["season_list"].split(",") if s.strip()]
            elif full:
                seasons = sources.history_seasons(first_start_year=opts["first_year"])
            else:
                seasons = recent_seasons(opts["seasons"])
            self.stdout.write(f"[playoff] {len(seasons)} seasons: {seasons[0]} .. {seasons[-1]}")
            self._run(
                "playoff", lambda: sources.fetch_playoff_series(seasons, per_call_timeout=opts["timeout"]), validate_playoff,
                lambda c: _bulk_upsert(
                    PlayoffSeries, c, ["season", "series_id"],
                    ["round", "winner_team_id", "winner_name", "winner_abbreviation",
                     "loser_team_id", "loser_name", "loser_abbreviation", "loser_wins", "total_games"],
                ),
            )

        if "starting-five" in datasets:
            if opts["season_list"]:
                seasons = [s.strip() for s in opts["season_list"].split(",") if s.strip()]
            elif full:
                last = sources.history_seasons()[-1]
                last_year = int(last[:4])
                seasons = [sources.season_label(y) for y in range(opts["sf_first_year"], last_year + 1)]
            else:
                seasons = recent_seasons(opts["seasons"])
            self.stdout.write(f"[starting-five] {len(seasons)} seasons, {opts['max_games']} games each")
            self._run(
                "starting-five",
                lambda: sources.fetch_starting_five(seasons, max_games_per_season=opts["max_games"], per_call_timeout=opts["timeout"]),
                validate_starting_five,
                lambda c: _bulk_upsert(
                    StartingFiveGame, c, ["game_id"],
                    ["game_date", "season", "team_a", "team_b", "team_a_logo", "team_b_logo",
                     "final_score", "winning_team", "starting_5"],
                ),
            )

        self.stdout.write(self.style.SUCCESS("sync_nba_data complete"))
