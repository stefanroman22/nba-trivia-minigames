"""The doctor's nightly signal scan (spec §4.9, phase 5). Code only, no model.

Reads the anonymous roll-ups (QuestionStats, WrongAnswerStats) and the players' open
problem reports (QuestionReport, status new) for the staged games, and per question:

    solve_rate     >= MIN_ATTEMPTS attempts (all days) and a solve rate (correct / players, both
                   summed over the days; never per guess, since the multi-guess games log every
                   guess as an attempt) below MIN_SOLVE_RATE, or below BAND_FACTOR x the median
                   of its game's band (quality.band) over the game's active questions with
                   >= MIN_ATTEMPTS attempts; no players, no signal
    wrong_cluster  one wrong answer (answer_norm) from >= CLUSTER_PLAYERS players and
                   >= CLUSTER_SHARE of the question's wrong answers
    reports        >= 1 report (the notes are kept in quality.doctor.reports)

Strong (>= STRONG_REPORTS distinct reporters, see _reporter_tally, or solve_rate and
wrong_cluster together) sets an active
question `quarantined` (event quarantined/signal); anything weaker queues it for research
(quality.doctor_queue, event flagged). Either way quality.doctor = {"signals", "at", "reports"},
and a report is marked handled only once its note is copied there. The invalid-audit route to
quarantine is checker_jobs' (an audit verdict). Pending rows are never touched; a question
already queued is not flagged again, and one already quarantined only gets new notes attached.

On Thursdays (UTC) it also marks AUDIT_SIZE random active questions quality.audit_due for the
Checker's audit run (question-checker.yml, 03:00 UTC the same day). The draw is seeded with
the date, so a re-run the same day draws the same questions and finds them already marked.

Signals are computed per logged question_id (a Tic-Tac-Toe cell is `<qid>:<cell>`) and land on
the question question_for() resolves it to.

A question the doctor's research (or a confirmed data correction) released carries
quality.doctor_released_at (release()); its signals then count only QuestionStats days after the
release day and WrongAnswerStats rows last seen at or after the release, so old numbers cannot
flag it again.
"""
import datetime
import random
from collections import defaultdict
from statistics import median

from django.db.models import Sum

from trivia.models import Question, QuestionReport, QuestionStats, WrongAnswerStats
from trivia.questions import checker

GAMES = checker.STAGED_GAMES
VOTE_GAMES = ("who-would-win",)  # a vote has no right answer: no solve rate, no wrong answers
MIN_ATTEMPTS = 30
MIN_SOLVE_RATE = 0.03
BAND_FACTOR = 0.4
CLUSTER_PLAYERS = 5
CLUSTER_SHARE = 0.15
STRONG_REPORTS = 3
AUDIT_SIZE = 20
AUDIT_WEEKDAY = 3  # Thursday (datetime.weekday, UTC)

RELEASED_AT = "doctor_released_at"
REPORTER_ACCOUNTS = "reporter_accounts"  # in quality.doctor: distinct reporting accounts so far
GUEST_REPORTED = "guest_reported"  # in quality.doctor: any guest reported (all guests count as one)

PERSON_KEY = {"career-path": "person_id", "who-are-ya": "person_id", "contexto": "secret_person_id"}
_PREFER = {Question.STATUS_ACTIVE: 0, Question.STATUS_QUARANTINED: 1, Question.STATUS_PENDING: 2,
           Question.STATUS_RETIRED: 3}


def _key(game, question_id):
    """The lookup key of a logged question_id: the person id for the player games (they log
    String(person_id)), the board qid for Tic-Tac-Toe (it logs `<qid>:<cell>`), else the qid."""
    if game in PERSON_KEY:
        try:
            return int(question_id)
        except ValueError:
            return None
    if game == "tictactoe":
        return question_id.split(":", 1)[0]
    return question_id


def _index(game):
    """{key: Question} for one game. Several rows can share a person (a Contexto secret on
    several days): the live one wins, then the newest."""
    out = {}
    for row in Question.objects.filter(game=game).order_by("-id"):
        if game in PERSON_KEY:
            key = row.definition.get(PERSON_KEY[game]) if isinstance(row.definition, dict) else None
        else:
            key = row.qid
        if key is None:
            continue
        best = out.get(key)
        if best is None or _PREFER.get(row.status, 9) < _PREFER.get(best.status, 9):
            out[key] = row
    return out


def question_for(game, question_id, indexes=None):
    """The Question a logged (game, question_id) is about, or None. `indexes` caches the
    per-game lookup across calls."""
    key = _key(game, str(question_id))
    if key is None:
        return None
    if indexes is None:
        indexes = {}
    if game not in indexes:
        indexes[game] = _index(game)
    return indexes[game].get(key)


