"""Apply the doctor agent's research verdicts (spec §4.9).

Job 3 of .github/workflows/doctor-research.yml. Reads every verdict-*.json under the given
folder, re-validates each in code (trivia.questions.doctor_verdicts): proposes sourced data
corrections for the Checker, rebands, retires or releases questions (back to pending, never
active), and journals every decision (FactoryRun kind "doctor"). Writes proposed=N (data
corrections waiting for the Checker) and changed=N (live questions retired) to $GITHUB_OUTPUT.
"""
import os

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from trivia.data_pipeline import publish_v3
from trivia.models import DataCorrection, FactoryRun
from trivia.questions.doctor_verdicts import apply_verdicts
from trivia.questions.journal import Journal


class Command(BaseCommand):
    help = "Apply the doctor agent's verdicts to quarantined and queued questions."

    def add_arguments(self, parser):
        parser.add_argument("directory", help="Folder holding verdict-*.json files (searched recursively)")
        parser.add_argument("--trigger", default="manual", choices=("manual", "schedule"))

    def handle(self, *args, **opts):
        journal = Journal("doctor", trigger=opts["trigger"])
        status = FactoryRun.STATUS_FAILED
        summary = None
        try:
            dataset = publish_v3.curated_dataset()
            journal.versions = {"dataset": dataset.version}
            with transaction.atomic():
                summary = apply_verdicts(opts["directory"], dataset, journal, timezone.now())
            status = FactoryRun.STATUS_DEGRADED if summary["needs_owner"] else FactoryRun.STATUS_OK
        except Exception:
            journal.mark_rolled_back()
            raise
        finally:
            run = journal.save(status)
            if summary is not None and summary["proposed"]:
                DataCorrection.objects.filter(pk__in=summary["proposed"]).update(run=run)
            self.stdout.write(f"Journal: factory run {run.pk} ({status}, {len(journal.events)} events)")
        self.stdout.write(f"corrections proposed {len(summary['proposed'])}, released {summary['released']}, "
                          f"retired {summary['retired']}")
        for item in summary["needs_owner"]:
            self.stdout.write(f"::warning::{item} needs the owner (see factory run {run.pk})")
        path = os.environ.get("GITHUB_OUTPUT")
        if path:
            with open(path, "a", encoding="utf-8") as f:
                f.write(f"proposed={len(summary['proposed'])}\n")
                f.write(f"changed={summary['changed']}\n")
