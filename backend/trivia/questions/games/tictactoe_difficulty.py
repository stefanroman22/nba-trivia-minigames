"""Tic-Tac-Toe difficulty: the owner's rules (2026-10-25) and the easy-board generator.

A board is 9 cells and each cell is a PAIR of criteria (its row team x its column). Difficulty lives in the pairs: a
board is only as easy as its hardest cell. So the rules judge pairs, and easy boards are composed from a library of
pairs that are each easy (`pair_library`), instead of drawing random boards and hoping.

HARD — what the owner's review of the published boards showed (every one hard): a column that asks for NBA history
or a rule casual players don't know. Any award (MVP, Finals MVP, DPOY, Rookie of the Year, All-NBA, champion,
All-Star 5x) and above all Sixth Man (most players don't know what qualifies), any draft fact (lottery pick,
undrafted, top-5, second round, draft decade), a college, a career-stat threshold. Every published board has three
such columns, so `classify` labels them all hard, with the reasons.

EASY — the owner's criteria: broad categories everyone knows, and answers that are general (many well-known players
fit), not only many. Concretely:
  - rows: the current franchises (a casual fan knows today's 30 teams, not the defunct ones);
  - columns: position (Guard / Forward / Center), origin (From USA / International, or one named country
    where a famous player fits every row, e.g. Spurs x France), decade played (2010s / 2020s);
  - every cell: at least MIN_POOL valid players AND at least MIN_NAMEABLE of them well known (fame band KNOWN or
    better, trivia.questions.fame), so a casual fan can name one; at most MAX_POOL (the publisher's eligibility cap);
  - variety: at most two position columns, one origin column and one decade column per board; no board repeats
    another's set of criteria (tictactoe.dup_key); teams are spread evenly over the generated boards.
"""
import itertools
from collections import Counter

from trivia.games.tictactoe import CURRENT_YEAR
from trivia.questions import fame
from trivia.questions.games import tictactoe as ttt
from trivia.questions.hashing import content_hash

MIN_POOL = 8
MIN_NAMEABLE = 2
MAX_POOL = ttt.MAX_VALID

HARD_TYPES = {"award", "draft", "college", "stat"}
HARD_WHY = {
    ("award", "smoy"): "Sixth Man: an award whose rule most players don't know",
    ("award", "mvp"): "MVP: an award (needs NBA history)",
    ("award", "fmvp"): "Finals MVP: an award (needs NBA history)",
    ("award", "dpoy"): "Defensive POY: an award (needs NBA history)",
    ("award", "roty"): "Rookie of the Year: an award (needs NBA history)",
    ("award", "allnba"): "All-NBA: an award (needs NBA history)",
    ("award", "ring"): "NBA Champion: needs title history",
    ("award", "allstar5plus"): "5x All-Star: needs career history",
    ("draft", "lottery"): "Lottery pick: a draft fact casual players don't know",
    ("draft", "undrafted"): "Undrafted: a draft fact casual players don't know",
}

POSITIONS = [{"type": "position", "value": v, "label": label} for v, label in (("guard", "Guard"), ("forward", "Forward"), ("center", "Center"))]
# `country` is the country the NBA lists for the player (Kyrie Irving, born in Australia, is USA), not his birthplace:
# hence "International", never "Born outside the USA".
ORIGINS = [{"type": "country", "value": "USA", "label": "From USA"}, {"type": "country", "value": "INTL", "label": "International"}]
DECADES = [{"type": "era", "value": d, "label": f"Played in the {d}"} for d in ("2010s", "2020s")]


def _group(col):
    return {"position": "position", "country": "origin", "era": "decade"}.get(col["type"], col["type"])


GROUP_MAX = {"position": 2, "origin": 1, "decade": 1}


def current_teams(dataset):
    """Team criteria (modern name) of the franchises playing now: an open stint, or one that ended this season or the last."""
    live = {s["abbr"] for p in dataset.playable for s in p.get("teams") or [] if s.get("end_year") is None or s["end_year"] >= CURRENT_YEAR - 1}
    return [t for t in ttt._team_criteria(dataset) if t["value"] in live]


