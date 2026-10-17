"""Apply the editorial author's proposals (spec §4.6).

Job 3 of .github/workflows/editorial-author.yml. Reads <directory>/proposals.json and runs every
proposal through the module gates (trivia.questions.editorial_author.apply_proposals): the
accepted ones become pending questions (created_by "author", at most 5 per game) for the next
daily Checker run, never active. Journal kind "editorial". Writes accepted=N to $GITHUB_OUTPUT.
"""
import os

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from trivia.data_pipeline import publish_v3
from trivia.models import FactoryRun
from trivia.questions.editorial_author import apply_proposals
from trivia.questions.journal import Journal


class Command(BaseCommand):
    help = "Apply the editorial author's proposals as pending questions."

    def add_arguments(self, parser):
        parser.add_argument("directory", help="Folder holding proposals.json")
        parser.add_argument("--trigger", default="manual", choices=("manual", "schedule"))

    def handle(self, *args, **opts):
        journal = Journal("editorial", trigger=opts["trigger"])
        status = FactoryRun.STATUS_FAILED
        summary = None
        try:
            dataset = publish_v3.curated_dataset()
            journal.versions = {"dataset": dataset.version}
            with transaction.atomic():
                summary = apply_proposals(opts["directory"], dataset, journal, timezone.now())
            status = FactoryRun.STATUS_DEGRADED if summary["malformed_file"] else FactoryRun.STATUS_OK
        except Exception:
            journal.mark_rolled_back()
            raise
        finally:
            run = journal.save(status)
            self.stdout.write(f"Journal: factory run {run.pk} ({status}, {len(journal.events)} events)")
        self.stdout.write(f"accepted {summary['accepted']} as pending, rejected {summary['rejected']}")
        if summary["malformed_file"]:
            self.stdout.write(f"::warning::no readable proposals.json (see factory run {run.pk})")
        path = os.environ.get("GITHUB_OUTPUT")
        if path:
            with open(path, "a", encoding="utf-8") as f:
                f.write(f"accepted={summary['accepted']}\n")
