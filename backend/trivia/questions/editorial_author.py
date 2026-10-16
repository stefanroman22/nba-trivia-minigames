"""The DB-side jobs around the weekly editorial author (spec §4.6), wrapped by the
export_editorial_brief and apply_editorial_proposals commands (.github/workflows/editorial-author.yml).

build_brief() is everything the author needs and nothing it could misuse: the rule language
(trivia.questions.rules) with worked examples evaluated on today's dataset, the dataset's field
catalogue with value ranges, the prompts, pairs and group labels that already exist, each game's
coverage (which decades, teams, categories are thin), the per-game quota, 40 sample players
trimmed to the fields a rule can read, and the champions and finalists since 1980 (Who Would Win).

apply_proposals() treats the author's proposals.json as untrusted input. Each proposal goes
through the gates the runner applies to a generated candidate (runner._select_and_add):
materialize + validate, quality.score against the game's spec (interest at least interest.min),
a dup_key or content already taken (active or pending; the content hash over every row), and
max_player_share; it is then saved through runner._add as a pending row (created_by "author").
At most QUOTA are accepted per game per run. Nothing here makes a question active: the daily
Checker run decides.
"""
import copy
import json
import os
import random
import statistics
from collections import Counter

from trivia.models import FactoryEvent, Question
from trivia.questions import checker, fame, rules, runner, specs
from trivia.questions import quality as scoring
from trivia.questions.games import GAME_MODULES
from trivia.questions.hashing import content_hash

GAMES = ("fan-favorites", "who-would-win", "connections")
QUOTA = 5
SAMPLE_PLAYERS = 40
TOP_COUNTRIES = 20
NOTABLE_FROM = 1980  # first season end year of the notable team-seasons
LIVE = (Question.STATUS_ACTIVE, Question.STATUS_PENDING)
LISTED = (Question.STATUS_ACTIVE, Question.STATUS_PENDING, Question.STATUS_QUARANTINED)
PROPOSAL_KEYS = {"game", "definition", "why"}
MAX_FILE_BYTES = 1_000_000
MAX_PROPOSALS = 60
MAX_DEFINITION = 10_000  # characters of a definition as JSON
MAX_PROMPT, MAX_LABEL, MAX_SUB, MAX_WHY = 200, 60, 90, 500
EXAMPLES = (
    ("player", {"award": "mvp", "min": 2}),
    ("player", {"all": [{"stint": "LAL"}, {"award": "fmvp"}]}),
    ("player", {"all": [{"international": True}, {"allstar": 5}]}),
    ("player", {"all": [{"draft": {"pick_max": 1}}, {"debut_decade": 2000}]}),
    ("player", {"all": [{"position": "C"}, {"award": "dpoy"}]}),
    ("player", {"all": [{"draft": {"undrafted": True}}, {"not": {"career": "ppg", "min": 15}}, {"seasons": 10}]}),
    ("player", {"playoff_team": {"season": "2015-16", "franchise": "Cleveland Cavaliers"}}),
    ("team", {"champion": {"year_from": 2000, "min": 1}}),
    ("team", {"finals": {"year_from": 1980, "min": 5}}),
)
GROUP_EXAMPLES = (("Sixth Men of the Year", {"award": "smoy"}),
                  ("Defensive Players of the Year", {"award": "dpoy"}),
                  ("Finals MVPs", {"award": "fmvp"}))


# ------------------------------------------------------------------ shared

def _scored(mod, slug, spec, dataset, statuses=LIVE):
    """(rows, [(definition, materialized, scores)]) of a game's questions in `statuses` that
    still materialize (read-only: what runner._process_game scores before it selects)."""
    rows = list(Question.objects.filter(game=slug, status__in=statuses).order_by("id"))
    out = []
    for row in rows:
        m, problems = runner._materialize(mod, row.definition, dataset)
        if not problems:
            out.append((row.definition, m, scoring.score(mod, m, dataset, spec, row.definition)))
    return rows, out


def _dup_key(mod, definition):
    try:
        return mod.dup_key(definition, None)
    except (KeyError, TypeError, AttributeError):
        return None


def _names(rows):
    return [r["full_name"] for r in sorted(rows, key=fame.fame_score, reverse=True)]


# ------------------------------------------------------------------ the brief

