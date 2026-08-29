"""Tiny env-var parsing helpers used by settings.py (kept separate so they're unit-testable)."""
import os


def env_bool(name, default):
    """Parse a boolean env var. Truthy: 1/true/yes/on (case-insensitive). Missing -> default."""
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def env_list(name, default):
    """Parse a comma-separated env var into a trimmed list. Missing/empty -> list(default)."""
    raw = os.environ.get(name)
    if not raw:
        return list(default)
    return [item.strip() for item in raw.split(",") if item.strip()]


def env_list_merge(name, base):
    """Like env_list, but the env var ADDS to `base` instead of replacing it.

    Use where dropping a baseline entry would break the app rather than merely
    narrow it: setting CORS_ALLOWED_ORIGINS to a partial list once locked the
    deployed frontends out of the API. Order is preserved (base first) and
    duplicates are collapsed. `base` is never mutated.
    """
    merged = list(base)
    for item in env_list(name, []):
        if item not in merged:
            merged.append(item)
    return merged
