"""Nightly cleanup of the factory's own tables (spec §4.7).

Compacts retired questions older than 180 days, deletes journal events older than 180 days
and the seen rows of retired questions (trivia.questions.cleanup). Journaled as a FactoryRun
of kind "cleanup": one `compacted` event per game and one `cleaned` event with the counts.
"""
from django.core.management.base import BaseCommand
from django.utils import timezone

from trivia.models import FactoryRun
from trivia.questions import cleanup
from trivia.questions.journal import Journal


class Command(BaseCommand):
    help = "Compact old retired questions and prune old journal events and seen rows."

    def add_arguments(self, parser):
        parser.add_argument("--trigger", default="manual", choices=("manual", "schedule"))

    def handle(self, *args, **opts):
        journal = Journal("cleanup", trigger=opts["trigger"])
        status = FactoryRun.STATUS_FAILED
        try:
            counts = cleanup.run(journal, timezone.now())
            status = FactoryRun.STATUS_OK
        finally:
            run = journal.save(status)
            self.stdout.write(f"Journal: factory run {run.pk} ({status}, {len(journal.events)} events)")
        self.stdout.write(f"compacted {counts['compacted']} questions, deleted {counts['factory_events']} "
                          f"journal events and {counts['seen_questions']} seen rows")
