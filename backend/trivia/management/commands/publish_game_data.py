import json
import os

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from trivia.data_pipeline.publish import build_publish_plan, upload_plan


def _data_dir():
    return getattr(
        settings, "GAME_DATA_DIR", os.path.join(settings.BASE_DIR, "trivia", "data")
    )


class Command(BaseCommand):
    help = "Publish the versioned game data in GAME_DATA_DIR to Cloudflare R2 (S3 API)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Print the upload plan without contacting R2 (no credentials needed).",
        )

    def handle(self, *args, **opts):
        data_dir = _data_dir()
        local_manifest = os.path.join(data_dir, "manifest.json")
        if not os.path.exists(local_manifest):
            raise CommandError(
                "No manifest in data dir; run `manage.py refresh_game_data` first."
            )
        with open(local_manifest, "r", encoding="utf-8") as f:
            version = json.load(f)["version"]

        public_base = os.environ.get("R2_PUBLIC_BASE_URL")
        if not public_base:
            raise CommandError("R2_PUBLIC_BASE_URL is not set.")
        plan = build_publish_plan(data_dir, version, public_base)

        if opts["dry_run"]:
            for obj in plan["objects"]:
                self.stdout.write(f"PUT {obj['key']}  ({obj['cache_control']})")
            self.stdout.write(
                f"PUT {plan['manifest_key']}  ({plan['manifest_cache']})"
            )
            self.stdout.write(
                self.style.SUCCESS(
                    f"Dry run: {len(plan['objects']) + 1} objects for version {version}"
                )
            )
            return

        required = ["R2_ACCOUNT_ID", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]
        missing = [k for k in required if not os.environ.get(k)]
        if missing:
            raise CommandError(f"Missing R2 env vars: {', '.join(missing)}")

        import boto3  # lazy: only needed for a real upload (see requirements-publish.txt)

        client = boto3.client(
            "s3",
            endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
            aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
            aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
            region_name="auto",
        )
        written = upload_plan(plan, client, os.environ["R2_BUCKET"])
        self.stdout.write(
            self.style.SUCCESS(f"Published {len(written)} objects for version {version}")
        )
