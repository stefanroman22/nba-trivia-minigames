"""Assemble players_curated.json rows from raw nba_api payloads.

This module replaces the hand-typed ROSTER that used to live in
trivia/data_static/author_curated.py: every field now comes from the API
(drafthistory + franchisehistory in bulk, commonplayerinfo + playercareerstats
+ playerawards per player), so the dataset can cover every player in the league
index rather than a famous-enough subset.

Everything here is pure except ProfileCache/fetch_missing, which read and write
the git-ignored raw-response cache. Splitting it that way means a re-run never
re-fetches a player it already has, and re-shaping a row costs no network at all.

Row schema is FROZEN (contract #1) — see trivia/games/who_are_ya.py's
_REQUIRED_KEYS and career_path.validate_rows. Do not add/rename/remove fields.
"""
import json
import os
import unicodedata
from datetime import datetime, timezone

# Bump when a cached payload's shape changes so stale entries are re-fetched.
CACHE_VERSION = 1

# New rows get the least-famous tier already in use; the games bias toward the
# famous players via fame_tier, but tier no longer gates existence.
DEFAULT_FAME_TIER = 4

# Work-order decision: Iguodala is a tier-2 name, not tier 3.
FAME_TIER_OVERRIDES = {2738: 2}  # Andre Iguodala

# The only five position values the frozen schema allows (who_are_ya._POSITIONS).
POSITIONS = {
    "guard": "G",
    "forward": "F",
    "center": "C",
    "guard-forward": "G-F",
    "forward-guard": "G-F",
    "forward-center": "F-C",
    "center-forward": "F-C",
}

# commonplayerinfo's SCHOOL is "last affiliation", so it can be a high school
# (LeBron: "St. Vincent-St. Mary HS (OH)") or a European club ("Real Madrid").
# Only real colleges belong in `college`; everything else is a legitimate null.
_NON_COLLEGE_MARKERS = (" hs ", " hs(", " hs (", "high school", " h.s.")

_AWARD_YEARS = {
    "NBA Most Valuable Player": "mvp",
    "NBA Finals Most Valuable Player": "fmvp",
    "NBA Defensive Player of the Year": "dpoy",
    "NBA Sixth Man of the Year": "smoy",
    "NBA Champion": "rings",
}
_AWARD_COUNTS = {"NBA All-Star": "allstar_count", "All-NBA": "allnba_count"}
_ROOKIE_OF_THE_YEAR = "NBA Rookie of the Year"


def _int(value, default=None):
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def ascii_fold(name):
    """'Luka Dončić' -> 'Luka Doncic' (accent-free alias for name matching)."""
    return "".join(
        c for c in unicodedata.normalize("NFKD", name) if not unicodedata.combining(c)
    )


# ---------------------------------------------------------------------------
#  Bulk lookups
# ---------------------------------------------------------------------------
def era_name_index(franchise_rows):
    """{team_id: [(start_year, end_year, name), ...]} from fetch_franchise_history."""
    index = {}
    for r in franchise_rows:
        index.setdefault(r["team_id"], []).append(
            (r["start_year"], r["end_year"], r["name"])
        )
    return index


def era_name(index, team_id, season_start_year, fallback):
    """The franchise's name AS OF that season (narrowest matching era wins).

    Narrowest-wins is what makes 2004-2013 the Charlotte Bobcats even though the
    endpoint also reports a Charlotte Hornets 1988-2025 span, and what drops the
    whole-franchise summary rows the endpoint emits alongside the real eras.
    """
    matches = [
        (end - start, name)
        for start, end, name in index.get(team_id, [])
        if start <= season_start_year <= end
    ]
    if not matches:
        return fallback
    return min(matches, key=lambda m: m[0])[1]


def draft_index(draft_rows):
    """{person_id: [draft row, ...]} oldest first.

    A list, not a single row: the old re-entry drafts put 136 players in two
    draft classes, and which pick started a career depends on when he debuted
    (see pick_draft).
    """
    index = {}
    for r in draft_rows:
        index.setdefault(r["person_id"], []).append(r)
    for picks in index.values():
        picks.sort(key=lambda r: r["year"])
    return index


def pick_draft(person_id, drafts, first_season=None):
    """The pick that started this player's career, or None if he has none.

    For the twice-drafted, the later pick is the one that got him into the
    league — unless it postdates his debut, in which case it was a re-entry
    draft he was already playing through and the first pick is the real one.
    """
    picks = drafts.get(person_id) or []
    if not picks:
        return None
    if first_season is not None:
        eligible = [p for p in picks if p["year"] <= first_season]
        if eligible:
            return eligible[-1]
    return picks[-1] if first_season is None else picks[0]


