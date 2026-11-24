"""The datasets a generated game may draw on.

Each Source is one published pool under trivia/data/ with an explicit field whitelist: a spec can only read, filter
on or answer with a listed field, so the model sees exactly what the engine can do and a typo fails validation
instead of producing an empty game. `derive` adds flat convenience fields (counts, first/last team) that would
otherwise need list logic the spec language does not have.
"""
import json
import os
from dataclasses import dataclass, field
from typing import Callable

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")

STRING, NUMBER, BOOLEAN, LIST = "string", "number", "boolean", "list"


@dataclass(frozen=True)
class Field:
    name: str
    type: str
    description: str


@dataclass(frozen=True)
class Source:
    id: str
    title: str
    description: str
    file: str
    fields: tuple
    derive: Callable = None
    # answer field -> the list field holding other accepted spellings of it (type_answer rounds).
    aliases: dict = field(default_factory=dict)

    def field(self, name):
        return next((f for f in self.fields if f.name == name), None)


def _season_start(row):
    """"1980-81" -> 1980."""
    try:
        return int(str(row.get("season", ""))[:4])
    except ValueError:
        return None


def _derive_player(row):
    awards = row.get("awards") or {}
    teams = row.get("teams") or []
    names = []
    for t in teams:  # a player's stints, in order; keep each franchise name once
        if t.get("name") and t["name"] not in names:
            names.append(t["name"])
    row["rings_count"] = len(awards.get("rings") or [])
    row["mvp_count"] = len(awards.get("mvp") or [])
    row["fmvp_count"] = len(awards.get("fmvp") or [])
    row["dpoy_count"] = len(awards.get("dpoy") or [])
    row["rookie_of_the_year"] = awards.get("roty") is not None
    row["team_names"] = names
    row["teams_count"] = len(names)
    row["first_team"] = names[0] if names else None
    row["last_team"] = names[-1] if names else None
    row["debut_year"] = min((t["start_year"] for t in teams if t.get("start_year")), default=None)
    row["final_year"] = max((t["end_year"] for t in teams if t.get("end_year")), default=None)
    return row


def _derive_series(row):
    row["season_start_year"] = _season_start(row)
    row["loser"] = row["team_b"] if row.get("winner") == row.get("team_a") else row.get("team_a")
    row["matchup"] = f"{row.get('team_a')} vs {row.get('team_b')}"
    wins = sorted([row.get("team_a_wins") or 0, row.get("team_b_wins") or 0], reverse=True)
    row["result"] = f"{wins[0]}-{wins[1]}"
    return row


def _derive_mvp(row):
    row["season_start_year"] = _season_start(row)
    return row


def _derive_starting_five(row):
    row["starters"] = [p.get("name") for p in row.get("starting_5") or [] if p.get("name")]
    row["losing_team"] = row["team_b"] if row.get("winning_team") == row.get("team_a") else row.get("team_a")
    row["matchup"] = f"{row.get('team_a')} vs {row.get('team_b')}"
    try:
        row["year"] = int(str(row.get("game_date", ""))[:4])
    except ValueError:
        row["year"] = None
    return row


