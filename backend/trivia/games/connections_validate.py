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
"""
import json
import os
import re
import sys

HERE = os.path.dirname(__file__)
SEED = os.path.join(HERE, "..", "data_static", "connections_seed.json")
CURATED = os.path.join(HERE, "..", "data_static", "players_curated.json")


def _load(path):
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _index_curated(curated):
    """name (lowercased) -> curated row, or {} if the file is absent."""
    if not curated:
        return {}
    return {row["full_name"].lower(): row for row in curated}


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


def _satisfies(row, kind, value):
    """Does curated player row satisfy (kind, value)? None = can't tell."""
    if row is None:
        return None
    if kind == "draft_year":
        return bool(row.get("draft")) and row["draft"].get("year") == value
    if kind == "jersey":
        return row.get("jersey") == value
    if kind == "country":
        return (row.get("country") or "").lower() == value
    if kind == "college":
        col = (row.get("college") or "").lower()
        if not col:
            return None
        return col in value or value in col or col.split()[0] in value
    return None


def validate(boards, curated_index):
    problems = []
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
