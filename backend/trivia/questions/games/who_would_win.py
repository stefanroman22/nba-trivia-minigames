"""Who Would Win — a vote between two team-seasons (spec §4.6).

Definition: {"a": {"season", "franchise", "sub"}, "b": {...}}. `season` is a playoff season
("1995-96") or a decade ("1960s"); `franchise` is the team's name as trivia/data/playoff.json
spells it that season ("Seattle SuperSonics", not "Oklahoma City Thunder"); `sub` is the
one-line teaser shown under the label. A side is valid only when playoff.json has that
team-season (any season of the decade for a decade side), and the two sides differ.

materialize renders each side's label like the seed: the season's end year and the
nickname ("'96 Bulls", "'01 Sixers", "'60s Celtics"; NICKNAMES shortens the long ones).
side_from_label() reads a seed label back into a side (the seed import uses it).

Features (1 = harder / more interesting), from playoff.json: a side's strength is the depth
of its run (title 1, lost the Finals 0.75, conference finals 0.5, semifinals 0.25, earlier 0;
the best season of a decade side). closeness = 1 - |strength a - strength b| (a close call is
hard to pick), era_gap = |end year a - end year b| / 40 capped at 1 (a decade side counts as
its middle year), pedigree (interest) = mean strength. Coverage: both sides' decades and
current franchises. Featured: the two team-seasons, so max_player_share caps how often one
team-season appears.
"""
import re

from trivia.questions import quality, rules, specs
from trivia.questions.base import Invalid, envelope

SLUG = "who-would-win"
_SPEC = specs.load(SLUG)  # specs/who-would-win.json
TARGET = _SPEC["refill"]["target"]
MINIMUM = _SPEC["refill"]["minimum"]
MAX_LABEL_LEN = 60  # trivia.games.who_would_win's pool limits
MAX_SUB_LEN = 90
ERA_SPAN_YEARS = 40
SIDE_KEYS = {"season", "franchise", "sub"}
DECADE_RE = re.compile(r"(\d{3})0s")
LABEL_RE = re.compile(r"'(\d{2})(s?) (.+)")
NICKNAMES = {"76ers": "Sixers", "Mavericks": "Mavs", "Cavaliers": "Cavs", "Timberwolves": "Wolves",
             "SuperSonics": "Sonics"}


def generate(dataset, existing_hashes, rng, n):
    """Nothing to invent by code: matchups come from the author (spec §4.6)."""
    return []


def nickname(name):
    last = name.split()[-1]
    return NICKNAMES.get(last, last)


def _seasons(season):
    """The playoff seasons a side's season covers: itself, or every season of a decade
    (end years decade..decade+9)."""
    m = DECADE_RE.fullmatch(season)
    if m is None:
        rules.check_season(season, "season")
        return [season]
    decade = int(m.group(1)) * 10
    return sorted({r["season"] for r in rules.playoff_rows()
                   if decade <= rules.season_end_year(r["season"]) <= decade + 9})


def _side(side, dataset):
    if not isinstance(side, dict) or set(side) != SIDE_KEYS:
        raise Invalid(f"a side is {{season, franchise, sub}}, got {side!r}")
    season, franchise, sub = side["season"], side["franchise"], side["sub"]
    if not isinstance(sub, str) or not sub.strip():
        raise Invalid("a side needs a sub")
    if not isinstance(season, str) or not isinstance(franchise, str):
        raise Invalid("season and franchise must be strings")
    try:
        seasons = [s for s in _seasons(season) if franchise in rules.season_teams(s)]
    except rules.RuleError as e:
        raise Invalid(str(e)) from None
    if not seasons:
        raise Invalid(f"{season} {franchise} is not a team-season in playoff.json")
    decade = DECADE_RE.fullmatch(season)
    if decade:
        year = int(decade.group(1)) * 10 + 5
        label = f"'{year // 10 % 10}0s {nickname(franchise)}"
    else:
        year = rules.season_end_year(season)
        label = f"'{year % 100:02d} {nickname(franchise)}"
    last = rules.season_end_year(seasons[-1])
    return {"label": label, "sub": sub, "season": season, "franchise": franchise, "year": year,
            "strength": max(rules.team_season_strength(s, franchise) for s in seasons),
            "abbr": rules.franchise_abbr(franchise, last, dataset) or "?"}


