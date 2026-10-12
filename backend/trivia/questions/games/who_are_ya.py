"""Who Are Ya — one recognizable mystery player (fame band KNOWN or better,
trivia.questions.fame). Rules moved from trivia/games/who_are_ya.py; the gate
moved from fame_tier 1-2 to fame bands in question-factory phase 1 (the tier
is a floor, so every tier 1-2 player stays eligible). TARGET None = every
eligible player gets a question."""
from trivia.questions import fame
from trivia.questions.base import Invalid, envelope
from trivia.questions.hashing import content_hash

SLUG = "who-are-ya"
TARGET = None
MINIMUM = 30
MIN_FAME_BAND = fame.KNOWN


def _eligible(row):
    return fame.at_least(row, MIN_FAME_BAND) and bool(row.get("teams"))


def generate(dataset, existing_hashes, rng, n):
    out = []
    for r in sorted((r for r in dataset.playable if _eligible(r)), key=lambda r: r["person_id"]):
        d = {"person_id": r["person_id"]}
        if content_hash(d) in existing_hashes:
            continue
        out.append(d)
        if len(out) >= n:
            break
    return out


def materialize(definition, dataset):
    row = dataset.by_id.get(definition.get("person_id"))
    if row is None:
        raise Invalid(f"person_id {definition.get('person_id')} is not in the playable pool")
    if not _eligible(row):
        raise Invalid(f"{row['full_name']} is fame band {fame.fame_band(row)}; need {MIN_FAME_BAND} or better")
    return envelope(SLUG, None, {"player": row})


def validate(materialized):
    p = materialized.get("player") or {}
    return [] if p.get("full_name") and _eligible(p) else ["player not eligible"]


def index_item(definition, materialized):
    return [None]


def players_referenced(definition, materialized, dataset=None):
    return [definition["person_id"]]


def qid_for(definition, seq):
    return f"way-{seq:06d}"
