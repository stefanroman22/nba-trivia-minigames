"""Write the fortnightly factory digest (spec §4.8, improvement loop step 1).

Job 2 of .github/workflows/factory-review.yml. Needs DATABASE_URL; calls no model and no
website. Reads the run journal (FactoryRun/FactoryEvent), the questions table and the roll-ups
of the last --days days and writes <out>/digest.md (for the review agent) and
<out>/digest.json (the same numbers). Read-only, like the other export commands: it writes
no journal. A KPI without data is "no data" in the markdown and null in the JSON, never 0.

KPIs (the §4.8 table) and how they are counted, over the runs started in the window:
    checker miss rate      questions found wrong after the Checker approved them (checker_miss
                           events of the audit, plus doctor `retired` questions that carry
                           quality.checked) / the Checker's approvals in the window
    unsure share           Checker `unsure` / every question verdict (approved, quarantined,
                           unsure, audit_passed)
    pending -> active      median hours from a question's last generated / staged_for_recheck /
                           released / rebanded event (else its created_at) to its approval
    audit error rate       audit verdicts that quarantined a live question / all audit verdicts
    live questions         `quarantined` events of doctor runs and of the audit (detail.audit) /
    quarantined per week   (days / 7); the Checker rejecting a pending question does not count
    false-alarm share      the doctor's false_alarm releases / the questions it resolved
                           (released, rebanded, retired, correction_proposed)
    runway per game        live questions / daily use (trivia.questions.demand's 14-day window
                           and rounds per play); Contexto: live days scheduled from today
    calibration            trivia.questions.calibration, per game with a solve rate
    coverage gaps          empty coverage cells in each game's newest gap_report
    held back              held_back events in supply runs (target 0 per run)
"""
import datetime
import json
import os
from collections import Counter, defaultdict
from statistics import median

from django.core.management.base import BaseCommand
from django.db import connection
from django.db.models import Q, Sum
from django.utils import timezone

from trivia.models import FactoryEvent, FactoryRun, GameDailyStats, Question
from trivia.questions import calibration, checker, demand, doctor, health

START_ACTIONS = ("generated", "staged_for_recheck", "released", "rebanded")  # a question (re)enters pending
RESOLVED = ("released", "rebanded", "retired", "correction_proposed")  # doctor research outcomes


def _rate(n, d):
    return n / d if d else None


def _events(since, **filters):
    return FactoryEvent.objects.filter(run__started_at__gte=since, **filters)


def _questions(keys, *fields):
    """{(game, qid): {field: value}} for the (game, qid) pairs in `keys`, in one query."""
    keys = set(keys)
    if not keys:
        return {}
    rows = Question.objects.filter(qid__in={qid for _, qid in keys}).values("game", "qid", *fields)
    return {(r["game"], r["qid"]): r for r in rows if (r["game"], r["qid"]) in keys}


def _checker(since):
    events = list(_events(since, run__kind="checker").exclude(game="")
                  .values("action", "game", "qid", "detail", "created_at"))
    count = Counter(e["action"] for e in events)
    audit_bad = sum(1 for e in events if e["action"] == "quarantined" and (e["detail"] or {}).get("audit"))
    approved = [e for e in events if e["action"] == "approved"]
    misses = {(e["game"], e["qid"]) for e in events if e["action"] == "checker_miss"}
    retired = {(e["game"], e["qid"]) for e in _events(since, run__kind="doctor", action="retired").values("game", "qid")}
    for key, row in _questions(retired, "quality").items():
        if (row["quality"] or {}).get("checked"):
            misses.add(key)
    verdicts = count["approved"] + count["quarantined"] + count["unsure"] + count["audit_passed"]
    audits = audit_bad + count["audit_passed"]
    return {
        "checker_approved": len(approved), "checker_misses": len(misses),
        "checker_miss_rate": _rate(len(misses), len(approved)),
        "checker_verdicts": verdicts, "unsure": count["unsure"], "unsure_share": _rate(count["unsure"], verdicts),
        "median_pending_to_active_h": _pending_to_active(approved),
        "audits": audits, "audit_errors": audit_bad, "audit_error_rate": _rate(audit_bad, audits),
    }


