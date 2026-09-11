"""Career Path — one mystery journeyman (3-7 stints), weighted to fame tier 2-3.
Rules moved from trivia/games/career_path.py."""
from trivia.questions.base import Invalid, envelope
from trivia.questions.hashing import content_hash

SLUG = "career-path"
TARGET = 300
MINIMUM = 50
MIN_STINTS, MAX_STINTS = 3, 7


def _eligible(row):
    return MIN_STINTS <= len(row.get("teams") or []) <= MAX_STINTS


def _weight(row):
    return 3 if row.get("fame_tier") in (2, 3) else 1


def generate(dataset, existing_hashes, rng, n):
    candidates = [r for r in dataset.playable if _eligible(r)]
    rng.shuffle(candidates)
    out = []
    for r in candidates:
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
        raise Invalid(f"{row['full_name']} has {len(row['teams'])} stints; need {MIN_STINTS}-{MAX_STINTS}")
    return envelope(SLUG, None, {"player": row})


def validate(materialized):
    p = materialized.get("player") or {}
    problems = []
    if not p.get("full_name"):
        problems.append("player has no full_name")
    if not _eligible(p):
        problems.append("stint count out of range")
    return problems


def index_item(definition, materialized):
    return [None, _weight(materialized["player"])]  # qid is filled by the runner


def players_referenced(definition, materialized, dataset=None):
    return [definition["person_id"]]


def qid_for(definition, seq):
    return f"cp-{seq:06d}"
