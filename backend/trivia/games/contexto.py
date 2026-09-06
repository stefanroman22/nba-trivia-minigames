"""LeContexto - backend round provider.

The game ranks EVERY player in the pool by similarity to a hidden daily secret,
so the RANKING needs the players' full profiles — but a round payload does not
have to carry them. Single-player already loads the whole players-index pool
from the CDN and picks the day's secret out of it client-side (``dailySecret``
in src/Game Renderers/Contexto.tsx, FNV-1a over the UTC date across the fame
tier 1-2 candidates). Multiplayer loads the very same CDN pool.

So a round carries CONFIG, not the pool:

    {"series": [{"pool": "players-index",
                 "day": "YYYY-MM-DD",
                 "secret_person_id": 2544}]}

``daily_secret`` below is the Python twin of the renderer's ``dailySecret``
over the same live pool (trivia/data_pipeline/live_pool.py), so the two modes
still resolve the same player for the same day; the renderer falls back to
running ``dailySecret`` itself if the id isn't in the pool it loaded.

Shipping the pool instead (as this endpoint used to) is O(dataset) per player
per round — 160 KB at 159 rows, megabytes at the full dataset, re-emitted on
every reconnect.
"""
import datetime

from django.http import JsonResponse

from trivia.data_pipeline.live_pool import load_players

GAME_NAME = "LeContexto"

POOL_KEY = "players-index"  # the CDN pool the renderer ranks against
SECRET_FAME_TIERS = (1, 2)  # a guessable secret is a famous player


def _fnv1a(text):
    """FNV-1a over UTF-16 code units — hashStr() in src/Game Renderers/Contexto.tsx."""
    h = 2166136261
    for ch in text:
        h = (h ^ ord(ch)) & 0xFFFFFFFF
        h = (h * 16777619) & 0xFFFFFFFF
    return h


def daily_secret(rows, day):
    """The day's secret player — the Python twin of dailySecret() in the renderer.

    Same rule, same order, same hash: fame tier 1-2 candidates sorted by
    person_id, indexed by the FNV-1a hash of the "YYYY-MM-DD" UTC date. Returns
    None for an empty pool.
    """
    if not rows:
        return None
    candidates = [r for r in rows if r.get("fame_tier", 9) in SECRET_FAME_TIERS]
    ordered = sorted(candidates or rows, key=lambda r: r["person_id"])
    return ordered[_fnv1a(day) % len(ordered)]


def get_round(request):
    """The day and its secret — the renderer loads the pool and ranks against it."""
    rows = load_players()
    if not rows:
        return JsonResponse({"error": "LeContexto content not ready"}, status=503)
    day = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
    secret = daily_secret(rows, day)
    return JsonResponse(
        {
            "series": [
                {
                    "pool": POOL_KEY,
                    "day": day,
                    "secret_person_id": secret["person_id"],
                }
            ]
        }
    )
