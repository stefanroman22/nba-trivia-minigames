"""Standalone seed validator for NBA Connections.

Run from backend/:  python -m trivia.games.connections_validate
Exits non-zero if any board is malformed or has an ambiguous solution.

Structural checks (always run):
  1. exactly 16 tiles, all unique;
  2. exactly 4 groups, each with exactly 4 members;
  3. tiles set === union of all group members (a clean 4x4 partition);
  4. difficulties are exactly {1,2,3,4} (one each).
Cross-group trap check (only where a group's criterion is derivable from
players_curated.json): no tile assigned to a DIFFERENT group may also validly
satisfy this group's criterion. When curated data is missing or a trait is not
derivable, that specific check is SKIPPED (structural checks still run).
Own-label check (same data, opposite direction): each of a group's OWN 4
members must actually satisfy the group's label — draft year, jersey, "Born in
<country>", "No. 1 overall pick" (with an optional decade), position words
("bigs"/"centers"/"forwards"/"guards") and college names the curated dataset
knows. Labels it cannot read (teammate/nickname/award groups) and players
missing from players_curated.json are SKIPPED.
Duplicate-group check: no board may reuse another board's four members as a
group, whatever the two are labelled or how they are tiered.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(__file__)
SEED = os.path.join(HERE, "..", "data_static", "connections_seed.json")
CURATED = os.path.join(HERE, "..", "data_static", "players_curated.json")

# backend/ on the path so the shared pool rule imports whether this runs as a
# module or as a plain script.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(HERE))))

from trivia.data_pipeline.curated_players import playable_rows  # noqa: E402


def _load(path):
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _index_curated(curated):
    """name (lowercased) -> playable pool row, or {} if the file is absent.

    Rows with no team stints are dataset-only (parity with the league index);
    a tile can never be one of them, so they are not indexed.

    32 pool names belong to more than one player, so a plain dict would let
    whoever came last win: Patrick Ewing Jr. (1 season, tier 4) shadowed Patrick
    Ewing, which made a "1990s dominant centers" group look wrong. A tile means
    the player the board is about, so the more famous row wins — lower
    fame_tier first, then the longer career.
    """
    if not curated:
        return {}
    index = {}
    for row in playable_rows(curated):
        key = row["full_name"].lower()
        held = index.get(key)
        if held is None or _prominence(row) > _prominence(held):
            index[key] = row
    return index


def _prominence(row):
    return (-(row.get("fame_tier") or 4), (row.get("career") or {}).get("seasons") or 0)


def _derive(label):
    """(kind, value) the label asserts, or (None, None) if not derivable."""
    low = label.lower()
    m = re.search(r"\b(19|20)\d{2}\b", label)
    if m and "draft" in low:
        return ("draft_year", int(m.group(0)))
    m = re.search(r"#\s*(\d+)", label)
    if m:
        return ("jersey", int(m.group(1)))
    m = re.match(r"born in (.+)", label.strip(), re.IGNORECASE)
    if m:
        return ("country", m.group(1).strip().lower())
    m = re.match(r"(.+?) national team", label.strip(), re.IGNORECASE)
    if m:
        return ("country", m.group(1).strip().lower())
    # Otherwise treat the label as a possible college phrase (matched loosely
    # against curated colleges); teammate/nickname labels simply won't match.
    return ("college", label.strip().lower())


MIN_COLLEGE_PLAYERS = 3  # below this a "college" is one player's oddity, not a group


def _colleges(curated_index):
    """Colleges the pool has >= MIN_COLLEGE_PLAYERS for, lowercased, longest first.

    The 159-row dataset knew 60-odd well-known US colleges. The full one knows
    552, including Brooklyn (2 players), Beijing (1) and Germany (1) — words
    that appear in labels about a franchise, an Olympics and a national team.
    A college nobody else went to cannot be what a four-player group is about,
    so it is not offered as a reading of a label.
    """
    counts = {}
    for row in curated_index.values():
        name = (row.get("college") or "").lower()
        if name:
            counts[name] = counts.get(name, 0) + 1
    return sorted(
        (n for n, c in counts.items() if c >= MIN_COLLEGE_PLAYERS), key=len, reverse=True
    )


def _own_derive(label, colleges):
    """(kind, value) the group's OWN members must satisfy, or (None, None).

    Deliberately narrower than _derive(): the cross-group check only needs a
    *possible* reading of a label (a wrong guess there simply never matches),
    while asserting a label against its own members needs a reading that is
    certainly what the label claims. So: draft year and jersey as written,
    "Born in <country>" but not "<country> national team" (Ibaka played for
    Spain, he was born in the Congo), position words, and a college phrase only
    when it names a college the curated dataset itself knows.
    """
    low = label.lower()
    kind, value = _derive(label)
    if kind in ("draft_year", "jersey"):
        return (kind, value)
    if kind == "country" and re.match(r"born in ", label.strip(), re.IGNORECASE):
        return (kind, value)
    if re.search(r"no\.?\s*1 overall pick", low):
        if low.startswith("never"):
            return ("not_top_pick", True)
        decade = re.search(r"\b(19|20)(\d)0s\b", low)
        return ("top_pick", int(decade.group(0)[:-1]) if decade else True)
    for term, positions in (("bigs", "FC"), ("center", "C"), ("forward", "F"), ("guard", "G")):
        if term in low:
            return ("position", positions)
    named = [c for c in colleges if re.search(rf"\b{re.escape(c)}\b", low)]
    # A college phrase NAMES the college first — "Duke Blue Devils", "Kentucky
    # one-and-dones", "Syracuse / Memphis stars". A label that merely contains a
    # college word further in is about something else ("1997-98 Utah Jazz",
    # "2008 Beijing Olympics", "Brooklyn Nets super-team"), and a bare substring
    # is not even a word ("Iona" inside "International 2010s starters").
    if named and any(low.startswith(c) for c in named):
        # "Syracuse / Memphis stars" asserts either college, not both.
        return ("colleges", named)
    return (None, None)


def _satisfies(row, kind, value):
    """Does curated player row satisfy (kind, value)? None = can't tell."""
    if row is None:
        return None
    if kind == "draft_year":
        return bool(row.get("draft")) and row["draft"].get("year") == value
    if kind == "jersey":
        # The row holds ONE number — the profile's current/last one — while a
        # career often runs through several (Julius Erving: 32 with the Nets, 6
        # in Philadelphia). A match therefore proves he wore it; a mismatch
        # proves nothing, so it is "can't tell", not "no".
        return True if row.get("jersey") == value else None
    if kind == "country":
        return (row.get("country") or "").lower() == value
    if kind == "college":
        col = (row.get("college") or "").lower()
        if not col:
            return None
        return col in value or value in col or col.split()[0] in value
    if kind == "colleges":
        col = (row.get("college") or "").lower()
        if not col:
            return None
        return any(c in col or col in c for c in value)
    if kind == "position":
        pos = (row.get("position") or "").split("-")
        if not any(pos):
            return None
        return any(p in pos for p in value)
    if kind in ("top_pick", "not_top_pick"):
        draft = row.get("draft") or {}
        if not draft.get("pick"):
            return None  # undrafted, or curated has no pick for them
        first = draft["pick"] == 1
        if kind == "not_top_pick":
            return not first
        if value is True:
            return first
        return first and value <= (draft.get("year") or 0) <= value + 9
    return None


