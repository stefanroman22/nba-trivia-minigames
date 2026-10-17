"""The editorial rule language (question factory §4.6): a small JSON query over the dataset.

Claude proposes a rule, code evaluates it to the complete answer set. A rule is a JSON
object naming exactly one predicate or combinator; a predicate's own value comes under its
name, and the only other keys allowed are that predicate's options:

Player rules (category "player", over dataset.playable):

    {"award": "mvp", "min": 2}         kind mvp|fmvp|dpoy|roty|smoy|rings; at least `min` (default 1)
    {"allstar": 10}                    at least 10 All-Star selections
    {"allnba": 5}                      at least 5 All-NBA selections
    {"career": "pts", "min": 30000}    career stat pts|reb|ast|ppg|rpg|apg|seasons >= min
    {"draft": {"pick_max": 1, "round": 1, "year_from": 2010, "year_to": 2019}}
                                       any non-empty subset; or {"undrafted": true} alone; pick_max
                                       counts real picks only (>= 1; a territorial pick is 0)
    {"country": "France"}              NBA.com's country field, case-insensitive
    {"international": true}            country is set and not "USA"
    {"stint": "GSW"}                   played for the franchise (modern abbreviation)
    {"debut_decade": 1990}             first stint's start year // 10 * 10
    {"seasons": 15}                    at least 15 seasons
    {"position": "C"}                  G|F|C, one of the listed positions (F-C counts for F and C)
    {"playoff_team": {"season": "2014-15", "franchise": "Golden State Warriors"}}
                                       on that franchise in that season, and that team-season is in
                                       trivia/data/playoff.json (it made the playoffs)

Team rules (category "team", over the 30 current franchises in trivia/data/name-logo.json,
rows {"name", "abbr", "team_id"}; every playoff.json row is credited to its current franchise):

    {"champion": {"year_from": 2000, "year_to": 2011, "min": 1}}   NBA titles (season end years)
    {"finals": {"year_from": 2020, "min": 1}}                      NBA Finals appearances
    {"playoff_team": {"season": "2014-15", "franchise": "..."}}    in that season's playoffs
                                                                   (franchise optional)

Combinators (either category): {"all": [rule, ...]}, {"any": [rule, ...]}, {"not": rule}.

validate() is strict (unknown keys, wrong types, a predicate of the other category: RuleError);
evaluate() validates first and returns the matching rows in pool order; describe() is the
English reading. Pure Python: no Django, only the committed playoff.json / name-logo.json.

A playoff.json team name is credited to a current franchise (franchise_abbr) by the curated
stints that carry that name in that season (modern abbreviation), else by a single abbreviation
for the name, else by an exact current name, else by playoff.json's own abbreviation when it is
a current one; a defunct franchise (Anderson Packers) maps to none.
"""
import json
import os
import re
import unicodedata
from collections import Counter

from trivia.questions import fame, quality

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
PLAYOFF_PATH = os.path.join(DATA_DIR, "playoff.json")
NAME_LOGO_PATH = os.path.join(DATA_DIR, "name-logo.json")

CATEGORIES = ("player", "team")
AWARDS = ("mvp", "fmvp", "dpoy", "roty", "smoy", "rings")
STATS = ("pts", "reb", "ast", "ppg", "rpg", "apg", "seasons")
POSITIONS = ("G", "F", "C")
DRAFT_KEYS = ("pick_max", "round", "year_from", "year_to", "undrafted")
RANGE_KEYS = ("year_from", "year_to", "min")
FINALS = "NBA Finals"
SEASON_RE = re.compile(r"(\d{4})-(\d{2})")

AWARD_NAMES = {"mvp": "MVP", "fmvp": "Finals MVP", "dpoy": "Defensive Player of the Year",
               "roty": "Rookie of the Year", "smoy": "Sixth Man of the Year", "rings": "an NBA title"}
STAT_NAMES = {"pts": "career points", "reb": "career rebounds", "ast": "career assists",
              "ppg": "career points per game", "rpg": "career rebounds per game",
              "apg": "career assists per game", "seasons": "seasons"}

PLAYER_PREDICATES = ("award", "allstar", "allnba", "career", "draft", "country", "international",
                     "stint", "debut_decade", "seasons", "position", "playoff_team")