def _rule_language(dataset):
    examples = []
    for category, rule in EXAMPLES:
        rows = rules.evaluate(rule, dataset, category=category)
        sample = [r["name"] for r in rows] if category == "team" else _names(rows)
        examples.append({"category": category, "rule": rule, "reads": rules.describe(rule),
                         "matches": len(rows), "sample": sample[:6]})
    for label, rule in GROUP_EXAMPLES:
        rows = rules.evaluate(rule, dataset)
        if len(rows) >= 4:
            examples.append({"category": "player", "reads": rules.describe(rule), "matches": len(rows),
                             "group": {"label": label, "rule": rule, "members": _names(rows)[:4],
                                       "difficulty": 1}})
            break
    return {"reference": (rules.__doc__ or "").strip(), "player_predicates": list(rules.PLAYER_PREDICATES),
            "team_predicates": list(rules.TEAM_PREDICATES), "combinators": list(rules.COMBINATORS),
            "awards": list(rules.AWARDS), "career_stats": list(rules.STATS), "positions": list(rules.POSITIONS),
            "examples": examples}


def _at_least(values, steps):
    return {f"{n}+": sum(1 for v in values if v >= n) for n in steps}


def _spread(values):
    values = sorted(v for v in values if v is not None)
    if not values:
        return {}
    return {"min": values[0], "median": statistics.median(values),
            "p90": values[int(0.9 * (len(values) - 1))], "max": values[-1]}


