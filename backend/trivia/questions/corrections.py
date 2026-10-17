"""Data corrections overlaid on the curated player rows (spec §4.9).

players_curated.json is generated from nba_api and never hand-edited. A
DataCorrection sets one value inside a row's existing structure, addressed by a
small path: dotted keys and [index] steps ("awards.smoy", "teams[2].end_year",
"draft.team_abbr", "jersey"). A path that does not resolve (missing key, index
out of range, wrong container type, a new top-level key) is journaled and
skipped: a bad correction never breaks a publish.
"""
import copy
import logging
import re

from django.utils import timezone

logger = logging.getLogger(__name__)

_PATH = re.compile(r"[A-Za-z_]\w*(?:\.[A-Za-z_]\w*|\[\d+\])*")
_STEP = re.compile(r"([A-Za-z_]\w*)|\[(\d+)\]")


class InvalidPath(ValueError):
    pass


def parse_path(path):
    """"teams[2].end_year" -> ["teams", 2, "end_year"]."""
    if not isinstance(path, str) or not _PATH.fullmatch(path):
        raise InvalidPath(f"malformed path {path!r}")
    steps = [key if key else int(index) for key, index in _STEP.findall(path)]
    if steps[0] == "person_id":
        raise InvalidPath("person_id is the row's identity, not a fact")
    return steps


def _locate(row, steps):
    """(container, last step) for steps inside row; never creates anything."""
    node = row
    for i, step in enumerate(steps):
        if isinstance(step, int):
            if not isinstance(node, list):
                raise InvalidPath(f"[{step}] on a {type(node).__name__}")
            if not 0 <= step < len(node):
                raise InvalidPath(f"index {step} out of range ({len(node)})")
        else:
            if not isinstance(node, dict):
                raise InvalidPath(f".{step} on a {type(node).__name__}")
            if step not in node:
                raise InvalidPath(f"missing key {step!r}")
        if i == len(steps) - 1:
            return node, step
        node = node[step]


def read(row, field_path):
    """The value at field_path inside row; InvalidPath when it does not resolve."""
    container, last = _locate(row, parse_path(field_path))
    return container[last]


def active_corrections():
    from trivia.models import DataCorrection

    return list(DataCorrection.objects.filter(status=DataCorrection.STATUS_ACTIVE).order_by("id"))


def _skip(journal, c, reason, error):
    logger.warning("data correction %s skipped (%s): %s %s: %s",
                   c.pk, reason, c.person_id, c.field_path, error)
    if journal is not None:
        journal.log("correction_skipped", reason=reason, correction_id=c.pk,
                    person_id=c.person_id, field_path=c.field_path, error=str(error))


def apply(rows, corrections=None, journal=None):
    """rows with every active correction overlaid. The input rows are never
    mutated: a corrected row is a deep copy. Without corrections, `rows` itself."""
    from trivia.models import DataCorrection

    if corrections is None:
        corrections = active_corrections()
    active = [c for c in corrections if c.status == DataCorrection.STATUS_ACTIVE]
    if not active:
        return rows
    out = list(rows)
    index = {r.get("person_id"): i for i, r in enumerate(out) if isinstance(r, dict)}
    copied = set()
    for c in active:
        i = index.get(c.person_id)
        if i is None:
            _skip(journal, c, "unknown_person", "no row with this person_id")
            continue
        row = out[i] if i in copied else copy.deepcopy(out[i])
        try:
            container, last = _locate(row, parse_path(c.field_path))
        except InvalidPath as e:
            _skip(journal, c, "invalid_path", e)
            continue
        container[last] = copy.deepcopy(c.new_value)
        out[i] = row
        copied.add(i)
    return out


def mark_redundant(rows, corrections=None, journal=None):
    """Mark redundant every active correction whose new_value the regenerated
    `rows` already hold; returns them. Saved when they are DB rows."""
    from trivia.models import DataCorrection

    if corrections is None:
        corrections = active_corrections()
    by_id = {r.get("person_id"): r for r in rows if isinstance(r, dict)}
    marked = []
    for c in corrections:
        if c.status != DataCorrection.STATUS_ACTIVE or c.person_id not in by_id:
            continue
        try:
            container, last = _locate(by_id[c.person_id], parse_path(c.field_path))
        except InvalidPath:
            continue
        if container[last] != c.new_value:
            continue
        c.status = DataCorrection.STATUS_REDUNDANT
        c.decided_at = timezone.now()
        if c.pk is not None:
            c.save(update_fields=["status", "decided_at"])
        if journal is not None:
            journal.log("correction_redundant", reason="regenerated_value_matches", correction_id=c.pk,
                        person_id=c.person_id, field_path=c.field_path)
        marked.append(c)
    return marked
