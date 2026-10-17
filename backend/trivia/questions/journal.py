"""In-memory journal of one factory run, persisted as FactoryRun + FactoryEvent.

Events are collected during the run and written by save() AFTER the run's
transaction, so a rolled-back or failed run still leaves its record
(docs/superpowers/specs/2026-10-12-question-factory-design.md §4.8).
"""
import json

from django.db import transaction
from django.utils import timezone

DECISIONS = ("refill_decision", "held_back", "capacity_bound", "saturation")  # a choice, not a DB write


class Journal:
    def __init__(self, kind, trigger=""):
        self.kind = kind
        self.trigger = trigger
        self.started_at = timezone.now()
        self.versions = {}
        self.events = []

    def log(self, action, reason="", game="", qid="", **detail):
        self.events.append({
            "action": action, "reason": reason, "game": game, "qid": qid or "",
            "detail": detail, "created_at": timezone.now(),
        })

    def mark_rolled_back(self, since=0):
        """Flag events from `since` on whose DB writes were rolled back, so every
        reader can tell what actually happened from the events alone. Decisions
        (DECISIONS) wrote nothing, so they are left unflagged."""
        for event in self.events[since:]:
            if event["action"] not in DECISIONS:
                event["detail"]["rolled_back"] = True

    def summary(self):
        out = {}
        for e in self.events:
            if e["game"]:
                per_game = out.setdefault(e["game"], {})
                per_game[e["action"]] = per_game.get(e["action"], 0) + 1
        return out

    def report_md(self, status):
        lines = [f"# {self.kind} run ({self.trigger or 'manual'}): {status}", ""]
        if self.versions:
            lines += ["Versions: " + ", ".join(f"{k} {v}" for k, v in sorted(self.versions.items())), ""]
        for game, counts in sorted(self.summary().items()):
            lines.append(f"- **{game}**: " + ", ".join(f"{a} {n}" for a, n in sorted(counts.items())))
        decisions = [e for e in self.events if e["action"] in DECISIONS]
        if decisions:
            lines += ["", "## Decisions"]
            lines += [f"  - {e['game']} {e['action']}: {e['reason']} "
                      f"{json.dumps(e['detail'], default=str, sort_keys=True)}" for e in decisions]
        return "\n".join(lines)

    def save(self, status):
        from trivia.models import FactoryEvent, FactoryRun

        with transaction.atomic():  # never a run row without its events
            run = FactoryRun.objects.create(
                kind=self.kind, trigger=self.trigger, status=status, started_at=self.started_at,
                finished_at=timezone.now(), versions=self.versions, summary=self.summary(),
                report_md=self.report_md(status),
            )
            FactoryEvent.objects.bulk_create([FactoryEvent(run=run, **e) for e in self.events], batch_size=500)
        return run
