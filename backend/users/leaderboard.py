"""Leaderboard service.

Uses a Redis sorted set (ZSET) when REDIS_URL is set — O(log N) rank/top-N at any
scale — and falls back to the original Postgres queries otherwise, so behavior is
unchanged with no Redis configured. The `redis` package is imported lazily, so local
and CI (no REDIS_URL) need not install it.

Entries are keyed by the player's permanent PUBLIC ID (usernames are display
names and may repeat), so renames never touch the board and two players with
the same name can't collide.

Banned accounts (users.strikes) are hidden, not deleted: every Postgres path filters them out,
`remove()` drops them from the ZSET at ban time and `record_score` never re-adds them; an unban
re-records the score, so the row comes back with its points.
"""
import os

from django.contrib.auth import get_user_model

User = get_user_model()

ZKEY = "leaderboard"
_client = None


def _ranked():
    """Every account that may appear on a board: banned accounts are hidden (users.strikes)."""
    return User.objects.filter(banned_at__isnull=True)


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
        rows = _ranked().order_by("-points")[:n].values("public_id", "username", "points")
        return [{"id": u["public_id"], "username": u["username"], "points": u["points"]} for u in rows]
    entries = r.zrevrange(ZKEY, 0, n - 1, withscores=True)
    ids = [m for m, _ in entries]
    # One query resolves the display names for the whole page.
    names = dict(_ranked().filter(public_id__in=ids).values_list("public_id", "username"))
    return [
        {"id": m, "username": names.get(m, "Player"), "points": int(s)}
        for m, s in entries
    ]


def rank_of(user):
    """1-based rank of `user` (number of players with strictly more points, + 1)."""
    r = _redis()
    if r is None:
        return _ranked().filter(points__gt=user.points).count() + 1
    rank = r.zrevrank(ZKEY, user.public_id)
    if rank is None:
        # Not in the ZSET yet (e.g. before the first sync) — fall back to a count.
        return _ranked().filter(points__gt=user.points).count() + 1
    return rank + 1


def total():
    """Total number of ranked players. With Redis, the ZSET is authoritative (every
    account is added on creation + via `sync_leaderboard`), so we don't mix in a
    Postgres count, which would hide drift."""
    r = _redis()
    if r is None:
        return _ranked().count()
    return r.zcard(ZKEY)


def record_score(user):
    """Upsert a user's score into the ZSET (no-op without Redis, and for a banned account)."""
    r = _redis()
    if r is None or getattr(user, "banned_at", None):
        return
    r.zadd(ZKEY, {user.public_id: user.points})


def remove(user):
    """Drop a user from the ZSET (no-op without Redis). Called when an account is banned."""
    r = _redis()
    if r is None:
        return
    r.zrem(ZKEY, user.public_id)


def friends_board(user):
    """Rows for `user` + their friends, highest first, as (board, rank, count).

    Always Postgres-backed, bypassing Redis entirely: friend groups are small,
    so the ZSET's O(log N)-at-scale advantage doesn't apply, and computing the
    rank within an already-small sorted list is just its index — no need for
    a scoped ZSET primitive, and it stays correct for accounts that predate
    Redis being wired in.
    """
    from django.db.models import Q

    from users.models import Friendship

    pairs = Friendship.objects.filter(Q(user_low=user) | Q(user_high=user)).values_list(
        "user_low_id", "user_high_id"
    )
    friend_ids = {hi if lo == user.pk else lo for lo, hi in pairs}
    ids = list(friend_ids) + [user.pk]

    rows = list(
        _ranked().filter(pk__in=ids).order_by("-points").values("pk", "public_id", "username", "points")
    )
    board = [{"id": r["public_id"], "username": r["username"], "points": r["points"]} for r in rows]
    my_rank = next((i + 1 for i, r in enumerate(rows) if r["pk"] == user.pk), len(board))
    return board, my_rank, len(board)
