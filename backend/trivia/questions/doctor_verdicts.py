"""The DB-side jobs around the doctor's weekly research (spec §4.9), wrapped by the
export_doctor_cases and apply_doctor_verdicts commands (.github/workflows/doctor-research.yml).

export_cases() writes one case per question the nightly scan took out of play (quarantined)
or queued for research (quality.doctor_queue): what players see (the checker view), our
curated rows for the players it references, the wrong-answer clusters, the players' report
notes and the signals. The doctor agent researches each case on the four approved sites in a
job with no database access and writes one verdict per case.

apply_verdicts() treats every verdict as untrusted input. A data correction is only proposed
(DataCorrection status "proposed"; the Checker confirms it before it applies, checker_jobs)
when it is backed by two approved domains, names a player in the dataset and copies the
current value exactly. Nothing here ever makes a question active: a released question goes
back to pending for the Checker.
"""
import glob
import json
import os
from collections import Counter
from urllib.parse import urlparse

from django.db.models import Q

from trivia.models import DataCorrection, Question, WrongAnswerStats
from trivia.questions import checker, corrections, doctor
from trivia.questions.checker_jobs import MAX_SOURCES_KEPT, MAX_TEXT, _text
from trivia.questions.games import GAME_MODULES
from trivia.questions.quality import LEVELS
from trivia.questions.runner import _materialize

KINDS = ("data_correction", "fix_answers", "add_alias", "reband", "retire", "false_alarm", "needs_owner")
MAX_CASES = 40
MAX_ROWS = 20
MAX_WRONG = 10
MAX_RATIONALE = 2000
MAX_CORRECTIONS = 10
MAX_VALUE = 2000  # characters of a correction's new_value as JSON
MAX_ANSWERS = 50
MIN_DOMAINS = 2


def _open(row):
    """True while the doctor owns the question: out of play, or live and queued."""
    if row.status == Question.STATUS_QUARANTINED:
        return True
    return row.status == Question.STATUS_ACTIVE and bool((row.quality or {}).get("doctor_queue"))


def _cases_rows():
    rows = [row for row in Question.objects.filter(
        game__in=checker.STAGED_GAMES, status__in=[Question.STATUS_QUARANTINED, Question.STATUS_ACTIVE])
        .order_by("game", "id") if _open(row)]
    return sorted(rows, key=lambda r: r.status != Question.STATUS_QUARANTINED)  # out of play first


def _wrong_answers(row):
    if row.game in doctor.PERSON_KEY:
        key = (row.definition or {}).get(doctor.PERSON_KEY[row.game])
        match = Q(question_id=str(key))
    else:  # a Tic-Tac-Toe cell logs <qid>:<cell>
        match = Q(question_id=row.qid) | Q(question_id__startswith=f"{row.qid}:")
    found = WrongAnswerStats.objects.filter(match, game=row.game).order_by("-count", "answer_norm")[:MAX_WRONG]
    return [{"question_id": w.question_id, "answer": w.answer_norm, "count": w.count, "players": w.players}
            for w in found]


def export_cases(dataset, limit=MAX_CASES, out=None):
    """[case, ...] for up to `limit` questions the doctor owns (quarantined first)."""
    by_id = {r.get("person_id"): r for r in dataset.rows}
    cases = []
    for row in _cases_rows():
        if len(cases) >= limit:
            break
        mod = GAME_MODULES[row.game]
        m, problems = _materialize(mod, row.definition, dataset)
        if problems:
            if out:
                out(f"  skipped {row.game}/{row.qid}: no longer materializes (the next supply run retires it)")
            continue
        quality = row.quality or {}
        report = quality.get("doctor") or {}
        referenced = mod.players_referenced(row.definition, m, dataset)
        case = {"case": f"{len(cases) + 1:03d}", "game": row.game, "qid": row.qid, "status": row.status,
                "band": quality.get("band"), "allowed_sites": list(checker.ALLOWED_SITES),
                "view": mod.checker_view(m, dataset),
                "players": [by_id[pid] for pid in referenced if pid in by_id][:MAX_ROWS],
                "wrong_answers": _wrong_answers(row),
                "reports": list(report.get("reports") or []),
                "signals": list(report.get("signals") or [])}
        if quality.get("check_failed"):
            case["checker_evidence"] = quality["check_failed"]
        cases.append(case)
    return cases