def _fields(dataset):
    rows = dataset.playable
    awards = [r.get("awards") or {} for r in rows]
    drafts = [r.get("draft") for r in rows]
    years = [d["year"] for d in drafts if d and d.get("year")]
    playoff_years = [rules.season_end_year(r["season"]) for r in rules.playoff_rows()]
    debut = Counter(y // 10 * 10 for y in (scoring.first_year(r) for r in rows) if y is not None)
    return {
        "playable_players": len(rows),
        "positions": dict(Counter(r.get("position") or "?" for r in rows).most_common()),
        "countries": [{"country": c, "players": n}
                      for c, n in Counter(r.get("country") or "?" for r in rows).most_common(TOP_COUNTRIES)],
        "debut_decades": {str(k): v for k, v in sorted(debut.items())},
        "stints": dict(sorted(Counter(a for r in rows for a in {s.get("abbr") for s in r.get("teams") or []}
                                      if a).items())),
        "awards": {
            **{kind: sum(1 for a in awards if (a.get(kind) if kind == "roty" else len(a.get(kind) or [])))
               for kind in rules.AWARDS},
            "allstar": _at_least([a.get("allstar_count") or 0 for a in awards], (1, 5, 10, 15)),
            "allnba": _at_least([a.get("allnba_count") or 0 for a in awards], (1, 3, 5, 10)),
        },
        "career": {stat: _spread([(r.get("career") or {}).get(stat) for r in rows]) for stat in rules.STATS},
        "draft": {"year_from": min(years, default=None), "year_to": max(years, default=None),
                  "undrafted": sum(1 for d in drafts if not d),
                  "first_picks": sum(1 for d in drafts if d and d.get("pick") == 1)},
        "teams": [{"name": t["name"], "abbr": t["abbr"]} for t in rules.team_rows()],
        "playoff_seasons": {"from": min(playoff_years, default=None), "to": max(playoff_years, default=None)},
    }


def _existing():
    out = {slug: [] for slug in GAMES}
    for row in Question.objects.filter(game__in=GAMES, status__in=LISTED).order_by("id"):
        d = row.definition if isinstance(row.definition, dict) else {}
        if row.game == "fan-favorites" and d.get("prompt"):
            out[row.game].append(d["prompt"])
        elif row.game == "who-would-win":
            key = _dup_key(GAME_MODULES[row.game], d)
            if key:
                out[row.game].append(key)
        elif row.game == "connections":
            out[row.game] += [g["label"] for g in d.get("groups") or [] if isinstance(g, dict) and g.get("label")]
    return {slug: sorted(set(items)) for slug, items in out.items()}


def _gaps(counts, universe):
    """The values of an axis below half the mean count (every value when there is none)."""
    mean = sum(counts.get(v, 0) for v in universe) / len(universe) if universe else 0
    return [v for v in universe if counts.get(v, 0) < max(1, mean / 2)]


def _coverage(dataset):
    decades = sorted({scoring.decade(scoring.first_year(r)) for r in dataset.playable
                      if scoring.first_year(r) is not None})
    universes = {"decade": decades, "team": [t["abbr"] for t in rules.team_rows()]}
    out = {}
    for slug in GAMES:
        mod, spec = GAME_MODULES[slug], specs.load(slug)
        rows, scored = _scored(mod, slug, spec, dataset)
        counts = {axis: Counter() for axis in spec["coverage"]["axes"]}
        bands = Counter()
        for _, _, s in scored:
            bands[s["band"]] += 1
            for axis, value in s["coverage"].items():
                counts[axis].update(value if isinstance(value, list) else [value])
        entry = {"questions": len(scored),
                 "counts": {axis: dict(sorted(c.items())) for axis, c in counts.items()},
                 "gaps": {axis: _gaps(c, universes.get(axis, [])) for axis, c in counts.items()},
                 "bands": {b: bands[b] for b in scoring.LEVELS}, "target_mix": spec["difficulty"]["mix"]}
        if slug == "fan-favorites":
            entry["categories"] = dict(Counter((r.definition or {}).get("category", "?") for r in rows))
        last = FactoryEvent.objects.filter(action="gap_report", game=slug).order_by("-created_at").first()
        entry["last_gap_report"] = last.detail if last is not None else None
        out[slug] = entry
    return out


def _trim(row):
    """A player row cut to the fields a rule can read."""
    a, d = row.get("awards") or {}, row.get("draft")
    first = scoring.first_year(row)
    return {
        "full_name": row["full_name"], "position": row.get("position"), "country": row.get("country"),
        "debut_decade": first // 10 * 10 if first is not None else None,
        "draft": {k: d.get(k) for k in ("year", "round", "pick")} if d else None,
        "stints": list(dict.fromkeys(s.get("abbr") for s in row.get("teams") or [] if s.get("abbr"))),
        "awards": {**{k: len(a.get(k) or []) for k in ("mvp", "fmvp", "dpoy", "smoy", "rings")},
                   "roty": bool(a.get("roty")), "allstar": a.get("allstar_count") or 0,
                   "allnba": a.get("allnba_count") or 0},
        "career": {k: (row.get("career") or {}).get(k) for k in rules.STATS},
    }


def _sample(dataset, now):
    """SAMPLE_PLAYERS rows, three in four of fame band KNOWN or better (boards are about names
    fans know), a new draw every week."""
    week = now.isocalendar()
    rng = random.Random(f"{dataset.version}:{week[0]}-{week[1]}")
    rows = sorted(dataset.playable, key=lambda r: r["person_id"])
    known = [r for r in rows if fame.at_least(r, fame.KNOWN)]
    picked = rng.sample(known, min(SAMPLE_PLAYERS * 3 // 4, len(known)))
    taken = {r["person_id"] for r in picked}
    rest = [r for r in rows if r["person_id"] not in taken]
    picked += rng.sample(rest, min(SAMPLE_PLAYERS - len(picked), len(rest)))
    return [_trim(r) for r in picked]


def _notable():
    out = []
    for r in rules.playoff_rows():
        if r.get("round") != rules.FINALS or rules.season_end_year(r["season"]) < NOTABLE_FROM:
            continue
        for team, other in ((r["team_a"], r["team_b"]), (r["team_b"], r["team_a"])):
            out.append({"season": r["season"], "franchise": team, "opponent": other,
                        "result": "champion" if r.get("winner") == team else "finalist"})
    return sorted(out, key=lambda n: (n["season"], n["result"] != "champion"))


def build_brief(dataset, now):
    return {
        "allowed_sites": list(checker.ALLOWED_SITES),
        "quota": {slug: QUOTA for slug in GAMES},
        "rule_language": _rule_language(dataset),
        "fields": _fields(dataset),
        "existing": _existing(),
        "coverage": _coverage(dataset),
        "sample_players": _sample(dataset, now),
        "notable_team_seasons": _notable(),
    }


# ------------------------------------------------------------------ apply

def _load(directory, journal):
    """The proposals list, or None (journaled) when the file is missing or malformed."""
    path = os.path.join(directory, "proposals.json")
    problem = None
    if not os.path.isfile(path):
        problem = "no proposals.json"
    elif os.path.getsize(path) > MAX_FILE_BYTES:
        problem = f"proposals.json is over {MAX_FILE_BYTES} bytes"
    else:
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
        except (ValueError, RecursionError) as e:
            problem = f"not JSON: {str(e)[:200]}"
        else:
            if not isinstance(data, dict) or not isinstance(data.get("proposals"), list):
                problem = 'expected {"proposals": [...]}'
    if problem:
        journal.log("rejected", "malformed_file", problem=problem)
        return None
    return data["proposals"]


def _needs_rule(slug, d):
    if slug == "fan-favorites":
        return "answers" in d or "rule" not in d
    if slug == "connections" and isinstance(d.get("groups"), list):
        return any(not isinstance(g, dict) or "rule" not in g for g in d["groups"])
    return False


def _too_long(slug, d, why):
    if len(why) > MAX_WHY:
        return f"why is over {MAX_WHY} characters"
    if len(json.dumps(d, default=str)) > MAX_DEFINITION:
        return f"definition is over {MAX_DEFINITION} characters"
    if slug == "fan-favorites" and isinstance(d.get("prompt"), str) and len(d["prompt"]) > MAX_PROMPT:
        return f"prompt is over {MAX_PROMPT} characters"
    if slug == "connections":
        for g in d.get("groups") if isinstance(d.get("groups"), list) else []:
            if isinstance(g, dict) and isinstance(g.get("label"), str) and len(g["label"]) > MAX_LABEL:
                return f"label is over {MAX_LABEL} characters"
    if slug == "who-would-win":
        for key in ("a", "b"):
            s = d.get(key)
            if isinstance(s, dict) and isinstance(s.get("sub"), str) and len(s["sub"]) > MAX_SUB:
                return f"side {key} sub is over {MAX_SUB} characters"
    return None


class _Game:
    """One game's gate state for this run: what is taken, the consistency state, the next seq."""

    def __init__(self, slug, dataset):
        self.mod, self.spec = GAME_MODULES[slug], specs.load(slug)
        rows, scored = _scored(self.mod, slug, self.spec, dataset)
        self.taken = {s["dup_key"] for _, _, s in scored} | {k for k in (_dup_key(self.mod, r.definition)
                                                                         for r in rows) if k}
        self.hashes = set(Question.objects.filter(game=slug).values_list("content_hash", flat=True))
        self.state = scoring.new_state()
        for d, m, s in scored:
            scoring.add(self.state, s, scoring.featured(self.mod, d, m, dataset))
        self.seq = runner._next_seq(slug)
        self.accepted = 0


def _gate(game, slug, d, dataset):
    """(reason, detail) of the first gate a materialized proposal fails, or (None, scores)."""
    try:
        m, problems = runner._materialize(game.mod, d, dataset)
        if problems:
            return "invalid", {"problems": problems[:5]}
        s = scoring.score(game.mod, m, dataset, game.spec, d)
        featured = scoring.featured(game.mod, d, m, dataset)
    except Exception as e:  # untrusted input: a definition the module cannot even read
        return "invalid", {"problems": [f"{type(e).__name__}: {str(e)[:300]}"]}
    if s["interest"] < game.spec["interest"]["min"]:
        return "low_interest", {"interest": s["interest"], "min": game.spec["interest"]["min"]}
    if s["dup_key"] in game.taken or content_hash(d) in game.hashes:
        return "duplicate", {"dup_key": s["dup_key"]}
    picked, refused = scoring.select([{"scores": s, "featured": featured}], 1, game.state, game.spec)
    if refused:
        return "consistency", {"players": refused[0]["over"]}
    return None, s


def _definition_detail(d):
    return {"definition": d} if len(json.dumps(d, default=str)) <= MAX_DEFINITION else {}


def apply_proposals(directory, dataset, journal, now):
    """Apply the author's proposals.json; returns {"accepted", "rejected", "malformed_file"}."""
    summary = {"accepted": 0, "rejected": 0, "malformed_file": False}
    proposals = _load(directory, journal)
    if proposals is None:
        summary["malformed_file"] = True
        return summary
    if len(proposals) > MAX_PROPOSALS:
        journal.log("rejected", "too_many", count=len(proposals), read=MAX_PROPOSALS)
        proposals = proposals[:MAX_PROPOSALS]
    games = {}

    def reject(reason, index, slug="", **detail):
        summary["rejected"] += 1
        journal.log("rejected", reason, game=slug, index=index, **detail)

    for i, p in enumerate(proposals):
        if not isinstance(p, dict) or set(p) != PROPOSAL_KEYS or not isinstance(p["game"], str) \
                or not isinstance(p["definition"], dict) or not isinstance(p["why"], str):
            reject("malformed", i, problem='a proposal is {"game", "definition", "why"}')
            continue
        slug, why = p["game"], p["why"]
        if slug not in GAMES:
            reject("not_editorial", i, got=slug[:48])
            continue
        if slug not in games:
            games[slug] = _Game(slug, dataset)
        game = games[slug]
        if game.accepted >= QUOTA:
            reject("over_quota", i, slug, quota=QUOTA)
            continue
        d = copy.deepcopy(p["definition"])
        if _needs_rule(slug, d):
            reject("needs_rule", i, slug, **_definition_detail(d))
            continue
        long = _too_long(slug, d, why)
        if long:
            reject("too_long", i, slug, problem=long)
            continue
        if slug == "fan-favorites":
            d["survey_date"] = now.date().isoformat()
        reason, detail = _gate(game, slug, d, dataset)
        if reason:
            reject(reason, i, slug, **detail, **_definition_detail(d))
            continue
        h = content_hash(d)
        result = runner._add(game.mod, slug, d, h, game.seq, dataset, now, journal, True, game.spec,
                             created_by="author", reason="author", why=why)
        game.seq += 1
        game.hashes.add(h)
        game.taken.add(detail["dup_key"])
        if result is not None:
            game.accepted += 1
            summary["accepted"] += 1
    return summary
