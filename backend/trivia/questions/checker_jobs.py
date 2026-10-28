"""The two DB-side jobs around the Checker (spec §4.12), wrapped by the
export_checker_batches and apply_checker_verdicts commands.

export_batches() turns pending questions into small batches holding only what a
player sees (checker views). The Checker agent reads those in a job with no
database access and writes one verdict per question. apply_verdicts() then treats
every verdict as untrusted input: the question must still be pending, its view must
still hash to the payload_sha the verdict names, and checker.judge() (not the model's
own word) decides valid / invalid / unsure.

The random audit (spec §4.9) reuses both jobs: export_batches(mode="audit") exports the live
questions the doctor marked quality.audit_due, and a verdict on such a question is applied
by _apply_audit() instead of the pending path.

So do the doctor's data corrections (spec §4.9): export_batches(mode="corrections") exports each
proposed DataCorrection on its own, and a verdict carrying "kind": "correction" is applied by
_apply_correction(): valid (every claim confirmed, on at least two approved domains) makes it
active and sends the quarantined or pending questions on that player back to pending.
"""
import glob
import json
import os
from collections import Counter
from urllib.parse import urlparse

from trivia.models import DataCorrection, Question
from trivia.questions import checker, corrections, doctor
from trivia.questions.games import GAME_MODULES
from trivia.questions.runner import _materialize

MAX_CLAIMS_KEPT = 50
MAX_SOURCES_KEPT = 10
MAX_TEXT = 500
AUTO_LIMIT_BACKLOG, AUTO_LIMIT = 150, 60  # owner decision 2: 150 a day until the backlog is gone, then 60


def _view(row, dataset):
    """(view, payload_sha) of a stored question, or (None, None) if it no longer materializes."""
    mod = GAME_MODULES[row.game]
    m, problems = _materialize(mod, row.definition, dataset)
    if problems:
        return None, None
    view = mod.checker_view(m, dataset)
    return view, checker.payload_sha(view)


def export_batches(dataset, limit, batch_size, out=None, mode="pending"):
    """[{"batch", "checker_version", "allowed_sites", "questions"}] for up to `limit`
    pending questions: Contexto days first (earliest first, they expire), then the
    games with the fewest live questions. limit="auto" is 150 while 150 or more are
    pending, else 60. mode="audit" exports the live questions the doctor marked
    quality.audit_due instead (limit="auto": all of them), each batch with "kind": "audit".
    mode="corrections" exports the proposed data corrections, one per item (limit="auto": all)."""
    if mode == "audit":
        return _export_audit(dataset, limit, batch_size, out)
    if mode == "corrections":
        return _export_corrections(dataset, limit, out)
    live = Counter(Question.objects.filter(game__in=checker.STAGED_GAMES, status=Question.STATUS_ACTIVE)
                   .values_list("game", flat=True))
    rows = list(Question.objects.filter(game__in=checker.STAGED_GAMES, status=Question.STATUS_PENDING)
                .select_related("label").order_by("id"))
    # A labeled game (Tic-Tac-Toe) takes its difficulties in turn, so a capped run brings
    # easy, medium and hard boards live together instead of draining the oldest band first.
    turn, per_band = {}, Counter()
    for row in rows:
        labeled = getattr(GAME_MODULES[row.game], "index_label", None)
        if labeled is not None:
            band = (row.game, labeled(row, [row.qid])[1])
            turn[row.id] = per_band[band]
            per_band[band] += 1

    def priority(row):
        if row.game == "contexto":
            return (0, str(row.definition.get("day", "")), "", 0, row.id)
        return (1, f"{live.get(row.game, 0):09d}", row.game, turn.get(row.id, 0), row.id)

    pending = sorted(rows, key=priority)
    if limit == "auto":
        limit = AUTO_LIMIT_BACKLOG if len(pending) >= AUTO_LIMIT_BACKLOG else AUTO_LIMIT
    questions = []
    for row in pending:
        if len(questions) >= limit:
            break
        view, sha = _view(row, dataset)
        if view is None:
            if out:
                out(f"  skipped {row.game}/{row.qid}: no longer materializes (the next supply run retires it)")
            continue
        questions.append({"game": row.game, "qid": row.qid, "payload_sha": sha, "view": view})
    return [
        {"batch": f"{i // batch_size + 1:03d}", "checker_version": checker.CHECKER_VERSION,
         "allowed_sites": list(checker.ALLOWED_SITES), "questions": questions[i:i + batch_size]}
        for i in range(0, len(questions), batch_size)
    ]


