"""The rank ladder: lifetime points decide the rank. Ranks never drop.

Each rank can carry an active-days gate (`Rank.days`, a Paris day with at least one scoring game,
trivia.awarding); since 2026-10-20 every gate is 0, so points alone decide (owner decision). The frontend
holds no thresholds; it displays `progress()` as the backend sends it (users.views.user_payload).

Changing LADDER, the rank gates or the daily rules also means: update `RANK_TAGLINES` in src/utils/ranks.ts.
The ladder cache key (`LADDER_CACHE_KEY` in users/ladder.py, one cache shared by
dev and prod) hashes LADDER, so a gate change gets a fresh key by itself; the daily rules are read per request and
never cached. Bump the key's version by hand only if the cached payload's shape changes.
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class Rank:
    name: str
    points: int
    days: int


LADDER = (
    Rank("Rookie", 0, 0),
    Rank("Role Player", 100, 0),
    Rank("Sixth Man", 500, 0),
    Rank("Starter", 1_500, 0),
    Rank("All-Star", 5_000, 0),
    Rank("All-NBA", 15_000, 0),
    Rank("MVP", 40_000, 0),
    Rank("Hall of Famer", 80_000, 0),
    Rank("GOAT", 150_000, 0),
)
RANK_NAMES = [r.name for r in LADDER]
# Divisions (III -> II -> I) split the long climbs from All-Star up into thirds of the point span, so a
# promotion still lands every few weeks. GOAT (the top) has none.
DIVISIONS_FROM = RANK_NAMES.index("All-Star")


def rank_for(points, active_days):
    """The highest rank whose points AND days are both met."""
    current = LADDER[0]
    for r in LADDER:
        if points >= r.points and active_days >= r.days:
            current = r
    return current.name


def _index(name):
    return RANK_NAMES.index(name) if name in RANK_NAMES else 0


def division(name, points):
    """3, 2 or 1 for ranks that have divisions, else None. Points past the next threshold (held back by
    the day gate) are division 1."""
    i = _index(name)
    if i < DIVISIONS_FROM or i == len(LADDER) - 1:
        return None
    span = LADDER[i + 1].points - LADDER[i].points
    into = max(0, points - LADDER[i].points)
    if into < span / 3:
        return 3
    if into < 2 * span / 3:
        return 2
    return 1


def progress(points, active_days):
    """What the profile card shows: the rank, its division, and what the next rank still needs."""
    name = rank_for(points, active_days)
    i = _index(name)
    here = LADDER[i]
    nxt = LADDER[i + 1] if i + 1 < len(LADDER) else None
    if nxt is None:
        pct = 100
    else:
        span = nxt.points - here.points
        pct = int(round(100 * min(max(points - here.points, 0), span) / span))
    return {
        "rank": name,
        "division": division(name, points),
        "next_rank": nxt.name if nxt else None,
        "next_points": nxt.points if nxt else None,
        "next_days": nxt.days if nxt else None,
        "points_to_next": max(0, nxt.points - points) if nxt else 0,
        "days_to_next": max(0, nxt.days - active_days) if nxt else 0,
        "progress_pct": pct,
    }
