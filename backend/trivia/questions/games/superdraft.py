"""SuperDraft Five slot sets. Slot drawing reuses trivia/games/superdraft.py;
the generator adds a MAX_ELIGIBLE cap so a slot is never 'every American'."""
from trivia.games.superdraft import MIN_ELIGIBLE, SLOT_COUNT, _candidate_queues, draw_slots
from trivia.questions.base import Invalid, envelope
from trivia.questions.hashing import content_hash

SLUG = "superdraft"
TARGET = 200
MINIMUM = 30
MAX_ELIGIBLE = 250


def slot_matches(row, slot):
    kind, value = slot.get("kind"), slot.get("value")
    if kind == "team":
        return any((s or {}).get("abbr") == value for s in row.get("teams") or [])
    if kind == "country":
        return row.get("country") == value
    if kind == "draft":
        d = row.get("draft")
        return isinstance(d, dict) and isinstance(d.get("year"), int) and str(d["year"] // 10 * 10) == str(value)
    return False


def _eligible_tuple(row):
    awards = row.get("awards") or {}
    career = row.get("career") or {}
    return [row["person_id"], row.get("height_in"), len(awards.get("rings") or []),
            int(career.get("pts") or 0), row.get("birth_year")]


def _counts(dataset, slots):
    return [sum(1 for r in dataset.playable if slot_matches(r, s)) for s in slots]


def generate(dataset, existing_hashes, rng, n):
    queues = _candidate_queues(dataset.playable)
    queues = [[c for c in q if sum(1 for r in dataset.playable if slot_matches(r, c)) <= MAX_ELIGIBLE] for q in queues]
    out, guard = [], 0
    while len(out) < n and guard < n * 50:
        guard += 1
        slots = draw_slots(queues, rng)
        if len(slots) < SLOT_COUNT:
            break
        d = {"slots": slots}
        if content_hash(d) in existing_hashes:
            continue
        existing_hashes = existing_hashes | {content_hash(d)}
        out.append(d)
    return out


def materialize(definition, dataset):
    slots = definition.get("slots") or []
    if len(slots) != SLOT_COUNT:
        raise Invalid(f"need {SLOT_COUNT} slots")
    filled = []
    for s in slots:
        rows = [r for r in dataset.playable if slot_matches(r, s)]
        if not MIN_ELIGIBLE <= len(rows) <= MAX_ELIGIBLE:
            raise Invalid(f"slot {s.get('label')}: {len(rows)} eligible (need {MIN_ELIGIBLE}-{MAX_ELIGIBLE})")
        filled.append({**s, "eligible": [_eligible_tuple(r) for r in rows]})
    return envelope(SLUG, None, {"slots": filled})


def validate(materialized):
    problems = []
    for s in materialized.get("slots") or []:
        n = len(s.get("eligible") or [])
        if not MIN_ELIGIBLE <= n <= MAX_ELIGIBLE:
            problems.append(f"slot {s.get('label')}: {n} eligible")
    if len(materialized.get("slots") or []) != SLOT_COUNT:
        problems.append("slot count")
    return problems


def index_item(definition, materialized):
    return [None]


def players_referenced(definition, materialized, dataset=None):
    return sorted({t[0] for s in materialized["slots"] for t in s["eligible"]})


def qid_for(definition, seq):
    return f"sd-{seq:06d}"
