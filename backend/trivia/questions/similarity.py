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

v2 (similarity_v2) is a separate formula whose features and weights live in
specs/contexto-similarity.json; v1 stays the default so scheduled days never move.
"""
import copy
import json
import math
import os

from trivia.questions import fame

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


SPEC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "specs")
V2_SPEC_PATH = os.path.join(SPEC_DIR, "contexto-similarity.json")
ANCHORS_PATH = os.path.join(SPEC_DIR, "contexto-anchors.json")
V2_FEATURES = ("franchise_seasons", "era", "position", "draft_class", "style", "fame", "country")
STYLE_KEYS = ("ppg", "rpg", "apg", "height_in")

_v2_cache = {}


franchise_seasons = _franchise_seasons  # public: the Contexto gate reads team-seasons too


def _fail(field, msg):
    raise ValueError(f"contexto-similarity: {field} {msg}")


def _positive(v):
    return type(v) in (int, float) and v > 0


def check_v2_spec(data):
    """Raise ValueError naming the first missing or bad field of a v2 similarity spec."""
    if not isinstance(data, dict):
        _fail("spec", "must be a JSON object")
    w = data.get("weights")
    if not isinstance(w, dict) or set(w) != set(V2_FEATURES) or any(
            type(v) not in (int, float) or v < 0 for v in w.values()):
        _fail("weights", f"must be non-negative numbers for {', '.join(V2_FEATURES)}")
    if abs(sum(w.values()) - 100) > 1e-6:
        _fail("weights", f"must sum to 100 (got {sum(w.values())})")
    for section, field in (("draft_class", "span_years"), ("fame", "span")):
        sec = data.get(section)
        if not _positive(sec.get(field) if isinstance(sec, dict) else None):
            _fail(f"{section}.{field}", "must be a positive number")
    style = data.get("style")
    hi = style.get("max") if isinstance(style, dict) else None
    if not isinstance(hi, dict):
        _fail("style.max", "must be an object")
    for k in STYLE_KEYS:
        if not _positive(hi.get(k)):
            _fail(f"style.max.{k}", "must be a positive number")
    regions = data.get("regions")
    if not isinstance(regions, dict) or not regions or any(
            not isinstance(c, list) or not all(isinstance(x, str) for x in c) for c in regions.values()):
        _fail("regions", "must be a non-empty object of country lists")
    if not isinstance(data.get("country_aliases", {}), dict):
        _fail("country_aliases", "must be an object")
    gate = data.get("gate")
    if not isinstance(gate, dict):
        _fail("gate", "must be an object")
    for k in ("team_season_top", "famous_top"):
        if type(gate.get(k)) is not int or gate[k] < 1:
            _fail(f"gate.{k}", "must be a positive integer")
    if type(gate.get("min_count")) is not int or gate["min_count"] < 0:
        _fail("gate.min_count", "must be a non-negative integer")
    if gate.get("min_band") not in ("STAR", "KNOWN", "DEEP", "OBSCURE"):
        _fail("gate.min_band", "must be one of STAR|KNOWN|DEEP|OBSCURE")


def load_v2_spec():
    """specs/contexto-similarity.json, read and checked once (a deep copy, like specs.load)."""
    if "spec" not in _v2_cache:
        with open(V2_SPEC_PATH, encoding="utf-8") as f:
            data = json.load(f)
        check_v2_spec(data)
        _v2_cache["spec"] = data
    return copy.deepcopy(_v2_cache["spec"])


def _draft_class(p, current_year):
    d = p.get("draft")
    if d and d.get("year") is not None:
        return d["year"]
    return _career_range(p, current_year)[0]  # undrafted: his first season


def _style_vec(p, spec):
    c = p.get("career") or {}
    hi = spec["style"]["max"]
    raw = {**{k: c.get(k) for k in STYLE_KEYS[:3]}, "height_in": p.get("height_in")}
    return [(raw[k] or 0) / hi[k] for k in STYLE_KEYS]


def _style_similarity(a, b):
    na, nb = _magnitude(a), _magnitude(b)
    if na == 0 and nb == 0:
        return 1.0
    return _cosine(a, b)


def _country(p, spec):
    c = p.get("country")
    return spec.get("country_aliases", {}).get(c, c)


def _region_of(spec):
    return {c: region for region, countries in spec["regions"].items() for c in countries}


def _v2_features(p, current_year, spec, regions):
    country = _country(p, spec)
    return {
        "seasons": _franchise_seasons(p, current_year),
        "range": _career_range(p, current_year),
        "draft_class": _draft_class(p, current_year),
        "style": _style_vec(p, spec),
        "fame": fame.fame_score(p),
        "country": country,
        "region": regions.get(country),
        "row": p,
    }


def _v2_score(a, b, spec):
    w = spec["weights"]
    if not a["country"] or not b["country"]:  # unknown
        country = 0.0
    elif a["country"] == b["country"]:
        country = 1.0
    else:
        country = 0.5 if a["region"] is not None and a["region"] == b["region"] else 0.0
    return (
        w["franchise_seasons"] * _jaccard(a["seasons"], b["seasons"])
        + w["era"] * _era_overlap(a["range"], b["range"])
        + w["position"] * _position_family(a["row"], b["row"])
        + w["draft_class"] * max(0.0, 1 - abs(a["draft_class"] - b["draft_class"]) / spec["draft_class"]["span_years"])
        + w["style"] * _style_similarity(a["style"], b["style"])
        + w["fame"] * min(1.0, max(0.0, 1 - abs(a["fame"] - b["fame"]) / spec["fame"]["span"]))
        + w["country"] * country
    )


def similarity_v2(secret, p, current_year, spec):
    """v2 (question factory spec §4.10): the features and weights of specs/contexto-similarity.json."""
    regions = _region_of(spec)
    return _v2_score(_v2_features(secret, current_year, spec, regions), _v2_features(p, current_year, spec, regions),
                     spec)


def rank_pool(secret, playable, current_year, version=1):
    """[(person_id, rank)] over the playable pool — desc score, ties by person_id.
    version 1 is the frozen formula above; 2 is similarity_v2 with the shipped spec."""
    if version == 1:
        scores = (similarity(secret, p, current_year) for p in playable)
    elif version == 2:
        spec = load_v2_spec()
        regions = _region_of(spec)
        s = _v2_features(secret, current_year, spec, regions)
        scores = (_v2_score(s, _v2_features(p, current_year, spec, regions), spec) for p in playable)
    else:
        raise ValueError(f"unknown similarity version {version!r}")
    scored = sorted(
        zip(scores, (p["person_id"] for p in playable)),
        key=lambda t: (-t[0], t[1]),
    )
    return [(pid, i + 1) for i, (_, pid) in enumerate(scored)]