TEAM_PREDICATES = ("champion", "finals", "playoff_team")
COMBINATORS = ("all", "any", "not")
OPTIONS = {"award": ("min",), "career": ("min",)}

_files = {}


class RuleError(ValueError):
    """A rule that is not well-formed (never a rule that merely matches nothing)."""


# ------------------------------------------------------------------ data files

def _load(path):
    if path not in _files:
        with open(path, encoding="utf-8") as f:
            _files[path] = json.load(f)
    return _files[path]


def playoff_rows():
    """trivia/data/playoff.json: one row per playoff series."""
    return _load(PLAYOFF_PATH)


def team_rows():
    """The current franchises {"name", "abbr", "team_id"} (trivia/data/name-logo.json), by name."""
    return sorted(({"name": t["full_name"], "abbr": t["abbreviation"], "team_id": t["team_id"]}
                   for t in _load(NAME_LOGO_PATH)), key=lambda t: t["name"])


def season_end_year(season):
    """'1999-00' -> 2000."""
    return int(season[:4]) + 1


def season_teams(season):
    """The team names (as playoff.json spells them) in one season's playoffs."""
    if "season_teams" not in _files:
        index = {}
        for r in playoff_rows():
            index.setdefault(r.get("season"), set()).update((r["team_a"], r["team_b"]))
        _files["season_teams"] = index
    return _files["season_teams"].get(season, set())


def _covers(stint, year):
    """Does a stint include the season ending in `year`? (start_year is the first season's
    start, end_year the last season's end, None while active.)"""
    start, end = stint.get("start_year"), stint.get("end_year")
    return start is not None and start < year and (end is None or year <= end)


def _cached(dataset, key, build):
    extra = getattr(dataset, "extra", None)
    if extra is None:
        return build()
    if key not in extra:
        extra[key] = build()
    return extra[key]


def _stint_names(dataset):
    """{stint name: [stint, ...]} over every dataset row (a stint carries its modern abbr)."""
    def build():
        out = {}
        for row in getattr(dataset, "rows", None) or getattr(dataset, "playable", []):
            for s in row.get("teams") or []:
                if s.get("name") and s.get("abbr"):
                    out.setdefault(s["name"], []).append(s)
        return out
    return _cached(dataset, "rules_stint_names", build)


def franchise_abbr(name, year, dataset, playoff_abbr=None):
    """The current franchise (modern abbreviation) a team name of the season ending in `year`
    belongs to, or None (see the module docstring)."""
    stints = _stint_names(dataset).get(name) or []
    during = Counter(s["abbr"] for s in stints if _covers(s, year))
    if during:
        return during.most_common(1)[0][0]
    anytime = {s["abbr"] for s in stints}
    if len(anytime) == 1:
        return anytime.pop()
    current = {t["name"]: t["abbr"] for t in team_rows()}
    if name in current:
        return current[name]
    if playoff_abbr in set(current.values()):
        return playoff_abbr
    return None


def _round_depth(row, team):
    """0..1: how far a team got in one series' round (lost there; 1 = won the Finals)."""
    rnd = row.get("round")
    if rnd == FINALS:
        return 1.0 if row.get("winner") == team else 0.75
    return {"Conference Finals": 0.5, "Conference Semifinals": 0.25}.get(rnd, 0.0)


def team_season_strength(season, name):
    """0..1 depth of a playoff run (won the title 1, lost the Finals 0.75, the conference
    finals 0.5, the semifinals 0.25, earlier 0), or None when the team-season is not in
    playoff.json."""
    best = None
    for r in playoff_rows():
        if r.get("season") == season and name in (r.get("team_a"), r.get("team_b")):
            best = max(best or 0.0, _round_depth(r, name))
    return best


def _team_index(dataset):
    """{modern abbr: {"titles": [years], "finals": [years], "seasons": {season: [names]}}}."""
    def build():
        out = {}
        for r in playoff_rows():
            year = season_end_year(r["season"])
            for side in ("team_a", "team_b"):
                abbr = franchise_abbr(r[side], year, dataset, r.get(f"{side}_abbreviation"))
                if abbr is None:
                    continue
                entry = out.setdefault(abbr, {"titles": [], "finals": [], "seasons": {}})
                names = entry["seasons"].setdefault(r["season"], [])
                if r[side] not in names:
                    names.append(r[side])
                if r.get("round") == FINALS:
                    entry["finals"].append(year)
                    if r.get("winner") == r[side]:
                        entry["titles"].append(year)
        return out
    return _cached(dataset, "rules_team_index", build)


