"""Fold raw answers and plays into the anonymous roll-up tables (spec §4.7).

Nightly: GuessLog -> QuestionStats + WrongAnswerStats and GameSession -> GameDailyStats,
above each source's watermark, in batches (trivia.questions.rollup). Journaled as a
FactoryRun of kind "rollup", one `counted` event per batch.
"""
from django.core.management.base import BaseCommand, CommandError

from trivia.models import FactoryRun
from trivia.questions import rollup
from trivia.questions.journal import Journal


class Command(BaseCommand):
    help = "Fold raw answers and plays into the anonymous daily roll-ups."

    def add_arguments(self, parser):
        parser.add_argument("--batch", type=int, default=rollup.BATCH, help="Raw rows per transaction")
        parser.add_argument("--trigger", default="manual", choices=("manual", "schedule"))

    def handle(self, *args, **opts):
        if opts["batch"] < 1:
            raise CommandError("--batch must be at least 1")
        journal = Journal("rollup", trigger=opts["trigger"])
        status = FactoryRun.STATUS_FAILED
        try:
            totals = rollup.run(journal, batch=opts["batch"])
            status = FactoryRun.STATUS_OK
        finally:
            run = journal.save(status)
            self.stdout.write(f"Journal: factory run {run.pk} ({status}, {len(journal.events)} events)")
        self.stdout.write(f"rolled up {totals['answers']} answers, {totals['plays']} plays")
