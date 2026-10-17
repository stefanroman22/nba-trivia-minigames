"""One-time import of the editorial seed files into Question rows (spec §4.6).

fan_favorites_seed.json, who_would_win_seed.json and connections_seed.json become active
fan-favorites / who-would-win / connections questions with their seed qids, created_by
"seed" and quality.checked = {"verdict": "legacy"} (live content the Checker never saw; the
doctor's audits can still pick them). Idempotent by qid: a qid already in the table is left
alone, so a second run imports nothing.

The seed boards keep their hand-written content: a Fan Favorites board becomes an answers
override (no rule), a Connections board keeps its groups (no rules) and its tile order, and a
Who Would Win label is read back into its team-season (who_would_win.side_from_label). Each
imported row is materialized and scored like any question (runner._materialize_row), which
stores its payload_sha; one that does not materialize is retired and journaled.
Journal kind "editorial".
"""
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from trivia.data_pipeline import publish_v3
from trivia.games import connections as connections_pool
from trivia.games import who_would_win as www_pool
from trivia.models import FactoryRun, Question
from trivia.questions import runner, specs
from trivia.questions.base import Invalid
from trivia.questions.games import GAME_MODULES, who_would_win
from trivia.questions.hashing import content_hash
from trivia.questions.journal import Journal
from trivia.utils.fan_favorites import load_seed


def fan_favorites_seeds():
    return [(q["qid"], {"prompt": q["prompt"], "category": q["category"], "answers": q["answers"],
                        "survey_date": q["survey_date"]}) for q in load_seed()]


def who_would_win_seeds():
    """(qid, definition or Invalid) per seed matchup."""
    out = []
    for r in www_pool._load_seed():
        try:
            d = {k: who_would_win.side_from_label(r[k]["label"], r[k]["sub"]) for k in ("a", "b")}
        except Invalid as e:
            d = e
        out.append((r["qid"], d))
    return out


def connections_seeds():
    return [(b["qid"], {"groups": [{"label": g["label"], "difficulty": g["difficulty"], "members": g["members"]}
                                   for g in b["groups"]], "tiles": b["tiles"]})
            for b in connections_pool._load_seed()]


SEEDS = {"fan-favorites": fan_favorites_seeds, "who-would-win": who_would_win_seeds,
         "connections": connections_seeds}


def import_seeds(dataset, journal, now, out):
    """Import every seed not yet in the table; returns {"imported", "skipped", "failed"}."""
    totals = {"imported": 0, "skipped": 0, "failed": 0}
    for slug, seeds in SEEDS.items():
        mod, spec = GAME_MODULES[slug], specs.load(slug)
        qids = set(Question.objects.filter(game=slug).values_list("qid", flat=True))
        hashes = set(Question.objects.filter(game=slug).values_list("content_hash", flat=True))
        counts = {"imported": 0, "skipped": 0, "failed": 0}
        for qid, definition in seeds():
            if qid in qids:
                counts["skipped"] += 1
                continue
            if isinstance(definition, Invalid):
                journal.log("rejected", "unreadable_seed", game=slug, qid=qid, problem=str(definition))
                counts["failed"] += 1
                continue
            h = content_hash(definition)
            if h in hashes:
                journal.log("rejected", "duplicate", game=slug, qid=qid)
                counts["failed"] += 1
                continue
            row = Question(game=slug, qid=qid, definition=definition, content_hash=h, created_by="seed",
                           status=Question.STATUS_ACTIVE, quality={"checked": {"verdict": "legacy"}})
            row.save()
            qids.add(qid)
            hashes.add(h)
            if runner._materialize_row(mod, row, dataset, now, journal, spec=spec) is None:
                counts["failed"] += 1  # retired, journaled as no_longer_valid
                continue
            journal.log("imported", "seed", game=slug, qid=qid)
            counts["imported"] += 1
        out(f"  {slug}: imported {counts['imported']}, already there {counts['skipped']}, failed {counts['failed']}")
        for k, v in counts.items():
            totals[k] += v
    return totals


class Command(BaseCommand):
    help = "Import the Fan Favorites, Who Would Win and Connections seeds as active questions (once)."

    def handle(self, *args, **opts):
        journal = Journal("editorial")
        status = FactoryRun.STATUS_FAILED
        try:
            dataset = publish_v3.curated_dataset(journal=journal)
            journal.versions = {"dataset": dataset.version}
            with transaction.atomic():
                totals = import_seeds(dataset, journal, timezone.now(), self.stdout.write)
            status = FactoryRun.STATUS_DEGRADED if totals["failed"] else FactoryRun.STATUS_OK
        finally:
            run = journal.save(status)
            self.stdout.write(f"Journal: factory run {run.pk} ({status}, {len(journal.events)} events)")
        self.stdout.write(f"imported {totals['imported']} seed questions "
                          f"({totals['skipped']} already there, {totals['failed']} failed)")