def _export_audit(dataset, limit, batch_size, out):
    due = [row for row in Question.objects.filter(game__in=checker.STAGED_GAMES, status=Question.STATUS_ACTIVE)
           .order_by("game", "id") if (row.quality or {}).get("audit_due")]
    questions = []
    for row in due:
        if limit != "auto" and len(questions) >= limit:
            break
        view, sha = _view(row, dataset)
        if view is None:
            if out:
                out(f"  skipped {row.game}/{row.qid}: no longer materializes (the next supply run retires it)")
            continue
        questions.append({"game": row.game, "qid": row.qid, "payload_sha": sha, "view": view})
    return [
        {"batch": f"{i // batch_size + 1:03d}", "kind": "audit", "checker_version": checker.CHECKER_VERSION,
         "allowed_sites": list(checker.ALLOWED_SITES), "questions": questions[i:i + batch_size]}
        for i in range(0, len(questions), batch_size)
    ]


def _export_corrections(dataset, limit, out):
    """One item per proposed correction: the change, the doctor's sources and, for context, the
    player's current row restricted to the top-level field the correction touches."""
    by_id = {r.get("person_id"): r for r in dataset.rows}
    items = []
    for c in DataCorrection.objects.filter(status=DataCorrection.STATUS_PROPOSED).order_by("id"):
        if limit != "auto" and len(items) >= limit:
            break
        row = by_id.get(c.person_id)
        try:
            top = corrections.parse_path(c.field_path)[0]
        except corrections.InvalidPath:
            top = None
        if row is None or top not in row:
            if out:
                out(f"  skipped correction {c.pk}: {c.person_id} {c.field_path} does not resolve")
            continue
        items.append({"batch": f"{len(items) + 1:03d}", "kind": "correction", "checker_version": checker.CHECKER_VERSION,
                      "allowed_sites": list(checker.ALLOWED_SITES), "id": c.pk, "person_id": c.person_id,
                      "player": row.get("full_name"), "field_path": c.field_path, "old_value": c.old_value,
                      "new_value": c.new_value, "sources": list(c.sources or []),
                      "row": {"person_id": c.person_id, "full_name": row.get("full_name"), top: row[top]}})
    return items


def _text(value, limit=MAX_TEXT):
    return str(value)[:limit] if value is not None else ""


def _evidence(verdict):
    """The model's evidence, size-capped before it is stored (it is untrusted input)."""
    claims = []
    for c in (verdict.get("claims") if isinstance(verdict.get("claims"), list) else [])[:MAX_CLAIMS_KEPT]:
        if not isinstance(c, dict):
            continue
        sources = c.get("sources") if isinstance(c.get("sources"), list) else []
        claim = {"claim": _text(c.get("claim")), "status": _text(c.get("status"), 20),
                 "sources": [_text(u) for u in sources[:MAX_SOURCES_KEPT] if isinstance(u, str)]}
        if c.get("found") is not None:
            claim["found"] = _text(c.get("found"))
        claims.append(claim)
    return {"model_verdict": _text(verdict.get("verdict"), 20), "summary": _text(verdict.get("summary"), 2000),
            "claims": claims}


def _combine(judged):
    """One outcome from every verdict a run produced for the same question: any backed
    contradiction wins, valid needs every verdict valid, anything else is unsure."""
    for item in judged:
        if item[0] == "invalid":
            return item
    if all(item[0] == "valid" for item in judged):
        return judged[0]
    return next(item for item in judged if item[0] == "unsure")