def _pending_to_active(approved):
    if not approved:
        return None
    starts = defaultdict(list)
    for e in FactoryEvent.objects.filter(action__in=START_ACTIONS, qid__in={a["qid"] for a in approved}) \
            .values("game", "qid", "created_at"):
        starts[(e["game"], e["qid"])].append(e["created_at"])
    created = _questions({(a["game"], a["qid"]) for a in approved}, "created_at")
    hours = []
    for a in approved:
        key = (a["game"], a["qid"])
        before = [t for t in starts.get(key, []) if t <= a["created_at"]]
        if before:
            start = max(before)
        elif key in created:
            start = created[key]["created_at"]
        else:
            continue
        hours.append((a["created_at"] - start).total_seconds() / 3600)
    return round(median(hours), 1) if hours else None


def _doctor(since, days):
    # Live questions only: the doctor's quarantines and the audit's, not the Checker rejecting pending ones.
    quarantined = _events(since, action="quarantined").filter(Q(run__kind="doctor") | Q(detail__audit=True)).count()
    resolved = list(_events(since, run__kind="doctor", action__in=RESOLVED).values("action", "reason", "game", "qid"))
    false_alarms = {(e["game"], e["qid"]) for e in resolved if e["action"] == "released" and e["reason"] == "false_alarm"}
    questions = {(e["game"], e["qid"]) for e in resolved}
    watched = FactoryRun.objects.filter(kind__in=("doctor", "checker"), started_at__gte=since).exists()
    return {"quarantined": quarantined,
            "quarantined_per_week": round(quarantined / (days / 7), 2) if watched else None,
            "false_alarms": len(false_alarms), "doctor_resolved": len(questions),
            "false_alarm_share": _rate(len(false_alarms), len(questions))}


def _runway(now):
    today = now.date()
    out = {}
    for slug in checker.STAGED_GAMES:
        target = demand._runway_days(slug)
        active = Question.objects.filter(game=slug, status=Question.STATUS_ACTIVE)
        if slug in demand.DAYS_AHEAD:  # live days scheduled from today
            days = sum(1 for d in active.values_list("definition", flat=True)
                       if isinstance(d, dict) and str(d.get("day", "")) >= today.isoformat())
            out[slug] = {"mode": "days_ahead", "active": active.count(), "days": float(days), "target_days": target,
                         "ok": days >= target}
            continue
        plays = GameDailyStats.objects.filter(
            game=slug, day__gte=today - datetime.timedelta(days=demand.WINDOW_DAYS), day__lt=today,
        ).aggregate(n=Sum("plays"))["n"]
        n = active.count()
        daily_use = plays / demand.WINDOW_DAYS * demand.ROUNDS_PER_PLAY.get(slug, 1) if plays else None
        days = round(n / daily_use, 1) if daily_use else None
        out[slug] = {"mode": "demand", "active": n, "plays_14d": plays, "daily_use": daily_use and round(daily_use, 3),
                     "days": days, "target_days": target, "ok": None if days is None else days >= target}
    return out


def _calibration(days, now):
    out = {}
    for slug in checker.STAGED_GAMES:
        if slug in doctor.VOTE_GAMES:  # a vote has no right answer, so no solve rate
            continue
        measured = calibration.band_solve_rates(slug, days, now)
        mono = calibration.monotonic(measured["rates"])
        enough = measured["answers"] >= calibration.MIN_ANSWERS
        out[slug] = {"answers": measured["answers"], "rates": measured["rates"], "players": measured["players"],
                     "monotonic": mono, "ok": (mono is not False) if enough else None,
                     "current": calibration.current_bands(slug),
                     "proposal": calibration.propose_band_edges(slug, days, now, measured=measured)}
    return out


def _coverage(since):
    out = {}
    events = _events(since, action="gap_report").order_by("run__started_at", "id").values("game", "detail")
    for e in events:
        empty = len((e["detail"] or {}).get("empty_cells") or [])
        entry = out.setdefault(e["game"], {"first": empty})
        entry["empty_cells"] = empty
        entry["trend"] = empty - entry["first"]
    return out


def _supply(since):
    runs = list(FactoryRun.objects.filter(kind="supply", started_at__gte=since).values_list("id", flat=True))
    held = list(_events(since, run__kind="supply", action="held_back").values("run_id", "game"))
    per_run = Counter(e["run_id"] for e in held)
    return {"supply_runs": len(runs), "held_back": len(held),
            "held_back_max_per_run": max(per_run.values()) if held else 0,
            "held_back_games": sorted({e["game"] for e in held})}


def _runs(since):
    out = {}
    for run in FactoryRun.objects.filter(started_at__gte=since).order_by("kind", "started_at"):
        entry = out.setdefault(run.kind, {"count": 0, "statuses": Counter(), "durations": []})
        entry["count"] += 1
        entry["statuses"][run.status] += 1
        entry["durations"].append(int((run.finished_at - run.started_at).total_seconds()))
    return {kind: {"count": e["count"], "statuses": dict(e["statuses"]), "median_s": int(median(e["durations"])),
                   "max_s": max(e["durations"])} for kind, e in out.items()}


