"""Tic-Tac-Toe difficulty: the owner's rules (2026-10-25) and the easy, medium and hard board generators.

A board is 9 cells and each cell is a PAIR of criteria (its row team x its column). Difficulty lives in the pairs: a
board is only as easy as its hardest cell. So the rules judge pairs, and boards are composed from a library of pairs
that each pass the band's rule (`pair_library`), instead of drawing random boards and hoping.

Every column has a tier (`column_tier`); a board's band is its hardest column's, then its cells must pass that band's
pair rule.

HARD — what the owner's review of the published boards showed (every one hard): a column that asks for NBA history
or a rule casual players don't know. Finals MVP, DPOY, Rookie of the Year, All-NBA, 5x All-Star and above all Sixth
Man (most players don't know what qualifies), any draft fact but the No. 1 pick (lottery pick, undrafted, top-5,
second round, draft decade), a college, a career-stat threshold (20+ PPG, 8+ APG...), a decade before the 1990s.

MEDIUM — the owner's brief (2026-10-25): a bit more niche than easy, far less than hard. A fan who follows the NBA
knows it without looking anything up:
  - "Played w/ <superstar>": a teammate of one of the top of the top (STARS: Jordan, Kobe, LeBron, Shaq, Duncan,
    Curry, Durant, Magic), any season together on any team;
  - the famous honours: NBA Champion, MVP, All-Star (at least once); the No. 1 pick;
  - the decades before the easy ones: Played in the 1990s / 2000s (with that team, as for every team x decade);
  - every cell: at least MEDIUM_MIN_POOL valid players and at least one well known; boards have at least two medium
    columns (the third may be an easy one) and at most two teammate, two award, one decade and one draft column.

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

from trivia.questions import fame
from trivia.questions.games import tictactoe as ttt
from trivia.questions.hashing import content_hash

MIN_POOL = 8
MIN_NAMEABLE = 2
MAX_POOL = ttt.MAX_VALID
MEDIUM_MIN_POOL = 5
MEDIUM_MIN_NAMEABLE = 1

HARD_WHY = {
    ("award", "smoy"): "Sixth Man: an award whose rule most players don't know",
    ("award", "fmvp"): "Finals MVP: an award (needs NBA history)",
    ("award", "dpoy"): "Defensive POY: an award (needs NBA history)",
    ("award", "roty"): "Rookie of the Year: an award (needs NBA history)",
    ("award", "allnba"): "All-NBA: an award (needs NBA history)",
    ("award", "allstar5plus"): "5x All-Star: needs career history",
    ("draft", "lottery"): "Lottery pick: a draft fact casual players don't know",
    ("draft", "undrafted"): "Undrafted: a draft fact casual players don't know",
}
HARD_WHY_BY_TYPE = {"stat": "a career stat casual players don't know", "draft": "a draft fact casual players don't know",
                    "college": "a college", "era": "a decade before most players' time"}

POSITIONS = [{"type": "position", "value": v, "label": label} for v, label in (("guard", "Guard"), ("forward", "Forward"), ("center", "Center"))]
# `country` is the country the NBA lists for the player (Kyrie Irving, born in Australia, is USA), not his birthplace:
# hence "International", never "Born outside the USA".
ORIGINS = [{"type": "country", "value": "USA", "label": "From USA"}, {"type": "country", "value": "INTL", "label": "International"}]
DECADES = [{"type": "era", "value": d, "label": f"Played in the {d}"} for d in ("2010s", "2020s")]

# The owner: "only big time players like top of the top - not a lot of players". (full name, label name)
STARS = [("Michael Jordan", "Jordan"), ("Kobe Bryant", "Kobe"), ("LeBron James", "LeBron"), ("Shaquille O'Neal", "Shaq"),
         ("Tim Duncan", "Duncan"), ("Stephen Curry", "Curry"), ("Kevin Durant", "Durant"), ("Magic Johnson", "Magic")]
MEDIUM_HONOURS = [{"type": "award", "value": "ring", "label": "NBA Champion"},
                  {"type": "award", "value": "mvp", "label": "Won MVP"},
                  {"type": "award", "value": "allstar", "label": "All-Star"},
                  {"type": "draft", "value": "pick1", "label": "No. 1 pick"}]
MEDIUM_DECADES = [{"type": "era", "value": d, "label": f"Played in the {d}"} for d in ("1990s", "2000s")]
# Hard boards with a career-stat column (the owner: stats are hard), beside the factory's award / draft boards.
STAT_COLUMNS = [{"type": "stat", "value": "ppg20", "label": "20+ PPG career"},
                {"type": "stat", "value": "rpg10", "label": "10+ RPG career"},
                {"type": "stat", "value": "apg8", "label": "8+ APG career"},
                {"type": "stat", "value": "20kpts", "label": "20K career pts"},
                {"type": "stat", "value": "seasons15plus", "label": "15+ seasons"}]
HARD_COLUMNS = STAT_COLUMNS + [c for c in ttt.AWARD_COLUMNS if (c["type"], c["value"]) in HARD_WHY] + [
    {"type": "award", "value": "allstar5plus", "label": "5x All-Star"}, {"type": "draft", "value": "top5", "label": "Top-5 pick"}]

_EASY_KEYS = {f"{c['type']}:{c['value']}" for c in POSITIONS + ORIGINS + DECADES}
_MEDIUM_KEYS = {f"{c['type']}:{c['value']}" for c in MEDIUM_HONOURS + MEDIUM_DECADES}


def _group(col):
    return {"position": "position", "country": "origin", "era": "decade"}.get(col["type"], col["type"])


GROUP_MAX = {"position": 2, "origin": 1, "decade": 1}
MEDIUM_GROUP_MAX = {"position": 1, "origin": 1, "decade": 1, "teammate": 2, "award": 2, "draft": 1}
HARD_GROUP_MAX = {"stat": 2, "award": 2, "draft": 1}


def column_tier(c):
    """'easy', 'medium' or 'hard' for one column criterion (anything not listed as easy or medium is hard)."""
    key = _key(c)
    if key in _EASY_KEYS or (c.get("type") == "country" and c.get("value") not in ("USA", "INTL")):
        return "easy"
    if c.get("type") == "teammate" or key in _MEDIUM_KEYS:
        return "medium"
    return "hard"


def _hard_why(c):
    if (c.get("type"), c.get("value")) in HARD_WHY:
        return HARD_WHY[(c.get("type"), c.get("value"))]
    return f"{c.get('label')}: {HARD_WHY_BY_TYPE.get(c.get('type'), 'needs NBA history')}"


def current_teams(dataset):
    """Team criteria (modern name) of the franchises playing now: someone played this season or the last for them."""
    recent = ttt._current_season() - 1
    live = {abbr for p in dataset.playable for abbr, y in ttt._seasons(p) if y >= recent}
    return [t for t in ttt._team_criteria(dataset) if t["value"] in live]


def named_countries(dataset):
    """One-country columns worth trying: countries other than the USA with at least three well-known players."""
    known = Counter(p.get("country") for p in dataset.playable if p.get("country") not in (None, "USA") and fame.at_least(p, fame.KNOWN))
    return [{"type": "country", "value": c, "label": f"From {c}"} for c, n in known.most_common() if n >= 3]


def teammate_columns(dataset):
    """"Played w/ <star>" columns for the STARS found in the dataset (by full name)."""
    ids = {p["full_name"]: p["person_id"] for p in dataset.playable}
    return [{"type": "teammate", "value": str(ids[name]), "label": f"Played w/ {short}"} for name, short in STARS if name in ids]


def cell_stats(dataset, row, col):
    """(pool, nameable): valid players of the pair, and how many of them are well known. Cached on the dataset."""
    cache = dataset.extra.setdefault("ttt_cell_stats", {})
    key = (_key(row), _key(col))
    if key not in cache:
        players = [p for p in dataset.playable if ttt.pair_matches(p, row, col, dataset)]
        cache[key] = (len(players), sum(1 for p in players if fame.at_least(p, fame.KNOWN)))
    return cache[key]


def cell_is_easy(pool, nameable):
    return MIN_POOL <= pool <= MAX_POOL and nameable >= MIN_NAMEABLE


def cell_is_medium(pool, nameable):
    return MEDIUM_MIN_POOL <= pool <= MAX_POOL and nameable >= MEDIUM_MIN_NAMEABLE


def cell_is_hard(pool, nameable):
    return ttt.MIN_VALID <= pool <= MAX_POOL


def pair_library(dataset, columns=None):
    """{(team value, column key): (pool, nameable)} for every current team x easy-candidate column."""
    columns = columns if columns is not None else POSITIONS + ORIGINS + DECADES + named_countries(dataset)
    return {(t["value"], _key(c)): cell_stats(dataset, t, c) for t in current_teams(dataset) for c in columns}, columns


def _key(c):
    return f"{c['type']}:{c['value']}"


def classify(definition, dataset):
    """(band, reason) of one board by the rules: 'hard' with what makes it hard, 'medium' when its columns are medium
    (or easy) and every pair passes the medium rule, 'easy' when every column is easy and every pair passes the easy
    rule, or (None, reason) when the rules say neither."""
    cols = definition.get("cols") or []
    rows = definition.get("rows") or []
    tiers = [column_tier(c) for c in cols]
    stats = [cell_stats(dataset, r, c) for r in rows for c in cols]
    thin = sum(1 for _, nameable in stats if nameable < MIN_NAMEABLE)
    if "hard" in tiers:
        why = "; ".join(_hard_why(c) for c, t in zip(cols, tiers) if t == "hard")
        if thin:
            why += f"; {thin} of 9 cells have fewer than {MIN_NAMEABLE} well-known answers"
        return "hard", f"Hard by rule: {why}."
    if stats and "medium" not in tiers and all(cell_is_easy(*s) for s in stats):
        fewest = min(n for _, n in stats)
        return "easy", (f"Easy by rule: broad columns ({', '.join(c['label'] for c in cols)}); every cell has at least "
                        f"{MIN_POOL} answers and {fewest}+ well-known players.")
    if stats and all(cell_is_medium(*s) for s in stats):
        medium = [c["label"] for c, t in zip(cols, tiers) if t == "medium"] or [c["label"] for c in cols]
        return "medium", (f"Medium by rule: {', '.join(medium)} need some NBA knowledge; every cell has at least "
                          f"{MEDIUM_MIN_POOL} answers and a well-known one.")
    short = sum(1 for s in stats if not cell_is_medium(*s))
    return None, f"Neither rule: {short} of 9 cells have fewer than {MEDIUM_MIN_POOL} answers or no well-known one."


def _column_triples(columns, group_max=GROUP_MAX, accept=None):
    for triple in itertools.combinations(columns, 3):
        groups = Counter(_group(c) for c in triple)
        if all(n <= group_max.get(g, 1) for g, n in groups.items()) and (accept is None or accept(triple)):
            yield triple


def _compose(dataset, triples, cell_ok, existing_hashes, existing_dup_keys, rng, n):
    """Up to `n` new boards {"rows", "cols"}: the column triples in a shuffled round-robin, each with the least-used
    trio of current teams whose 9 pairs all pass `cell_ok`. Skips any board whose hash or criteria set already exists."""
    teams = {t["value"]: t for t in current_teams(dataset)}
    options = []
    for triple in triples:
        ok = [v for v in teams if all(cell_ok(*cell_stats(dataset, teams[v], c)) for c in triple)]
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


def generate_easy(dataset, existing_hashes, existing_dup_keys, rng, n):
    """Up to `n` new easy boards from the easy columns (see the module docstring)."""
    _, columns = pair_library(dataset)
    return _compose(dataset, _column_triples(columns), cell_is_easy, existing_hashes, existing_dup_keys, rng, n)


def medium_columns(dataset):
    return teammate_columns(dataset) + MEDIUM_HONOURS + MEDIUM_DECADES


def generate_medium(dataset, existing_hashes, existing_dup_keys, rng, n):
    """Up to `n` new medium boards: at least two medium columns, the third medium or easy; every pair medium."""
    columns = medium_columns(dataset) + POSITIONS + ORIGINS + DECADES
    triples = _column_triples(columns, MEDIUM_GROUP_MAX, lambda t: sum(column_tier(c) == "medium" for c in t) >= 2)
    return _compose(dataset, triples, cell_is_medium, existing_hashes, existing_dup_keys, rng, n)


def generate_hard(dataset, existing_hashes, existing_dup_keys, rng, n):
    """Up to `n` new hard boards with at least one career-stat column, beside hard award / draft ones."""
    triples = _column_triples(HARD_COLUMNS, HARD_GROUP_MAX, lambda t: any(c["type"] == "stat" for c in t))
    return _compose(dataset, triples, cell_is_hard, existing_hashes, existing_dup_keys, rng, n)


GENERATORS = {"easy": generate_easy, "medium": generate_medium, "hard": generate_hard}