# ------------------------------------------------------------------ validation

def _fail(msg):
    raise RuleError(msg)


def _is_int(v):
    return type(v) is int


def _int_at_least(v, low, what):
    if not _is_int(v) or v < low:
        _fail(f"{what} must be an integer >= {low}, got {v!r}")


def check_season(v, what):
    m = SEASON_RE.fullmatch(v) if isinstance(v, str) else None
    if m is None or (int(m.group(1)) + 1) % 100 != int(m.group(2)):
        _fail(f"{what} must be a season like '2014-15', got {v!r}")


def _range(value, name, allowed):
    if not isinstance(value, dict):
        _fail(f"{name} takes an object, got {value!r}")
    unknown = set(value) - set(allowed)
    if unknown:
        _fail(f"{name}: unknown key(s) {', '.join(sorted(unknown))} (allowed: {', '.join(allowed)})")
    for key in ("year_from", "year_to"):
        if key in value:
            _int_at_least(value[key], 1900, f"{name}.{key}")
    if "year_from" in value and "year_to" in value and value["year_from"] > value["year_to"]:
        _fail(f"{name}: year_from is after year_to")


def _check_predicate(name, value, rule, category):
    if name == "award":
        if value not in AWARDS:
            _fail(f"award must be one of {'|'.join(AWARDS)}, got {value!r}")
        if "min" in rule:
            _int_at_least(rule["min"], 1, "award min")
    elif name in ("allstar", "allnba", "seasons"):
        _int_at_least(value, 1, name)
    elif name == "career":
        if value not in STATS:
            _fail(f"career must be one of {'|'.join(STATS)}, got {value!r}")
        if "min" not in rule:
            _fail("career needs a min")
        if type(rule["min"]) not in (int, float) or rule["min"] < 0:
            _fail(f"career min must be a number >= 0, got {rule['min']!r}")
    elif name == "draft":
        _range(value, "draft", DRAFT_KEYS)
        if not value:
            _fail("draft needs at least one of " + ", ".join(DRAFT_KEYS))
        if "undrafted" in value:
            if value["undrafted"] is not True:
                _fail("draft undrafted must be true")
            if len(value) > 1:
                _fail("draft undrafted cannot be combined with other draft keys")
        for key in ("pick_max", "round"):
            if key in value:
                _int_at_least(value[key], 1, f"draft {key}")
    elif name == "country":
        if not isinstance(value, str) or not value.strip():
            _fail("country must be a non-empty string")
    elif name == "international":
        if value is not True:
            _fail("international must be true")
    elif name == "stint":
        if not isinstance(value, str) or not re.fullmatch(r"[A-Z]{2,4}", value):
            _fail(f"stint must be a modern team abbreviation like 'GSW', got {value!r}")
    elif name == "debut_decade":
        if not _is_int(value) or value % 10 or not 1940 <= value <= 2100:
            _fail(f"debut_decade must be a decade like 1990, got {value!r}")
    elif name == "position":
        if value not in POSITIONS:
            _fail(f"position must be one of {'|'.join(POSITIONS)}, got {value!r}")
    elif name == "playoff_team":
        _range(value, "playoff_team", ("season", "franchise"))
        if "season" not in value:
            _fail("playoff_team needs a season")
        check_season(value["season"], "playoff_team season")
        if "franchise" in value and (not isinstance(value["franchise"], str) or not value["franchise"].strip()):
            _fail("playoff_team franchise must be a team name")
        if category == "player" and "franchise" not in value:
            _fail("playoff_team needs a franchise for a player rule")
    elif name in ("champion", "finals"):
        _range(value, name, RANGE_KEYS)
        if "min" in value:
            _int_at_least(value["min"], 1, f"{name} min")


