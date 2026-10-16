"""Regenerate the static /data/ pools (+ manifest) from the central DB store.

The frontend reads these pools from the CDN for single-player (client-side
randomization), so this is the bridge from the always-fresh Supabase store to
the cheap, infinitely-scalable static serving path. The scheduler runs this
right after `sync_nba_data`.

Each pool is validated independently; an empty/invalid pool is skipped (its
existing committed file is kept) rather than clobbering good data.
"""

import json
import os
import random
from datetime import datetime, timezone
from types import SimpleNamespace

from django.conf import settings
from django.core.management.base import BaseCommand
from trivia.data_pipeline import award_seasons
from trivia.data_pipeline.build_static import build_all_players_pool
from trivia.data_pipeline.live_pool import load_dataset
from trivia.data_pipeline.manifest import build_manifest
from trivia.data_pipeline.starting_five import canonical_lineup_names, playable_lineups
from trivia.data_pipeline.validate import validate_pool
from trivia.games import POOL_BUILDERS as GAME_POOL_BUILDERS
from trivia.models import FanFavoritesQuestion, Mvp, Player, PlayoffSeries, StartingFiveGame, Team
from trivia.questions import corrections
from trivia.questions.runner import pool_rows
from trivia.utils.fan_favorites import live_standings, refresh_live_standings
from trivia.utils.logo_utils import logo
from trivia.utils.text_utils import wordle_word


def _data_dir():
    return getattr(settings, "GAME_DATA_DIR", os.path.join(settings.BASE_DIR, "trivia", "data"))


def build_name_logo():
    return [
        {"team_id": t.team_id, "full_name": t.full_name,
         "abbreviation": t.abbreviation, "logo": t.logo or logo(t.team_id)}
        for t in Team.objects.all()
    ]


def build_all_players():
    # The curated dataset, not the DB Player table: players_curated.json is
    # generated from the live league index and is 1:1 with this list by
    # construction (generate_players_curated --rewrite-all-players writes both),
    # so publishing the DB's older, unaccented names here would break that
    # parity and the starting-five canonicalisation that reads this list.
    return build_all_players_pool()


def build_wordle():
    # Clean, de-duplicated 5-letter ASCII surnames (accents stripped, e.g. Jokić->Jokic).
    # De-dupe case-insensitively too, so casing variants that collide once the
    # game uppercases guesses (e.g. "DuVal" vs "Duval") don't produce two pool
    # entries for the same answer.
    seen = set()
    words = []
    for ln in Player.objects.values_list("last_name", flat=True):
        w = wordle_word(ln)
        if w and w.upper() not in seen:
            seen.add(w.upper())
            words.append(w)
    return sorted(words)


def build_mvps(dataset=None):
    # Every major award season (trivia/data_pipeline/award_seasons.py): the MVP rows keep
    # their four Mvp-table fields, every row adds award, winners and prompt. The other
    # awards come from the curated rows with the active DataCorrections overlaid
    # (`dataset`: the publish's, already corrected).
    mvps = [
        {"season": m.season, "mvp": m.mvp, "team": m.team, "team_logo_url": m.team_logo_url}
        for m in Mvp.objects.all().order_by("season")
    ]
    if not mvps:  # no MVP rows: an empty pool, so the committed file is kept
        return []
    rows = dataset.rows if dataset is not None else corrections.apply(load_dataset())
    # A team logo only when exactly one franchise carries the abbreviation.
    by_abbr = {}
    for t in Team.objects.all():
        by_abbr.setdefault(t.abbreviation, []).append(t.logo or logo(t.team_id))
    logos = {abbr: urls[0] for abbr, urls in by_abbr.items() if len(urls) == 1}
    return award_seasons.build(rows, mvps, logos)


