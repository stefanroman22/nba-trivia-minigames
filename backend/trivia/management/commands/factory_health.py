"""Report what is off in the question factory (trivia.questions.health).

Run nightly. Prints one line per finding. With --slack, stdout holds only the
message for `node scripts/slack.mjs post-text backend -` (one block headed
"Factory health —"), and nothing when all is well, so the workflow posts only
then. Always exits 0 on findings; journals a FactoryRun kind "health" with one
event per finding.
"""
from django.core.management.base import BaseCommand
from django.utils import timezone

from trivia.models import FactoryRun
from trivia.questions import health
from trivia.questions.journal import Journal

ICONS = {"error": ":red_circle:", "warn": ":warning:"}


class Command(BaseCommand):
    help = "Check the question factory's journal and backlog; print (or shape for Slack) what is off."

    def add_arguments(self, parser):
        parser.add_argument("--slack", action="store_true",
                            help="Write one Slack block to stdout (empty when all is well)")

    def handle(self, *args, **opts):
        journal = Journal("health")
        status = FactoryRun.STATUS_FAILED
        try:
            findings = health.check(timezone.now())
            for f in findings:
                journal.log("finding", f["code"], severity=f["severity"], text=f["text"])
            status = FactoryRun.STATUS_DEGRADED if findings else FactoryRun.STATUS_OK
        finally:
            run = journal.save(status)
            # Never on stdout under --slack: it would become part of the Slack message.
            (self.stderr if opts["slack"] else self.stdout).write(
                f"Journal: factory run {run.pk} ({status}, {len(journal.events)} events)")
        if opts["slack"]:
            if findings:
                lines = [f"Factory health — {len(findings)} problem(s)"]
                lines += [f"{ICONS[f['severity']]} {f['code']}: {f['text']}" for f in findings]
                self.stdout.write("\n".join(lines))
            return
        for f in findings:
            self.stdout.write(f"[{f['severity']}] {f['code']}: {f['text']}")
        if not findings:
            self.stdout.write("Factory health: all clear")
