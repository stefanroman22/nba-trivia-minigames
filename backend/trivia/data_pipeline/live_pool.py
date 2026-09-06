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

CURATED_PATH = os.path.join(
    settings.BASE_DIR, "trivia", "data_static", "players_curated.json"
)


def load_players():
    """Curated PlayerIndexEntry rows ([] when the dataset is missing/unreadable).

    Callers treat [] as "content not ready" (503) rather than crashing, so a
    half-deployed dataset degrades the same way an empty seed used to.
    """
    if not os.path.exists(CURATED_PATH):
        return []
    try:
        with open(CURATED_PATH, "r", encoding="utf-8") as f:
            rows = json.load(f)
    except (OSError, ValueError):
        return []
    return rows if isinstance(rows, list) else []