def _apply_one(game, qid, verdicts, dataset, journal, now, outcomes, approved_games, needs_owner):
    if game not in checker.STAGED_GAMES:
        journal.log("rejected", "not_staged", game=game[:32], qid=qid[:48])
        return
    row = Question.objects.filter(game=game, qid=qid).first()
    audit = row is not None and row.status == Question.STATUS_ACTIVE and (row.quality or {}).get("audit_due")
    if row is None or (row.status != Question.STATUS_PENDING and not audit):
        journal.log("rejected", "not_pending", game=game, qid=qid[:48])
        return
    _, sha = _view(row, dataset)
    current = [v for v in verdicts if sha is not None and v.get("payload_sha") == sha]
    for _ in range(len(verdicts) - len(current)):
        journal.log("rejected", "stale", game=game, qid=qid, current_sha=sha)
    if not current:
        return
    outcome, reason, verdict = _combine([(*checker.judge(v), v) for v in current])
    evidence = _evidence(verdict)
    if audit:
        _apply_audit(row, outcome, reason, sha, evidence, journal, now, outcomes)
        return
    quality = dict(row.quality or {})
    if outcome == "valid":
        quality.pop("unsure_count", None)
        quality["checked"] = {"verdict": "valid", "at": now.isoformat(), "payload_sha": sha,
                              "checker_version": checker.CHECKER_VERSION}
        row.status = Question.STATUS_ACTIVE
        approved_games.add(game)
        journal.log("approved", reason, game=game, qid=qid, **evidence)
    elif outcome == "invalid":
        quality["check_failed"] = {"at": now.isoformat(), "payload_sha": sha, **evidence}
        row.status = Question.STATUS_QUARANTINED
        journal.log("quarantined", reason, game=game, qid=qid, **evidence)
    else:
        quality["unsure_count"] = quality.get("unsure_count", 0) + 1
        journal.log("unsure", reason, game=game, qid=qid, unsure_count=quality["unsure_count"], **evidence)
        if quality["unsure_count"] >= checker.MAX_UNSURE:
            needs_owner.append(f"{game}/{qid}")
            journal.log("needs_owner", "unsure_twice", game=game, qid=qid)
    row.quality = quality
    row.save(update_fields=["status", "quality", "updated_at"])
    outcomes[outcome] += 1


def _apply_audit(row, outcome, reason, sha, evidence, journal, now, outcomes):
    """A random-audit verdict on a live question (spec §4.9): valid renews its check, invalid
    takes it out of play (a checker_miss when an earlier check had passed it), unsure leaves
    it due for the next audit run."""
    game, qid = row.game, row.qid
    if outcome == "unsure":
        journal.log("unsure", reason, game=game, qid=qid, audit=True, **evidence)
        outcomes["unsure"] += 1
        return
    quality = dict(row.quality or {})
    quality.pop("audit_due", None)
    if outcome == "valid":
        quality["checked"] = {"verdict": "valid", "at": now.isoformat(), "payload_sha": sha,
                              "checker_version": checker.CHECKER_VERSION}
        journal.log("audit_passed", reason, game=game, qid=qid, **evidence)
        outcomes["audit_valid"] += 1
    else:
        prior = quality.get("checked")
        quality["check_failed"] = {"at": now.isoformat(), "payload_sha": sha, **evidence}
        row.status = Question.STATUS_QUARANTINED
        journal.log("quarantined", reason, game=game, qid=qid, audit=True, **evidence)
        if prior:
            journal.log("checker_miss", "audit_invalid", game=game, qid=qid,
                        checked_at=prior.get("at"), checked_sha=prior.get("payload_sha"))
        outcomes["invalid"] += 1
    row.quality = quality
    row.save(update_fields=["status", "quality", "updated_at"])


def _judge_correction(verdict):
    """checker.judge(), except that valid also needs the confirming pages on two approved domains."""
    outcome, reason = checker.judge(verdict)
    if outcome != "valid":
        return outcome, reason
    hosts = set()
    for claim in verdict["claims"]:
        for u in claim["sources"]:
            if checker._allowed(u):
                hosts.add(urlparse(u).hostname)
    return ("valid", reason) if len(hosts) >= 2 else ("unsure", "one_domain")


