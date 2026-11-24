"""Turns a validated GameSpec into playable rounds.

Deterministic for a (spec, seed) pair, so a preview can be reproduced. Every round is rendered from real dataset
rows; the engine's job beyond templating is to keep a generated game fair:

  - a multiple-choice distractor is never another correct answer (rows whose rendered prompt is the same question
    are all correct, so their answers are kept out of the options);
  - a typed answer accepts every row that fits the same rendered prompt, plus the source's aliases;
  - numeric distractors are drawn from the values nearest the answer, not from anywhere in the range.

build_rounds() raises SpecError when the filters leave too little to play; preview() is the same run reported as
numbers and warnings, which is what the agent reads before it submits.
"""
import random

from .sources import SOURCES, get_value, is_blank, load_rows
from .spec import SpecError, placeholders

SAMPLE_ROUNDS = 3
NEAREST_NUMERIC = 8  # numeric distractors come from this many closest distinct values


def _matches(row, flt):
    value, op, want = get_value(row, flt["field"]), flt["op"], flt["value"]
    if op == "exists":
        return is_blank(value) != want
    if is_blank(value):
        return False
    if op == "eq":
        return _same(value, want)
    if op == "ne":
        return not _same(value, want)
    if op == "in":
        return any(_same(value, w) for w in want)
    if op == "contains":
        needle = want.casefold()
        if isinstance(value, list):
            return any(isinstance(v, str) and needle in v.casefold() for v in value)
        return needle in str(value).casefold()
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    return {"gt": value > want, "gte": value >= want, "lt": value < want, "lte": value <= want}[op]


def _same(a, b):
    if isinstance(a, str) and isinstance(b, str):
        return a.casefold() == b.casefold()
    return a == b


def _show(value):
    if isinstance(value, list):
        return ", ".join(str(v) for v in value)
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def _render(template, row):
    out = template
    for name in placeholders(template):
        out = out.replace("{" + name + "}", _show(get_value(row, name)))
    return out


def _pool(spec):
    """Rows that pass the filters and have every field the round needs."""
    needed = set(placeholders(spec["prompt"]))
    if spec["mode"] == "higher_lower":
        needed |= {spec["compare_field"], spec["label_field"]}
    else:
        needed.add(spec["answer_field"])
    return [
        row
        for row in load_rows(spec["source"])
        if all(_matches(row, f) for f in spec["filters"]) and not any(is_blank(get_value(row, n)) for n in needed)
    ]


def _reveal(spec, row):
    template = spec.get("reveal")
    if not template or any(is_blank(get_value(row, n)) for n in placeholders(template)):
        return None
    return _render(template, row)


def _distractors(answer, candidates, count, rng):
    """`count` wrong options out of the distinct candidate values; numbers stay close to the answer."""
    if isinstance(answer, (int, float)) and not isinstance(answer, bool):
        numeric = [c for c in candidates if isinstance(c, (int, float)) and not isinstance(c, bool)]
        candidates = sorted(numeric, key=lambda c: (abs(c - answer), c))[: max(NEAREST_NUMERIC, count)]
    else:
        candidates = sorted(candidates, key=str)  # a stable order before sampling keeps the seed meaningful
    return rng.sample(candidates, count) if len(candidates) >= count else None


