"""Fame score: how recognizable a player is, computed from his curated row.

The gate the question games use to pick players a fan can actually name
(docs/superpowers/specs/2026-10-12-question-factory-design.md §4.2). The row
schema is frozen, so the score is computed here and never stored. The
hand-set fame_tier stays as an editorial floor: it can raise a player's band
(a young star with no honours yet), never lower it.
"""

VERSION = 1

STAR, KNOWN, DEEP, OBSCURE = 1, 2, 3, 4  # lower is more famous, like fame_tier
THRESHOLDS = ((STAR, 40.0), (KNOWN, 18.0), (DEEP, 10.0))
_TIER_FLOOR = {1: STAR, 2: KNOWN, 3: DEEP}


def fame_score(row):
    a = row.get("awards") or {}
    c = row.get("career") or {}
    score = (
        4 * min(a.get("allstar_count") or 0, 15)
        + 3 * min(a.get("allnba_count") or 0, 15)
        + 10 * len(a.get("mvp") or [])
        + 6 * len(a.get("fmvp") or [])
        + 3 * len(a.get("dpoy") or [])
        + (3 if a.get("roty") else 0)
        + 2 * len(a.get("smoy") or [])
        + min(len(a.get("rings") or []), 5)
        + min((c.get("pts") or 0) / 1000, 25)
        + 0.5 * min(c.get("seasons") or 0, 20)
    )
    return round(score, 1)


def fame_band(row):
    score = fame_score(row)
    band = next((b for b, t in THRESHOLDS if score >= t), OBSCURE)
    return min(band, _TIER_FLOOR.get(row.get("fame_tier"), OBSCURE))


def at_least(row, band):
    return fame_band(row) <= band
