"""Tic-Tac-Toe difficulty (trivia.questions.games.tictactoe_difficulty): label boards by the owner's rules, and
generate easy, medium and hard boards.

    python manage.py tictactoe_difficulty --label-rules [--dry-run]
        Every active board the owner has not labeled gets the rule's label and reason (hard for a hard column, medium
        when its columns are medium or easy and all 9 pairs pass the medium rule, easy when every column is easy and
        all 9 pairs pass the easy rule). An owner label is never touched.
    python manage.py tictactoe_difficulty --generate-easy 1000 [--generate-medium 1000] [--generate-hard 200]
                                          [--status pending|active] [--seed 7] [--dry-run]
        New boards from the pair library, stored as Question rows (created_by "<band>-rules", status pending by
        default so the question factory's Checker sees them before players do) with that band as a rule label.
"""
import random
import re

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from trivia.admin_questions import _dataset
from trivia.models import Question, QuestionLabel
from trivia.questions import quality, specs
from trivia.questions.base import Invalid
from trivia.questions.games import tictactoe as ttt
from trivia.questions.games import tictactoe_difficulty as rules
from trivia.questions.hashing import content_hash

GAME = "tictactoe"


class Command(BaseCommand):
    help = "Label Tic-Tac-Toe boards by the difficulty rules, and generate easy, medium and hard boards."

    def add_arguments(self, parser):
        parser.add_argument("--label-rules", action="store_true")
        for band in rules.GENERATORS:
            parser.add_argument(f"--generate-{band}", type=int, default=0, metavar="N")
        parser.add_argument("--status", choices=[Question.STATUS_PENDING, Question.STATUS_ACTIVE], default=Question.STATUS_PENDING)
        parser.add_argument("--seed", type=int, default=None)
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **o):
        bands = [b for b in rules.GENERATORS if o[f"generate_{b}"]]
        if not o["label_rules"] and not bands:
            raise CommandError("nothing to do: pass --label-rules and/or --generate-easy|medium|hard N")
        dataset = _dataset()
        if not dataset.playable:
            raise CommandError("the player dataset is empty")
        for band in bands:
            self._generate(dataset, band, o[f"generate_{band}"], o["status"], o["seed"], o["dry_run"])
        if o["label_rules"]:
            self._label(dataset, o["dry_run"])

    def _label(self, dataset, dry_run):
        counts = {"hard": 0, "medium": 0, "easy": 0, "none": 0, "owner": 0}
        for q in Question.objects.filter(game=GAME, status=Question.STATUS_ACTIVE).select_related("label"):
            lab = getattr(q, "label", None)
            if lab is not None and lab.source == QuestionLabel.OWNER:
                counts["owner"] += 1
                continue
            band, reason = rules.classify(q.definition, dataset)
            counts[band or "none"] += 1
            if band and not dry_run:
                QuestionLabel.objects.update_or_create(
                    question=q, defaults={"difficulty": band, "source": QuestionLabel.RULE, "reason": reason, "labeled_by": None}
                )
        self.stdout.write(f"label-rules{' (dry run)' if dry_run else ''}: hard {counts['hard']} · medium {counts['medium']} · "
                          f"easy {counts['easy']} · neither {counts['none']} · owner labels kept {counts['owner']}")

    def _generate(self, dataset, band, n, status, seed, dry_run):
        existing = list(Question.objects.filter(game=GAME).values_list("definition", "content_hash", "qid"))
        hashes = {h for _, h, _ in existing}
        dup_keys = {"|".join(sorted(f"{c['type']}:{c['value']}" for c in (d.get("rows") or []) + (d.get("cols") or []))) for d, _, _ in existing}
        seqs = [int(m.group(1)) for _, _, qid in existing if (m := re.fullmatch(r"ttt-(\d+)", qid or ""))]
        seq = max(seqs, default=0)
        boards = rules.GENERATORS[band](dataset, hashes, dup_keys, random.Random(seed), n)
        spec = specs.load(GAME)
        made = skipped = 0
        with transaction.atomic():
            for d in boards:
                try:
                    m = ttt.materialize(d, dataset)
                except Invalid as e:
                    skipped += 1
                    self.stdout.write(f"skip: {e}")
                    continue
                got, reason = rules.classify(d, dataset)
                if got != band:
                    skipped += 1
                    continue
                seq += 1
                if dry_run:
                    made += 1
                    continue
                q = Question.objects.create(
                    game=GAME, qid=ttt.qid_for(d, seq), definition=d, content_hash=content_hash(d), status=status,
                    quality=quality.score(ttt, m, dataset, spec, d), players_referenced=ttt.players_referenced(d, m),
                    dataset_version=dataset.version or "", created_by=f"{band}-rules",
                )
                QuestionLabel.objects.create(question=q, difficulty=band, source=QuestionLabel.RULE, reason=reason)
                made += 1
        self.stdout.write(f"generate-{band}{' (dry run)' if dry_run else ''}: {made} {band} board(s) as {status} · {skipped} skipped")
