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
TARGET = 60
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


def _team_criteria(dataset):
    min_team_players = 40 if len(dataset.playable) > 1000 else 20
    names, counts = {}, {}
    for r in dataset.playable:
        for s in r.get("teams") or []:
            counts[s["abbr"]] = counts.get(s["abbr"], 0) + 1
            names.setdefault(s["abbr"], s.get("name") or s["abbr"])
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


def players_referenced(definition, materialized):
    return sorted({pid for cell in materialized["valid"] for pid in cell})


def qid_for(definition, seq):
    return f"ttt-{seq:04d}"
