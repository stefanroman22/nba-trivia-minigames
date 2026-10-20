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
import logging
import os
import time

from django.contrib.auth import get_user_model

User = get_user_model()
logger = logging.getLogger(__name__)

ZKEY = "leaderboard"
_client = None
DRIFT_WARNING_INTERVAL = 60  # seconds between two "out of sync" warnings
_last_drift_warning = float("-inf")


def _ranked():
    """Every account that may appear on a board: every account except banned ones, which are hidden
    (users.strikes). Age plays no part (owner decision 2026-10-19: the only age limit left is the
    profile photo)."""
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


def _warn_drift(detail):
    """Log that the ZSET has drifted and Postgres is answering, at most once a minute per process (the
    fallback is silent to players, so this is how it shows up)."""
    global _last_drift_warning
    now = time.monotonic()
    if now - _last_drift_warning >= DRIFT_WARNING_INTERVAL:
        _last_drift_warning = now
        logger.warning("leaderboard ZSET out of sync (%s); answering from Postgres until sync_leaderboard runs", detail)


def _in_sync(r):
    """True when the ZSET holds as many members as there are ranked accounts. A ZSET that is
    missing players (never synced, or written while they were hidden) or still holds hidden or
    deleted ones has drifted: the callers then answer from Postgres, which is always right, until
    `sync_leaderboard` rebuilds it."""
    members, ranked = r.zcard(ZKEY), _ranked().count()
    if members != ranked:
        _warn_drift(f"{members} members for {ranked} ranked accounts")
        return False
    return True


def _is_ranked(user):
    return not getattr(user, "banned_at", None)


def _postgres_top(n):
    rows = _ranked().order_by("-points")[:n].values("public_id", "username", "points", "rank")
    return [{"id": u["public_id"], "username": u["username"], "rank": u["rank"], "points": u["points"]} for u in rows]


def top(n=100):
    """Top `n` rows as [{"id", "username", "rank", "points"}], highest first."""
    r = _redis()
    if r is None or not _in_sync(r):
        return _postgres_top(n)
    entries = r.zrevrange(ZKEY, 0, n - 1, withscores=True)
    ids = [m for m, _ in entries]
    # One query resolves the display names for the whole page.
    info = {pid: (name, rank) for pid, name, rank in _ranked().filter(public_id__in=ids).values_list("public_id", "username", "rank")}
    if len(info) < len(ids):
        # A member that is not on the board (hidden or deleted since it was added) means the ZSET has
        # drifted even though its size matches, so a real player is missing from it: Postgres answers.
        _warn_drift(f"{len(ids) - len(info)} of the top {len(ids)} members are not on the board")
        return _postgres_top(n)
    return [{"id": m, "username": info[m][0], "rank": info[m][1], "points": int(s)} for m, s in entries]


def rank_of(user):
    """1-based rank of `user` (number of players with strictly more points, + 1), or None for an
    account that is not on the board."""
    if not _is_ranked(user):
        return None
    r = _redis()
    if r is None or not _in_sync(r):
        return _ranked().filter(points__gt=user.points).count() + 1
    rank = r.zrevrank(ZKEY, user.public_id)
    if rank is None:
        # Not in the ZSET yet (e.g. before the first sync) — fall back to a count.
        return _ranked().filter(points__gt=user.points).count() + 1
    return rank + 1


def total():
    """Total number of ranked players, from Postgres: the ZSET can hold members that are no
    longer on the board, or miss some that are (see `_in_sync`)."""
    return _ranked().count()


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

    # Banned accounts are hidden, as on every board.
    rows = list(
        User.objects.filter(banned_at__isnull=True, pk__in=ids)
        .order_by("-points")
        .values("pk", "public_id", "username", "points", "rank")
    )
    board = [{"id": r["public_id"], "username": r["username"], "rank": r["rank"], "points": r["points"]} for r in rows]
    my_rank = next((i + 1 for i, r in enumerate(rows) if r["pk"] == user.pk), len(board))
    return board, my_rank, len(board)


def weekly_board(user=None):
    """This week's board (Monday 00:00 Paris to now) as (rows, my_rank, count, my_points): each public
    account's summed GameSession.awarded. Postgres only — the window is small and resets weekly, so the
    ZSET's advantage doesn't apply. `my_rank` is None and `my_points` 0 for a guest or a player with
    nothing this week."""
    from django.db.models import Sum

    from trivia.awarding import week_start_utc
    from trivia.models import GameSession
    from trivia.wordle_daily import cet_today

    rows = list(
        GameSession.objects.filter(user__in=_ranked(), finished_at__gte=week_start_utc(cet_today()), awarded__gt=0)
        .values("user__public_id", "user__username", "user__rank")
        .annotate(points=Sum("awarded"))
        .order_by("-points", "user__public_id")
    )
    board = [{"id": r["user__public_id"], "username": r["user__username"], "rank": r["user__rank"], "points": r["points"]} for r in rows]
    my_rank = None
    mine = None
    if user is not None:
        mine = next((r["points"] for r in rows if r["user__public_id"] == user.public_id), None)
        if mine is not None:
            my_rank = sum(1 for r in rows if r["points"] > mine) + 1
    return board[:100], my_rank, len(board), mine or 0
