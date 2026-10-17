"""Connections — sixteen players in four hidden groups of four (spec §4.6).

Definition: {"groups": [{"label", "rule", "members": [4 names], "difficulty": 1..4}, x4]},
optionally "tiles" (the 16 members in the order they are dealt; default: a fixed shuffle
seeded by the board). Exactly four groups of four, sixteen distinct members, difficulties
exactly 1, 2, 3, 4.

A group's rule (trivia.questions.rules, player rules) is checked both ways: each of its
members must match it, and no member of another group may (the board would have two
solutions). A group without a rule (the seed boards: labels such as "1990s Bulls" cannot be
written as a rule) keeps its members as given and is checked only by the label logic of
trivia.games.connections_validate, which also runs on every group: the cross-trap check of
its _derive (a draft year, jersey, country or college the label names, where derivable from
the curated rows) and its own-label check. A member a check cannot place is skipped there,
as in that validator; a member of a ruled group must be in the playable pool.

Features (1 = harder / more interesting): member_fame (mean fame hardness of the members
found in the dataset, 0.5 when none), unruled (share of groups checked only by their label:
hand-written connections ask for knowledge no stat line holds), recognizable (interest: share
of found members in fame band KNOWN or better, 0.5 when none). Coverage: decade of the
members' median debut. No featured players (a member is one tile of sixteen).
"""
import hashlib
import random
import statistics

from trivia.games import connections_validate
from trivia.questions import fame, quality, rules, specs
from trivia.questions.base import Invalid, envelope

SLUG = "connections"
_SPEC = specs.load(SLUG)  # specs/connections.json
TARGET = _SPEC["refill"]["target"]
MINIMUM = _SPEC["refill"]["minimum"]
GROUPS, GROUP_SIZE = _SPEC["eligibility"]["groups"], _SPEC["eligibility"]["group_size"]
GROUP_KEYS = {"label", "rule", "members", "difficulty"}


def generate(dataset, existing_hashes, rng, n):
    """Nothing to invent by code: boards come from the author (spec §4.6)."""
    return []


def _structure(definition):
    if not isinstance(definition, dict) or set(definition) - {"groups", "tiles"} or "groups" not in definition:
        raise Invalid("a board is {groups[, tiles]}")
    groups = definition["groups"]
    if not isinstance(groups, list) or len(groups) != GROUPS:
        raise Invalid(f"a board has {GROUPS} groups")
    for g in groups:
        if not isinstance(g, dict) or set(g) - GROUP_KEYS or not {"label", "members", "difficulty"} <= set(g):
            raise Invalid(f"a group is {{label, members, difficulty[, rule]}}, got {g!r}")
        if not isinstance(g["label"], str) or not g["label"].strip():
            raise Invalid("a group needs a label")
        members = g["members"]
        if not isinstance(members, list) or len(members) != GROUP_SIZE or \
                not all(isinstance(x, str) and x.strip() for x in members):
            raise Invalid(f"'{g['label']}' needs {GROUP_SIZE} member names")
    members = [x for g in groups for x in g["members"]]
    if len(set(members)) != GROUPS * GROUP_SIZE:
        raise Invalid("the sixteen members must be distinct")
    if sorted(g["difficulty"] for g in groups) != list(range(1, GROUPS + 1)) or \
            not all(type(g["difficulty"]) is int for g in groups):
        raise Invalid("the difficulties must be exactly 1, 2, 3, 4")
    tiles = definition.get("tiles")
    if tiles is not None and (not isinstance(tiles, list) or sorted(tiles) != sorted(members)):
        raise Invalid("tiles must be the sixteen members")
    return groups, members


def _curated_index(dataset):
    extra = dataset.extra
    if "connections_curated_index" not in extra:
        extra["connections_curated_index"] = connections_validate._index_curated(dataset.rows)
    return extra["connections_curated_index"]