def _split(rule):
    if not isinstance(rule, dict):
        _fail(f"a rule must be an object, got {type(rule).__name__}")
    known = [k for k in rule if k in PLAYER_PREDICATES or k in TEAM_PREDICATES or k in COMBINATORS]
    if len(known) != 1:
        _fail(f"a rule names exactly one predicate or combinator, got {sorted(rule) or 'none'}")
    name = known[0]
    extra = set(rule) - {name} - set(OPTIONS.get(name, ()))
    if extra:
        _fail(f"{name}: unknown key(s) {', '.join(sorted(extra))}")
    return name, rule[name]


def validate(rule, category="player"):
    """Raise RuleError unless `rule` is a well-formed rule of `category` (player|team)."""
    if category not in CATEGORIES:
        _fail(f"category must be one of {'|'.join(CATEGORIES)}, got {category!r}")
    name, value = _split(rule)
    if name in ("all", "any"):
        if not isinstance(value, list) or not value:
            _fail(f"{name} takes a non-empty list of rules")
        for sub in value:
            validate(sub, category)
        return
    if name == "not":
        validate(value, category)
        return
    allowed = PLAYER_PREDICATES if category == "player" else TEAM_PREDICATES
    if name not in allowed:
        _fail(f"{name} is not a {category} predicate (allowed: {', '.join(allowed)})")
    _check_predicate(name, value, rule, category)


# ------------------------------------------------------------------ evaluation

def _player_playoff(value, row, dataset):
    season, franchise = value["season"], value["franchise"]
    if franchise not in season_teams(season):
        return False
    year = season_end_year(season)
    abbr = franchise_abbr(franchise, year, dataset)
    return any(_covers(s, year) and (s.get("name") == franchise or (abbr and s.get("abbr") == abbr))
               for s in row.get("teams") or [])


def _match_player(name, value, rule, row, dataset):
    awards = row.get("awards") or {}
    career = row.get("career") or {}
    if name == "award":
        got = awards.get(value)
        n = (1 if got else 0) if value == "roty" else len(got or [])
        return n >= rule.get("min", 1)
    if name == "allstar":
        return (awards.get("allstar_count") or 0) >= value
    if name == "allnba":
        return (awards.get("allnba_count") or 0) >= value
    if name == "career":
        return (career.get(value) or 0) >= rule["min"]
    if name == "seasons":
        return (career.get("seasons") or 0) >= value
    if name == "draft":
        d = row.get("draft")
        if value.get("undrafted"):
            return not d
        if not d:
            return False
        pick, rnd, year = d.get("pick"), d.get("round"), d.get("year")
        # A real pick is >= 1: territorial / unknown picks are stored as 0 (tictactoe's rule).
        return (("pick_max" not in value or (pick is not None and 1 <= pick <= value["pick_max"]))
                and ("round" not in value or rnd == value["round"])
                and ("year_from" not in value or (year is not None and year >= value["year_from"]))
                and ("year_to" not in value or (year is not None and year <= value["year_to"])))
    if name == "country":
        return (row.get("country") or "").lower() == value.strip().lower()
    if name == "international":
        return (row.get("country") or "USA") != "USA"
    if name == "stint":
        return any(s.get("abbr") == value for s in row.get("teams") or [])
    if name == "debut_decade":
        first = quality.first_year(row)
        return first is not None and first // 10 * 10 == value
    if name == "position":
        return value in (row.get("position") or "").split("-")
    if name == "playoff_team":
        return _player_playoff(value, row, dataset)
    raise RuleError(f"unknown predicate {name}")  # unreachable after validate()


def _in_range(years, value):
    lo, hi = value.get("year_from", 0), value.get("year_to", 10 ** 4)
    return sum(1 for y in years if lo <= y <= hi) >= value.get("min", 1)


def _match_team(name, value, row, dataset):
    entry = _team_index(dataset).get(row["abbr"]) or {"titles": [], "finals": [], "seasons": {}}
    if name == "champion":
        return _in_range(entry["titles"], value)
    if name == "finals":
        return _in_range(entry["finals"], value)
    if name == "playoff_team":
        names = entry["seasons"].get(value["season"]) or []
        return bool(names) and ("franchise" not in value or value["franchise"] in names
                                or value["franchise"] in (row["name"], row["abbr"]))
    raise RuleError(f"unknown predicate {name}")  # unreachable after validate()


