"""Admin-only question labeling (the in-app admin panel → Games → Tic-Tac-Toe → View questions).

The owner labels each question Easy, Medium or Hard (trivia.models.QuestionLabel); a question without a label is
not reviewed yet and counts as hard, the default. Each listed question carries what helps judge it: its board as
players see it (row and column criteria), every cell's number of valid answers and its most famous ones (materialized
against the live player dataset, as the publisher does), the question factory's own difficulty score and band
(Question.quality), and how players did on it (QuestionStats: guesses and correct ones, per cell for Tic-Tac-Toe).

Only LABEL_GAMES can be labeled (Tic-Tac-Toe for now). Every view REQUIRES is_staff (IsAdminUser).
"""
from django.db.models import Sum
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response

from trivia.data_pipeline import live_pool
from trivia.models import Question, QuestionLabel, QuestionStats
from trivia.questions.base import Invalid, load_dataset_from_rows
from trivia.questions.games import GAME_MODULES

LABEL_GAMES = ("tictactoe",)
DIFFICULTIES = [d for d, _ in QuestionLabel.DIFFICULTIES]
FILTERS = ("all", "unreviewed", *DIFFICULTIES)
SORTS = ("qid", "factory", "accuracy", "updated")
TOP_ANSWERS = 3

_dataset_cache = {"rows": None, "dataset": None}


def _dataset():
    """The live player dataset as the question modules want it, rebuilt only when live_pool reloads its rows."""
    rows = live_pool.load_dataset()
    if _dataset_cache["rows"] is not rows:
        _dataset_cache.update(rows=rows, dataset=load_dataset_from_rows(rows, "live"))
    return _dataset_cache["dataset"]


def _iso(dt):
    return dt.isoformat() if dt else None


def label_counts(game):
    """{total, reviewed, unreviewed, easy, medium, hard} over the game's active questions; unreviewed count as hard."""
    active = Question.objects.filter(game=game, status=Question.STATUS_ACTIVE)
    total = active.count()
    labels = dict.fromkeys(DIFFICULTIES, 0)
    for d in QuestionLabel.objects.filter(question__in=active).values_list("difficulty", flat=True):
        labels[d] = labels.get(d, 0) + 1
    reviewed = sum(labels.values())
    return {
        "total": total,
        "reviewed": reviewed,
        "unreviewed": total - reviewed,
        "easy": labels["easy"],
        "medium": labels["medium"],
        "hard": labels["hard"] + (total - reviewed),
    }


def _stats(game):
    """qid → {attempts, correct, cells: {cell: {attempts, correct}}}: QuestionStats summed over every day. A
    question_id is the qid, or `<qid>:<cell>` for a game that logs per cell (Tic-Tac-Toe)."""
    out = {}
    rows = (QuestionStats.objects.filter(game=game).values("question_id")
            .annotate(attempts=Sum("attempts"), correct=Sum("correct")))
    for r in rows:
        qid, _, cell = str(r["question_id"]).partition(":")
        s = out.setdefault(qid, {"attempts": 0, "correct": 0, "cells": {}})
        s["attempts"] += r["attempts"] or 0
        s["correct"] += r["correct"] or 0
        if cell:
            c = s["cells"].setdefault(cell, {"attempts": 0, "correct": 0})
            c["attempts"] += r["attempts"] or 0
            c["correct"] += r["correct"] or 0
    return out


def _accuracy(s):
    return round(s["correct"] / s["attempts"], 4) if s and s["attempts"] else None


def _board(mod, definition, dataset, stats):
    """Rows, cols and per-cell answers of a Tic-Tac-Toe board (materialized; on Invalid the stored labels only)."""
    rows, cols = definition.get("rows") or [], definition.get("cols") or []
    try:
        m = mod.materialize(definition, dataset)
    except Invalid as e:
        return {"rows": [r.get("label") for r in rows], "cols": [c.get("label") for c in cols], "cells": None, "error": str(e)}
    cell_stats = (stats or {}).get("cells", {})
    cells = []
    for i, ids in enumerate(m["valid"]):
        top = [dataset.by_id[pid]["full_name"] for pid in ids[:TOP_ANSWERS] if pid in dataset.by_id]
        cs = cell_stats.get(str(i))
        cells.append({"count": len(ids), "top": top, "attempts": cs["attempts"] if cs else 0, "accuracy": _accuracy(cs)})
    return {"rows": [r["label"] for r in m["rows"]], "cols": [c["label"] for c in m["cols"]], "cells": cells, "error": None}