def release(row, now):
    """Release a question from the doctor (not saved): its doctor flags are cleared, the release
    is stamped, and a quarantined question goes back to pending for a fresh Checker pass (never
    straight to active). A live question stays live."""
    quality = dict(row.quality or {})
    quality.pop("doctor", None)
    quality.pop("doctor_queue", None)
    quality[RELEASED_AT] = now.isoformat()
    row.quality = quality
    if row.status == Question.STATUS_QUARANTINED:
        row.status = Question.STATUS_PENDING


def _released_at(row):
    stamp = (row.quality or {}).get(RELEASED_AT)
    try:
        at = datetime.datetime.fromisoformat(stamp) if isinstance(stamp, str) else None
    except ValueError:
        return None
    return at.replace(tzinfo=datetime.timezone.utc) if at is not None and at.tzinfo is None else at


def _solve_rate_signals(games, resolve):
    """{row.pk: [signal, ...]} for the solve-rate anomaly."""
    totals = (QuestionStats.objects.filter(game__in=games).values("game", "question_id")
              .annotate(attempts=Sum("attempts"), correct=Sum("correct"), players=Sum("players"))
              .order_by("game", "question_id"))
    measured = []  # (row, question_id, attempts, players, rate)
    for t in totals:
        if t["attempts"] < MIN_ATTEMPTS or not t["players"]:
            continue
        row = resolve(t["game"], t["question_id"])
        if row is None:
            continue
        attempts, correct, players = t["attempts"], t["correct"], t["players"]
        released = _released_at(row)
        if released is not None:  # only the days after the release day count
            since = (QuestionStats.objects.filter(game=t["game"], question_id=t["question_id"],
                                                  day__gt=released.date())
                     .aggregate(attempts=Sum("attempts"), correct=Sum("correct"), players=Sum("players")))
            attempts, correct, players = since["attempts"] or 0, since["correct"] or 0, since["players"] or 0
            if attempts < MIN_ATTEMPTS or not players:
                continue
        # Per player, not per guess: the multi-guess games log every guess as an attempt.
        measured.append((row, t["question_id"], attempts, players, correct / players))
    by_band = defaultdict(list)
    for row, _, _, _, rate in measured:
        band = (row.quality or {}).get("band")
        if row.status == Question.STATUS_ACTIVE and band:
            by_band[(row.game, band)].append(rate)
    medians = {k: median(v) for k, v in by_band.items()}
    out = defaultdict(list)
    for row, question_id, attempts, players, rate in measured:
        norm = medians.get((row.game, (row.quality or {}).get("band")))
        if rate < MIN_SOLVE_RATE or (norm is not None and rate < BAND_FACTOR * norm):
            out[row.pk].append({"signal": "solve_rate", "question_id": question_id, "attempts": attempts,
                                "players": players, "solve_rate": round(rate, 4),
                                "band_median": round(norm, 4) if norm is not None else None})
    return out


def _cluster_signals(games, resolve):
    """{row.pk: [signal, ...]} for the wrong-answer clusters."""
    answers = defaultdict(list)
    for w in WrongAnswerStats.objects.filter(game__in=games).order_by("game", "question_id", "-count", "answer_norm"):
        answers[(w.game, w.question_id)].append(w)
    out = defaultdict(list)
    for (game, question_id), rows in answers.items():
        total = sum(w.count for w in rows)
        hits = [w for w in rows if w.players >= CLUSTER_PLAYERS and w.count >= CLUSTER_SHARE * total]
        row = resolve(game, question_id) if hits else None
        if row is None:
            continue
        released = _released_at(row)
        if released is not None:  # only answers seen since the release count
            rows = [w for w in rows if w.last_seen >= released]
            total = sum(w.count for w in rows)
            hits = [w for w in rows if w.players >= CLUSTER_PLAYERS and w.count >= CLUSTER_SHARE * total]
            if not hits:
                continue
        out[row.pk] += [{"signal": "wrong_cluster", "question_id": question_id, "answer": w.answer_norm,
                         "players": w.players, "count": w.count, "share": round(w.count / total, 4)}
                        for w in hits]
    return out


