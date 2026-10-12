"""Apply the Checker agent's verdicts (spec §4.12).

Job 3 of .github/workflows/question-checker.yml. Reads every verdicts-*.json under the
given folder, re-validates each verdict in code (trivia.questions.checker_jobs), moves
questions pending -> active / quarantined, and journals every decision with its
claim-by-claim evidence (FactoryRun kind "checker"). Writes approved=N and
games=<comma list> to $GITHUB_OUTPUT so the workflow can trigger a publish.
"""
import os

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from trivia.data_pipeline import publish_v3
from trivia.models import FactoryRun
from trivia.questions import checker
from trivia.questions.checker_jobs import apply_verdicts
from trivia.questions.journal import Journal


class Command(BaseCommand):
    help = "Apply the Checker agent's verdicts to pending questions."

    def add_arguments(self, parser):
        parser.add_argument("directory", help="Folder holding verdicts-*.json files (searched recursively)")
        parser.add_argument("--trigger", default="manual", choices=("manual", "schedule"))

    def handle(self, *args, **opts):
        journal = Journal("checker", trigger=opts["trigger"])
        status = FactoryRun.STATUS_FAILED
        try:
            dataset = publish_v3.curated_dataset()
            journal.versions = {"dataset": dataset.version, "checker": checker.CHECKER_VERSION}
            with transaction.atomic():
                summary = apply_verdicts(opts["directory"], dataset, journal, timezone.now())
            status = FactoryRun.STATUS_DEGRADED if summary["needs_owner"] else FactoryRun.STATUS_OK
        finally:
            run = journal.save(status)
            self.stdout.write(f"Journal: factory run {run.pk} ({status}, {len(journal.events)} events)")
        self.stdout.write(f"approved {summary['approved']}, quarantined {summary['quarantined']}, "
                          f"unsure {summary['unsure']}")
        for item in summary["needs_owner"]:
            self.stdout.write(f"::warning::{item} was unsure twice and needs the owner (see factory run {run.pk})")
        path = os.environ.get("GITHUB_OUTPUT")
        if path:
            with open(path, "a", encoding="utf-8") as f:
                f.write(f"approved={summary['approved']}\n")
                f.write(f"games={','.join(summary['games'])}\n")