def _criteria_text(definition):
    return " ".join(str(c.get("label", "")) for c in (definition.get("rows") or []) + (definition.get("cols") or [])).lower()


def _game_or_error(game):
    if game not in LABEL_GAMES:
        return Response({"error": f"questions of {game!r} cannot be labeled (only {', '.join(LABEL_GAMES)})"}, status=400)
    return None


@api_view(["GET"])
@permission_classes([IsAdminUser])
def admin_questions(request):
    """One page of a game's active questions: ?game=tictactoe&filter=all|unreviewed|easy|medium|hard&q=&sort=qid|
    factory|accuracy|updated&limit=20&offset=0 → {game, counts, total, offset, rows}. `total` is after the filter."""
    game = str(request.query_params.get("game") or "")
    if (err := _game_or_error(game)) is not None:
        return err
    flt = str(request.query_params.get("filter") or "all")
    sort = str(request.query_params.get("sort") or "qid")
    query = str(request.query_params.get("q") or "").strip().lower()
    if flt not in FILTERS or sort not in SORTS:
        return Response({"error": f"filter must be one of {', '.join(FILTERS)}; sort one of {', '.join(SORTS)}"}, status=400)
    try:
        limit = min(max(int(request.query_params.get("limit", 20)), 1), 50)
        offset = max(int(request.query_params.get("offset", 0)), 0)
    except ValueError:
        return Response({"error": "limit/offset must be integers"}, status=400)

    questions = list(Question.objects.filter(game=game, status=Question.STATUS_ACTIVE).select_related("label"))
    stats = _stats(game)

    def label_of(q):
        return getattr(q, "label", None)

    if flt == "unreviewed":
        questions = [q for q in questions if label_of(q) is None]
    elif flt in DIFFICULTIES:
        questions = [q for q in questions if (label_of(q).difficulty if label_of(q) else QuestionLabel.HARD) == flt]
    if query:
        questions = [q for q in questions if query in q.qid.lower() or query in _criteria_text(q.definition)]

    if sort == "factory":
        questions.sort(key=lambda q: ((q.quality or {}).get("difficulty") is None, (q.quality or {}).get("difficulty") or 0, q.qid))
    elif sort == "accuracy":  # played questions first, hardest (lowest accuracy) first
        questions.sort(key=lambda q: (_accuracy(stats.get(q.qid)) is None, _accuracy(stats.get(q.qid)) or 0, q.qid))
    elif sort == "updated":  # most recently labeled first, then the unreviewed
        questions.sort(key=lambda q: (label_of(q) is None, -(label_of(q).updated_at.timestamp() if label_of(q) else 0), q.qid))
    else:
        questions.sort(key=lambda q: q.qid)

    page = questions[offset : offset + limit]
    mod, dataset = GAME_MODULES[game], _dataset()
    rows = []
    for q in page:
        lab, s = label_of(q), stats.get(q.qid)
        rows.append({
            "id": q.pk,
            "qid": q.qid,
            "label": {"difficulty": lab.difficulty if lab else QuestionLabel.HARD, "reviewed": lab is not None, "updated_at": _iso(lab.updated_at) if lab else None},
            "factory": {"band": (q.quality or {}).get("band"), "difficulty": (q.quality or {}).get("difficulty")},
            "plays": {"attempts": s["attempts"] if s else 0, "correct": s["correct"] if s else 0, "accuracy": _accuracy(s)},
            "board": _board(mod, q.definition, dataset, s),
        })
    return Response({"game": game, "counts": label_counts(game), "total": len(questions), "offset": offset, "rows": rows})


@api_view(["POST"])
@permission_classes([IsAdminUser])
def admin_question_label(request, pk):
    """POST {difficulty: easy|medium|hard} → the question's label (created or changed) and the game's new counts."""
    q = Question.objects.filter(pk=pk).first()
    if q is None:
        return Response({"error": "question not found"}, status=404)
    if (err := _game_or_error(q.game)) is not None:
        return err
    difficulty = str((request.data or {}).get("difficulty") or "")
    if difficulty not in DIFFICULTIES:
        return Response({"error": f"difficulty must be one of {', '.join(DIFFICULTIES)}"}, status=400)
    lab, _ = QuestionLabel.objects.update_or_create(question=q, defaults={"difficulty": difficulty, "labeled_by": request.user})
    return Response({
        "id": q.pk,
        "qid": q.qid,
        "label": {"difficulty": lab.difficulty, "reviewed": True, "updated_at": _iso(lab.updated_at)},
        "counts": label_counts(q.game),
    })
