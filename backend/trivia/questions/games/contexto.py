# backend/trivia/questions/games/contexto.py
"""LeContexto: one secret per day, ranking precomputed over the whole playable pool."""
import datetime

from trivia.questions import checker, fame, quality, specs
from trivia.questions.base import Invalid, envelope
from trivia.questions.hashing import content_hash
from trivia.questions.similarity import franchise_seasons, load_v2_spec, rank_pool

SLUG = "contexto"
_SPEC = specs.load(SLUG)  # specs/contexto.json
TARGET = _SPEC["refill"]["target"]            # days scheduled ahead
MINIMUM = _SPEC["refill"]["minimum"]
MIN_SECRET_BAND = getattr(fame, _SPEC["eligibility"]["min_secret_band"])  # ~500 candidates: a full year without a repeat
NO_REPEAT_DAYS = _SPEC["eligibility"]["no_repeat_days"]
SIM_VERSION = 2  # new days; a definition without sim_version is a v1 day and stays v1
_GATE = load_v2_spec()["gate"]  # v2 only: the top of the ranking must feel right to a fan


def _existing(dataset):
    return getattr(dataset, "extra", {}).get("contexto_existing", [])


def generate(dataset, existing_hashes, rng, n, today=None):
    """Schedule up to n secrets on the free days from `today` on. Every secret ever
    scheduled (any status) is excluded for 365 days; only live or pending days
    ("contexto_taken", set by the runner) are occupied, so a retired or quarantined
    day is filled again. A secret whose v2 ranking fails validate() (the gate: no
    one-team-season top 10, enough famous players in the top 20) is skipped, not scheduled."""
    today = today or datetime.datetime.now(datetime.timezone.utc).date()
    existing = _existing(dataset)
    taken_days = {e["day"] for e in getattr(dataset, "extra", {}).get("contexto_taken", existing)}
    cutoff = (today - datetime.timedelta(days=NO_REPEAT_DAYS)).isoformat()
    recent_secrets = {e["secret_person_id"] for e in existing if e["day"] >= cutoff}
    candidates = [r for r in dataset.playable if fame.at_least(r, MIN_SECRET_BAND) and r["person_id"] not in recent_secrets]
    rng.shuffle(candidates)
    out, day = [], today
    while len(out) < n and candidates:
        stamp = day.isoformat()
        day += datetime.timedelta(days=1)
        if stamp in taken_days:
            continue
        secret = candidates.pop()
        d = {"secret_person_id": secret["person_id"], "day": stamp, "sim_version": SIM_VERSION}
        if content_hash(d) in existing_hashes:
            continue
        if validate(materialize(d, dataset)):
            day -= datetime.timedelta(days=1)  # the day stays free for the next candidate
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
    version = definition.get("sim_version", 1)
    ranking = [[pid, rank] for pid, rank in rank_pool(secret, dataset.playable, year, version)]
    if version == 1:  # byte-identical to the days scheduled before v2
        return envelope(SLUG, None, {"day": definition["day"], "secret": secret, "ranking": ranking})
    return envelope(SLUG, None, {"day": definition["day"], "secret": secret, "ranking": ranking,
                                 "sim_version": version, "gate": _gate_facts(ranking, dataset, year)})


def _gate_facts(ranking, dataset, year):
    """What validate() needs about the top of the ranking, the secret (rank 1) left out: does
    the top team_season_top share one team-season, how many of the top famous_top are famous."""
    top = [dataset.by_id[pid] for pid, _ in ranking[1:_GATE["team_season_top"] + 1]]
    shared = set.intersection(*(franchise_seasons(r, year) for r in top)) if top else set()
    famous = [dataset.by_id[pid] for pid, _ in ranking[1:_GATE["famous_top"] + 1]]
    return {"team_season_top": len(top), "shared_team_season": min(shared) if shared else None,
            "famous_top": len(famous),
            "famous": sum(1 for r in famous if fame.at_least(r, getattr(fame, _GATE["min_band"])))}


def validate(materialized):
    ranking = materialized.get("ranking") or []
    problems = []
    if not ranking or ranking[0][1] != 1 or ranking[0][0] != (materialized.get("secret") or {}).get("person_id"):
        problems.append("ranking must start with the secret at rank 1")
    if len({r[0] for r in ranking}) != len(ranking):
        problems.append("duplicate person_id in ranking")
    if materialized.get("sim_version", 1) == 2:
        gate = materialized.get("gate") or {}
        if gate.get("shared_team_season"):
            problems.append(f"the top {gate.get('team_season_top')} all share one team-season "
                            f"({gate['shared_team_season']})")
        if (gate.get("famous") or 0) < _GATE["min_count"]:
            problems.append(f"the top {gate.get('famous_top')} has {gate.get('famous') or 0} "
                            f"{_GATE['min_band']}-or-better players; need {_GATE['min_count']}")
    return problems


def index_item(definition, materialized):
    version = definition.get("sim_version", 1)
    return [None, definition["day"]] if version == 1 else [None, definition["day"], version]


def players_referenced(definition, materialized, dataset=None):
    return [definition["secret_person_id"]]


def checker_view(materialized, dataset=None):
    """The secret and the facts the similarity ranking leans on (position, draft, teams).
    The day and the computed ranking are not claims to check. A v2 day names its
    similarity version (a v1 day's view, and so its checked hash, is unchanged)."""
    profile = checker.player_profile(materialized["secret"])
    view = {"kind": SLUG, **{k: profile[k] for k in ("player", "position", "draft", "teams")}}
    if materialized.get("sim_version", 1) != 1:
        view["sim_version"] = materialized["sim_version"]
    return view


def features(materialized, dataset):
    """Normalization in trivia.questions.quality's docstring (1 = harder / more interesting)."""
    secret = materialized["secret"]
    return {"fame_band": quality.fame_hardness(secret, MIN_SECRET_BAND), "era_age": quality.era_age(secret, dataset),
            "recognizable": 1 - quality.fame_hardness(secret)}


def coverage(materialized, dataset=None):
    return quality.player_coverage(materialized["secret"])


def dup_key(definition, materialized):
    return str(materialized["secret"]["person_id"])


def place(definitions, dataset, today=None):
    """Selection keeps only some candidates, so their days have holes: put the kept
    secrets, in order, on the first free days from `today` (as generate does). The ranking
    year is the day's year, so a gated (v2) secret moved into another year is checked
    again, and dropped (its day left free) if it no longer passes."""
    today = today or datetime.datetime.now(datetime.timezone.utc).date()
    taken = {e["day"] for e in getattr(dataset, "extra", {}).get("contexto_taken", _existing(dataset))}
    out, day = [], today
    for d in definitions:
        while day.isoformat() in taken:
            day += datetime.timedelta(days=1)
        moved = {**d, "day": day.isoformat()}
        if (d.get("sim_version", 1) != 1 and str(d.get("day", ""))[:4] != moved["day"][:4]
                and validate(materialize(moved, dataset))):
            continue
        out.append(moved)
        day += datetime.timedelta(days=1)
    return out


def qid_for(definition, seq):
    return f"ctx-{definition['day']}"
