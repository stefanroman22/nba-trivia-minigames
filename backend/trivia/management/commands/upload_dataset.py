"""Home-PC step after generate_players_curated: put the dataset in Storage."""
import json
import os

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from trivia.data_pipeline.publish import upload_plan
from trivia.questions.storage import StorageConfig, s3_client
from trivia.questions.upload import build_dataset_plan

DEFAULT_PATH = os.path.join(settings.BASE_DIR, "trivia", "data_static", "players_curated.json")
MANIFEST = os.path.join(settings.BASE_DIR, "trivia", "data", "manifest.json")


class Command(BaseCommand):
    help = "Upload players_curated.json to Supabase Storage and point datasets/manifest.json at it."

    def add_arguments(self, parser):
        parser.add_argument("--path", default=DEFAULT_PATH)
        parser.add_argument("--dataset-version", default=None, help="default: trivia/data/manifest.json version")
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **opts):
        version = opts["dataset_version"]
        if not version:
            with open(MANIFEST, encoding="utf-8") as f:
                version = json.load(f)["version"]
        cfg = StorageConfig.from_env()
        plan = build_dataset_plan(opts["path"], version, cfg.public_base)
        if opts["dry_run"]:
            for o in plan["objects"]:
                self.stdout.write(f"PUT {o['key']}")
            self.stdout.write(f"PUT {plan['manifest_key']}")
            return
        if not os.path.exists(opts["path"]):
            raise CommandError(f"{opts['path']} not found")
        upload_plan(plan, s3_client(cfg), cfg.bucket)
        self.stdout.write(self.style.SUCCESS(f"uploaded players dataset {version}"))