def side_from_label(label, sub):
    """The side a seed label names: "'96 Bulls" -> 1995-96 Chicago Bulls, "'60s Celtics" ->
    1960s Boston Celtics. Raises Invalid unless exactly one playoff team matches."""
    m = LABEL_RE.fullmatch(label or "")
    if m is None:
        raise Invalid(f"cannot read the label {label!r}")
    yy, decade, nick = int(m.group(1)), m.group(2), m.group(3)
    year = (1900 if yy > 40 else 2000) + yy
    season = f"{year}s" if decade else f"{year - 1}-{year % 100:02d}"
    names = {n for s in _seasons(season) for n in rules.season_teams(s) if nickname(n) == nick}
    if len(names) != 1:
        raise Invalid(f"{label!r}: {len(names)} playoff teams match ({', '.join(sorted(names))})")
    return {"season": season, "franchise": names.pop(), "sub": sub}


def materialize(definition, dataset):
    if not isinstance(definition, dict) or set(definition) != {"a", "b"}:
        raise Invalid("a matchup is {a, b}")
    a, b = _side(definition["a"], dataset), _side(definition["b"], dataset)
    if (a["season"], a["franchise"]) == (b["season"], b["franchise"]):
        raise Invalid("both sides are the same team-season")
    return envelope(SLUG, None, {"a": a, "b": b})


def validate(materialized):
    problems = []
    for key in ("a", "b"):
        s = materialized.get(key) or {}
        if not s.get("label") or len(s["label"]) > MAX_LABEL_LEN:
            problems.append(f"side {key}: label empty or longer than {MAX_LABEL_LEN}")
        if len(s.get("sub") or "") > MAX_SUB_LEN:
            problems.append(f"side {key}: sub longer than {MAX_SUB_LEN}")
    return problems


def pool_row(materialized):
    """The published matchup: today's who-would-win.json row, field for field."""
    m = materialized
    return {"qid": m["qid"], **{k: {"label": m[k]["label"], "sub": m[k]["sub"]} for k in ("a", "b")}}


def index_item(definition, materialized):
    return [None]  # qid is filled by the runner


def players_referenced(definition, materialized, dataset=None):
    return []


def featured(definition, materialized):
    return [f"{materialized[k]['season']} {materialized[k]['franchise']}" for k in ("a", "b")]


def checker_view(materialized, dataset=None):
    """Both team-seasons and the teaser line under each."""
    m = materialized
    return {"kind": SLUG, **{k: {"team_season": f"{m[k]['season']} {m[k]['franchise']}", "sub": m[k]["sub"]}
                             for k in ("a", "b")}}


def features(materialized, dataset=None):
    """Normalization in the module docstring (1 = harder / more interesting)."""
    a, b = materialized["a"], materialized["b"]
    return {
        "closeness": 1 - abs(a["strength"] - b["strength"]),
        "era_gap": quality._clamp(abs(a["year"] - b["year"]) / ERA_SPAN_YEARS),
        "pedigree": (a["strength"] + b["strength"]) / 2,
    }


def coverage(materialized, dataset=None):
    sides = (materialized["a"], materialized["b"])
    return {"decade": [quality.decade(s["year"]) for s in sides], "team": [s["abbr"] for s in sides]}


def dup_key(definition, materialized):
    """The two team-seasons, sorted: a swapped pair is the same matchup."""
    return " | ".join(sorted(f"{s['season']} {s['franchise']}" for s in (definition["a"], definition["b"])))


def qid_for(definition, seq):
    return f"www-{seq:03d}"
