"""The game-builder agent: a Claude tool loop that turns an admin's description into a GameSpec.

The model does not write questions. It picks a dataset, writes a spec, and tests it with the same engine players
get: describe_source shows what a field really holds, preview_game runs the draft and returns the pool size and
sample rounds, submit_game hands in the final spec. A submitted spec is validated and test-run here; a spec that
fails goes back to the model as a tool error with the reasons, so what reaches the database is always playable.

The loop is hosted in-process (Messages API + tool use) because its tools read this app's own datasets and the
admin waits on the HTTP request. It is bounded by GAME_BUILDER_MAX_TURNS model calls.

The API call itself (lazy SDK import, refusal fallback, error mapping) is trivia/llm.py.
"""
import json
from dataclasses import dataclass, field

from django.conf import settings

from trivia import llm

from . import engine
from .sources import SOURCES, catalog, describe
from .spec import MODES, OPS, SpecError, validate

MAX_TOKENS = 16000


class BuilderError(llm.LLMError):
    """The agent could not produce a game. The message is safe to show to the admin."""


@dataclass
class BuildResult:
    spec: dict = None  # None: the agent answered in words without changing the game
    message: str = ""
    preview: dict = None
    model: str = ""
    usage: dict = field(default_factory=lambda: {"input_tokens": 0, "output_tokens": 0, "turns": 0})


_SPEC_SCHEMA = {
    "type": "object",
    "description": "A GameSpec. See the system prompt for the meaning of each key.",
    "properties": {
        "title": {"type": "string"},
        "description": {"type": "string"},
        "source": {"type": "string", "enum": list(SOURCES)},
        "mode": {"type": "string", "enum": list(MODES)},
        "rounds": {"type": "integer"},
        "points_per_correct": {"type": "integer"},
        "filters": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"field": {"type": "string"}, "op": {"type": "string", "enum": list(OPS)}, "value": {}},
                "required": ["field", "op", "value"],
            },
        },
        "prompt": {"type": "string"},
        "answer_field": {"type": "string"},
        "options": {"type": "integer"},
        "compare_field": {"type": "string"},
        "label_field": {"type": "string"},
        "reveal": {"type": "string"},
    },
    "required": ["title", "description", "source", "mode", "prompt"],
}

TOOLS = [
    {
        "name": "describe_source",
        "description": "Statistics for a dataset's fields: how many rows have a value, the numeric range, the most "
        "common values of a text field, and sample rows. Call it before filtering on a field whose values you have "
        "not seen (exact team names, round names, typical ranges).",
        "input_schema": {
            "type": "object",
            "properties": {
                "source": {"type": "string", "enum": list(SOURCES)},
                "fields": {"type": "array", "items": {"type": "string"}, "description": "Limit to these fields."},
            },
            "required": ["source"],
        },
    },
    {
        "name": "preview_game",
        "description": "Test-run a draft spec with the real engine. Returns how many rows pass the filters, how "
        "many distinct answers they give, three sample rounds exactly as a player would see them, and warnings. "
        "An invalid spec returns the list of problems.",
        "input_schema": {"type": "object", "properties": {"spec": _SPEC_SCHEMA}, "required": ["spec"]},
    },
    {
        "name": "submit_game",
        "description": "Hand in the final spec. It is validated and test-run again; if it fails you get the "
        "reasons back and can fix it. `summary` is one or two plain sentences for the admin: what the game is and "
        "any choice you made that they did not ask for.",
        "input_schema": {
            "type": "object",
            "properties": {"spec": _SPEC_SCHEMA, "summary": {"type": "string"}},
            "required": ["spec", "summary"],
        },
    },
]

_SYSTEM = """You build NBA trivia minigames for Swish Quest, a trivia site. An admin describes a game in plain \
words; you turn it into a GameSpec that the site's engine plays from real data. You never write individual \
questions: you choose a dataset, filters and a question template, and the engine renders every round from rows.

## GameSpec
- title (at most 60 characters), description (one line a player reads before starting, at most 200)
- source: the dataset id
- mode:
  - multiple_choice: `prompt` is a template with {field} placeholders, `answer_field` is the correct answer, \
`options` (2 to 6, default 4) is how many choices are shown. Wrong choices are other values of the same field.
  - type_answer: same, but the player types the answer. Use it when the answer is a name people know how to spell.
  - higher_lower: two rows side by side; the player picks the one with the higher `compare_field` (a number). \
`label_field` is what identifies each side. `prompt` is one fixed question with no placeholders.
- rounds (3 to 20, default 10), points_per_correct (5 to 50, default 10)
- filters: a list of {field, op, value}, all of which must hold. ops: eq, ne, gt, gte, lt, lte, in (value is a \
list), contains (text or list field contains the text, case-insensitive), exists (value true or false).
- reveal (optional, not for higher_lower): a template shown after the player answers. It may use the answer field.

## What makes a generated game good
- People can answer it. Most players in the data are obscure; when a game is about players, filter to ones a fan \
knows unless the admin asks for a deep cut.
- The prompt identifies one answer. It must not contain the answer field, and it should name the row precisely \
enough that a fan would not argue about it.
- The pool is several times larger than `rounds`, so a second play is not the same game.
- It is the game the admin asked for. When their words leave a choice open, take the reading a trivia player \
would enjoy most and say so in the summary.

## How to work
The datasets and their fields are listed below. Draft a spec, run preview_game, and read the sample rounds the \
way a player would: check the wording, the difficulty, and that the wrong options are plausible. Fix what reads \
badly, then call submit_game. When the admin asks to change an existing game, change what they asked for and \
keep the rest.

If the datasets cannot support the request, do not force it: reply in one or two sentences saying what data is \
missing and what close game you could build instead, without calling submit_game.

## Datasets
"""


