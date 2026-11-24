"""The database side of the feedback-triage automation (trivia/feedback_triage.py, scripts/feedback/run.mjs).

    python manage.py feedback_triage export --out batch.json [--limit 200]
    python manage.py feedback_triage apply --file applied.json [--dry-run]
"""
import json

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from trivia import feedback_triage


class Command(BaseCommand):
    help = "Export un-triaged feedback for the feedback-triage agent, or apply its verdicts."

    def add_arguments(self, parser):
        parser.add_argument("action", choices=["export", "apply"])
        parser.add_argument("--out")
        parser.add_argument("--file")
        parser.add_argument("--limit", type=int, default=feedback_triage.DEFAULT_LIMIT)
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **opts):
        if opts["action"] == "export":
            batch = feedback_triage.export_batch(limit=opts["limit"])
            text = json.dumps(batch, indent=1, ensure_ascii=False)
            if opts["out"]:
                with open(opts["out"], "w", encoding="utf-8") as f:
                    f.write(text + "\n")
            else:
                self.stdout.write(text)
            self.stderr.write(f"feedback_triage export: {len(batch['items'])} item(s), run {batch['run']}")
            return
        if not opts["file"]:
            raise CommandError("apply needs --file")
        with open(opts["file"], encoding="utf-8") as f:
            doc = json.load(f)
        try:
            with transaction.atomic():
                result = feedback_triage.apply_verdicts(doc)
                if opts["dry_run"]:
                    transaction.set_rollback(True)
        except ValueError as e:
            raise CommandError(str(e))
        for problem in result["problems"]:
            self.stderr.write(problem)
        self.stdout.write(
            f"feedback_triage apply{' (dry run)' if opts['dry_run'] else ''}: "
            f"{result['applied']} applied, {result['skipped']} skipped, {len(result['problems'])} rejected"
        )
        if result["problems"]:
            raise CommandError("some verdicts were rejected")
