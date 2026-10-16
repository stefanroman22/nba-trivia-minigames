"""Apply the Checker agent's verdicts (spec §4.12).

Job 3 of .github/workflows/question-checker.yml. Reads every verdicts-*.json under the
given folder, re-validates each verdict in code (trivia.questions.checker_jobs), moves
questions pending -> active / quarantined (and, for the random audit, live questions
due for it stay active or go quarantined; the doctor's proposed data corrections go active
or rejected), and journals every decision with its claim-by-claim evidence (FactoryRun kind
"checker"). Writes approved=N, changed=N (approved + quarantined + corrections confirmed)
and games=<comma list> to $GITHUB_OUTPUT; the workflow publishes whenever changed > 0.
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
        if summary["audited"]:
            self.stdout.write(f"audit passed {summary['audited']}")
        if summary["corrections_confirmed"] or summary["corrections_rejected"]:
            self.stdout.write(f"corrections confirmed {summary['corrections_confirmed']}, "
                              f"rejected {summary['corrections_rejected']}")
        for item in summary["needs_owner"]:
            self.stdout.write(f"::warning::{item} was unsure twice and needs the owner (see factory run {run.pk})")
        path = os.environ.get("GITHUB_OUTPUT")
        if path:
            with open(path, "a", encoding="utf-8") as f:
                f.write(f"approved={summary['approved']}\n")
                # Anything that changes what is (or may be) live: approvals go live, a
                # quarantine must leave production, and a confirmed correction changes the
                # dataset (the publish's maintenance re-stages the live questions it touches).
                # Publishing is a no-op when nothing differs.
                changed = summary["approved"] + summary["quarantined"] + summary["corrections_confirmed"]
                f.write(f"changed={changed}\n")
                f.write(f"games={','.join(summary['games'])}\n")
