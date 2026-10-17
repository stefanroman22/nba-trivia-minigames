"""Difficulty, interest and coverage of a question (question factory §4.3, phase 2).

score(mod, materialized, dataset, spec) turns a game module's features(m, dataset)
into the scores the runner stores in Question.quality:

    difficulty  weighted sum of spec["difficulty"]["features"]   0 = easiest
    band        easy|medium|hard, from spec["difficulty"]["bands"]
    interest    weighted sum of spec["interest"]["features"]     0 = dullest
    coverage    {axis: value} for spec["coverage"]["axes"]
    dup_key     mod.dup_key(definition, m): the near-duplicate key

Every feature is normalized to 0..1. A difficulty feature is 1 when it makes the
question hardest; an interest feature is 1 when it makes it most interesting. A
difficulty and an interest feature measuring the same thing therefore carry
different names (career-path `memorable_stop` vs `memorable`).

Feature normalization:
- fame_band (all player games, difficulty): the player's fame band, read as a share
  of the bands the game admits (STAR..its floor band), each band an equal slice,
  interpolated inside the band by fame score (BAND_SCORES: the top of the band
  is 0 within it, the band's threshold 1). A player held up by his fame_tier
  floor (score below his band) sits at the bottom of his band. So for a KNOWN-floor
  game a 120+ score STAR is 0, a STAR at 40 is 0.5, a KNOWN at 18 is 1.
- era_age (who-are-ya, contexto, difficulty): years since the player's last season,
  measured from the dataset's latest season, / ERA_SPAN_YEARS (40), capped at 1.
  An active player is 0.
- stint_count (career-path, difficulty): (max - stints) / (max - min) over the
  game's eligible 3..7: fewer cards, fewer clues, so 3 stints is 1 and 7 is 0.
- memorable_stop (career-path, difficulty): 1 - the share of stints that are
  memorable (memorable_stint). A path of only famous stops is 0.
- memorable (career-path, interest): memorable stints / 2, capped at 1: one
  memorable stop is 0.5, two or more 1, none 0 (rejected below interest.min 0.3).
- distinct_clues (who-are-ya, difficulty): 1 - clues / 5; clues (interest): clues / 5.
  A clue counts when it is set and differs from the pool's most common value
  (clue_modes): position, birth year, jersey, draft (round, pick), and the team
  of the longest stint.
- recognizable (contexto, interest): 1 - fame_band read on the full STAR..OBSCURE
  scale, so every KNOWN+ secret scores at least 0.5: eligibility already asks for a
  known name, and the pool must last a year without repeats.
- mean_cell_size, min_cell_size (tictactoe, difficulty): 1 - a log scale of the
  cells' mean (resp. smallest) answer count over [3, 400], the eligibility range:
  3 answers is 1, 400 is 0.
- famous_per_cell (tictactoe, difficulty): 1 - famous / 3; famous (interest):
  famous / 3, where famous is the mean number of KNOWN+ players among each cell's
  first three answers (cells are fame-ordered).

Coverage values (strings, or a list for a question covering several cells):
- decade: decade of the player's first stint, "1990s"; tictactoe: the decade of
  the median first-stint year over the board's distinct valid players.
- team: modern abbr of the player's longest stint (games played, then seasons);
  tictactoe: the three row team abbrs (a list: one cell per team).
- position: the player's position ("?" when unknown).
Coverage cells are per axis (axis, value), not the full decade x team x position
product: most of that product (~1,200 cells) can never be filled, so it would
make every candidate look like it fills a gap.

select() picks greedily: the difficulty band furthest below its mix share first,
then the candidate filling the most empty coverage cells (then the least crowded,
then the most interesting). A candidate whose featured player would appear in more
than max(MIN_PLAYER_LIMIT, max_player_share x questions) questions is refused.
"""
import math
from collections import Counter

from trivia.questions import fame

