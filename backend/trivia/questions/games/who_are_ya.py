"""Who Are Ya — one famous (tier 1-2) mystery player. Rules moved from
trivia/games/who_are_ya.py. TARGET None = every eligible player gets a question."""
from trivia.questions.base import Invalid, envelope
from trivia.questions.hashing import content_hash

SLUG = "who-are-ya"
TARGET = None
MINIMUM = 30
ELIGIBLE_FAME_TIERS = (1, 2)


def _eligible(row):
    return row.get("fame_tier") in ELIGIBLE_FAME_TIERS and bool(row.get("teams"))


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
        raise Invalid(f"{row['full_name']} is fame tier {row.get('fame_tier')}; need 1-2")
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
