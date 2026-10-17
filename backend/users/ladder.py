"""The ladder: how ranks are distributed and what it takes to climb (ladder spec §1).

`distribution()` is the expensive part — a cache miss costs 7 queries (one COUNT, one GROUP BY over the public
players, five OFFSET queries for the percentile thresholds) — and is cached for LADDER_TTL under LADDER_CACHE_KEY.
The key carries a hash of users.ranks.LADDER, so a gate change can never serve stale gates (dev and prod share one
cache); bump its version by hand only when the shape of the payload changes. A cache outage behaves as a miss. The
`you` block is per request (one rank_of query) and never cached.
"""
import hashlib
import logging
import math

from django.core.cache import cache
from django.db.models import Count

from users import leaderboard, ranks

logger = logging.getLogger(__name__)

PERCENTILES = (1, 5, 10, 25, 50)
LADDER_CACHE_KEY = f"ladder:v1:{hashlib.md5(repr(ranks.LADDER).encode()).hexdigest()[:8]}"
LADDER_TTL = 600  # seconds
RANK_NAMES = ranks.RANK_NAMES


def _threshold(ranked, total, pct):
    """Points of the player at the top-`pct`% boundary: at least this many points puts you in the top pct%."""
    if total == 0:
        return 0
    k = max(0, math.ceil(total * pct / 100) - 1)
    row = ranked.order_by("-points").values_list("points", flat=True)[k:k + 1]
    return row[0] if row else 0


def _compute():
    ranked = leaderboard._ranked()
    total = ranked.count()
    counts = dict(ranked.values("rank").annotate(n=Count("id")).values_list("rank", "n"))
    rows = []
    for r in ranks.LADDER:
        n = counts.get(r.name, 0)
        rows.append({
            "name": r.name,
            "points": r.points,
            "days": r.days,
            "players": n,
            "share_pct": round(100 * n / total, 1) if total else 0.0,
        })
    return {
        "total_players": total,
        "ladder": rows,
        "percentiles": {str(p): _threshold(ranked, total, p) for p in PERCENTILES},
    }


def distribution():
    """Cached rank counts + percentile thresholds for the public population (adult, not banned)."""
    try:
        data = cache.get(LADDER_CACHE_KEY)
    except Exception as exc:
        logger.warning("ladder cache unavailable (%s): %s", "get", exc)
        data = None
    if data is None:
        data = _compute()
        try:
            cache.set(LADDER_CACHE_KEY, data, LADDER_TTL)
        except Exception as exc:
            logger.warning("ladder cache unavailable (%s): %s", "set", exc)
    return data


def you_block(user, dist):
    """Where `user` stands against the public population. Works for accounts outside it (teens)."""
    total = dist["total_players"]
    position = leaderboard.rank_of(user)
    percentile = round(100 * position / total, 1) if total else 100.0
    percentile = min(99.9, max(0.1, percentile))
    same = next((row["players"] for row in dist["ladder"] if row["name"] == user.rank), 0)
    prog = ranks.progress(user.points, user.active_days)
    return {
        "rank": user.rank,
        "division": prog["division"],
        "position": position,
        "percentile": percentile,
        "ahead_of_pct": round(100 - percentile, 1),
        "same_rank_pct": round(min(100.0, 100 * same / total), 1) if total else 0.0,
        "next_rank": prog["next_rank"],
        "points_to_next": prog["points_to_next"],
        "days_to_next": prog["days_to_next"],
        "to_top": {p: max(0, pts - user.points) for p, pts in dist["percentiles"].items()},
    }


def rules():
    """The daily rules the UI explains, read from the code so the copy can't drift."""
    from trivia import awarding
    from users.views import GUEST_CARRYOVER_MAX

    return {
        "first_game_bonus": awarding.FIRST_GAME_BONUS,
        "daily_full": awarding.DAILY_FULL,
        "daily_half": awarding.DAILY_HALF,
        "daily_tail_rate": awarding.DAILY_TAIL_RATE,
        "streak_milestones": {str(k): v for k, v in awarding.STREAK_MILESTONES.items()},
        "max_freezes": awarding.MAX_FREEZES,
        "guest_carryover_max": GUEST_CARRYOVER_MAX,
    }
