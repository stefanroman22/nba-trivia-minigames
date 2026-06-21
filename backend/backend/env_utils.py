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
