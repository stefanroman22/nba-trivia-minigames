"""Hand-off between the Feedback table and the feedback-triage agent (scripts/feedback/run.mjs).

The same shape as the other agent jobs in this app: export a batch, an agent with no database access judges it,
a command applies the verdict. What crosses to the model is the least it needs: the rating, the message, the page
and game it was sent from, the day, and whether the sender was signed in. No email, name or account id leaves.

Left out of a batch: ban appeals (a person decides those), ratings with no message (nothing to interpret), and
anything a person or an earlier run already handled.
"""
from django.utils import timezone

from trivia.models import Feedback

KINDS = ("bug", "idea", "content", "praise", "complaint", "other")
APPEAL_GAME = "appeal"
SUMMARY_MAX = 300
DEFAULT_LIMIT = 200


def pending():
    """New, un-triaged feedback that carries a message, oldest first."""
    return (
        Feedback.objects.filter(status=Feedback.NEW, triage={})
        .exclude(game=APPEAL_GAME)
        .exclude(message="")
        .order_by("created_at", "pk")
    )


def export_batch(limit=DEFAULT_LIMIT, run=None):
    now = timezone.now()
    rows = list(pending()[:limit])
    return {
        "run": run or now.strftime("%Y%m%d-%H%M"),
        "exported_at": now.isoformat(),
        "kinds": list(KINDS),
        "items": [
            {
                "id": f.pk,
                "rating": f.rating,
                "message": f.message,
                "page": f.page,
                "game": f.game,
                "day": f.created_at.date().isoformat(),
                "signed_in": f.user_id is not None,
            }
            for f in rows
        ],
    }


def apply_verdicts(doc):
    """Writes each verdict to its row and marks it read. Only rows still new and un-triaged change, so a second
    apply of the same file, or a row the owner handled meanwhile, is a no-op. Returns the counts."""
    run = str(doc.get("run") or "")
    items = doc.get("items")
    if not run or not isinstance(items, list):
        raise ValueError('The file must be {"run": "...", "items": [...]}.')
    now = timezone.now().isoformat()
    applied = skipped = 0
    problems = []
    for item in items:
        pk, kind = item.get("id"), item.get("kind")
        if not isinstance(pk, int) or kind not in KINDS:
            problems.append(f"item {pk!r}: kind must be one of {', '.join(KINDS)}")
            continue
        triage = {
            "run": run,
            "at": now,
            "kind": kind,
            "summary": str(item.get("summary") or "")[:SUMMARY_MAX],
            "cluster": str(item.get("cluster") or "")[:80],
            "ticket": str(item.get("ticket") or "")[:64],
        }
        changed = Feedback.objects.filter(pk=pk, status=Feedback.NEW, triage={}).update(
            triage=triage, status=Feedback.READ
        )
        applied += changed
        skipped += 1 - changed
    return {"applied": applied, "skipped": skipped, "problems": problems}