def modern_abbr_index():
    """{team_id: current abbreviation} — stint `abbr` is what the games match on."""
    from nba_api.stats.static import teams as static_teams

    return {t["id"]: t["abbreviation"] for t in static_teams.get_teams()}


# ---------------------------------------------------------------------------
#  Field builders
# ---------------------------------------------------------------------------
def build_draft(pick):
    """{year, round, pick, team_abbr} for a chosen draft pick, or None.

    None is a legitimate value (undrafted, or a pre-lottery-era player the
    endpoint has no pick for) — assemble_rows reports players whose
    commonplayerinfo claims a draft year the draft history does not have, so a
    data gap can never hide inside a null.
    """
    if not pick or not pick["team_abbr"]:
        return None
    return {
        "year": pick["year"],
        "round": pick["round"],
        "pick": pick["pick"],
        "team_abbr": pick["team_abbr"],
    }


def build_college(school, draft_row):
    """A real college, or None for high-school and club affiliations."""
    school = (school or "").strip()
    if not school or school.lower() == "none":
        return None
    padded = f" {school.lower()} "
    if any(marker in padded for marker in _NON_COLLEGE_MARKERS):
        return None
    if draft_row and draft_row["organization_type"] and (
        draft_row["organization_type"] != "College/University"
    ):
        return None
    return school


def build_position(raw):
    """'Forward-Guard' -> 'G-F' (the five values the frozen schema allows)."""
    return POSITIONS.get((raw or "").strip().lower())


def build_height_in(raw):
    """'6-9' -> 81 inches."""
    parts = (raw or "").split("-")
    if len(parts) != 2:
        return None
    feet, inches = _int(parts[0]), _int(parts[1])
    if feet is None or inches is None:
        return None
    return feet * 12 + inches


def build_birth_year(raw):
    """'1984-12-30T00:00:00' -> 1984."""
    return _int((raw or "")[:4])


def build_stints(season_rows, eras, abbrs, is_active):
    """Team stints, oldest first, from playercareerstats' per-season rows.

    Consecutive seasons with the same franchise merge into one stint, but a
    franchise RENAME splits it, so Kevin Durant reads "Seattle SuperSonics"
    through 2007-08 and "Oklahoma City Thunder" after. `abbr` stays the modern
    abbreviation (the games match criteria on it); `name` is the era name.
    start_year is the first season's start year and end_year the last season's
    END year (2003-04..2009-10 -> 2003..2010); the last stint of an active
    player is open-ended (null), which career_path.validate_rows requires.
    """
    seasons = []
    for r in season_rows:
        if (r.get("LEAGUE_ID") or "00") != "00":
            continue
        team_id = _int(r.get("TEAM_ID"), 0)
        abbr = (r.get("TEAM_ABBREVIATION") or "").strip()
        year = _int(str(r.get("SEASON_ID") or "")[:4])
        # TEAM_ID 0 / "TOT" is the multi-team season SUMMARY row: counting it
        # would double every traded season's games.
        if not team_id or abbr == "TOT" or year is None:
            continue
        seasons.append(
            {
                "year": year,
                "team_id": team_id,
                "abbr": abbr,
                "gp": _int(r.get("GP"), 0),
                "pts": _int(r.get("PTS"), 0),
            }
        )
    seasons.sort(key=lambda s: s["year"])  # stable: keeps within-season trade order

    stints = []
    for s in seasons:
        name = era_name(eras, s["team_id"], s["year"], fallback=s["abbr"])
        last = stints[-1] if stints else None
        if (
            last
            and last["team_id"] == s["team_id"]
            and last["name"] == name
            and s["year"] <= last["last_year"] + 1
        ):
            last["last_year"] = max(last["last_year"], s["year"])
            last["gp"] += s["gp"]
            last["pts"] += s["pts"]
            continue
        stints.append(
            {
                "team_id": s["team_id"],
                "abbr": abbrs.get(s["team_id"], s["abbr"]),
                "name": name,
                "start_year": s["year"],
                "last_year": s["year"],
                "gp": s["gp"],
                "pts": s["pts"],
            }
        )

    out = []
    for i, s in enumerate(stints):
        ongoing = is_active and i == len(stints) - 1
        out.append(
            {
                "abbr": s["abbr"],
                "name": s["name"],
                "start_year": s["start_year"],
                "end_year": None if ongoing else s["last_year"] + 1,
                "gp": s["gp"],
                "ppg": round(s["pts"] / s["gp"], 1) if s["gp"] else 0.0,
            }
        )
    return out


