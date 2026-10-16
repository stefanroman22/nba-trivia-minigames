"""Fan Favorites — one survey board: a prompt and every accepted answer, ranked (spec §4.6).

Definition: {"prompt", "category": player|team|coach, "rule", "survey_date"}. The rule
(trivia.questions.rules) is evaluated against the dataset for the complete answer set, so
the answers follow the data; a team rule is evaluated over the current franchises. A board
must have 6-17 answers (spec eligibility).

Answers override: a board whose answers cannot be expressed as a rule (the 40 hand-written
seed boards, any coach board) carries {"prompt", "category", "answers": [{"answer", "count",
"aliases"}, ...], "survey_date"} instead of a rule (never both); materialize then serves those
answers as given, ranked by count.

Counts are an estimate until players answer: each rule answer's share of 100 is weighted
by fame (players: fame score + 1; teams: 1 + 2 x titles + Finals appearances), at least 1,
summing to exactly 100, and the materialized board carries "estimated": true. The published
board (pool_row) keeps today's shape; the pool builder swaps in the live standings
(trivia.utils.fan_favorites.live_standings, >= 500 correct guesses) per qid.

Aliases: the accent-folded lowercase name, the curated aliases, and the last name (teams:
nickname, city, abbreviation) when no other answer on the board shares it.

Features (1 = harder / more interesting): answer_count (17 answers 0, 6 answers 1),
answer_fame (mean fame hardness of the player answers found in the dataset; a team board 0,
none found 0.5), recognizable (share of those answers in fame band KNOWN or better; team 1,
none found 0.5). Coverage: decade of the median debut of the player answers ("?" otherwise).
No featured players: an answer is a small part of a board, so max_player_share does not apply.
"""
import re
import statistics

from trivia.questions import fame, quality, rules, specs
from trivia.questions.base import Invalid, envelope

SLUG = "fan-favorites"
_SPEC = specs.load(SLUG)  # specs/fan-favorites.json
TARGET = _SPEC["refill"]["target"]
MINIMUM = _SPEC["refill"]["minimum"]
MIN_ANSWERS, MAX_ANSWERS = _SPEC["eligibility"]["min_answers"], _SPEC["eligibility"]["max_answers"]
CATEGORIES = ("player", "team", "coach")  # coach: answers override only
KEYS = {"prompt", "category", "rule", "answers", "survey_date"}
ANSWER_KEYS = {"answer", "count", "aliases"}
SUFFIXES = {"jr", "sr", "ii", "iii", "iv"}


def generate(dataset, existing_hashes, rng, n):
    """Nothing to invent by code: boards come from the author (spec §4.6)."""
    return []


def _check(definition):
    if not isinstance(definition, dict):
        raise Invalid("definition must be an object")
    unknown = set(definition) - KEYS
    if unknown:
        raise Invalid(f"unknown key(s) {', '.join(sorted(unknown))}")
    if not isinstance(definition.get("prompt"), str) or not definition["prompt"].strip():
        raise Invalid("prompt must be a non-empty string")
    if not isinstance(definition.get("survey_date"), str) or not definition["survey_date"]:
        raise Invalid("survey_date must be a date string")
    category = definition.get("category")
    if category not in CATEGORIES:
        raise Invalid(f"category must be one of {'|'.join(CATEGORIES)}, got {category!r}")
    if ("rule" in definition) == ("answers" in definition):
        raise Invalid("a board has a rule or an answers list, exactly one")
    if "rule" in definition and category not in rules.CATEGORIES:
        raise Invalid(f"a {category} board needs an answers list (rules cover {', '.join(rules.CATEGORIES)})")


def _last_name(name):
    words = [w for w in rules.fold(name).replace(".", "").split() if w not in SUFFIXES]
    return words[-1] if len(words) > 1 else None


def _team_parts(name):
    words = name.split()
    k = 2 if name.endswith("Trail Blazers") else 1
    return " ".join(words[-k:]).lower(), " ".join(words[:-k]).lower()


def _dedupe(items):
    return list(dict.fromkeys(i for i in items if i))


def _player_answers(rows):
    lasts = [_last_name(r["full_name"]) for r in rows]
    out = []
    for row, last in zip(rows, lasts):
        aliases = [rules.fold(row["full_name"])] + [rules.fold(a) for a in row.get("aliases") or []]
        if last and lasts.count(last) == 1:
            aliases.append(last)
        out.append({"answer": row["full_name"], "aliases": _dedupe(aliases)})
    return out


def _team_answers(rows):
    parts = [_team_parts(r["name"]) for r in rows]
    cities = [city for _, city in parts]
    out = []
    for row, (nick, city) in zip(rows, parts):
        aliases = [row["name"].lower(), nick]
        if nick.count(" "):
            aliases.append(nick.split()[-1])
        if city and cities.count(city) == 1:
            aliases.append(city)
        aliases.append(row["abbr"].lower())
        out.append({"answer": row["name"], "aliases": _dedupe(aliases)})
    return out


def _shares(weights):
    """Integer shares of 100, each >= 1, summing to 100 (largest remainder)."""
    total = sum(weights)
    raw = [100 * w / total for w in weights]
    counts = [max(1, int(r)) for r in raw]
    order = sorted(range(len(raw)), key=lambda i: (-(raw[i] - int(raw[i])), i))
    i = 0
    while sum(counts) < 100:
        counts[order[i % len(order)]] += 1
        i += 1
    while sum(counts) > 100:
        j = max(range(len(counts)), key=lambda k: counts[k])
        if counts[j] <= 1:
            break
        counts[j] -= 1
    return counts