def _check_rules(groups, dataset):
    by_name = rules.players_by_name(dataset)
    for g in groups:
        if "rule" not in g:
            continue
        try:
            rules.validate(g["rule"])
        except rules.RuleError as e:
            raise Invalid(f"'{g['label']}' rule: {e}") from None
        said = rules.describe(g["rule"])
        for member in g["members"]:
            row = by_name.get(rules.fold(member))
            if row is None:
                raise Invalid(f"'{member}' (in '{g['label']}') is not in the playable pool")
            if not rules.matches(g["rule"], row, dataset):
                raise Invalid(f"'{member}' does not fit its own rule '{g['label']}' ({said})")
        for other in groups:
            if other is g:
                continue
            for member in other["members"]:
                row = by_name.get(rules.fold(member))
                if row is not None and rules.matches(g["rule"], row, dataset):
                    raise Invalid(f"'{member}' (in '{other['label']}') also fits '{g['label']}' ({said})")


def materialize(definition, dataset):
    groups, members = _structure(definition)
    _check_rules(groups, dataset)
    tiles = definition.get("tiles")
    if tiles is None:
        tiles = list(members)
        seed = hashlib.sha256(dup_key(definition, None).encode("utf-8")).hexdigest()[:16]
        random.Random(int(seed, 16)).shuffle(tiles)
    shown = [{"label": g["label"], "difficulty": g["difficulty"], "members": list(g["members"])} for g in groups]
    problems = connections_validate.validate([{"qid": "board", "tiles": tiles, "groups": shown}],
                                             _curated_index(dataset))
    if problems:
        raise Invalid("; ".join(p.removeprefix("board: ") for p in problems[:5]))
    by_name = rules.players_by_name(dataset)
    person_ids = [(by_name.get(rules.fold(x)) or {}).get("person_id") for x in members]
    return envelope(SLUG, None, {"tiles": list(tiles), "groups": shown,
                                 "ruled": [("rule" in g) for g in groups], "person_ids": person_ids})


def validate(materialized):
    tiles = materialized.get("tiles") or []
    groups = materialized.get("groups") or []
    problems = connections_validate.validate([{"qid": "board", "tiles": tiles, "groups": groups}], {})
    return [p.removeprefix("board: ") for p in problems]


def pool_row(materialized):
    """The published board: today's connections.json row, field for field."""
    m = materialized
    return {"qid": m["qid"], "tiles": list(m["tiles"]),
            "groups": [{"label": g["label"], "difficulty": g["difficulty"], "members": list(g["members"])}
                       for g in m["groups"]]}


def index_item(definition, materialized):
    return [None]  # qid is filled by the runner


def _rows(materialized, dataset):
    by_id = getattr(dataset, "by_id", {}) if dataset is not None else {}
    return [by_id[pid] for pid in materialized.get("person_ids") or [] if pid in by_id]


def players_referenced(definition, materialized, dataset=None):
    return list(dict.fromkeys(pid for pid in materialized.get("person_ids") or [] if pid is not None))


def featured(definition, materialized):
    return []


def checker_view(materialized, dataset=None):
    """Every group's label and its four members (each must fit its own label)."""
    return {"kind": SLUG, "groups": [{"label": g["label"], "members": list(g["members"])}
                                     for g in materialized["groups"]]}


def features(materialized, dataset=None):
    """Normalization in the module docstring (1 = harder / more interesting)."""
    rows = _rows(materialized, dataset)
    ruled = materialized.get("ruled") or []
    unruled = 1 - sum(ruled) / len(ruled) if ruled else 1.0
    if not rows:
        return {"member_fame": 0.5, "unruled": unruled, "recognizable": 0.5}
    return {
        "member_fame": statistics.fmean(quality.fame_hardness(r) for r in rows),
        "unruled": unruled,
        "recognizable": sum(1 for r in rows if fame.at_least(r, fame.KNOWN)) / len(rows),
    }


def coverage(materialized, dataset=None):
    years = [y for y in (quality.first_year(r) for r in _rows(materialized, dataset)) if y is not None]
    return {"decade": quality.decade(int(statistics.median_low(years))) if years else "?"}


def dup_key(definition, materialized):
    """The sixteen members, accent-folded and sorted: the same players are the same board."""
    return "|".join(sorted(rules.fold(x) for g in definition["groups"] for x in g["members"]))


def qid_for(definition, seq):
    return f"cn-{seq:03d}"