SOURCES = {
    s.id: s
    for s in (
        Source(
            id="players",
            title="NBA players",
            description="Every NBA player with bio, draft, career averages, teams and awards. Most rows are obscure "
            "role players: filter on fame_tier, career.ppg or awards.allstar_count for questions people can answer.",
            file="players-index.json",
            derive=_derive_player,
            aliases={"full_name": "aliases"},
            fields=(
                Field("full_name", STRING, "Player name"),
                Field("fame_tier", NUMBER, "1 = superstar, 2 = star, 3 = well known, 4 = everyone else"),
                Field("position", STRING, "G, F, C, G-F or F-C"),
                Field("height_in", NUMBER, "Height in inches"),
                Field("weight_lb", NUMBER, "Weight in pounds"),
                Field("birth_year", NUMBER, "Year of birth"),
                Field("country", STRING, "Country of origin"),
                Field("college", STRING, "College, when the player attended one"),
                Field("jersey", NUMBER, "Most associated jersey number"),
                Field("is_active", BOOLEAN, "Still playing"),
                Field("draft.year", NUMBER, "Draft year (undrafted players have none)"),
                Field("draft.round", NUMBER, "Draft round"),
                Field("draft.pick", NUMBER, "Overall pick number"),
                Field("draft.team_abbr", STRING, "Abbreviation of the drafting team"),
                Field("career.pts", NUMBER, "Career total points"),
                Field("career.reb", NUMBER, "Career total rebounds"),
                Field("career.ast", NUMBER, "Career total assists"),
                Field("career.ppg", NUMBER, "Career points per game"),
                Field("career.rpg", NUMBER, "Career rebounds per game"),
                Field("career.apg", NUMBER, "Career assists per game"),
                Field("career.seasons", NUMBER, "Seasons played"),
                Field("awards.allstar_count", NUMBER, "All-Star selections"),
                Field("awards.allnba_count", NUMBER, "All-NBA selections"),
                Field("rings_count", NUMBER, "Championships won"),
                Field("mvp_count", NUMBER, "Regular-season MVP awards"),
                Field("fmvp_count", NUMBER, "Finals MVP awards"),
                Field("dpoy_count", NUMBER, "Defensive Player of the Year awards"),
                Field("rookie_of_the_year", BOOLEAN, "Won Rookie of the Year"),
                Field("team_names", LIST, "Every franchise the player played for, in order"),
                Field("teams_count", NUMBER, "Number of franchises played for"),
                Field("first_team", STRING, "First franchise"),
                Field("last_team", STRING, "Last (or current) franchise"),
                Field("debut_year", NUMBER, "First season's starting year"),
                Field("final_year", NUMBER, "Last season's ending year"),
            ),
        ),
        Source(
            id="playoff_series",
            title="Playoff series",
            description="Every completed NBA playoff series since 1980-81: the two teams, the round, the winner "
            "and the series score.",
            file="playoff.json",
            derive=_derive_series,
            fields=(
                Field("season", STRING, "Season, e.g. 1995-96"),
                Field("season_start_year", NUMBER, "First year of the season, e.g. 1995"),
                Field("round", STRING, "First Round, Conference Semifinals, Conference Finals or NBA Finals"),
                Field("team_a", STRING, "One team"),
                Field("team_b", STRING, "The other team"),
                Field("matchup", STRING, "\"team_a vs team_b\""),
                Field("winner", STRING, "Series winner"),
                Field("loser", STRING, "Series loser"),
                Field("result", STRING, "Series score, winner first, e.g. 4-2"),
                Field("total_games", NUMBER, "Games played in the series"),
            ),
        ),
        Source(
            id="mvps",
            title="Regular-season MVPs",
            description="One row per season since 1955-56: the MVP and his team.",
            file="mvps.json",
            derive=_derive_mvp,
            fields=(
                Field("season", STRING, "Season, e.g. 2015-16"),
                Field("season_start_year", NUMBER, "First year of the season"),
                Field("mvp", STRING, "The MVP's name"),
                Field("team", STRING, "The team he played for that season"),
            ),
        ),
        Source(
            id="teams",
            title="NBA teams",
            description="The 30 current franchises. Small: suits short games only.",
            file="name-logo.json",
            fields=(
                Field("full_name", STRING, "Team name, e.g. Boston Celtics"),
                Field("abbreviation", STRING, "Three-letter abbreviation, e.g. BOS"),
            ),
        ),
        Source(
            id="starting_five",
            title="Starting lineups",
            description="Around 500 regular-season games with the winning team's starting five.",
            file="starting-five.json",
            derive=_derive_starting_five,
            fields=(
                Field("game_date", STRING, "Date, YYYY-MM-DD"),
                Field("year", NUMBER, "Calendar year of the game"),
                Field("team_a", STRING, "One team"),
                Field("team_b", STRING, "The other team"),
                Field("matchup", STRING, "\"team_a vs team_b\""),
                Field("final_score", STRING, "Final score, e.g. 91 - 110"),
                Field("winning_team", STRING, "Winner"),
                Field("losing_team", STRING, "Loser"),
                Field("starters", LIST, "The winning team's five starters"),
            ),
        ),
    )
}

_cache = {}


def load_rows(source_id):
    """The source's rows with derived fields added. Cached per file mtime: a publish replaces the file."""
    source = SOURCES[source_id]
    path = os.path.join(DATA_DIR, source.file)
    mtime = os.stat(path).st_mtime_ns
    hit = _cache.get(source_id)
    if hit and hit[0] == mtime:
        return hit[1]
    with open(path, encoding="utf-8") as f:
        rows = json.load(f)
    if source.derive:
        rows = [source.derive(dict(r)) for r in rows]
    _cache[source_id] = (mtime, rows)
    return rows


def get_value(row, path):
    """`draft.year` -> row["draft"]["year"]; None when any step is missing."""
    cur = row
    for part in path.split("."):
        if not isinstance(cur, dict):
            return None
        cur = cur.get(part)
    return cur


def is_blank(value):
    return value is None or value == "" or value == []


def catalog():
    """What the admin panel and the agent's system prompt show: every source with its row count and fields."""
    return [
        {
            "id": s.id,
            "title": s.title,
            "description": s.description,
            "rows": len(load_rows(s.id)),
            "fields": [{"name": f.name, "type": f.type, "description": f.description} for f in s.fields],
        }
        for s in SOURCES.values()
    ]


def describe(source_id, field_names=None, samples=3):
    """Field statistics the agent uses to pick filters that leave enough rows: coverage, numeric range, the most
    common values of a string field, plus a few sample rows (most famous first where the source ranks fame)."""
    source = SOURCES[source_id]
    rows = load_rows(source_id)
    wanted = [f for f in source.fields if not field_names or f.name in field_names]
    stats = []
    for f in wanted:
        values = [v for v in (get_value(r, f.name) for r in rows) if not is_blank(v)]
        entry = {"name": f.name, "type": f.type, "filled": len(values), "of": len(rows)}
        if f.type == NUMBER and values:
            ordered = sorted(values)
            entry.update(min=ordered[0], median=ordered[len(ordered) // 2], max=ordered[-1])
        elif f.type == STRING and values:
            counts = {}
            for v in values:
                counts[v] = counts.get(v, 0) + 1
            entry["distinct"] = len(counts)
            entry["top"] = [v for v, _ in sorted(counts.items(), key=lambda kv: -kv[1])[:8]]
        stats.append(entry)
    ranked = sorted(rows, key=lambda r: r.get("fame_tier") or 9)[:samples]
    return {
        "source": source_id,
        "rows": len(rows),
        "fields": stats,
        "samples": [{f.name: get_value(r, f.name) for f in wanted} for r in ranked],
    }
