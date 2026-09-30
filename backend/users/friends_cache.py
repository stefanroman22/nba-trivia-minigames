"""Cache for the Friends overview (`friends_overview`), keyed per user.

Goes through `django.core.cache` (the three tiers `settings.py` already picks: Redis when
`REDIS_URL` is set, else DatabaseCache, else LocMemCache), so it is correct with zero Redis
configured. The raw client in `users/leaderboard.py` is only for ZSET primitives Django's cache
API lacks; cached *reads* belong here.

Keys live in their own versioned namespace (`users:friends-overview:v1:<pk>`), distinct from DRF's
`throttle_<scope>_<ident>` counters that share the default cache. Every cache call is wrapped so a
backend outage behaves as a miss / no-op: the view then falls back to the database instead of 500ing.
"""
import logging

from django.core.cache import cache

logger = logging.getLogger(__name__)

FRIENDS_OVERVIEW_TTL = 60  # seconds; bounds staleness of other users' username/points/rank in rows
KEY_VERSION = "v1"  # bump if the cached payload shape changes


def overview_key(user_pk):
    return f"users:friends-overview:{KEY_VERSION}:{user_pk}"


def get_overview(user_pk):
    """The cached overview payload for this user, or None (miss or cache failure)."""
    try:
        return cache.get(overview_key(user_pk))
    except Exception as exc:
        logger.warning("friends cache unavailable (%s): %s", "get", exc)
        return None


def set_overview(user_pk, payload):
    try:
        cache.set(overview_key(user_pk), payload, FRIENDS_OVERVIEW_TTL)
    except Exception as exc:
        logger.warning("friends cache unavailable (%s): %s", "set", exc)


def invalidate_friends(*users):
    """Drop the overview cache of every given user (CustomUser instances or int pks, mixed ok)."""
    keys = [overview_key(u if isinstance(u, int) else u.pk) for u in users]
    try:
        cache.delete_many(keys)
    except Exception as exc:
        logger.warning("friends cache unavailable (%s): %s", "delete", exc)