def _award_year(season):
    """'2012-13' -> 2013 (the year the season ended); '1959' -> 1959."""
    start = _int(str(season or "")[:4])
    if start is None:
        return None
    return start + 1 if "-" in str(season) else start


def build_awards(award_rows):
    """Aggregate playerawards rows into the frozen award counts. All-zero is fine."""
    awards = {
        "mvp": [], "fmvp": [], "dpoy": [], "roty": None, "smoy": [],
        "allstar_count": 0, "allnba_count": 0, "rings": [],
    }
    for r in award_rows:
        description = (r.get("DESCRIPTION") or "").strip()
        if description in _AWARD_COUNTS:
            awards[_AWARD_COUNTS[description]] += 1
            continue
        year = _award_year(r.get("SEASON"))
        if year is None:
            continue
        if description == _ROOKIE_OF_THE_YEAR:
            awards["roty"] = year if awards["roty"] is None else min(awards["roty"], year)
        elif description in _AWARD_YEARS:
            awards[_AWARD_YEARS[description]].append(year)
    for key in ("mvp", "fmvp", "dpoy", "smoy", "rings"):
        awards[key] = sorted(set(awards[key]))
    return awards


def build_career(career_totals, season_rows):
    """Exact career regular-season totals + the per-game averages they imply."""
    totals = career_totals[0] if career_totals else {}
    gp = _int(totals.get("GP"), 0)
    pts = _int(totals.get("PTS"), 0)
    reb = _int(totals.get("REB"), 0)  # None for the pre-1950-51 seasons
    ast = _int(totals.get("AST"), 0)
    seasons = {
        str(r.get("SEASON_ID"))
        for r in season_rows
        if (r.get("LEAGUE_ID") or "00") == "00" and r.get("SEASON_ID")
    }
    per_game = (lambda total: round(total / gp, 1)) if gp else (lambda total: 0.0)
    return {
        "pts": pts, "reb": reb, "ast": ast,
        "ppg": per_game(pts), "rpg": per_game(reb), "apg": per_game(ast),
        "seasons": len(seasons),
    }


# ---------------------------------------------------------------------------
#  Rows
# ---------------------------------------------------------------------------
def carry_over_index(existing_rows):
    """{person_id: {fame_tier, aliases}} from the dataset being replaced.

    fame_tier is editorial (hand-assigned) and the hand-written aliases carry
    nicknames/birth names no endpoint exposes, so both survive the rebuild.
    """
    carry = {}
    for row in existing_rows:
        pid = row.get("person_id")
        if pid is None:
            continue
        carry[pid] = {
            "fame_tier": FAME_TIER_OVERRIDES.get(pid, row.get("fame_tier", DEFAULT_FAME_TIER)),
            "aliases": list(row.get("aliases") or []),
        }
    return carry


def build_row(profile, drafts, eras, abbrs, carry):
    """One frozen-schema curated row from one cached raw profile."""
    info = (profile.get("info") or [{}])[0]
    person_id = _int(info.get("PERSON_ID"))
    full_name = (info.get("DISPLAY_FIRST_LAST") or "").strip()
    inherited = carry.get(person_id, {})

    aliases = list(inherited.get("aliases") or [])
    folded = ascii_fold(full_name)
    if folded != full_name and folded not in aliases:
        aliases.append(folded)

    status = info.get("ROSTERSTATUS")
    is_active = str(status).strip().lower() in ("active", "1")
    stints = build_stints(profile.get("career") or [], eras, abbrs, is_active)
    pick = pick_draft(person_id, drafts, stints[0]["start_year"] if stints else None)

    return {
        "person_id": person_id,
        "full_name": full_name,
        "aliases": aliases,
        "fame_tier": inherited.get("fame_tier", DEFAULT_FAME_TIER),
        "position": build_position(info.get("POSITION")),
        "height_in": build_height_in(info.get("HEIGHT")),
        "weight_lb": _int(info.get("WEIGHT")),
        "birth_year": build_birth_year(info.get("BIRTHDATE")),
        "country": (info.get("COUNTRY") or "").strip() or None,
        "college": build_college(info.get("SCHOOL"), pick),
        "draft": build_draft(pick),
        "jersey": _int(info.get("JERSEY")),
        "is_active": is_active,
        "teams": stints,
        "awards": build_awards(profile.get("awards") or []),
        "career": build_career(profile.get("career_totals") or [], profile.get("career") or []),
    }