def _reporter_tally(doctor_state, reports):
    """The question's distinct reporters after this scan's new reports, as counts only (no ids
    are kept on the question): accounts are counted once per scan, and every guest together is
    one reporter, ever, since a guest report carries no key of its own."""
    accounts = {r.user_id for r in reports if r.user_id is not None}
    guest = bool(doctor_state.get(GUEST_REPORTED)) or any(r.user_id is None for r in reports)
    return {REPORTER_ACCOUNTS: int(doctor_state.get(REPORTER_ACCOUNTS) or 0) + len(accounts),
            GUEST_REPORTED: guest}


def scan(now, journal, games=GAMES):
    """Flag, quarantine and (on Thursdays) select for audit; returns
    {"quarantined", "flagged", "audit_selected", "games"} (games: those with a quarantine)."""
    indexes, rows = {}, {}

    def resolve(game, question_id):
        row = question_for(game, question_id, indexes)
        if row is not None:
            rows[row.pk] = row
        return row

    stat_signals = defaultdict(list)
    stat_games = [g for g in games if g not in VOTE_GAMES]
    for found in (_solve_rate_signals(stat_games, resolve), _cluster_signals(stat_games, resolve)):
        for pk, signals in found.items():
            stat_signals[pk] += signals
    new_reports = defaultdict(list)
    for rep in QuestionReport.objects.filter(game__in=games, status=QuestionReport.NEW).order_by("id"):
        row = resolve(rep.game, rep.question_id)
        if row is not None:
            new_reports[row.pk].append(rep)

    summary = {"quarantined": 0, "flagged": 0, "audit_selected": 0, "games": []}
    stamp = now.isoformat()
    for pk in sorted(rows):
        row = rows[pk]
        if row.status not in (Question.STATUS_ACTIVE, Question.STATUS_QUARANTINED):
            continue  # pending waits for the Checker; retired is gone
        reports = new_reports.get(pk, [])
        quality = dict(row.quality or {})
        doctor = dict(quality.get("doctor") or {})
        notes = list(doctor.get("reports") or []) + [r.note for r in reports]
        tally = _reporter_tally(doctor, reports)
        if row.status == Question.STATUS_QUARANTINED:
            if not reports:
                continue
            doctor["reports"] = notes  # already out of play: keep the notes for the research
        else:
            signals = list(stat_signals.get(pk, []))
            if notes:
                signals.append({"signal": "reports", "count": len(notes)})
            if not signals:
                continue
            kinds = {s["signal"] for s in signals}
            reporters = tally[REPORTER_ACCOUNTS] + tally[GUEST_REPORTED]
            strong = reporters >= STRONG_REPORTS or {"solve_rate", "wrong_cluster"} <= kinds
            if strong:
                row.status = Question.STATUS_QUARANTINED
                doctor = {"signals": signals, "at": stamp, "reports": notes}
                journal.log("quarantined", "signal", game=row.game, qid=row.qid, signals=signals)
                summary["quarantined"] += 1
                if row.game not in summary["games"]:
                    summary["games"].append(row.game)
            elif quality.get("doctor_queue"):
                if not reports:
                    continue  # already queued: nothing new
                doctor["reports"] = notes
            else:
                quality["doctor_queue"] = True
                doctor = {"signals": signals, "at": stamp, "reports": notes}
                journal.log("flagged", "weak", game=row.game, qid=row.qid, signals=signals)
                summary["flagged"] += 1
        if notes:
            doctor.update(tally)
        quality["doctor"] = doctor
        row.quality = quality
        row.save(update_fields=["status", "quality", "updated_at"])
        if reports:
            QuestionReport.objects.filter(pk__in=[r.pk for r in reports]).update(status=QuestionReport.HANDLED)

    if now.weekday() == AUDIT_WEEKDAY:
        summary["audit_selected"] = _select_audit(now, journal, games)
    summary["games"].sort()
    return summary


def _select_audit(now, journal, games):
    """Mark AUDIT_SIZE random active questions audit_due. Questions still due from an earlier
    week are not drawn; ones drawn earlier today are drawn again and skipped."""
    today = now.date().isoformat()
    candidates = []
    for row in Question.objects.filter(game__in=games, status=Question.STATUS_ACTIVE).order_by("id"):
        q = row.quality or {}
        if q.get("audit_due") and q.get("audit_selected") != today:
            continue
        candidates.append(row)
    picked = random.Random(today).sample(candidates, min(AUDIT_SIZE, len(candidates)))
    selected = 0
    for row in sorted(picked, key=lambda r: r.id):
        if (row.quality or {}).get("audit_selected") == today:
            continue
        row.quality = {**(row.quality or {}), "audit_due": True, "audit_selected": today}
        row.save(update_fields=["quality", "updated_at"])
        journal.log("audit_selected", "random", game=row.game, qid=row.qid)
        selected += 1
    return selected