# ------------------------------------------------------------------- apply

def _same(a, b):
    """Exact JSON equality (1 is not 1.0, True is not 1)."""
    return json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)


def _kind(value):
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, (int, float)):
        return "number"
    return type(value).__name__


def _sources(value):
    return [_text(u) for u in (value if isinstance(value, list) else [])[:MAX_SOURCES_KEPT] if isinstance(u, str)]


def _domains(urls):
    """The approved hostnames among `urls`."""
    out = set()
    for u in urls:
        try:
            host = urlparse(u).hostname
        except ValueError:
            continue
        if host in checker.ALLOWED_SITES:
            out.add(host)
    return out


def _correction_problem(item, by_id):
    """None when one proposed correction passes the hard gates, else the reason it does not."""
    if not isinstance(item, dict) or "old_value" not in item or "new_value" not in item:
        return "malformed_correction"
    pid = item.get("person_id")
    if isinstance(pid, bool) or not isinstance(pid, int) or pid not in by_id:
        return "unknown_person"
    try:
        current = corrections.read(by_id[pid], item.get("field_path"))
    except corrections.InvalidPath:
        return "invalid_path"
    old, new = item["old_value"], item["new_value"]
    if not _same(old, current):
        return "old_value_mismatch"
    if _same(new, old):
        return "no_change"
    if len(json.dumps(new)) > MAX_VALUE:
        return "too_large"
    if old is not None and new is not None and _kind(old) != _kind(new):
        return "type_mismatch"
    urls = [u for u in (item.get("sources") if isinstance(item.get("sources"), list) else [])
            if isinstance(u, str)]
    if len(_domains(urls)) < MIN_DOMAINS:
        return "too_few_domains"
    return None


def _propose(row, verdict, rationale, by_id, journal, created):
    items = verdict.get("corrections")
    if not isinstance(items, list) or not items:
        journal.log("rejected", "no_corrections", game=row.game, qid=row.qid)
        return
    if len(items) > MAX_CORRECTIONS:
        journal.log("rejected", "too_many_corrections", game=row.game, qid=row.qid, dropped=len(items) - MAX_CORRECTIONS)
    for item in items[:MAX_CORRECTIONS]:
        problem = _correction_problem(item, by_id)
        if problem is None and DataCorrection.objects.filter(
                person_id=item["person_id"], field_path=item["field_path"],
                status__in=[DataCorrection.STATUS_PROPOSED, DataCorrection.STATUS_CHECKING,
                            DataCorrection.STATUS_ACTIVE]).exists():
            problem = "correction_exists"
        if problem is not None:
            shown = item if isinstance(item, dict) else {}
            journal.log("rejected", problem, game=row.game, qid=row.qid, person_id=_text(shown.get("person_id"), 20),
                        field_path=_text(shown.get("field_path"), 120))
            continue
        sources = [u for u in _sources(item["sources"]) if _domains([u])]
        c = DataCorrection.objects.create(
            person_id=item["person_id"], field_path=item["field_path"], old_value=item["old_value"],
            new_value=item["new_value"], sources=sources, reason=rationale,
            status=DataCorrection.STATUS_PROPOSED, created_by="doctor")
        created.append(c.pk)
        journal.log("correction_proposed", "doctor", game=row.game, qid=row.qid, correction_id=c.pk,
                    person_id=c.person_id, field_path=c.field_path, old_value=c.old_value, new_value=c.new_value,
                    sources=sources)


def _deferred(row, verdict, kind, journal, evidence):
    """fix_answers / add_alias belong to the editorial games of a later phase: shape-checked
    and journaled, nothing changes yet."""
    if kind == "fix_answers":
        answers = verdict.get("answers")
        if not isinstance(answers, list) or not answers or not all(isinstance(a, str) and a.strip() for a in answers):
            journal.log("rejected", "malformed_answers", game=row.game, qid=row.qid)
            return
        journal.log("deferred", kind, game=row.game, qid=row.qid,
                    answers=[_text(a, 120) for a in answers[:MAX_ANSWERS]], **evidence)
        return
    alias = verdict.get("alias")
    if not (isinstance(alias, dict) and all(isinstance(alias.get(k), str) and alias[k].strip()
                                            for k in ("answer", "alias"))):
        journal.log("rejected", "malformed_alias", game=row.game, qid=row.qid)
        return
    journal.log("deferred", kind, game=row.game, qid=row.qid,
                alias={"answer": _text(alias["answer"], 120), "alias": _text(alias["alias"], 120)}, **evidence)