def system_prompt():
    """Stable between calls (the catalog only changes on a data publish), so the whole block caches."""
    return _SYSTEM + json.dumps(catalog(), indent=1)


def _user_message(prompt, current_spec):
    if current_spec:
        return (
            "This is the current game:\n```json\n"
            + json.dumps(current_spec, indent=1)
            + "\n```\n\nThe admin asks for this change:\n"
            + prompt
        )
    return "The admin describes this game:\n" + prompt


def _checked(raw):
    """(spec, preview) of a spec that validates and fills its rounds, else SpecError with every reason."""
    spec = validate(raw)
    result = engine.preview(spec)
    if not result["playable"]:
        raise SpecError(result["warnings"])
    return spec, result


def _run_tool(name, args):
    """(result text, is_error, accepted) for one tool call. `accepted` is (spec, preview, summary) on a good submit."""
    try:
        if name == "describe_source":
            if args.get("source") not in SOURCES:
                return f"Unknown source. Use one of: {', '.join(SOURCES)}.", True, None
            return json.dumps(describe(args["source"], args.get("fields"))), False, None
        if name == "preview_game":
            return json.dumps(engine.preview(validate(args.get("spec")))), False, None
        if name == "submit_game":
            spec, result = _checked(args.get("spec"))
            return "Accepted.", False, (spec, result, str(args.get("summary") or "").strip())
    except SpecError as e:
        return "The spec has problems:\n- " + "\n- ".join(e.problems), True, None
    return f"Unknown tool `{name}`.", True, None


def _create(client, messages):
    """One model call. The request is identical between turns apart from `messages`, so the prefix caches."""
    try:
        return llm.create(
            client,
            model=settings.GAME_BUILDER_MODEL,
            max_tokens=MAX_TOKENS,
            system=[{"type": "text", "text": system_prompt(), "cache_control": {"type": "ephemeral"}}],
            tools=TOOLS,
            messages=messages,
            output_config={"effort": settings.GAME_BUILDER_EFFORT},
        )
    except llm.LLMError as e:
        raise BuilderError(str(e))


def run(prompt, current_spec=None, client=None):
    """Build (or, with `current_spec`, refine) a game. Returns a BuildResult; raises BuilderError."""
    client = client or llm.client(settings.GAME_BUILDER_TIMEOUT)
    result = BuildResult(model=settings.GAME_BUILDER_MODEL)
    messages = [{"role": "user", "content": _user_message(prompt, current_spec)}]

    for _ in range(settings.GAME_BUILDER_MAX_TURNS):
        response = _create(client, messages)
        result.usage["turns"] += 1
        usage = response.usage
        result.usage["input_tokens"] += (
            (usage.input_tokens or 0)
            + (getattr(usage, "cache_read_input_tokens", 0) or 0)
            + (getattr(usage, "cache_creation_input_tokens", 0) or 0)
        )
        result.usage["output_tokens"] += usage.output_tokens or 0
        result.model = getattr(response, "model", None) or result.model

        calls = [b for b in response.content if b.type == "tool_use"]
        if not calls:
            result.message = llm.text_of(response) or "The agent stopped without building a game."
            return result

        messages.append({"role": "assistant", "content": response.content})
        outputs = []
        for call in calls:
            text, is_error, accepted = _run_tool(call.name, call.input if isinstance(call.input, dict) else {})
            if accepted:
                result.spec, result.preview, summary = accepted
                result.message = summary or llm.text_of(response) or "Game built."
                return result
            outputs.append({"type": "tool_result", "tool_use_id": call.id, "content": text, "is_error": is_error})
        messages.append({"role": "user", "content": outputs})

    raise BuilderError(
        f"The agent did not finish a playable game in {settings.GAME_BUILDER_MAX_TURNS} steps. "
        "Try describing the game more concretely."
    )
