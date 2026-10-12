"""The two DB-side jobs around the Checker (spec §4.12), wrapped by the
export_checker_batches and apply_checker_verdicts commands.

export_batches() turns pending questions into small batches holding only what a
player sees (checker views). The Checker agent reads those in a job with no
database access and writes one verdict per question. apply_verdicts() then treats
every verdict as untrusted input: the question must still be pending, its view must
still hash to the payload_sha the verdict names, and checker.judge() (not the model's
own word) decides valid / invalid / unsure.
"""
import glob
import json
import os
from collections import Counter

from trivia.models import Question
from trivia.questions import checker
from trivia.questions.games import GAME_MODULES
from trivia.questions.runner import _materialize

MAX_CLAIMS_KEPT = 50


def _view(row, dataset):
    """(view, payload_sha) of a stored question, or (None, None) if it no longer materializes."""
    mod = GAME_MODULES[row.game]
    m, problems = _materialize(mod, row.definition, dataset)
    if problems:
        return None, None
    view = mod.checker_view(m, dataset)
    return view, checker.payload_sha(view)


def export_batches(dataset, limit, batch_size):
    """[{"batch", "checker_version", "allowed_sites", "questions"}] for up to `limit`
    pending questions: Contexto days first (earliest first, they expire), then the
    games with the fewest live questions."""
    live = Counter(Question.objects.filter(game__in=checker.STAGED_GAMES, status=Question.STATUS_ACTIVE)
                   .values_list("game", flat=True))

    def priority(row):
        if row.game == "contexto":
            return (0, str(row.definition.get("day", "")), "", row.id)
        return (1, f"{live.get(row.game, 0):09d}", row.game, row.id)

    pending = sorted(Question.objects.filter(game__in=checker.STAGED_GAMES, status=Question.STATUS_PENDING),
                     key=priority)
    questions = []
    for row in pending:
        if len(questions) >= limit:
            break
        view, sha = _view(row, dataset)
        if view is None:
            continue  # the next maintenance run retires it
        questions.append({"game": row.game, "qid": row.qid, "payload_sha": sha, "view": view})
    return [
        {"batch": f"{i // batch_size + 1:03d}", "checker_version": checker.CHECKER_VERSION,
         "allowed_sites": list(checker.ALLOWED_SITES), "questions": questions[i:i + batch_size]}
        for i in range(0, len(questions), batch_size)
    ]


def _evidence(verdict):
    claims = verdict.get("claims")
    return {
        "model_verdict": verdict.get("verdict"),
        "summary": str(verdict.get("summary") or "")[:2000],
        "claims": claims[:MAX_CLAIMS_KEPT] if isinstance(claims, list) else [],
    }


def _apply_one(verdict, dataset, journal, now, outcomes, approved_games, needs_owner):
    if not isinstance(verdict, dict):
        journal.log("rejected", "malformed_verdict")
        return
    game, qid = str(verdict.get("game") or ""), str(verdict.get("qid") or "")
    if game not in checker.STAGED_GAMES:
        journal.log("rejected", "not_staged", game=game[:32], qid=qid[:48])
        return
    row = Question.objects.filter(game=game, qid=qid).first()
    if row is None or row.status != Question.STATUS_PENDING:
        journal.log("rejected", "not_pending", game=game, qid=qid[:48])
        return
    _, sha = _view(row, dataset)
    if sha is None or verdict.get("payload_sha") != sha:
        journal.log("rejected", "stale", game=game, qid=qid, current_sha=sha)
        return
    outcome, reason = checker.judge(verdict)
    evidence = _evidence(verdict)
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


def apply_verdicts(directory, dataset, journal, now):
    """Apply every verdicts-*.json in `directory`; returns a summary dict."""
    outcomes, approved_games, needs_owner = Counter(), set(), []
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
            _apply_one(verdict, dataset, journal, now, outcomes, approved_games, needs_owner)
    return {"approved": outcomes["valid"], "quarantined": outcomes["invalid"], "unsure": outcomes["unsure"],
            "games": sorted(approved_games), "needs_owner": needs_owner}
