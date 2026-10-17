"""The doctor's nightly signal scan (spec §4.9).

A step of .github/workflows/factory-nightly.yml, after the roll-up and cleanup. Reads the
answer roll-ups and the open problem reports (trivia.questions.doctor), quarantines questions
with a strong signal, queues weak ones for research and, on Thursdays, selects the random
audit. Journaled as a FactoryRun of kind "doctor". Writes quarantined=N to $GITHUB_OUTPUT;
the workflow publishes the staged games whenever N > 0 so quarantined questions leave play.
"""
import os

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from trivia.models import FactoryRun
from trivia.questions import doctor
from trivia.questions.journal import Journal


class Command(BaseCommand):
    help = "Scan answer statistics and problem reports; quarantine or queue questions; pick the weekly audit."

    def add_arguments(self, parser):
        parser.add_argument("--trigger", default="manual", choices=("manual", "schedule"))

    def handle(self, *args, **opts):
        journal = Journal("doctor", trigger=opts["trigger"])
        status = FactoryRun.STATUS_FAILED
        try:
            with transaction.atomic():
                summary = doctor.scan(timezone.now(), journal)
            status = FactoryRun.STATUS_OK
        except Exception:
            journal.mark_rolled_back()
            raise
        finally:
            run = journal.save(status)
            self.stdout.write(f"Journal: factory run {run.pk} ({status}, {len(journal.events)} events)")
        self.stdout.write(f"quarantined {summary['quarantined']}, flagged {summary['flagged']}, "
                          f"audit selected {summary['audit_selected']}")
        path = os.environ.get("GITHUB_OUTPUT")
        if path:
            with open(path, "a", encoding="utf-8") as f:
                f.write(f"quarantined={summary['quarantined']}\n")
