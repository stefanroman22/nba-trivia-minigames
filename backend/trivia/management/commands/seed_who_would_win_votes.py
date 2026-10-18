"""Seed Who Would Win matchups with starting votes (owner request, 2026-10-18).

A new matchup shows its community split right after the first vote; with no votes yet the
first players see 100/0. This stores a panel of simulated fan votes per matchup in
Question.quality["seed_votes"] = {"a": n, "b": n} (quality is not part of the checked
content, so no re-check). trivia.games.who_would_win.tally adds them to the real votes.
Seeds are kept apart from real votes on purpose: `--clear` removes them all.

Input file: {"<qid>": {"a": int, "b": int}, ...}. Only who-would-win questions that exist and
are active or pending are touched; each side must be 0-500. Journal kind "editorial".
"""
import json

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from trivia.models import FactoryRun, Question
from trivia.questions.journal import Journal

GAME = "who-would-win"
MAX_SIDE = 500


class Command(BaseCommand):
    help = "Store simulated starting votes on Who Would Win matchups (or --clear them)."

    def add_arguments(self, parser):
        parser.add_argument("file", nargs="?", help="JSON {qid: {a, b}}")
        parser.add_argument("--clear", action="store_true", help="remove every seeded vote")

    def handle(self, *args, **opts):
        if not opts["clear"] and not opts["file"]:
            raise CommandError("give a votes file or --clear")
        journal = Journal("editorial", trigger="manual")
        status = FactoryRun.STATUS_FAILED
        done = skipped = 0
        try:
            with transaction.atomic():
                if opts["clear"]:
                    for q in Question.objects.filter(game=GAME, quality__has_key="seed_votes"):
                        q.quality = {k: v for k, v in (q.quality or {}).items() if k != "seed_votes"}
                        q.save(update_fields=["quality", "updated_at"])
                        journal.log("cleaned", "seed_votes", game=GAME, qid=q.qid)
                        done += 1
                else:
                    with open(opts["file"], encoding="utf-8") as f:
                        votes = json.load(f)
                    if not isinstance(votes, dict):
                        raise CommandError("the votes file must be a JSON object {qid: {a, b}}")
                    rows = {q.qid: q for q in Question.objects.filter(
                        game=GAME, qid__in=list(votes),
                        status__in=(Question.STATUS_ACTIVE, Question.STATUS_PENDING))}
                    for qid, v in votes.items():
                        q = rows.get(qid)
                        ok = isinstance(v, dict) and all(
                            type(v.get(s)) is int and 0 <= v[s] <= MAX_SIDE for s in ("a", "b"))
                        if q is None or not ok:
                            journal.log("rejected", "seed_votes", game=GAME, qid=str(qid)[:48],
                                        problem="unknown or not live" if q is None else "a and b must be ints 0-500")
                            skipped += 1
                            continue
                        q.quality = {**(q.quality or {}), "seed_votes": {"a": v["a"], "b": v["b"]}}
                        q.save(update_fields=["quality", "updated_at"])
                        journal.log("generated", "seed_votes", game=GAME, qid=qid, a=v["a"], b=v["b"])
                        done += 1
            status = FactoryRun.STATUS_OK
        except Exception:
            journal.mark_rolled_back()
            raise
        finally:
            run = journal.save(status)
            self.stdout.write(f"Journal: factory run {run.pk} ({status}, {len(journal.events)} events)")
        self.stdout.write(f"{'cleared' if opts['clear'] else 'seeded'} {done}, skipped {skipped}")
