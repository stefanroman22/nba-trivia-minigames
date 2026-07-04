"""Leaderboard service.

Uses a Redis sorted set (ZSET) when REDIS_URL is set — O(log N) rank/top-N at any
scale — and falls back to the original Postgres queries otherwise, so behavior is
unchanged with no Redis configured. The `redis` package is imported lazily, so local
and CI (no REDIS_URL) need not install it.

Entries are keyed by the player's permanent PUBLIC ID (usernames are display
names and may repeat), so renames never touch the board and two players with
the same name can't collide.
"""
import os

from django.contrib.auth import get_user_model

User = get_user_model()

ZKEY = "leaderboard"
_client = None


def _redis():
    """Return a redis client if REDIS_URL is set, else None (Postgres fallback)."""
    global _client
    url = os.environ.get("REDIS_URL")
    if not url:
        return None
    if _client is None:
        import redis  # lazy: only needed when REDIS_URL is configured

        _client = redis.from_url(url, decode_responses=True)
    return _client


def top(n=100):
    """Top `n` rows as [{"id", "username", "points"}], highest first."""
    r = _redis()
    if r is None:
        rows = User.objects.order_by("-points")[:n].values("public_id", "username", "points")
        return [{"id": u["public_id"], "username": u["username"], "points": u["points"]} for u in rows]
    entries = r.zrevrange(ZKEY, 0, n - 1, withscores=True)
    ids = [m for m, _ in entries]
    # One query resolves the display names for the whole page.
    names = dict(User.objects.filter(public_id__in=ids).values_list("public_id", "username"))
    return [
        {"id": m, "username": names.get(m, "Player"), "points": int(s)}
        for m, s in entries
    ]


def rank_of(user):
    """1-based rank of `user` (number of players with strictly more points, + 1)."""
    r = _redis()
    if r is None:
        return User.objects.filter(points__gt=user.points).count() + 1
    rank = r.zrevrank(ZKEY, user.public_id)
    if rank is None:
        # Not in the ZSET yet (e.g. before the first sync) — fall back to a count.
        return User.objects.filter(points__gt=user.points).count() + 1
    return rank + 1


def total():
    """Total number of ranked players. With Redis, the ZSET is authoritative (every
    account is added on creation + via `sync_leaderboard`), so we don't mix in a
    Postgres count, which would hide drift."""
    r = _redis()
    if r is None:
        return User.objects.count()
    return r.zcard(ZKEY)


def record_score(user):
    """Upsert a user's score into the ZSET (no-op without Redis)."""
    r = _redis()
    if r is None:
        return
    r.zadd(ZKEY, {user.public_id: user.points})