def named_countries(dataset):
    """One-country columns worth trying: countries other than the USA with at least three well-known players."""
    known = Counter(p.get("country") for p in dataset.playable if p.get("country") not in (None, "USA") and fame.at_least(p, fame.KNOWN))
    return [{"type": "country", "value": c, "label": f"From {c}"} for c, n in known.most_common() if n >= 3]


def cell_stats(dataset, row, col):
    """(pool, nameable): valid players of the pair, and how many of them are well known."""
    players = [p for p in dataset.playable if ttt.pair_matches(p, row, col)]
    return len(players), sum(1 for p in players if fame.at_least(p, fame.KNOWN))


def cell_is_easy(pool, nameable):
    return MIN_POOL <= pool <= MAX_POOL and nameable >= MIN_NAMEABLE


def pair_library(dataset, columns=None):
    """{(team value, column key): (pool, nameable)} for every current team x easy-candidate column."""
    columns = columns if columns is not None else POSITIONS + ORIGINS + DECADES + named_countries(dataset)
    return {(t["value"], _key(c)): cell_stats(dataset, t, c) for t in current_teams(dataset) for c in columns}, columns


def _key(c):
    return f"{c['type']}:{c['value']}"


def classify(definition, dataset):
    """(band, reason) of one board by the rules: 'hard' with what makes it hard, 'easy' when every pair passes the easy
    rules, or (None, reason) when the rules say neither (medium, left to the owner)."""
    cols = definition.get("cols") or []
    rows = definition.get("rows") or []
    hard = [HARD_WHY.get((c.get("type"), c.get("value")), f"{c.get('label')}: needs NBA history") for c in cols if c.get("type") in HARD_TYPES]
    stats = [cell_stats(dataset, r, c) for r in rows for c in cols]
    thin = sum(1 for _, nameable in stats if nameable < MIN_NAMEABLE)
    if hard:
        why = "; ".join(hard)
        if thin:
            why += f"; {thin} of 9 cells have fewer than {MIN_NAMEABLE} well-known answers"
        return "hard", f"Hard by rule: {why}."
    if stats and all(cell_is_easy(*s) for s in stats):
        fewest = min(n for _, n in stats)
        return "easy", (f"Easy by rule: broad columns ({', '.join(c['label'] for c in cols)}); every cell has at least "
                        f"{MIN_POOL} answers and {fewest}+ well-known players.")
    return None, f"Neither rule: {thin} of 9 cells have fewer than {MIN_NAMEABLE} well-known answers."


def _column_triples(columns):
    for triple in itertools.combinations(columns, 3):
        groups = Counter(_group(c) for c in triple)
        if all(n <= GROUP_MAX.get(g, 1) for g, n in groups.items()):
            yield triple


def generate_easy(dataset, existing_hashes, existing_dup_keys, rng, n):
    """Up to `n` new easy boards {"rows", "cols"}: column triples in a shuffled round-robin, each with the least-used
    trio of current teams whose 9 pairs are all easy. Skips any board whose hash or criteria set already exists."""
    lib, columns = pair_library(dataset)
    teams = {t["value"]: t for t in current_teams(dataset)}
    options = []
    for triple in _column_triples(columns):
        ok = [v for v in teams if all(cell_is_easy(*lib[(v, _key(c))]) for c in triple)]
        if len(ok) >= 3:
            options.append((list(triple), ok))
    rng.shuffle(options)
    used, out, hashes, dups = Counter(), [], set(existing_hashes), set(existing_dup_keys)
    stalled = 0
    while len(out) < n and options and stalled < len(options):
        progressed = False
        for cols, ok in options:
            if len(out) >= n:
                break
            for _ in range(12):  # a few tries for an unused trio of this column triple, least-used teams first
                pool = sorted(ok, key=lambda v: (used[v], rng.random()))[: max(3, min(len(ok), 8))]
                trio = rng.sample(pool, 3)
                d = {"rows": [teams[v] for v in rng.sample(trio, 3)], "cols": rng.sample(cols, 3)}
                dk = "|".join(sorted(_key(c) for c in d["rows"] + d["cols"]))
                h = content_hash(d)
                if h in hashes or dk in dups:
                    continue
                hashes.add(h)
                dups.add(dk)
                used.update(trio)
                out.append(d)
                progressed = True
                break
        stalled = 0 if progressed else stalled + len(options)
    return out