def build_playoff(winner_first=None):
    # winner_first(series) -> bool decides whether the winner is team_a. Random by
    # default; the v3 publisher passes a stable rule so the same data always
    # produces the same bytes (and the same content-addressed file names).
    winner_first = winner_first or (lambda s: random.choice([True, False]))
    out = []
    for s in PlayoffSeries.objects.all():
        winner_wins = s.total_games - s.loser_wins
        winner = (s.winner_name, s.winner_abbreviation, s.winner_team_id, winner_wins)
        loser = (s.loser_name, s.loser_abbreviation, s.loser_team_id, s.loser_wins)
        a, b = (winner, loser) if winner_first(s) else (loser, winner)
        out.append({
            "season": s.season,
            "team_a": a[0], "team_b": b[0],
            "team_a_abbreviation": a[1], "team_b_abbreviation": b[1],
            "team_a_logo": logo(a[2]), "team_b_logo": logo(b[2]),
            "team_a_wins": a[3], "team_b_wins": b[3],
            "winner": s.winner_name, "round": s.round,
            "match_id": s.series_id, "total_games": s.total_games,
        })
    return out


def build_starting_five():
    # The board is a fixed 2-2-1 and every guess goes through the autocomplete,
    # so unwinnable lineups are dropped and names are pulled to their canonical
    # spelling here: the store keeps the raw feed, the pool only the playable
    # part of it (trivia/data_pipeline/starting_five.py).
    rows = [
        {"game_id": g.game_id, "game_date": g.game_date,
         "team_a": g.team_a, "team_b": g.team_b,
         "team_a_logo": g.team_a_logo, "team_b_logo": g.team_b_logo,
         "final_score": g.final_score, "winning_team": g.winning_team,
         "starting_5": g.starting_5}
        for g in StartingFiveGame.objects.all()
    ]
    return canonical_lineup_names(playable_lineups(rows), build_all_players())


def build_fan_favorites(persist=True, dataset=None, out=None):
    # Auto seed->live transition: boards with enough real guesses re-rank first.
    # persist=False (the read-only freshness check) applies the same re-rank in
    # memory only, so it sees exactly the rows a publish would build, with no writes.
    if persist:
        refresh_live_standings()
    # The boards are the active fan-favorites questions (spec §4.6) once the seeds are
    # imported; their live standings are merged by qid in memory (same rule, no writes).
    # `dataset` / `out`: the publish's dataset and its log (runner.pool_rows).
    boards = pool_rows("fan-favorites", dataset, out)
    if boards is not None:
        for row in boards:
            row["answers"] = live_standings(SimpleNamespace(qid=row["qid"], answers=row["answers"])) or row["answers"]
        return boards
    rows = []
    for q in FanFavoritesQuestion.objects.filter(live=True).order_by("qid"):
        answers = q.answers if persist else (live_standings(q) or q.answers)
        rows.append({"qid": q.qid, "prompt": q.prompt, "survey_date": q.survey_date,
                     "category": q.category, "answers": answers})
    return rows


BUILDERS = {
    "name-logo": build_name_logo,
    "all-players": build_all_players,
    "wordle": build_wordle,
    "mvps": build_mvps,
    "playoff": build_playoff,
    "starting-five": build_starting_five,
    "fan-favorites": build_fan_favorites,
    # Modular game builders (trivia/games/<module>.build_pool) — includes the
    # "players-index" pool published from the curated dataset.
    **GAME_POOL_BUILDERS,
}


class Command(BaseCommand):
    help = "Regenerate static /data/ pools (+ manifest) from the central DB store."

    def add_arguments(self, parser):
        parser.add_argument("--label", default=None, help="Manifest version (default: UTC date)")

    def handle(self, *args, **opts):
        data_dir = _data_dir()
        os.makedirs(data_dir, exist_ok=True)
        version = opts["label"] or datetime.now(timezone.utc).strftime("%Y-%m-%d")

        written = 0
        for key, builder in BUILDERS.items():
            data = builder()
            problems = validate_pool(key, data)
            if problems:
                self.stdout.write(self.style.WARNING(f"  skip {key}: {problems} (kept existing file)"))
                continue
            with open(os.path.join(data_dir, f"{key}.json"), "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False)
            written += 1
            self.stdout.write(f"  wrote {key}.json ({len(data)} rows)")

        manifest = build_manifest(data_dir, version)
        with open(os.path.join(data_dir, "manifest.json"), "w", encoding="utf-8") as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2)
        self.stdout.write(self.style.SUCCESS(f"Regenerated {written} pools + manifest (version {version}) from DB"))