def _ranked(answers, weights):
    counts = _shares(weights)
    ranked = sorted(zip(answers, counts, weights), key=lambda t: (-t[1], -t[2], t[0]["answer"]))
    return [{"answer": a["answer"], "count": c, "aliases": a["aliases"]} for a, c, _ in ranked]


def _given_answers(answers):
    if not isinstance(answers, list):
        raise Invalid("answers must be a list")
    out = []
    for a in answers:
        if not isinstance(a, dict) or set(a) - ANSWER_KEYS:
            raise Invalid(f"an answer is {{answer, count, aliases}}, got {a!r}")
        if not isinstance(a.get("answer"), str) or not a["answer"].strip():
            raise Invalid("an answer needs a name")
        if type(a.get("count")) is not int or a["count"] < 0:
            raise Invalid(f"{a['answer']}: count must be an integer >= 0")
        aliases = a.get("aliases", [])
        if not isinstance(aliases, list) or not all(isinstance(x, str) for x in aliases):
            raise Invalid(f"{a['answer']}: aliases must be a list of strings")
        out.append({"answer": a["answer"], "count": a["count"], "aliases": list(aliases)})
    return sorted(out, key=lambda a: a["count"], reverse=True)  # stable: the seed loader's order


def materialize(definition, dataset):
    _check(definition)
    category = definition["category"]
    if "answers" in definition:
        answers = _given_answers(definition["answers"])
        index = rules.players_by_name(dataset) if category == "player" else {}
        person_ids = [(index.get(rules.fold(a["answer"])) or {}).get("person_id") for a in answers]
    else:
        try:
            rows = rules.evaluate(definition["rule"], dataset, category=category)
        except rules.RuleError as e:
            raise Invalid(f"rule: {e}") from None
        if not rows:
            raise Invalid(f"the rule matches nobody ({rules.describe(definition['rule'])})")
        if category == "team":
            weights = [1 + 2 * t + f for t, f in (rules.team_titles(r["abbr"], dataset) for r in rows)]
            answers = _ranked(_team_answers(rows), weights)
            person_ids = [None] * len(answers)
        else:
            weights = [fame.fame_score(r) + 1 for r in rows]
            answers = _ranked(_player_answers(rows), weights)
            by_name = {r["full_name"]: r["person_id"] for r in rows}
            person_ids = [by_name[a["answer"]] for a in answers]
    return envelope(SLUG, None, {"prompt": definition["prompt"], "survey_date": definition["survey_date"],
                                 "category": category, "answers": answers, "estimated": True,
                                 "person_ids": person_ids})


def validate(materialized):
    problems = []
    answers = materialized.get("answers") or []
    if not (MIN_ANSWERS <= len(answers) <= MAX_ANSWERS):
        problems.append(f"{len(answers)} answers; a board needs {MIN_ANSWERS}-{MAX_ANSWERS}")
    names = [a.get("answer") for a in answers]
    if len(set(names)) != len(names):
        problems.append("duplicate answers")
    counts = [a.get("count", 0) for a in answers]
    if counts != sorted(counts, reverse=True):
        problems.append("answers not in descending count order")
    if not (materialized.get("prompt") or "").strip():
        problems.append("no prompt")
    return problems


def pool_row(materialized):
    """The published board: today's fan-favorites.json row, field for field."""
    m = materialized
    return {"qid": m["qid"], "prompt": m["prompt"], "survey_date": m["survey_date"],
            "category": m["category"], "answers": [dict(a) for a in m["answers"]]}


def index_item(definition, materialized):
    return [None]  # qid is filled by the runner


def _rows(materialized, dataset):
    by_id = getattr(dataset, "by_id", {}) if dataset is not None else {}
    return [by_id[pid] for pid in materialized.get("person_ids") or [] if pid in by_id]


def players_referenced(definition, materialized, dataset=None):
    return [pid for pid in materialized.get("person_ids") or [] if pid is not None]


def featured(definition, materialized):
    return []


def checker_view(materialized, dataset=None):
    """The prompt, the category and every accepted answer (the board is valid only if complete)."""
    m = materialized
    return {"kind": SLUG, "prompt": m["prompt"], "category": m["category"],
            "answers": [a["answer"] for a in m["answers"]]}


def features(materialized, dataset=None):
    """Normalization in the module docstring (1 = harder / more interesting)."""
    n = len(materialized.get("answers") or [])
    count = quality._clamp((MAX_ANSWERS - n) / (MAX_ANSWERS - MIN_ANSWERS))
    if materialized["category"] == "team":
        return {"answer_count": count, "answer_fame": 0.0, "recognizable": 1.0}
    rows = _rows(materialized, dataset)
    if not rows:
        return {"answer_count": count, "answer_fame": 0.5, "recognizable": 0.5}
    return {
        "answer_count": count,
        "answer_fame": statistics.fmean(quality.fame_hardness(r) for r in rows),
        "recognizable": sum(1 for r in rows if fame.at_least(r, fame.KNOWN)) / len(rows),
    }


def coverage(materialized, dataset=None):
    years = [y for y in (quality.first_year(r) for r in _rows(materialized, dataset)) if y is not None]
    return {"decade": quality.decade(int(statistics.median_low(years))) if years else "?"}


def dup_key(definition, materialized):
    """The prompt, accent-folded, lowercase, punctuation and spacing collapsed."""
    return re.sub(r"[^a-z0-9]+", " ", rules.fold(definition.get("prompt", ""))).strip()


def qid_for(definition, seq):
    return f"ff-{seq:03d}"