def _question_rounds(spec, pool, rng):
    """multiple_choice and type_answer: one round per distinct rendered prompt."""
    answer_field = spec["answer_field"]
    alias_field = SOURCES[spec["source"]].aliases.get(answer_field)
    by_prompt = {}
    for row in pool:
        by_prompt.setdefault(_render(spec["prompt"], row), []).append(row)
    all_answers = {get_value(row, answer_field) for row in pool}

    prompts = sorted(by_prompt)
    rng.shuffle(prompts)
    rounds = []
    for prompt in prompts:
        rows = by_prompt[prompt]
        row = rows[0]
        answer = get_value(row, answer_field)
        correct = {get_value(r, answer_field) for r in rows}
        entry = {"kind": spec["mode"], "prompt": prompt, "answer": _show(answer)}
        if spec["mode"] == "multiple_choice":
            wrong = _distractors(answer, all_answers - correct, spec["options"] - 1, rng)
            if wrong is None:
                continue  # not enough genuinely wrong answers for this question
            options = [_show(answer)] + [_show(w) for w in wrong]
            rng.shuffle(options)
            entry["options"] = options
        else:
            accepted = []
            for r in rows:
                accepted.append(_show(get_value(r, answer_field)))
                accepted.extend(a for a in (get_value(r, alias_field) or [] if alias_field else []) if a)
            entry["accepted"] = sorted(set(accepted), key=str.casefold)
        reveal = _reveal(spec, row)
        if reveal:
            entry["reveal"] = reveal
        rounds.append(entry)
        if len(rounds) == spec["rounds"]:
            break
    return rounds


def _higher_lower_rounds(spec, pool, rng):
    """Pairs of rows with different values; each row appears at most once per game."""
    rows = sorted(pool, key=lambda r: str(get_value(r, spec["label_field"])))
    rng.shuffle(rows)
    rounds, i = [], 0
    while i + 1 < len(rows) and len(rounds) < spec["rounds"]:
        left, right = rows[i], rows[i + 1]
        lv, rv = get_value(left, spec["compare_field"]), get_value(right, spec["compare_field"])
        ll, rl = get_value(left, spec["label_field"]), get_value(right, spec["label_field"])
        if lv == rv or ll == rl:
            i += 1  # a tie has no answer: slide the window by one row
            continue
        rounds.append({
            "kind": "higher_lower",
            "prompt": spec["prompt"],
            "left": {"label": _show(ll), "value": lv},
            "right": {"label": _show(rl), "value": rv},
            "answer": "left" if lv > rv else "right",
        })
        i += 2
    return rounds


def _generate(spec, seed):
    pool = _pool(spec)
    rng = random.Random(seed)
    make = _higher_lower_rounds if spec["mode"] == "higher_lower" else _question_rounds
    rounds = make(spec, pool, rng)
    for n, entry in enumerate(rounds, 1):
        entry["id"] = f"r{n}"
    return pool, rounds


def build_rounds(spec, seed=None):
    """The rounds of one play. SpecError when the spec cannot fill its `rounds`."""
    pool, rounds = _generate(spec, seed)
    if len(rounds) < spec["rounds"]:
        raise SpecError([_shortfall(spec, pool, rounds)])
    return rounds


def _shortfall(spec, pool, rounds):
    reason = f"The filters leave {len(pool)} rows, which gives {len(rounds)} playable rounds of the {spec['rounds']} asked."
    if spec["mode"] == "multiple_choice":
        reason += f" Each question needs {spec['options'] - 1} wrong answers that are not also correct."
    return reason + " Loosen a filter, lower `rounds`, or pick another answer field."


def preview(spec, seed=0):
    """What the spec produces: pool size, distinct answers, sample rounds and plain-language warnings."""
    pool, rounds = _generate(spec, seed)
    if spec["mode"] == "higher_lower":
        answers = len({get_value(r, spec["compare_field"]) for r in pool})
    else:
        answers = len({get_value(r, spec["answer_field"]) for r in pool})
    warnings = []
    if len(rounds) < spec["rounds"]:
        warnings.append(_shortfall(spec, pool, rounds))
    elif len(pool) < spec["rounds"] * 3:
        warnings.append(f"Only {len(pool)} rows match: the same questions will come back after a few plays.")
    if spec["mode"] == "multiple_choice" and answers < spec["options"] * 2:
        warnings.append(f"Only {answers} distinct answers: the options will repeat between rounds.")
    return {
        "pool_size": len(pool),
        "answer_values": answers,
        "playable": len(rounds) >= spec["rounds"],
        "rounds": rounds[:SAMPLE_ROUNDS],
        "warnings": warnings,
    }
