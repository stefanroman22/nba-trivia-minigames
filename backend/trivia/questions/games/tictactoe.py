"""Tic-Tac-Toe boards: 3 team rows x 3 non-team columns, each cell precomputed
to the ids that satisfy both criteria. Matching semantics are
trivia.games.tictactoe.player_matches (the server's port of src/utils/criteria.ts)."""
import json
import os

from django.conf import settings

from trivia.games.tictactoe import player_matches
from trivia.questions.base import Invalid, envelope
from trivia.questions.hashing import content_hash

SLUG = "tictactoe"
# 2026-09-30: raised from 60 (expand-question-pools); eligible pool comfortably larger, see docs/team/designs/2026-09-30-expand-question-pools.md
TARGET = 120
MINIMUM = 12
MIN_VALID, MAX_VALID = 3, 400

SEED_PATH = os.path.join(settings.BASE_DIR, "trivia", "data_static", "tictactoe_seed.json")

AWARD_COLUMNS = [
    {"type": "award", "value": "mvp", "label": "Won MVP"},
    {"type": "award", "value": "fmvp", "label": "Finals MVP"},
    {"type": "award", "value": "dpoy", "label": "Defensive POY"},
    {"type": "award", "value": "roty", "label": "Rookie of the Year"},
    {"type": "award", "value": "smoy", "label": "Sixth Man"},
    {"type": "award", "value": "ring", "label": "NBA Champion"},
    {"type": "award", "value": "allnba", "label": "All-NBA"},
    {"type": "draft", "value": "undrafted", "label": "Undrafted"},
    {"type": "draft", "value": "lottery", "label": "Lottery pick"},
]


def seed_definitions():
    with open(SEED_PATH, encoding="utf-8") as f:
        boards = json.load(f)
    return [{"rows": b["rows"], "cols": b["cols"]} for b in boards]


def _current_team_names(dataset):
    """abbr -> era name of that abbr's most recent stint (greatest start_year; ties
    keep the later end_year, an open-ended stint counting as latest, else the last
    seen) - the franchise's modern name, as snapshot._current_team_abbr picks the
    current team. `abbr` is already modern. build_stints writes name == abbr as a
    stand-in when franchise history has no era for a season, so a stint whose name
    is empty or equals its abbr is skipped; the abbr is the label only when the
    franchise has no real-name stint at all."""
    best, names = {}, {}
    for r in dataset.playable:
        for s in r.get("teams") or []:
            abbr = s["abbr"]
            names.setdefault(abbr, abbr)
            name = s.get("name")
            if not name or name == abbr:
                continue
            end = s.get("end_year")
            key = (s.get("start_year") or 0, 10**4 if end is None else end)
            if abbr not in best or key >= best[abbr]:
                best[abbr] = key
                names[abbr] = name
    return names


def _team_criteria(dataset):
    min_team_players = 40 if len(dataset.playable) > 1000 else 20
    counts = {}
    for r in dataset.playable:
        for s in r.get("teams") or []:
            counts[s["abbr"]] = counts.get(s["abbr"], 0) + 1
    names = _current_team_names(dataset)
    return [
        {"type": "team", "value": abbr, "label": names[abbr]}
        for abbr, n in counts.items() if n >= min_team_players
    ]


def _cell_valid(dataset, row_c, col_c):
    return [p["person_id"] for p in dataset.playable if player_matches(p, row_c) and player_matches(p, col_c)]


def generate(dataset, existing_hashes, rng, n):
    teams = _team_criteria(dataset)
    out, guard = [], 0
    while len(out) < n and guard < n * 200:
        guard += 1
        rows = rng.sample(teams, 3)
        cols = rng.sample(AWARD_COLUMNS, 3)
        d = {"rows": rows, "cols": cols}
        if content_hash(d) in existing_hashes:
            continue
        try:
            materialize(d, dataset)
        except Invalid:
            continue
        existing_hashes = existing_hashes | {content_hash(d)}
        out.append(d)
    return out


def materialize(definition, dataset):
    rows, cols = definition.get("rows") or [], definition.get("cols") or []
    if len(rows) != 3 or len(cols) != 3:
        raise Invalid("board needs 3 rows and 3 cols")
    # Stored boards keep whatever label they were generated with; re-derive team labels
    # so a republish heals stale franchise names (value/cells are unaffected).
    names = _current_team_names(dataset)
    rows = [{**r, "label": names.get(r.get("value"), r.get("label"))} if r.get("type") == "team" else r
            for r in rows]
    valid = []
    for r in rows:
        for c in cols:
            ids = _cell_valid(dataset, r, c)
            if not MIN_VALID <= len(ids) <= MAX_VALID:
                raise Invalid(f"{r['label']} x {c['label']}: {len(ids)} valid players (need {MIN_VALID}-{MAX_VALID})")
            valid.append(ids)
    return envelope(SLUG, None, {"rows": rows, "cols": cols, "valid": valid})


def validate(materialized):
    valid = materialized.get("valid") or []
    problems = []
    if len(valid) != 9:
        problems.append("valid must have 9 cells")
    for i, cell in enumerate(valid):
        if not MIN_VALID <= len(cell) <= MAX_VALID:
            problems.append(f"cell {i}: {len(cell)} valid players")
    return problems


def index_item(definition, materialized):
    return [None]


def players_referenced(definition, materialized, dataset=None):
    return sorted({pid for cell in materialized["valid"] for pid in cell})


def qid_for(definition, seq):
    return f"ttt-{seq:04d}"
