"""NBA Imposter mystery pool — one row, materialized to the tier<=2 name list
the turn server draws from (rule mirrored from turnGames.js pickMystery)."""
from trivia.questions.base import Invalid, envelope
from trivia.questions.hashing import content_hash

SLUG = "imposter"
TARGET = 1
MINIMUM = 20
MAX_MYSTERY_TIER = 2
DEFINITION = {"rule": "fame_tier<=2"}


def _eligible(row):
    return isinstance(row.get("full_name"), str) and row["full_name"].strip() and (row.get("fame_tier") or 4) <= MAX_MYSTERY_TIER


def generate(dataset, existing_hashes, rng, n):
    return [] if content_hash(DEFINITION) in existing_hashes else [dict(DEFINITION)]


def materialize(definition, dataset):
    if definition != DEFINITION:
        raise Invalid(f"unknown imposter rule {definition!r}")
    names = [r["full_name"] for r in dataset.playable if _eligible(r)]
    if len(names) < MINIMUM:
        raise Invalid(f"only {len(names)} mystery names; need >= {MINIMUM}")
    return envelope(SLUG, None, {"names": names})


def validate(materialized):
    names = materialized.get("names") or []
    problems = []
    if len(names) < MINIMUM:
        problems.append(f"{len(names)} names")
    if len({n.lower() for n in names}) != len(names):
        problems.append("duplicate names")
    return problems


def index_item(definition, materialized):
    return [None, len(materialized["names"])]


def players_referenced(definition, materialized, dataset=None):
    if dataset is None:
        return []
    names = set(materialized["names"])
    return sorted(r["person_id"] for r in dataset.playable if r["full_name"] in names)


def qid_for(definition, seq):
    return "imposter-pool"