LEVELS = ("easy", "medium", "hard")
BAND_SCORES = {fame.STAR: (120.0, 40.0), fame.KNOWN: (40.0, 18.0), fame.DEEP: (18.0, 10.0), fame.OBSCURE: (10.0, 0.0)}
ERA_SPAN_YEARS = 40
MARQUEE = frozenset({"LAL", "BOS", "CHI", "GSW", "MIA", "SAS", "NYK", "PHI", "DAL", "HOU"})
ALLSTAR_PPG = 15
CELL_RANGE = (3, 400)
MIN_PLAYER_LIMIT = 3


def _clamp(x):
    return max(0.0, min(1.0, x))


def fame_hardness(row, floor=fame.OBSCURE):
    """0 = the most famous player, 1 = the bottom of the floor band (see the docstring)."""
    band = min(fame.fame_band(row), floor)
    top, bottom = BAND_SCORES[band]
    score = min(max(fame.fame_score(row), bottom), top)
    within = (top - score) / (top - bottom)
    return _clamp((band - 1 + within) / floor)


def _cached(dataset, key, build):
    extra = getattr(dataset, "extra", None)
    if extra is None:
        return build()
    if key not in extra:
        extra[key] = build()
    return extra[key]


def latest_season(dataset):
    return _cached(dataset, "quality_latest_season", lambda: max(
        (s.get("end_year") or s.get("start_year") or 0 for r in dataset.playable for s in r.get("teams") or []),
        default=0))


def era_age(row, dataset):
    ref = latest_season(dataset)
    stints = row.get("teams") or []
    if not stints or any(s.get("end_year") is None for s in stints):
        return 0.0
    last = max(s["end_year"] for s in stints)
    return _clamp((ref - last) / ERA_SPAN_YEARS)


def memorable_stint(stint, row):
    """A ring inside the stint, an All-Star-level stint, or a marquee franchise."""
    awards = row.get("awards") or {}
    start, end = stint.get("start_year") or 0, stint.get("end_year")
    if any(start < y and (end is None or y <= end) for y in awards.get("rings") or []):
        return True
    if (awards.get("allstar_count") or 0) >= 1 and (stint.get("ppg") or 0) >= ALLSTAR_PPG:
        return True
    return stint.get("abbr") in MARQUEE


def memorable_count(row):
    return sum(1 for s in row.get("teams") or [] if memorable_stint(s, row))


def longest_team(row):
    stints = row.get("teams") or []
    if not stints:
        return None
    best = max(stints, key=lambda s: (s.get("gp") or 0, (s.get("end_year") or 0) - (s.get("start_year") or 0)))
    return best.get("abbr")


def _draft_clue(row):
    d = row.get("draft") or {}
    return (d.get("round"), d.get("pick")) if d.get("round") is not None else None


CLUES = {
    "position": lambda r: r.get("position"),
    "birth_year": lambda r: r.get("birth_year"),
    "jersey": lambda r: r.get("jersey"),
    "draft": _draft_clue,
    "team": longest_team,
}


def clue_modes(dataset):
    def build():
        modes = {}
        for name, get in CLUES.items():
            counts = Counter(v for v in (get(r) for r in dataset.playable) if v is not None)
            modes[name] = counts.most_common(1)[0][0] if counts else None
        return modes
    return _cached(dataset, "quality_clue_modes", build)


def distinct_clues(row, dataset):
    modes = clue_modes(dataset)
    return sum(1 for name, get in CLUES.items() if get(row) is not None and get(row) != modes[name])


def first_year(row):
    years = [s["start_year"] for s in row.get("teams") or [] if s.get("start_year") is not None]
    return min(years) if years else None


def decade(year):
    return f"{year // 10 * 10}s" if year is not None else "?"


def player_coverage(row):
    return {"decade": decade(first_year(row)), "team": longest_team(row) or "?",
            "position": row.get("position") or "?"}