# ---------------------------------------------------------------------------
#  Dataset checks
#
#  Pure and dependency-free on purpose: curated_validate.py (standalone script)
#  and players_index.validate_rows (publish-time pool gate) both use them.
# ---------------------------------------------------------------------------
# Generous ceilings on CAREER averages — Wilt Chamberlain holds the real ones
# (30.1 ppg, 22.9 rpg) and Magic Johnson the assist one (11.2 apg).
MAX_CAREER_PPG, MAX_CAREER_RPG, MAX_CAREER_APG = 55.0, 30.0, 20.0
MAX_SEASONS = 30  # Vince Carter's 22 is the record
AVERAGE_TOLERANCE = 1.0  # per-game averages must agree with totals/games this closely


def stint_seasons(stint, open_end):
    """The season start-years a stint covers: [2003, 2010] -> {2003..2009}."""
    start = stint.get("start_year")
    if not isinstance(start, int):
        return set()
    end = stint.get("end_year")
    if not isinstance(end, int):
        end = open_end
    return set(range(start, max(end, start + 1)))


def check_cross_stints(rows, open_end=None):
    """Stints must run in order and must not claim the same seasons twice.

    Until now each stint was only checked in isolation (start <= end), so a row
    could list its teams out of order, or list two stints covering the same span,
    and nothing noticed. ONE shared season between two different franchises is
    legitimate — that is a midseason trade — but two is not, and a franchise can
    never share a season with itself.
    """
    if open_end is None:
        open_end = datetime.now(timezone.utc).year + 1
    problems = []
    for row in rows:
        name = row.get("full_name")
        stints = row.get("teams") or []
        for a, b in zip(stints, stints[1:]):
            if not isinstance(a.get("start_year"), int) or not isinstance(b.get("start_year"), int):
                continue
            if b["start_year"] < a["start_year"]:
                problems.append(
                    f"{name}: stints out of order — {b['abbr']} {b['start_year']} "
                    f"listed after {a['abbr']} {a['start_year']}"
                )
        covered = [(s, stint_seasons(s, open_end)) for s in stints]
        for i, (a, a_seasons) in enumerate(covered):
            for b, b_seasons in covered[i + 1:]:
                shared = a_seasons & b_seasons
                if not shared:
                    continue
                if len(shared) > 1 or a.get("abbr") == b.get("abbr"):
                    problems.append(
                        f"{name}: stints {a['abbr']} {a['start_year']}-{a['end_year']} and "
                        f"{b['abbr']} {b['start_year']}-{b['end_year']} both claim "
                        f"season(s) {sorted(shared)}"
                    )
    return problems


def check_plausibility(rows):
    """Career totals have to be possible for the games the stints add up to.

    Catches bad API data (a totals row that belongs to someone else, a stint
    whose games went missing) rather than re-deriving the stats: the averages
    the row publishes must agree with its own totals and games played.
    """
    problems = []
    for row in rows:
        name = row.get("full_name")
        career = row.get("career") or {}
        games = sum((s.get("gp") or 0) for s in (row.get("teams") or []))
        totals = {k: career.get(k) or 0 for k in ("pts", "reb", "ast")}
        seasons = career.get("seasons") or 0
        if games <= 0:
            # A drafted player who never debuted is a legitimate empty row, but
            # totals without games played never are.
            if any(totals.values()) or seasons:
                problems.append(
                    f"{name}: career totals {totals} / {seasons} season(s) but 0 games played"
                )
            continue
        for total_key, average_key, ceiling in (
            ("pts", "ppg", MAX_CAREER_PPG),
            ("reb", "rpg", MAX_CAREER_RPG),
            ("ast", "apg", MAX_CAREER_APG),
        ):
            average = career.get(average_key)
            if not isinstance(average, (int, float)):
                problems.append(f"{name}: missing career {average_key}")
                continue
            if average > ceiling:
                problems.append(f"{name}: career {average_key} {average} exceeds {ceiling}")
            implied = totals[total_key] / games
            if abs(implied - average) > AVERAGE_TOLERANCE:
                problems.append(
                    f"{name}: career {average_key} {average} but {totals[total_key]} "
                    f"{total_key} over {games} games is {implied:.1f}"
                )
        if not 1 <= seasons <= MAX_SEASONS:
            problems.append(f"{name}: implausible career seasons {seasons}")
    return problems