def _db_size():
    if connection.vendor != "postgresql":
        return None
    with connection.cursor() as cur:
        cur.execute("SELECT pg_database_size(current_database())")
        return cur.fetchone()[0]


def build(days, now=None):
    now = now or timezone.now()
    since = now - datetime.timedelta(days=days)
    kpis = {**_checker(since), **_doctor(since, days), **_supply(since), "db_size_bytes": _db_size()}
    rejections = Counter(_events(since, action="rejected").values_list("reason", flat=True))
    return {
        "window": {"days": days, "from": since.isoformat(), "to": now.isoformat()},
        "kpis": kpis,
        "runway": _runway(now),
        "calibration": _calibration(days, now),
        "coverage": _coverage(since),
        "capacity_bound": sorted(set(_events(since, action="capacity_bound").values_list("game", flat=True))),
        "saturated": sorted(set(_events(since, action="saturation").values_list("game", flat=True))),
        "rejections": dict(sorted(rejections.items(), key=lambda kv: (-kv[1], kv[0]))),
        "runs": _runs(since),
        "health": health.check(now),
    }


# ------------------------------------------------------------------ markdown

NO_DATA = "no data"


def _pct(x):
    return NO_DATA if x is None else f"{x * 100:.2f}%"


def _status(ok):
    return NO_DATA if ok is None else ("ok" if ok else "MISS")


def _below(x, limit):
    return None if x is None else x < limit


