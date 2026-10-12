# backend/trivia/questions/games/contexto.py
"""LeContexto: one secret per day, ranking precomputed over the whole playable pool."""
import datetime

from trivia.questions import checker, fame
from trivia.questions.base import Invalid, envelope
from trivia.questions.hashing import content_hash
from trivia.questions.similarity import rank_pool

SLUG = "contexto"
TARGET = 60            # days scheduled ahead
MINIMUM = 30
MIN_SECRET_BAND = fame.KNOWN  # ~500 candidates: a full year without a repeat
NO_REPEAT_DAYS = 365


def _existing(dataset):
    return getattr(dataset, "extra", {}).get("contexto_existing", [])


def generate(dataset, existing_hashes, rng, n, today=None):
    today = today or datetime.datetime.now(datetime.timezone.utc).date()
    existing = _existing(dataset)
    taken_days = {e["day"] for e in existing}
    cutoff = (today - datetime.timedelta(days=NO_REPEAT_DAYS)).isoformat()
    recent_secrets = {e["secret_person_id"] for e in existing if e["day"] >= cutoff}
    candidates = [r for r in dataset.playable if fame.at_least(r, MIN_SECRET_BAND) and r["person_id"] not in recent_secrets]
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
    if not fame.at_least(secret, MIN_SECRET_BAND):
        raise Invalid(f"{secret['full_name']} is fame band {fame.fame_band(secret)}; need {MIN_SECRET_BAND} or better")
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


def players_referenced(definition, materialized, dataset=None):
    return [definition["secret_person_id"]]


def checker_view(materialized, dataset=None):
    """The secret's facts; the day and the computed ranking are not claims to check."""
    return {"kind": SLUG, **checker.player_profile(materialized["secret"])}


def qid_for(definition, seq):
    return f"ctx-{definition['day']}"
