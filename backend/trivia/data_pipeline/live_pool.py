"""The live shared player pool — one dataset, read at request time.

``trivia/data_static/players_curated.json`` (frozen contract #1) is the single
player dataset the app has. ``trivia.games.players_index`` republishes it
verbatim as the ``players-index`` pool, which every single-player renderer
downloads from the CDN and filters client-side.

Games whose multiplayer round is dealt by Django used to keep a second,
hand-authored subset of it per game (``*_seed.json``). Those subsets drifted:
stale facts, players that no longer existed in the pool, eligibility that
disagreed with what the live game did. So the round endpoints now filter THIS
pool at request time by the same eligibility rule their renderer applies —
rules, never hand-picked lists, so nothing has to be re-authored when the
dataset grows.
"""

import json
import os

from django.conf import settings

from trivia.data_pipeline.curated_players import playable_rows

CURATED_PATH = os.path.join(
    settings.BASE_DIR, "trivia", "data_static", "players_curated.json"
)


# Parsed once and kept, the way trivia/views.py load_dataset caches its fallback
# datasets — seven round endpoints read this file now, and re-parsing megabytes of
# JSON per request would be the one part of this design that only works while the
# dataset is small. Keyed on (mtime, size) rather than cached forever, so a
# regenerated file is picked up without a process restart.
_cache_key = None
_cache_rows = []
_cache_pool = []


def _read():
    """Refresh the two cached lists if the file changed; False when unreadable."""
    global _cache_key, _cache_rows, _cache_pool
    try:
        stat = os.stat(CURATED_PATH)
    except OSError:
        return False
    key = (stat.st_mtime_ns, stat.st_size)
    if key != _cache_key:
        try:
            with open(CURATED_PATH, "r", encoding="utf-8") as f:
                rows = json.load(f)
        except (OSError, ValueError):
            return False
        _cache_rows = rows if isinstance(rows, list) else []
        _cache_pool = playable_rows(_cache_rows)
        _cache_key = key
    return True


def load_dataset():
    """Every curated row, including the players who never took the floor.

    This is the 1:1-with-the-league-index dataset, so it is what
    ``data/all-players.json`` is published from — one entry per row. Games want
    ``load_players()`` instead.

    TREAT THE RESULT AS READ-ONLY (see load_players).
    """
    return _cache_rows if _read() else []


def load_players():
    """The playable pool: curated rows with >= 1 team stint ([] when unreadable).

    The dataset on disk is 1:1 with the league index, so it also holds the 308
    players who have never taken the floor (`teams: []`). Those are dataset
    rows, not pool rows — see curated_players.playable_rows — and the filter
    lives HERE so the pool players-index publishes and the pool every round
    endpoint deals from are the same set, byte for byte.

    Callers treat [] as "content not ready" (503) rather than crashing, so a
    half-deployed dataset degrades the same way an empty seed used to.

    TREAT THE RESULT AS READ-ONLY. It is the shared cached list, not a copy —
    copying it would defeat the cache. Filter or sample it (``[r for r in ...]``,
    ``random.sample``, ``random.choices`` all build a new list); never sort,
    append to, or mutate a row of what comes back.
    """
    return _cache_pool if _read() else []