def validate(boards, curated_index):
    problems = []
    colleges = _colleges(curated_index)
    seen_groups = {}
    for b in boards:
        qid = b.get("qid", "?")
        tiles = b.get("tiles", [])
        groups = b.get("groups", [])
        if len(tiles) != 16 or len(set(tiles)) != 16:
            problems.append(f"{qid}: tiles not 16-unique ({len(tiles)}, {len(set(tiles))} unique)")
        if len(groups) != 4 or any(len(g.get("members", [])) != 4 for g in groups):
            problems.append(f"{qid}: not four 4-member groups")
            continue
        member_union = [m for g in groups for m in g["members"]]
        if set(member_union) != set(tiles) or len(member_union) != 16 or len(set(member_union)) != 16:
            problems.append(f"{qid}: tiles != union(groups) (partition broken)")
        diffs = sorted(g.get("difficulty") for g in groups)
        if diffs != [1, 2, 3, 4]:
            problems.append(f"{qid}: difficulties {diffs} != [1,2,3,4]")
        # No board may reuse another board's four-member group verbatim.
        for g in groups:
            owner, label = seen_groups.setdefault(
                frozenset(g["members"]), (qid, g["label"]))
            if owner != qid:
                problems.append(
                    f"{qid}: group '{g['label']}' repeats {owner}'s '{label}' "
                    f"verbatim (same four members)")
        # Own-label check: each of a group's own members must satisfy its label.
        for g in groups:
            kind, value = _own_derive(g["label"], colleges)
            if value is None:
                continue
            for member in g["members"]:
                row = curated_index.get(member.lower())
                if _satisfies(row, kind, value) is False:
                    problems.append(
                        f"{qid}: '{member}' (in '{g['label']}') does not satisfy "
                        f"its own label [{kind}={value}]")
        # Cross-group trap check: a member of group B must NOT also satisfy A.
        for g in groups:
            kind, value = _derive(g["label"])
            if value is None:
                continue
            for other in groups:
                if other is g:
                    continue
                for member in other["members"]:
                    row = curated_index.get(member.lower())
                    if _satisfies(row, kind, value) is True:
                        problems.append(
                            f"{qid}: '{member}' (in '{other['label']}') also satisfies "
                            f"'{g['label']}' [{kind}={value}] -- ambiguous solution")
    return problems


def main():
    boards = _load(SEED)
    if boards is None:
        print("FAIL: connections_seed.json missing")
        return 1
    curated = _load(CURATED)
    if curated is None:
        print("WARN: players_curated.json missing -- running structural checks only")
    problems = validate(boards, _index_curated(curated))
    if problems:
        print(f"FAIL: {len(problems)} problem(s):")
        for p in problems:
            print("  -", p)
        return 1
    print(f"OK: {len(boards)} boards valid")
    return 0


if __name__ == "__main__":
    sys.exit(main())