def render(d):
    k, w = d["kpis"], d["window"]
    runway, cal = d["runway"], d["calibration"]
    short = [g for g, r in runway.items() if r["ok"] is False]
    runway_ok = None if all(r["ok"] is None for r in runway.values()) else not short
    cal_ok = None if all(c["ok"] is None for c in cal.values()) else all(c["ok"] is not False for c in cal.values())
    coverage = d["coverage"]
    size = NO_DATA if k["db_size_bytes"] is None else f"{k['db_size_bytes'] / 1e6:.1f} MB"
    lines = [
        f"# Factory digest: {w['from'][:10]} to {w['to'][:10]} ({w['days']} days)", "",
        "Built by `manage.py factory_digest` from the run journal and the answer roll-ups.", "",
        "## KPIs", "",
        "| KPI | Value | Target | Status |", "|---|---|---|---|",
        f"| Audit error rate | {_pct(k['audit_error_rate'])} ({k['audit_errors']} of {k['audits']} audits) | < 1% "
        f"| {_status(_below(k['audit_error_rate'], 0.01))} |",
        f"| Checker miss rate | {_pct(k['checker_miss_rate'])} ({k['checker_misses']} misses, "
        f"{k['checker_approved']} approved) | < 0.5% | {_status(_below(k['checker_miss_rate'], 0.005))} |",
        f"| Checker unsure share | {_pct(k['unsure_share'])} ({k['unsure']} of {k['checker_verdicts']} verdicts) "
        f"| < 10% | {_status(_below(k['unsure_share'], 0.10))} |",
        f"| Median pending -> active | "
        f"{NO_DATA if k['median_pending_to_active_h'] is None else str(k['median_pending_to_active_h']) + ' h'} "
        f"| tracked | tracked |",
        f"| Live questions quarantined per week | "
        f"{NO_DATA if k['quarantined_per_week'] is None else k['quarantined_per_week']} "
        f"({k['quarantined']} in the window) | tracked | tracked |",
        f"| False-alarm share | {_pct(k['false_alarm_share'])} ({k['false_alarms']} of {k['doctor_resolved']} "
        f"resolved) | < 30% | {_status(_below(k['false_alarm_share'], 0.30))} |",
        f"| Runway per game | {', '.join(short) + ' short' if short else ('all at target' if runway_ok else NO_DATA)} "
        f"| >= spec runway_days | {_status(runway_ok)} |",
        f"| Difficulty calibration | "
        f"{', '.join(g for g, c in cal.items() if c['ok'] is False) or ('monotonic' if cal_ok else NO_DATA)} "
        f"| monotonic, games with >= {calibration.MIN_ANSWERS} answers | {_status(cal_ok)} |",
        f"| Coverage cells empty | "
        f"{sum(c['empty_cells'] for c in coverage.values()) if coverage else NO_DATA} | trending down | tracked |",
        f"| Held-back games per run | {k['held_back_max_per_run'] if k['supply_runs'] else NO_DATA} "
        f"({k['held_back']} in {k['supply_runs']} supply runs) | 0 "
        f"| {_status(None if not k['supply_runs'] else k['held_back'] == 0)} |",
        f"| Database size | {size} | tracked | tracked |",
        "", "## Runway per game", "",
        "| Game | Live | Plays (14 d) | Days of runway | Target days | Status |", "|---|---|---|---|---|---|",
    ]
    for game, r in runway.items():
        days = NO_DATA if r["days"] is None else (f"{r['days']:g} days ahead" if r["mode"] == "days_ahead"
                                                  else f"{r['days']:g}")
        lines.append(f"| {game} | {r['active']} | {r.get('plays_14d') or '-'} | {days} | {r['target_days']} "
                     f"| {_status(r['ok'])} |")
    lines += ["", "## Difficulty calibration", "",
              f"Solve rate per band over active questions (correct / players). A game is judged once it has "
              f">= {calibration.MIN_ANSWERS} answers in the window.", "",
              "| Game | Answers | Easy | Medium | Hard | Monotonic | Status |", "|---|---|---|---|---|---|---|"]
    for game, c in cal.items():
        rates = " | ".join(_pct(c["rates"][b]) for b in calibration.LEVELS)
        mono = NO_DATA if c["monotonic"] is None else ("yes" if c["monotonic"] else "no")
        lines.append(f"| {game} | {c['answers']} | {rates} | {mono} | {_status(c['ok'])} |")
    proposals = {g: c for g, c in cal.items() if c["proposal"]}
    lines += ["", "### Calibration proposals", ""]
    if not proposals:
        lines.append("None.")
    for game, c in proposals.items():
        lines += [f"- **{game}** (`backend/trivia/questions/specs/{game}.json`): current "
                  f"`{json.dumps(c['current'])}`; proposed difficulty.bands:", "",
                  "  ```json", f"  {json.dumps(c['proposal'])}", "  ```", ""]
    lines += ["", "## Coverage gaps", ""]
    if coverage:
        lines += ["| Game | Empty cells (newest) | Change in window |", "|---|---|---|"]
        lines += [f"| {g} | {c['empty_cells']} | {c['trend']:+d} |" for g, c in sorted(coverage.items())]
    else:
        lines.append(NO_DATA)
    lines += ["", "## Capacity-bound and saturated games", "",
              f"- Capacity-bound: {', '.join(d['capacity_bound']) or 'none'}",
              f"- Saturated: {', '.join(d['saturated']) or 'none'}",
              f"- Held back: {', '.join(k['held_back_games']) or 'none'}",
              "", "## Rejections by reason", ""]
    lines += [f"- {reason or '(none)'}: {n}" for reason, n in d["rejections"].items()] or [NO_DATA]
    lines += ["", "## Runs (slowest steps)", "", "| Kind | Runs | Statuses | Median s | Max s |", "|---|---|---|---|---|"]
    for kind, r in sorted(d["runs"].items(), key=lambda kv: -kv[1]["max_s"]):
        statuses = ", ".join(f"{s} {n}" for s, n in sorted(r["statuses"].items()))
        lines.append(f"| {kind} | {r['count']} | {statuses} | {r['median_s']} | {r['max_s']} |")
    if not d["runs"]:
        lines.append(f"| {NO_DATA} | | | | |")
    lines += ["", "## Health findings (now)", ""]
    lines += [f"- [{f['severity']}] {f['code']}: {f['text']}" for f in d["health"]] or ["None."]
    return "\n".join(lines) + "\n"


class Command(BaseCommand):
    help = "Write the factory's KPI digest of the last --days days to <out>/digest.md and digest.json."

    def add_arguments(self, parser):
        parser.add_argument("--days", type=int, default=14, help="Window in days (default 14)")
        parser.add_argument("--out", required=True, help="Folder to write digest.md and digest.json into")

    def handle(self, *args, **opts):
        digest = build(max(1, opts["days"]))
        os.makedirs(opts["out"], exist_ok=True)
        with open(os.path.join(opts["out"], "digest.json"), "w", encoding="utf-8") as f:
            json.dump(digest, f, ensure_ascii=False, indent=1, default=str)
        with open(os.path.join(opts["out"], "digest.md"), "w", encoding="utf-8") as f:
            f.write(render(digest))
        self.stdout.write(f"Wrote the {digest['window']['days']}-day digest to {opts['out']}")
