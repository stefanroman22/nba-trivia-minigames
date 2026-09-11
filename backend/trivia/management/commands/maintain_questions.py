"""Daily job (GitHub Actions): download the dataset, refresh the questions
table, publish a new snapshot. Exit 1 on any gate failure — nothing is published."""
import random

from django.core.management.base import BaseCommand, CommandError

from trivia.questions import runner
from trivia.questions.games import GAME_MODULES
from trivia.questions.storage import StorageConfig, StorageUnavailable, download_players_dataset, s3_client


class Command(BaseCommand):
    help = "Re-materialize, prune, top up and publish the pre-generated game questions."

    def add_arguments(self, parser):
        parser.add_argument("--games", default="", help="comma-separated slugs (default: all)")
        parser.add_argument("--no-publish", action="store_true")
        parser.add_argument("--dry-run", action="store_true", help="run everything, roll back, upload nothing")
        parser.add_argument("--rng-seed", type=int, default=None)

    def handle(self, *args, **opts):
        games = [g.strip() for g in opts["games"].split(",") if g.strip()] or list(GAME_MODULES)
        unknown = [g for g in games if g not in GAME_MODULES]
        if unknown:
            raise CommandError(f"unknown games: {unknown}")
        cfg = StorageConfig.from_env()
        try:
            dataset = download_players_dataset(cfg)
        except StorageUnavailable as e:
            raise CommandError(f"dataset unavailable: {e}")
        self.stdout.write(f"dataset players {dataset.version}: {len(dataset.playable)} playable / {len(dataset.rows)} rows")
        s3 = None if opts["no_publish"] or opts["dry_run"] else s3_client(cfg)
        rng = random.Random(opts["rng_seed"])
        try:
            summary = runner.run(games, publish=not opts["no_publish"], dry_run=opts["dry_run"],
                                 rng=rng, dataset=dataset, s3=s3, cfg=cfg, out=self.stdout.write)
        except runner.BelowMinimum as e:
            raise CommandError(str(e))
        except runner.RunAborted as e:
            raise CommandError(str(e))
        self.stdout.write(self.style.SUCCESS(f"done: {summary}"))
