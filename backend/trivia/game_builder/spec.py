"""GameSpec: the declarative recipe a generated game is stored as, and its validation.

A spec is written by a model, so validate() is strict and returns every problem at once in words the model can act
on (the agent feeds them straight back as a tool error). It never repairs: a spec either comes out normalized or
raises SpecError.

    {
      "version": 1,
      "title": "Draft Day",  "description": "Name the team that drafted each star.",
      "source": "players",
      "mode": "multiple_choice" | "type_answer" | "higher_lower",
      "rounds": 10,  "points_per_correct": 10,
      "filters": [{"field": "awards.allstar_count", "op": "gte", "value": 3}],      # all must hold
      "prompt": "Which team drafted {full_name} in {draft.year}?",                    # {field} placeholders
      "answer_field": "draft.team_abbr",  "options": 4,                               # multiple_choice / type_answer
      "compare_field": "career.ppg",  "label_field": "full_name",                     # higher_lower
      "reveal": "{full_name} went #{draft.pick} overall."                             # optional, shown after answering
    }
"""
import re

from .sources import BOOLEAN, LIST, NUMBER, SOURCES, STRING

VERSION = 1
MODES = ("multiple_choice", "type_answer", "higher_lower")
OPS = ("eq", "ne", "gt", "gte", "lt", "lte", "in", "contains", "exists")
ROUNDS = (3, 20)
POINTS = (5, 50)
OPTIONS = (2, 6)
MAX_FILTERS = 8
PLACEHOLDER = re.compile(r"\{([a-z0-9_.]+)\}")
_KEYS = {
    "version", "title", "description", "source", "mode", "rounds", "points_per_correct", "filters", "prompt",
    "answer_field", "options", "compare_field", "label_field", "reveal",
}


class SpecError(ValueError):
    """The spec cannot be played. `problems` is the full list, one sentence each."""

    def __init__(self, problems):
        self.problems = list(problems)
        super().__init__("; ".join(self.problems))


def placeholders(template):
    return PLACEHOLDER.findall(template or "")


def _text(raw, key, limit, problems, required=True):
    value = raw.get(key)
    if value is None or value == "":
        if required:
            problems.append(f"`{key}` is required.")
        return ""
    if not isinstance(value, str):
        problems.append(f"`{key}` must be a string.")
        return ""
    value = " ".join(value.split())
    if len(value) > limit:
        problems.append(f"`{key}` is {len(value)} characters; the limit is {limit}.")
    return value


def _int(raw, key, bounds, default, problems):
    value = raw.get(key, default)
    if isinstance(value, bool) or not isinstance(value, int):
        problems.append(f"`{key}` must be a whole number.")
        return default
    if not bounds[0] <= value <= bounds[1]:
        problems.append(f"`{key}` must be between {bounds[0]} and {bounds[1]}.")
    return value


def _filters(raw, source, problems):
    filters = raw.get("filters") or []
    if not isinstance(filters, list):
        problems.append("`filters` must be a list.")
        return []
    if len(filters) > MAX_FILTERS:
        problems.append(f"At most {MAX_FILTERS} filters.")
    out = []
    for i, flt in enumerate(filters):
        where = f"filters[{i}]"
        if not isinstance(flt, dict):
            problems.append(f"{where} must be an object with field, op and value.")
            continue
        name, op, value = flt.get("field"), flt.get("op"), flt.get("value")
        fld = source.field(name) if isinstance(name, str) else None
        if not fld:
            problems.append(f"{where}: `{name}` is not a field of source `{source.id}`.")
            continue
        if op not in OPS:
            problems.append(f"{where}: op `{op}` is not one of {', '.join(OPS)}.")
            continue
        if op == "exists":
            if not isinstance(value, bool):
                problems.append(f"{where}: `exists` takes true or false.")
        elif op in ("gt", "gte", "lt", "lte"):
            if fld.type != NUMBER or isinstance(value, bool) or not isinstance(value, (int, float)):
                problems.append(f"{where}: `{op}` needs a number field and a number value.")
        elif op == "in":
            if fld.type == LIST or not isinstance(value, list) or not value:
                problems.append(f"{where}: `in` needs a scalar field and a non-empty list value.")
        elif op == "contains":
            if fld.type not in (STRING, LIST) or not isinstance(value, str) or not value:
                problems.append(f"{where}: `contains` needs a string or list field and a string value.")
        elif fld.type == LIST or isinstance(value, (list, dict)) or value is None:  # eq / ne
            problems.append(f"{where}: `{op}` needs a scalar field and a scalar value.")
        out.append({"field": name, "op": op, "value": value})
    return out


def _template(raw, key, source, problems, limit, required=True):
    text = _text(raw, key, limit, problems, required=required)
    for name in placeholders(text):
        if not source.field(name):
            problems.append(f"`{key}` uses {{{name}}}, which is not a field of source `{source.id}`.")
    return text


def validate(raw):
    """A normalized spec (only known keys, mode-specific keys only for their mode), or SpecError."""
    if not isinstance(raw, dict):
        raise SpecError(["The spec must be a JSON object."])
    problems = [f"Unknown key `{k}`." for k in sorted(set(raw) - _KEYS)]
    source = SOURCES.get(raw.get("source"))
    if not source:
        raise SpecError(problems + [f"`source` must be one of {', '.join(SOURCES)}."])
    mode = raw.get("mode")
    if mode not in MODES:
        raise SpecError(problems + [f"`mode` must be one of {', '.join(MODES)}."])

    spec = {
        "version": VERSION,
        "title": _text(raw, "title", 60, problems),
        "description": _text(raw, "description", 200, problems),
        "source": source.id,
        "mode": mode,
        "rounds": _int(raw, "rounds", ROUNDS, 10, problems),
        "points_per_correct": _int(raw, "points_per_correct", POINTS, 10, problems),
        "filters": _filters(raw, source, problems),
        "prompt": _template(raw, "prompt", source, problems, 200),
    }

    if mode == "higher_lower":
        if placeholders(spec["prompt"]):
            problems.append("A higher_lower `prompt` is one fixed question about both sides, without {placeholders}.")
        compare, label = source.field(raw.get("compare_field")), source.field(raw.get("label_field"))
        if not compare or compare.type != NUMBER:
            problems.append("`compare_field` must be a number field of the source.")
        if not label or label.type != STRING:
            problems.append("`label_field` must be a string field of the source.")
        spec.update(compare_field=raw.get("compare_field"), label_field=raw.get("label_field"))
        for key in ("answer_field", "options", "reveal"):
            if raw.get(key) is not None:
                problems.append(f"`{key}` does not apply to higher_lower.")
    else:
        answer = source.field(raw.get("answer_field"))
        if not answer or answer.type in (LIST, BOOLEAN):
            problems.append("`answer_field` must be a string or number field of the source.")
        elif answer.name in placeholders(spec["prompt"]):
            problems.append(f"`prompt` shows {{{answer.name}}}, which is the answer.")
        spec["answer_field"] = raw.get("answer_field")
        if mode == "multiple_choice":
            spec["options"] = _int(raw, "options", OPTIONS, 4, problems)
        elif raw.get("options") is not None:
            problems.append("`options` does not apply to type_answer.")
        reveal = _template(raw, "reveal", source, problems, 200, required=False)
        if reveal:
            spec["reveal"] = reveal
        for key in ("compare_field", "label_field"):
            if raw.get(key) is not None:
                problems.append(f"`{key}` applies to higher_lower only.")

    if problems:
        raise SpecError(problems)
    return spec
