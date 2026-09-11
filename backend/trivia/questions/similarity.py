# backend/trivia/questions/similarity.py
"""LeContexto similarity — the Python home of what src/Game Renderers/Contexto.tsx
computed client-side. Rankings are precomputed per question, so the renderer no
longer needs player profiles. Formula and tie-break are frozen (golden test).

The awards term is awardsSimilarity() (cosine scaled by the min/max norm
ratio), not plain cosine — see 146b653 "rank résumés by magnitude, not just
direction" in src/Game Renderers/Contexto.tsx. A one-time all-star and a
two-MVP secret point the same direction but aren't a 94% match; two empty
trophy cases are defined as a match (1.0), and one side with hardware and the
other with none is a total mismatch (0.0).
"""
import math

POS_FAMILY = {"G": ["G"], "F": ["F"], "C": ["C"], "G-F": ["G", "F"], "F-C": ["F", "C"]}


def _franchise_seasons(p, current_year):
    out = set()
    for t in p.get("teams") or []:
        end = t["end_year"] if t.get("end_year") is not None else current_year
        for y in range(t["start_year"], end + 1):
            out.add(f"{t['abbr']}:{y}")
    return out


def _jaccard(a, b):
    if not a and not b:
        return 0.0
    inter = len(a & b)
    union = len(a) + len(b) - inter
    return inter / union if union else 0.0


def _career_range(p, current_year):
    lo, hi = math.inf, -math.inf
    for t in p.get("teams") or []:
        lo = min(lo, t["start_year"])
        end = t["end_year"] if t.get("end_year") is not None else current_year
        hi = max(hi, end)
    if lo == math.inf:
        return (current_year, current_year)
    return (lo, hi)


def _era_overlap(a, b):
    inter = max(0, min(a[1], b[1]) - max(a[0], b[0]) + 1)
    union = (a[1] - a[0] + 1) + (b[1] - b[0] + 1) - inter
    return inter / union if union > 0 else 0.0


def _position_family(a, b):
    if a.get("position") == b.get("position"):
        return 1.0
    fb = POS_FAMILY.get(b.get("position"), [])
    return 0.5 if any(x in fb for x in POS_FAMILY.get(a.get("position"), [])) else 0.0


def _draft_proximity(a, b):
    ua, ub = a.get("draft") is None, b.get("draft") is None
    if ua and ub:
        return 1.0
    if ua or ub:
        return 0.0
    return max(0.0, 1 - abs(a["draft"]["pick"] - b["draft"]["pick"]) / 60)


def _awards_vec(p):
    a = p.get("awards") or {}
    return [len(a.get("mvp") or []), a.get("allstar_count") or 0, len(a.get("rings") or []), len(a.get("dpoy") or [])]


def _magnitude(v):
    return math.sqrt(sum(x * x for x in v))


def _cosine(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    na = _magnitude(a)
    nb = _magnitude(b)
    return dot / (na * nb) if na and nb else 0.0


def _awards_similarity(a, b):
    na = _magnitude(a)
    nb = _magnitude(b)
    if na == 0 and nb == 0:
        return 1.0
    if na == 0 or nb == 0:
        return 0.0
    return _cosine(a, b) * (min(na, nb) / max(na, nb))


def similarity(secret, p, current_year):
    return (
        35 * _jaccard(_franchise_seasons(secret, current_year), _franchise_seasons(p, current_year))
        + 20 * _era_overlap(_career_range(secret, current_year), _career_range(p, current_year))
        + 15 * _position_family(secret, p)
        + 10 * (1 if secret.get("country") == p.get("country") else 0)
        + 10 * _draft_proximity(secret, p)
        + 10 * _awards_similarity(_awards_vec(secret), _awards_vec(p))
    )


def rank_pool(secret, playable, current_year):
    """[(person_id, rank)] over the playable pool — desc score, ties by person_id."""
    scored = sorted(
        ((similarity(secret, p, current_year), p["person_id"]) for p in playable),
        key=lambda t: (-t[0], t[1]),
    )
    return [(pid, i + 1) for i, (_, pid) in enumerate(scored)]
