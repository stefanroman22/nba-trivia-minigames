"""Career Path — one mystery journeyman (3-7 stints, fame band DEEP or better),
weighted toward KNOWN/DEEP players over stars. Rules moved from
trivia/games/career_path.py; the fame gate was added in question-factory phase 1
(players nobody can name are no longer eligible)."""
from trivia.questions import checker, fame, specs
from trivia.questions.base import Invalid, envelope
from trivia.questions.hashing import content_hash

SLUG = "career-path"
_SPEC = specs.load(SLUG)  # specs/career-path.json
# 2026-09-30: raised from 300 (expand-question-pools); eligible pool comfortably larger, see docs/team/designs/2026-09-30-expand-question-pools.md
TARGET = _SPEC["refill"]["target"]
MINIMUM = _SPEC["refill"]["minimum"]
MIN_STINTS, MAX_STINTS = _SPEC["eligibility"]["min_stints"], _SPEC["eligibility"]["max_stints"]
MIN_FAME_BAND = getattr(fame, _SPEC["eligibility"]["min_fame_band"])


def _eligible(row):
    return MIN_STINTS <= len(row.get("teams") or []) <= MAX_STINTS and fame.at_least(row, MIN_FAME_BAND)


def _weight(row):
    return 3 if fame.fame_band(row) in (fame.KNOWN, fame.DEEP) else 1


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
        raise Invalid(f"{row['full_name']} has {len(row['teams'])} stints and fame band {fame.fame_band(row)}; "
                      f"need {MIN_STINTS}-{MAX_STINTS} stints and band {MIN_FAME_BAND} or better")
    return envelope(SLUG, None, {"player": row})


def validate(materialized):
    p = materialized.get("player") or {}
    problems = []
    if not p.get("full_name"):
        problems.append("player has no full_name")
    if not _eligible(p):
        problems.append("stint count or fame band out of range")
    return problems


def index_item(definition, materialized):
    return [None, _weight(materialized["player"])]  # qid is filled by the runner


def players_referenced(definition, materialized, dataset=None):
    return [definition["person_id"]]


def checker_view(materialized, dataset=None):
    """Every card (team, years, games played, points per game) and the last card's draft line."""
    p = materialized["player"]
    profile = checker.player_profile(p)
    cards = [f"{label}, GP {s.get('gp')}, PPG {s.get('ppg')}" for label, s in zip(profile["teams"], p.get("teams") or [])]
    return {"kind": SLUG, "player": p["full_name"], "draft": profile["draft"], "teams": cards}


def qid_for(definition, seq):
    return f"cp-{seq:06d}"