def check_parity(rows, all_player_names):
    """1:1 parity with all-players.json — every real player has a row.

    Names are compared accent-folded so the diacritics rewrite ('Jonas
    Valanciunas' -> 'Jonas Valančiūnas') is not mistaken for a missing player.
    """
    problems = []
    known = set()
    for row in rows:
        for name in [row.get("full_name")] + list(row.get("aliases") or []):
            if name:
                known.add(ascii_fold(name).casefold())
    missing = [n for n in all_player_names if ascii_fold(n).casefold() not in known]
    if len(rows) != len(all_player_names):
        problems.append(
            f"row count {len(rows)} != all-players.json {len(all_player_names)}"
        )
    for name in missing[:20]:
        problems.append(f"no curated row for {name!r}")
    if len(missing) > 20:
        problems.append(f"...and {len(missing) - 20} more players with no curated row")
    return problems


# ---------------------------------------------------------------------------
#  Raw-response cache  (git-ignored; makes the whole run resumable)
# ---------------------------------------------------------------------------
class ProfileCache:
    """One JSON file per player under <root>/players, plus the bulk payloads."""

    def __init__(self, root):
        self.root = root
        self.players_dir = os.path.join(root, "players")
        os.makedirs(self.players_dir, exist_ok=True)

    def _player_path(self, person_id):
        return os.path.join(self.players_dir, f"{person_id}.json")

    def _read(self, path):
        if not os.path.exists(path):
            return None
        try:
            with open(path, "r", encoding="utf-8") as f:
                entry = json.load(f)
        except (OSError, ValueError):
            return None
        if entry.get("cache_version") != CACHE_VERSION:
            return None
        return entry.get("payload")

    def _write(self, path, payload):
        entry = {
            "cache_version": CACHE_VERSION,
            "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "payload": payload,
        }
        with open(path, "w", encoding="utf-8") as f:
            json.dump(entry, f, ensure_ascii=False)

    def get(self, person_id):
        return self._read(self._player_path(person_id))

    def put(self, person_id, payload):
        self._write(self._player_path(person_id), payload)

    def bulk(self, name, fetch):
        """Cached bulk payload (draft/franchise/roster); fetched once, then reused."""
        path = os.path.join(self.root, f"{name}.json")
        cached = self._read(path)
        if cached is not None:
            return cached
        payload = fetch()
        self._write(path, payload)
        return payload

    def write_failures(self, failures):
        path = os.path.join(self.root, "failures.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(failures, f, ensure_ascii=False, indent=1)
        return path


def fetch_missing(person_ids, cache, fetch_profile, on_progress=None):
    """Cache a raw profile for every id not already cached (idempotent resume).

    Returns (fetched, skipped, failures). A player whose fetch keeps failing is
    recorded in `failures` and simply has no row — the run never dies on one bad
    player, and never invents a null-filled row for one either.
    """
    fetched = skipped = 0
    failures = {}
    for i, person_id in enumerate(person_ids, start=1):
        if cache.get(person_id) is not None:
            skipped += 1
        else:
            try:
                cache.put(person_id, fetch_profile(person_id))
                fetched += 1
            except Exception as e:  # noqa: BLE001 - network/parse: report and continue
                failures[person_id] = f"{type(e).__name__}: {e}"[:200]
        if on_progress:
            on_progress(i, len(person_ids), fetched, skipped, len(failures))
    return fetched, skipped, failures


def assemble_rows(person_ids, cache, drafts, eras, abbrs, carry):
    """Build a row for every cached profile.

    Returns (rows, uncached, draft_gaps). `uncached` are the players with no
    usable cached profile — they get NO row rather than a null-filled one.
    `draft_gaps` are players whose profile claims a draft year that the draft
    history has no pick for, so a hole in the source data can never be mistaken
    for the legitimate `draft: null` of an undrafted player.
    """
    rows = []
    uncached = []
    draft_gaps = []
    for person_id in person_ids:
        profile = cache.get(person_id)
        if profile is None:
            uncached.append(person_id)
            continue
        row = build_row(profile, drafts, eras, abbrs, carry)
        if row["person_id"] is None:
            uncached.append(person_id)
            continue
        if row["draft"] is None:
            info = (profile.get("info") or [{}])[0]
            if _int(info.get("DRAFT_YEAR")) is not None:
                draft_gaps.append(row["person_id"])
        rows.append(row)
    return rows, uncached, draft_gaps
