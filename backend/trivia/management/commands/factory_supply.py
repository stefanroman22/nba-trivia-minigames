"""Top up question games without publishing (owner-run bulk supply).

Runs the same question maintenance as the weekly publish (trivia.questions.runner.maintain,
stage=True: every new or changed question is `pending` until the Checker approves it) for the
given games, `--rounds` times, each round in its own transaction, and stops early once a round
adds nothing. Nothing is built or published: the next publish ships what the Checker approved.
Journal kind "supply" (one run per round).
"""
import random

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from trivia.data_pipeline import publish_v3
from trivia.models import FactoryRun
from trivia.questions import fame, runner
from trivia.questions.games import GAME_MODULES
from trivia.questions.journal import Journal


class Command(BaseCommand):
    help = "Generate pending questions for the given games (no publish)."

    def add_arguments(self, parser):
        parser.add_argument("--games", required=True, help="comma-separated question game slugs")
        parser.add_argument("--rounds", type=int, default=1, help="maintenance rounds (each adds up to max_new_per_run)")
        parser.add_argument("--rng-seed", type=int, default=None)
        parser.add_argument("--trigger", default="manual", choices=("manual", "schedule"))

    def handle(self, *args, **opts):
        games = [g.strip() for g in opts["games"].split(",") if g.strip()]
        unknown = [g for g in games if g not in GAME_MODULES]
        if unknown:
            raise CommandError(f"unknown games: {unknown}")
        dataset = publish_v3.curated_dataset()
        self.stdout.write(f"dataset {dataset.version}: {len(dataset.playable)} playable players")
        rng = random.Random(opts["rng_seed"])
        for n in range(1, max(1, opts["rounds"]) + 1):
            journal = Journal("supply", trigger=opts["trigger"])
            journal.versions = {"dataset": dataset.version, "fame": fame.VERSION}
            status = FactoryRun.STATUS_FAILED
            stats = {}
            try:
                with transaction.atomic():
                    _, stats = runner.maintain(games, dataset, rng, out=self.stdout.write, isolate=True,
                                               journal=journal, stage=True)
                status = FactoryRun.STATUS_DEGRADED if any("held_back" in s for s in stats.values()) \
                    else FactoryRun.STATUS_OK
            except Exception:
                journal.mark_rolled_back()
                raise
            finally:
                run = journal.save(status)
                self.stdout.write(f"round {n}: factory run {run.pk} ({status}, {len(journal.events)} events)")
            added = sum(int((s or {}).get("added", 0) or 0) for s in stats.values())
            self.stdout.write(f"round {n}: added {added} pending ({stats})")
            if not added:
                break
