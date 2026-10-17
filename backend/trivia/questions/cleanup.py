"""Nightly cleanup of the factory's own tables (spec §4.7, phase 3).

(a) Retired questions older than COMPACT_AFTER are compacted: `definition`, `quality` and
    `players_referenced` are emptied; game, qid, content_hash, status, retired_reason and the
    dates stay. Contexto keeps a slim definition (secret and day). The runner dedupes on
    content_hash and numbers qids from the qid, and Contexto reads only the secret and day of
    every row, so generation is unchanged.
(b) Journal events older than EVENTS_KEPT are deleted; the runs themselves are kept.
(c) SeenQuestion rows of retired questions are deleted (a no-op until seen tracking exists).

Raw answers are pruned by users.retention, only below the roll-up watermark.
"""
import datetime

from django.apps import apps
from django.db import transaction
from django.db.models import Exists, OuterRef

from trivia.models import FactoryEvent, Question

COMPACT_AFTER = datetime.timedelta(days=180)
EVENTS_KEPT = datetime.timedelta(days=180)
SLIM_DEFINITION = {"contexto": ("secret_person_id", "day")}  # what generation still reads


def run(journal, now):
    """Compact, prune and journal; returns {compacted, factory_events, seen_questions}.
    Events are logged after the transaction commits, so they describe what was written."""
    with transaction.atomic():
        per_game = _compact(now - COMPACT_AFTER)
        events = FactoryEvent.objects.filter(created_at__lt=now - EVENTS_KEPT).delete()[0]
        seen = _delete_seen_of_retired()
    for game, n in sorted(per_game.items()):
        journal.log("compacted", "retired_180d", game=game, questions=n)
    counts = {"compacted": sum(per_game.values()), "factory_events": events, "seen_questions": seen}
    journal.log("cleaned", "retention", **counts)
    return counts


def _slim(game, definition):
    keep = SLIM_DEFINITION.get(game, ())
    return {k: definition[k] for k in keep if k in (definition or {})}


def _compact(cutoff):
    per_game, changed = {}, []
    rows = (Question.objects.filter(status=Question.STATUS_RETIRED, retired_at__lt=cutoff)
            .only("id", "game", "definition", "quality", "players_referenced").order_by("id"))
    for row in rows.iterator():
        slim = _slim(row.game, row.definition)
        if row.definition == slim and not row.quality and not row.players_referenced:
            continue  # already compact
        row.definition, row.quality, row.players_referenced = slim, {}, []
        changed.append(row)
        per_game[row.game] = per_game.get(row.game, 0) + 1
    # bulk_update leaves updated_at alone: compaction is not an edit of the question.
    Question.objects.bulk_update(changed, ["definition", "quality", "players_referenced"], batch_size=500)
    return per_game


def _delete_seen_of_retired():
    try:
        seen = apps.get_model("trivia", "SeenQuestion")
    except LookupError:
        return 0
    retired = Question.objects.filter(status=Question.STATUS_RETIRED, game=OuterRef("game"), qid=OuterRef("qid"))
    return seen.objects.filter(Exists(retired)).delete()[0]