def _apply_correction(cid, verdicts, dataset, journal, now, outcomes):
    c = DataCorrection.objects.filter(pk=int(cid)).first() if cid.isascii() and cid.isdigit() else None
    if c is None or c.status != DataCorrection.STATUS_PROPOSED:
        journal.log("rejected", "not_proposed", correction_id=cid[:20])
        return
    outcome, reason, verdict = _combine([(*_judge_correction(v), v) for v in verdicts])
    evidence = _evidence(verdict)
    if outcome == "unsure":
        journal.log("unsure", reason, correction_id=c.pk, **evidence)
        return
    if outcome == "valid":
        row = next((r for r in dataset.rows if r.get("person_id") == c.person_id), None)
        try:
            current = corrections.read(row, c.field_path) if row is not None else None
            resolved = row is not None
        except corrections.InvalidPath:
            resolved = False
        if not resolved or current == c.new_value or current != c.old_value:
            # The data moved since the doctor proposed it: already fixed, or a different value now.
            c.status = DataCorrection.STATUS_REDUNDANT if resolved and current == c.new_value \
                else DataCorrection.STATUS_REJECTED
            c.decided_at = now
            c.save(update_fields=["status", "decided_at"])
            journal.log("rejected", "stale_correction", correction_id=c.pk, status=c.status)
            return
    if outcome == "invalid":
        c.status = DataCorrection.STATUS_REJECTED
        c.decided_at = now
        c.save(update_fields=["status", "decided_at"])
        journal.log("correction_rejected", reason, correction_id=c.pk, **evidence)
        outcomes["correction_invalid"] += 1
        return
    c.status = DataCorrection.STATUS_ACTIVE
    c.decided_at = now
    c.save(update_fields=["status", "decided_at"])
    journal.log("correction_confirmed", reason, correction_id=c.pk, person_id=c.person_id,
                field_path=c.field_path, new_value=c.new_value, **evidence)
    outcomes["correction_valid"] += 1
    # Every question out of play or waiting on this player is checked again against the corrected
    # data (the next supply run re-materializes it); a queued live one only leaves the queue.
    for q in Question.objects.filter(game__in=checker.STAGED_GAMES).exclude(status=Question.STATUS_RETIRED) \
            .order_by("id"):
        if c.person_id not in (q.players_referenced or []):
            continue
        if q.status == Question.STATUS_ACTIVE and not (q.quality or {}).get("doctor_queue"):
            continue
        doctor.release(q, now)  # quarantined -> pending
        q.save(update_fields=["status", "quality", "updated_at"])
        journal.log("released", "correction_confirmed", game=q.game, qid=q.qid, correction_id=c.pk)


def apply_verdicts(directory, dataset, journal, now):
    """Apply every verdicts-*.json in `directory`; returns a summary dict."""
    outcomes, approved_games, needs_owner = Counter(), set(), []
    grouped = {}  # (game, qid) -> [verdict, ...], in the order first seen
    by_correction = {}  # correction id -> [verdict, ...]
    for path in sorted(glob.glob(os.path.join(directory, "**", "verdicts-*.json"), recursive=True)):
        name = os.path.basename(path)
        try:
            with open(path, encoding="utf-8") as f:
                verdicts = json.load(f)["verdicts"]
            if not isinstance(verdicts, list):
                raise ValueError("verdicts is not a list")
        except (OSError, ValueError, KeyError, TypeError) as e:
            journal.log("rejected", "malformed_file", file=name, error=str(e)[:500])
            continue
        for verdict in verdicts:
            if not isinstance(verdict, dict):
                journal.log("rejected", "malformed_verdict", file=name)
                continue
            if verdict.get("kind") == "correction":
                by_correction.setdefault(str(verdict.get("id") or ""), []).append(verdict)
                continue
            key = (str(verdict.get("game") or ""), str(verdict.get("qid") or ""))
            grouped.setdefault(key, []).append(verdict)
    for (game, qid), verdicts in grouped.items():
        _apply_one(game, qid, verdicts, dataset, journal, now, outcomes, approved_games, needs_owner)
    for cid, verdicts in by_correction.items():
        _apply_correction(cid, verdicts, dataset, journal, now, outcomes)
    return {"approved": outcomes["valid"], "quarantined": outcomes["invalid"], "unsure": outcomes["unsure"],
            "audited": outcomes["audit_valid"], "games": sorted(approved_games), "needs_owner": needs_owner,
            "corrections_confirmed": outcomes["correction_valid"],
            "corrections_rejected": outcomes["correction_invalid"]}