def _matches(rule, row, dataset, category):
    name, value = _split(rule)
    if name == "all":
        return all(_matches(sub, row, dataset, category) for sub in value)
    if name == "any":
        return any(_matches(sub, row, dataset, category) for sub in value)
    if name == "not":
        return not _matches(value, row, dataset, category)
    if category == "team":
        return _match_team(name, value, row, dataset)
    return _match_player(name, value, rule, row, dataset)


def matches(rule, row, dataset, category="player"):
    """Does one row match an already validated rule?"""
    return _matches(rule, row, dataset, category)


def evaluate(rule, dataset, category="player"):
    """The rows matching `rule`, in pool order: dataset.playable rows for a player rule,
    team_rows() for a team rule. Raises RuleError on a malformed rule."""
    validate(rule, category)
    rows = team_rows() if category == "team" else dataset.playable
    return [row for row in rows if _matches(rule, row, dataset, category)]


def fold(name):
    """'Nikola Jokić' -> 'nikola jokic': the key names are matched on."""
    folded = "".join(c for c in unicodedata.normalize("NFKD", name or "") if not unicodedata.combining(c))
    return folded.lower().strip()


def players_by_name(dataset):
    """{fold(full_name): playable row}; a name shared by several players means the most
    famous one (fame score, then seasons), as a board about him would."""
    def build():
        out = {}
        for row in dataset.playable:
            key = fold(row.get("full_name"))
            held = out.get(key)
            if held is None or _prominence(row) > _prominence(held):
                out[key] = row
        return out
    return _cached(dataset, "rules_players_by_name", build)


def _prominence(row):
    return (fame.fame_score(row), (row.get("career") or {}).get("seasons") or 0)


def team_titles(abbr, dataset):
    """(titles, finals appearances) of a current franchise over playoff.json."""
    entry = _team_index(dataset).get(abbr) or {"titles": [], "finals": []}
    return len(entry["titles"]), len(entry["finals"])


# ------------------------------------------------------------------ describe

def _times(n):
    return "" if n == 1 else f" at least {n} times"


def _years(value):
    lo, hi = value.get("year_from"), value.get("year_to")
    if lo and hi:
        return f" from {lo} to {hi}"
    if lo:
        return f" in {lo} or later"
    if hi:
        return f" in {hi} or earlier"
    return ""


def _describe_predicate(name, value, rule):
    if name == "award":
        return f"won {AWARD_NAMES[value]}{_times(rule.get('min', 1))}"
    if name == "allstar":
        return f"made at least {value} All-Star teams"
    if name == "allnba":
        return f"made at least {value} All-NBA teams"
    if name == "career":
        verb = "averaged" if value.endswith("pg") else {"pts": "scored", "seasons": "played"}.get(value, "had")
        return f"{verb} at least {rule['min']} {STAT_NAMES[value]}"
    if name == "seasons":
        return f"played at least {value} seasons"
    if name == "draft":
        if value.get("undrafted"):
            return "went undrafted"
        parts = []
        if "pick_max" in value:
            parts.append(f"with pick {value['pick_max']} or better")
        if "round" in value:
            parts.append(f"in round {value['round']}")
        years = _years(value).strip()
        if years:
            parts.append(years)
        return "was drafted " + ", ".join(parts)
    if name == "country":
        return f"is from {value}"
    if name == "international":
        return "was born outside the USA"
    if name == "stint":
        return f"played for {value}"
    if name == "debut_decade":
        return f"debuted in the {value}s"
    if name == "position":
        return f"plays {value}"
    if name == "playoff_team":
        return f"was on the {value['season']} {value.get('franchise', 'playoff teams')}"
    what = "won the NBA title" if name == "champion" else "reached the NBA Finals"
    return f"{what}{_times(value.get('min', 1))}{_years(value)}"


def describe(rule):
    """An English reading of a (valid) rule, e.g. 'won MVP at least 2 times'."""
    name, value = _split(rule)
    if name in ("all", "any"):
        joined = f" {'and' if name == 'all' else 'or'} ".join(
            f"({describe(sub)})" if _split(sub)[0] in ("all", "any") else describe(sub) for sub in value)
        return joined
    if name == "not":
        return f"not ({describe(value)})"
    return _describe_predicate(name, value, rule)