def _apply_one(game, qid, verdict, by_id, journal, now, summary, created):
    kind = verdict.get("verdict")
    if kind not in KINDS:
        journal.log("rejected", "unknown_verdict", game=game, qid=qid, verdict=_text(kind, 40))
        return
    row = Question.objects.filter(game=game, qid=qid).first() if game in checker.STAGED_GAMES else None
    if row is None or not _open(row):
        journal.log("rejected", "not_in_research", game=game, qid=qid)
        return
    rationale = _text(verdict.get("rationale"), MAX_RATIONALE)
    evidence = {"rationale": rationale, "sources": _sources(verdict.get("sources"))}
    if kind == "data_correction":
        _propose(row, verdict, rationale, by_id, journal, created)
        return  # the question waits for the Checker to confirm the correction
    if kind in ("fix_answers", "add_alias"):
        _deferred(row, verdict, kind, journal, evidence)
        return
    if kind == "needs_owner":
        journal.log("needs_owner", "doctor", game=game, qid=qid, **evidence)
        summary["needs_owner"].append(f"{game}/{qid}")
        return
    signals = list(((row.quality or {}).get("doctor") or {}).get("signals") or [])
    if kind == "retire":
        if row.status == Question.STATUS_ACTIVE:
            summary["changed"] += 1  # leaves production
        row.status = Question.STATUS_RETIRED
        row.retired_at = now
        row.retired_reason = f"doctor: {rationale}"[:MAX_RATIONALE]
        row.save(update_fields=["status", "retired_at", "retired_reason", "updated_at"])
        journal.log("retired", "doctor", game=game, qid=qid, signals=signals, **evidence)
        summary["retired"] += 1
        return
    if kind == "reband":
        band = verdict.get("band")
        if band not in LEVELS:
            journal.log("rejected", "invalid_band", game=game, qid=qid, band=_text(band, 20))
            return
        before = (row.quality or {}).get("band")
        doctor.release(row, now)
        row.quality = {**row.quality, "band": band, "band_override": band}
        row.save(update_fields=["status", "quality", "updated_at"])
        journal.log("rebanded", "doctor", game=game, qid=qid, band_from=before, band_to=band, signals=signals,
                    **evidence)
        summary["released"] += 1
        return
    doctor.release(row, now)  # false_alarm
    row.save(update_fields=["status", "quality", "updated_at"])
    journal.log("released", "false_alarm", game=game, qid=qid, signals=signals, **evidence)
    summary["released"] += 1


def apply_verdicts(directory, dataset, journal, now):
    """Apply every verdict-*.json in `directory` (one verdict object per file). Returns
    {"proposed": [correction ids], "released", "retired", "changed", "needs_owner": [...]};
    changed counts live questions that left production."""
    by_id = {r.get("person_id"): r for r in dataset.rows}
    summary = Counter()
    summary["needs_owner"] = []
    created, seen = [], set()
    for path in sorted(glob.glob(os.path.join(directory, "**", "verdict-*.json"), recursive=True)):
        name = os.path.basename(path)
        try:
            with open(path, encoding="utf-8") as f:
                verdict = json.load(f)
            if not isinstance(verdict, dict):
                raise ValueError("a verdict file holds one JSON object")
        except (OSError, ValueError) as e:
            journal.log("rejected", "malformed_file", file=name, error=str(e)[:MAX_TEXT])
            continue
        game, qid = _text(verdict.get("game"), 32), _text(verdict.get("qid"), 48)
        if (game, qid) in seen:
            journal.log("rejected", "duplicate", game=game, qid=qid, file=name)
            continue
        seen.add((game, qid))
        _apply_one(game, qid, verdict, by_id, journal, now, summary, created)
    return {"proposed": created, "released": summary["released"], "retired": summary["retired"],
            "changed": summary["changed"], "needs_owner": summary["needs_owner"]}