def cell_size_hardness(n):
    lo, hi = CELL_RANGE
    return _clamp(1 - (math.log(max(n, lo)) - math.log(lo)) / (math.log(hi) - math.log(lo)))


def _weighted(weights, features, kind):
    missing = set(weights) - set(features)
    if missing:
        raise KeyError(f"{kind} features missing: {', '.join(sorted(missing))}")
    return _clamp(sum(w * features[k] for k, w in weights.items()))


def band_of(difficulty, bands):
    for level in LEVELS:
        lo, hi = bands[level]
        if lo <= difficulty < hi:
            return level
    return LEVELS[-1]  # difficulty == 1


def score(mod, materialized, dataset, spec, definition=None):
    features = mod.features(materialized, dataset)
    difficulty = _weighted(spec["difficulty"]["features"], features, "difficulty")
    coverage = mod.coverage(materialized, dataset)
    return {
        "difficulty": round(difficulty, 4),
        "band": band_of(difficulty, spec["difficulty"]["bands"]),
        "interest": round(_weighted(spec["interest"]["features"], features, "interest"), 4),
        "coverage": {axis: coverage[axis] for axis in spec["coverage"]["axes"]},
        "dup_key": mod.dup_key(definition, materialized),
    }


def featured(mod, definition, materialized, dataset):
    """The players a question is about, for max_player_share (default: every referenced one)."""
    fn = getattr(mod, "featured", None)
    if fn is not None:
        return fn(definition, materialized)
    return mod.players_referenced(definition, materialized, dataset)


def cells(scores):
    out = []
    for axis, value in (scores.get("coverage") or {}).items():
        for v in value if isinstance(value, list) else [value]:
            out.append(f"{axis}:{v}")
    return out


def new_state():
    return {"n": 0, "bands": Counter(), "cells": Counter(), "players": Counter()}


def add(state, scores, players):
    state["n"] += 1
    state["bands"][scores["band"]] += 1
    state["cells"].update(cells(scores))
    state["players"].update(set(players))


def select(pool, k, state, spec):
    """Pick up to k candidates from pool (dicts with "scores" and "featured"); picked and
    refused ones leave the pool, picked ones are added to state. Returns (picked, refused)."""
    mix = spec["difficulty"]["mix"]
    share = spec["consistency"]["max_player_share"]
    picked, refused = [], []
    while pool and len(picked) < k:
        n = state["n"]
        deficit = {b: mix[b] - (state["bands"][b] / n if n else 0.0) for b in LEVELS}
        group = []
        for band in sorted(LEVELS, key=lambda b: -deficit[b]):  # stable: LEVELS order on ties
            group = [c for c in pool if c["scores"]["band"] == band]
            if group:
                break
        best = max(group, key=lambda c: (sum(1 for x in cells(c["scores"]) if not state["cells"][x]),
                                         -sum(state["cells"][x] for x in cells(c["scores"])),
                                         c["scores"]["interest"]))
        pool.remove(best)
        limit = max(MIN_PLAYER_LIMIT, share * (n + 1))
        over = sorted(p for p in set(best["featured"]) if state["players"][p] + 1 > limit)
        if over:
            best["over"] = over
            refused.append(best)
            continue
        add(state, best["scores"], best["featured"])
        picked.append(best)
    return picked, refused


def gap_report(state, universe, spec):
    """Empty coverage cells (seen in the pool or among candidates, still without a question),
    decades covered against min_decades, and the final difficulty mix."""
    n = state["n"]
    decades = {c for c in state["cells"] if c.startswith("decade:") and c != "decade:?"}
    return {
        "empty_cells": sorted(c for c in universe if not state["cells"][c]),
        "decades": len(decades),
        "min_decades": spec["coverage"]["min_decades"],
        "mix": {b: round(state["bands"][b] / n, 3) if n else 0.0 for b in LEVELS},
        "target_mix": spec["difficulty"]["mix"],
        "questions": n,
    }
