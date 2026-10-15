"""Per-game spec files (question factory §4.3): backend/trivia/questions/specs/<slug>.json.

load(slug) reads, validates and caches a spec; a bad file raises SpecError naming
the offending field. Fame bands are stored by name (STAR|KNOWN|DEEP|OBSCURE) and
mapped to trivia.questions.fame constants by the game modules. Dependency-free:
the backend has no YAML, and this module imports nothing from Django.
"""
import copy
import json
import os

SPEC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "specs")
FAME_BANDS = ("STAR", "KNOWN", "DEEP", "OBSCURE")
COVERAGE_AXES = ("decade", "team", "position")
LEVELS = ("easy", "medium", "hard")
_EPS = 1e-6

_cache = {}


class SpecError(ValueError):
    pass


def load(slug):
    """The validated spec for `slug` (a deep copy, so callers cannot change the cache)."""
    if slug not in _cache:
        path = os.path.join(SPEC_DIR, f"{slug}.json")
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
        except FileNotFoundError:
            raise SpecError(f"{slug}: no spec file at {path}") from None
        except json.JSONDecodeError as e:
            raise SpecError(f"{slug}: invalid JSON in {path}: {e}") from None
        validate(slug, data)
        _cache[slug] = data
    return copy.deepcopy(_cache[slug])


def reload():
    """Forget cached specs (tests, or after editing a file in a long-lived process)."""
    _cache.clear()


def _fail(slug, field, msg):
    raise SpecError(f"{slug}: {field} {msg}")


def _is_int(v):
    return type(v) is int


def _is_num(v):
    return type(v) in (int, float)


def _section(slug, data, name):
    v = data.get(name)
    if not isinstance(v, dict):
        _fail(slug, name, "must be an object")
    return v


def _get(slug, sec, name, field):
    if field not in sec:
        _fail(slug, f"{name}.{field}", "is required")
    return sec[field]


def _weights(slug, sec, field):
    w = _get(slug, sec, field.split(".")[0], "features")
    if not isinstance(w, dict) or not w:
        _fail(slug, field, "must be a non-empty object of feature weights")
    for k, v in w.items():
        if not _is_num(v) or not 0 <= v <= 1:
            _fail(slug, f"{field}.{k}", "must be a number in [0, 1]")
    if abs(sum(w.values()) - 1) > _EPS:
        _fail(slug, field, f"weights must sum to 1 (got {sum(w.values())})")


def validate(slug, data):
    if not isinstance(data, dict):
        _fail(slug, "spec", "must be a JSON object")
    if data.get("slug") != slug:
        _fail(slug, "slug", f"must equal the file name ({slug!r}), got {data.get('slug')!r}")
    if not _is_int(data.get("version")) or data["version"] < 1:
        _fail(slug, "version", "must be an integer >= 1")

    elig = _section(slug, data, "eligibility")
    for k, v in elig.items():
        if k.endswith("_band"):
            if v not in FAME_BANDS:
                _fail(slug, f"eligibility.{k}", f"must be one of {'|'.join(FAME_BANDS)}, got {v!r}")
        elif not _is_int(v) or v < 0:
            _fail(slug, f"eligibility.{k}", "must be a non-negative integer")
    for k, v in elig.items():
        hi = elig.get(f"max_{k[4:]}") if k.startswith("min_") and not k.endswith("_band") else None
        if hi is not None and v > hi:
            _fail(slug, f"eligibility.{k}", f"must not exceed eligibility.max_{k[4:]}")

    diff = _section(slug, data, "difficulty")
    _weights(slug, diff, "difficulty.features")
    bands = _get(slug, diff, "difficulty", "bands")
    if not isinstance(bands, dict) or set(bands) != set(LEVELS):
        _fail(slug, "difficulty.bands", f"must have exactly {', '.join(LEVELS)}")
    edges = []
    for level in LEVELS:
        b = bands[level]
        if not (isinstance(b, list) and len(b) == 2 and all(_is_num(x) for x in b) and b[0] < b[1]):
            _fail(slug, f"difficulty.bands.{level}", "must be [low, high] with low < high")
        edges.append(b)
    if edges[0][0] != 0 or edges[-1][1] != 1 or any(a[1] != b[0] for a, b in zip(edges, edges[1:])):
        _fail(slug, "difficulty.bands", "must tile [0, 1] without gaps or overlaps")
    mix = _get(slug, diff, "difficulty", "mix")
    if not isinstance(mix, dict) or set(mix) != set(LEVELS):
        _fail(slug, "difficulty.mix", f"must have exactly {', '.join(LEVELS)}")
    for level in LEVELS:
        if not _is_num(mix[level]) or not 0 <= mix[level] <= 1:
            _fail(slug, f"difficulty.mix.{level}", "must be a number in [0, 1]")
    if abs(sum(mix.values()) - 1) > _EPS:
        _fail(slug, "difficulty.mix", f"must sum to 1 (got {sum(mix.values())})")

    interest = _section(slug, data, "interest")
    _weights(slug, interest, "interest.features")
    m = _get(slug, interest, "interest", "min")
    if not _is_num(m) or not 0 <= m <= 1:
        _fail(slug, "interest.min", "must be a number in [0, 1]")

    cov = _section(slug, data, "coverage")
    axes = _get(slug, cov, "coverage", "axes")
    if not isinstance(axes, list) or not axes or any(a not in COVERAGE_AXES for a in axes) or len(set(axes)) != len(axes):
        _fail(slug, "coverage.axes", f"must be a non-empty list of distinct {'|'.join(COVERAGE_AXES)}")
    md = _get(slug, cov, "coverage", "min_decades")
    if not _is_int(md) or md < 0:
        _fail(slug, "coverage.min_decades", "must be a non-negative integer")

    refill = _section(slug, data, "refill")
    for field in ("runway_days", "max_new_per_run"):
        v = _get(slug, refill, "refill", field)
        if not _is_int(v) or v < 1:
            _fail(slug, f"refill.{field}", "must be a positive integer")
    minimum = _get(slug, refill, "refill", "minimum")
    if not _is_int(minimum) or minimum < 0:
        _fail(slug, "refill.minimum", "must be a non-negative integer")
    target = _get(slug, refill, "refill", "target")
    if target is not None and (not _is_int(target) or target < minimum):
        _fail(slug, "refill.target", "must be null or an integer >= refill.minimum")

    cons = _section(slug, data, "consistency")
    share = _get(slug, cons, "consistency", "max_player_share")
    if not _is_num(share) or not 0 < share <= 1:
        _fail(slug, "consistency.max_player_share", "must be a number in (0, 1]")
