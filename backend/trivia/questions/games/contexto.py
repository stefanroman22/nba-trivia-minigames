# backend/trivia/questions/games/contexto.py
"""LeContexto: one secret per day, ranking precomputed over the whole playable pool."""
import datetime

from trivia.questions.base import Invalid, envelope
from trivia.questions.hashing import content_hash
from trivia.questions.similarity import rank_pool

SLUG = "contexto"
TARGET = 90            # days scheduled ahead
MINIMUM = 30
SECRET_FAME_TIERS = (1, 2)
NO_REPEAT_DAYS = 365


def _existing(dataset):
    return getattr(dataset, "extra", {}).get("contexto_existing", [])


def generate(dataset, existing_hashes, rng, n, today=None):
    today = today or datetime.datetime.now(datetime.timezone.utc).date()
    existing = _existing(dataset)
    taken_days = {e["day"] for e in existing}
    cutoff = (today - datetime.timedelta(days=NO_REPEAT_DAYS)).isoformat()
    recent_secrets = {e["secret_person_id"] for e in existing if e["day"] >= cutoff}
    candidates = [r for r in dataset.playable if r.get("fame_tier") in SECRET_FAME_TIERS and r["person_id"] not in recent_secrets]
    rng.shuffle(candidates)
    start = today
    if taken_days:
        last_taken = max(datetime.date.fromisoformat(d) for d in taken_days)
        if last_taken >= start:
            start = last_taken + datetime.timedelta(days=1)
    out, day = [], start
    while len(out) < n and candidates:
        stamp = day.isoformat()
        day += datetime.timedelta(days=1)
        if stamp in taken_days:
            continue
        secret = candidates.pop()
        d = {"secret_person_id": secret["person_id"], "day": stamp}
        if content_hash(d) in existing_hashes:
            continue
        out.append(d)
    return out


def materialize(definition, dataset):
    secret = dataset.by_id.get(definition.get("secret_person_id"))
    if secret is None:
        raise Invalid(f"secret {definition.get('secret_person_id')} is not in the playable pool")
    if secret.get("fame_tier") not in SECRET_FAME_TIERS:
        raise Invalid(f"{secret['full_name']} is fame tier {secret.get('fame_tier')}; need 1-2")
    year = int(definition["day"][:4])
    ranking = [[pid, rank] for pid, rank in rank_pool(secret, dataset.playable, year)]
    return envelope(SLUG, None, {"day": definition["day"], "secret": secret, "ranking": ranking})


def validate(materialized):
    ranking = materialized.get("ranking") or []
    problems = []
    if not ranking or ranking[0][1] != 1 or ranking[0][0] != (materialized.get("secret") or {}).get("person_id"):
        problems.append("ranking must start with the secret at rank 1")
    if len({r[0] for r in ranking}) != len(ranking):
        problems.append("duplicate person_id in ranking")
    return problems


def index_item(definition, materialized):
    return [None, definition["day"]]


def players_referenced(definition, materialized):
    return [definition["secret_person_id"]]


def qid_for(definition, seq):
    return f"ctx-{definition['day']}"
