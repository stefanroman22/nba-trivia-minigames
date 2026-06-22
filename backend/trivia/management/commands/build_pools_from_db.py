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

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db.models.functions import Length

from trivia.data_pipeline.manifest import build_manifest
from trivia.data_pipeline.validate import validate_pool
from trivia.models import Mvp, Player, PlayoffSeries, StartingFiveGame, Team
from trivia.utils.logo_utils import logo


def _data_dir():
    return getattr(settings, "GAME_DATA_DIR", os.path.join(settings.BASE_DIR, "trivia", "data"))


def build_name_logo():
    return [
        {"team_id": t.team_id, "full_name": t.full_name,
         "abbreviation": t.abbreviation, "logo": t.logo or logo(t.team_id)}
        for t in Team.objects.all()
    ]


def build_all_players():
    return list(Player.objects.values_list("full_name", flat=True))


def build_wordle():
    return list(
        Player.objects.annotate(ln=Length("last_name")).filter(ln=5)
        .values_list("last_name", flat=True)
    )


def build_mvps():
    return [
        {"season": m.season, "mvp": m.mvp, "team": m.team, "team_logo_url": m.team_logo_url}
        for m in Mvp.objects.all().order_by("season")
    ]


def build_playoff():
    out = []
    for s in PlayoffSeries.objects.all():
        winner_wins = s.total_games - s.loser_wins
        winner = (s.winner_name, s.winner_abbreviation, s.winner_team_id, winner_wins)
        loser = (s.loser_name, s.loser_abbreviation, s.loser_team_id, s.loser_wins)
        a, b = (winner, loser) if random.choice([True, False]) else (loser, winner)
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
    return [
        {"game_id": g.game_id, "game_date": g.game_date,
         "team_a": g.team_a, "team_b": g.team_b,
         "team_a_logo": g.team_a_logo, "team_b_logo": g.team_b_logo,
         "final_score": g.final_score, "winning_team": g.winning_team,
         "starting_5": g.starting_5}
        for g in StartingFiveGame.objects.all()
    ]


BUILDERS = {
    "name-logo": build_name_logo,
    "all-players": build_all_players,
    "wordle": build_wordle,
    "mvps": build_mvps,
    "playoff": build_playoff,
    "starting-five": build_starting_five,
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
