import json
import os
from datetime import datetime, timezone

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from trivia.data_pipeline.build_static import (
    build_all_players_pool,
    build_mvps_pool,
    build_name_logo_pool,
    build_wordle_pool,
)
from trivia.data_pipeline.manifest import build_manifest
from trivia.data_pipeline.validate import validate_pool


def _data_dir():
    return getattr(
        settings, "GAME_DATA_DIR", os.path.join(settings.BASE_DIR, "trivia", "data")
    )


def _utils_dir():
    return os.path.join(settings.BASE_DIR, "trivia", "utils")


def _load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


class Command(BaseCommand):
    help = "Build, validate, and version all game data pools into GAME_DATA_DIR."

    def add_arguments(self, parser):
        parser.add_argument(
            "--skip-live",
            action="store_true",
            help="Skip nba_api network builders; reuse existing playoff/starting_five JSON.",
        )
        parser.add_argument(
            "--label",
            default=None,
            help="Manifest version label (default: UTC date, e.g. 2026-06-21).",
        )

    def handle(self, *args, **opts):
        data_dir = _data_dir()
        utils_dir = _utils_dir()
        os.makedirs(data_dir, exist_ok=True)
        version = opts["label"] or datetime.now(timezone.utc).strftime("%Y-%m-%d")

        pools = {
            "name-logo": build_name_logo_pool(),
            "all-players": build_all_players_pool(),
            "wordle": build_wordle_pool(),
            "mvps": build_mvps_pool(os.path.join(utils_dir, "nba_mvps.csv")),
        }

        if opts["skip_live"]:
            pools["playoff"] = _load_json(os.path.join(utils_dir, "playoff_data.json"))
            pools["starting-five"] = _load_json(
                os.path.join(utils_dir, "starting_five_data.json")
            )
        else:
            from trivia.utils.playoff_games_utils import build_local_playoff_database
            from trivia.utils.starting_five_utils import build_starting_five_database

            playoff_path = os.path.join(data_dir, "playoff.json")
            sf_path = os.path.join(data_dir, "starting-five.json")
            build_local_playoff_database(output_path=playoff_path, num_seasons=20)
            build_starting_five_database(output_path=sf_path, max_games_per_season=50)
            pools["playoff"] = _load_json(playoff_path)
            pools["starting-five"] = _load_json(sf_path)

        problems = []
        for key, data in pools.items():
            problems += validate_pool(key, data)
        if problems:
            raise CommandError("Validation failed:\n" + "\n".join(problems))

        for key, data in pools.items():
            with open(os.path.join(data_dir, f"{key}.json"), "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False)

        manifest = build_manifest(data_dir, version)
        with open(os.path.join(data_dir, "manifest.json"), "w", encoding="utf-8") as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2)

        self.stdout.write(
            self.style.SUCCESS(
                f"Wrote {len(pools)} pools + manifest (version {version}) to {data_dir}"
            )
        )
