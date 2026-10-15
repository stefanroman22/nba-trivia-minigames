"""Factory health check: reads the run journal and the question table and names
what is off, so a silent failure (the Checker checked nothing on 2026-10-13/14
because of a token bug) reaches Slack the next night (spec §5). Wrapped by the
factory_health command; read-only.
"""
from datetime import timedelta

from trivia.models import FactoryEvent, FactoryRun, Question
from trivia.questions import checker

CHECKER_WINDOW = timedelta(hours=36)
NEEDS_OWNER_WINDOW = timedelta(days=7)
BACKLOG = 300
CHECKED = ("approved", "quarantined", "unsure")  # events that prove the Checker judged something
MAX_LISTED = 10


def _pending():
    return Question.objects.filter(game__in=checker.STAGED_GAMES, status=Question.STATUS_PENDING)


def _newest(kind):
    return FactoryRun.objects.filter(kind=kind).order_by("-started_at", "-id").first()


def _finding(code, severity, text):
    return {"code": code, "severity": severity, "text": text}


def _checker(now, pending):
    run = FactoryRun.objects.filter(kind="checker", started_at__gte=now - CHECKER_WINDOW) \
        .order_by("-started_at", "-id").first()
    if run is None:
        if pending:
            return [_finding("checker_missing", "error",
                             f"no Checker run in the last 36 h while {pending} question(s) are pending")]
        return []
    if run.events.filter(action__in=CHECKED).exists():
        return []
    # A question the Checker never touched is still pending, so "pending now and created
    # before the run started" is what was waiting for it.
    waiting = _pending().filter(created_at__lt=run.started_at).count()
    if not waiting:
        return []
    return [_finding("checker_idle", "error",
                     f"the Checker run of {run.started_at:%Y-%m-%d %H:%M} UTC (factory run {run.pk}) checked "
                     f"nothing while {waiting} question(s) were pending")]


def _held_back():
    run = _newest("supply")
    if run is None:
        return []
    games = sorted(set(run.events.filter(action="held_back").values_list("game", flat=True)))
    if not games:
        return []
    return [_finding("held_back", "warn",
                     f"the supply run of {run.started_at:%Y-%m-%d} (factory run {run.pk}) held back: "
                     + ", ".join(games))]


def _refresh():
    run = _newest("refresh")
    if run is None or run.status != FactoryRun.STATUS_FAILED:
        return []
    return [_finding("refresh_failed", "error",
                     f"the data refresh of {run.started_at:%Y-%m-%d} (factory run {run.pk}) failed")]


def _needs_owner(now):
    events = FactoryEvent.objects.filter(action="needs_owner", created_at__gte=now - NEEDS_OWNER_WINDOW) \
        .order_by("created_at", "id")
    keys = list(dict.fromkeys((e.game, e.qid) for e in events))
    # needs_owner is only logged for a pending question; any move off pending is the owner's answer.
    waiting = [f"{game}/{qid}" for game, qid in keys
               if Question.objects.filter(game=game, qid=qid, status=Question.STATUS_PENDING).exists()]
    if not waiting:
        return []
    listed = ", ".join(waiting[:MAX_LISTED]) + (f" and {len(waiting) - MAX_LISTED} more"
                                                if len(waiting) > MAX_LISTED else "")
    return [_finding("needs_owner", "warn", f"{len(waiting)} question(s) need the owner: {listed}")]


def check(now):
    """[{"code", "severity": "warn"|"error", "text"}], errors first; empty when all is well."""
    pending = _pending().count()
    findings = _checker(now, pending) + _held_back() + _refresh()
    if pending > BACKLOG:
        findings.append(_finding("backlog", "warn", f"{pending} questions are pending (more than {BACKLOG})"))
    findings += _needs_owner(now)
    return sorted(findings, key=lambda f: f["severity"] != "error")
