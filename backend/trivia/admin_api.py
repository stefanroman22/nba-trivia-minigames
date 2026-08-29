"""Admin-only metadata API backing the in-app admin panel (/admin → Games tab).

Read-only: it reports which data source feeds each game (DB table and/or pool
JSON file), row counts, last-updated timestamps (SyncRun for synced tables,
file mtime for pools), schema/fields, and lets the panel page through records.

Every view REQUIRES is_staff (IsAdminUser). The frontend's `is_admin` flag is a
UI hint only — this module is the actual gate.
"""
import json
import os
from datetime import datetime, timezone as dt_timezone

from django.db.models import Q
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response

from trivia.models import (
    FanFavoritesQuestion,
    GameSession,
    GuessLog,
    Mvp,
    Player,
    PlayoffSeries,
    StartingFiveGame,
    SyncRun,
    Team,
)
from trivia.views import _game_data_dir

# ---------------------------------------------------------------------------
#  Source registry
# ---------------------------------------------------------------------------
# DB sources the panel may inspect. `sync_dataset` links a table to the
# sync_nba_data dataset that refreshes it (None = not covered by the sync).
# `latest_field` is a timestamp column to fall back on for "last updated".
DB_SOURCES = {
    "team": {"model": Team, "search": ["full_name", "abbreviation"], "sync_dataset": "teams"},
    "player": {"model": Player, "search": ["full_name"], "sync_dataset": "players"},
    "playoffseries": {"model": PlayoffSeries, "search": ["season", "winner_name", "loser_name", "round"], "sync_dataset": "playoff"},
    "mvp": {"model": Mvp, "search": ["season", "mvp", "team"], "sync_dataset": "mvps"},
    "startingfivegame": {"model": StartingFiveGame, "search": ["season", "team_a", "team_b", "winning_team"], "sync_dataset": "starting-five"},
    "fanfavoritesquestion": {"model": FanFavoritesQuestion, "search": ["qid", "prompt", "category"], "sync_dataset": None},
    "gamesession": {"model": GameSession, "search": ["game", "mode"], "sync_dataset": None, "latest_field": "finished_at"},
    "guesslog": {"model": GuessLog, "search": ["game", "question_id", "answer"], "sync_dataset": None, "latest_field": "created_at"},
    "syncrun": {"model": SyncRun, "search": ["dataset", "status"], "sync_dataset": None, "latest_field": "created_at"},
}

_MODES_DEFAULT = {"singleplayer": True, "multiplayer": True, "turn_based": False, "party": False}


def _modes(**overrides):
    return {**_MODES_DEFAULT, **overrides}


# One entry per game. `sources` reference DB_SOURCES keys ("db:...") and pool
# files under GAME_DATA_DIR ("pool:<name>" → <name>.json). `config` is a list
# of human-readable facts about how the game's questions are put together.
GAME_REGISTRY = [
    {
        "id": "series-winner",
        "name": "Guess the Series Winner",
        "status": "live",
        "modes": _modes(),
        "sources": ["db:playoffseries", "pool:playoff"],
        "config": [
            "5 playoff series per round; sides are shuffled server-side.",
            "Refreshed by sync_nba_data (dataset: playoff) → build_pools_from_db.",
        ],
    },
    {
        "id": "name-logo",
        "name": "Name the NBA Club",
        "status": "live",
        "modes": _modes(),
        "sources": ["db:team", "pool:name-logo"],
        "config": [
            "5 team logos per round from the 30 NBA teams.",
            "Refreshed by sync_nba_data (dataset: teams).",
        ],
    },
    {
        "id": "guess-mvps",
        "name": "Guess the MVP",
        "status": "live",
        "modes": _modes(),
        "sources": ["db:mvp", "pool:mvps"],
        "config": [
            "5 seasons per round; one MVP row per season (unique).",
            "Refreshed by sync_nba_data (dataset: mvps, CSV-backed).",
        ],
    },
    {
        "id": "starting-five",
        "name": "Fill in the Starting 5",
        "status": "live",
        "modes": _modes(),
        "sources": ["db:startingfivegame", "pool:starting-five"],
        "config": [
            "1 real game per round; guess the winner's five starters.",
            "Refreshed by sync_nba_data (dataset: starting-five).",
        ],
    },
    {
        "id": "wordle",
        "name": "NBA Wordle",
        "status": "live",
        "modes": _modes(),
        "sources": ["db:player", "pool:wordle"],
        "config": [
            "Words are 5-letter player surnames drawn from the player table.",
            "Random per play — not date-seeded, despite the DAILY tag.",
            "Player table refreshed by sync_nba_data (dataset: players).",
        ],
    },
    {
        "id": "fan-favorites",
        "name": "Fan Favorites",
        "status": "live",
        "modes": _modes(),
        "sources": ["db:fanfavoritesquestion", "pool:fan-favorites", "db:guesslog"],
        "config": [
            "Editorial seed boards; a board must have ≥6 answers and live=True to be served.",
            "Community takeover: once a board logs 500 correct guesses, its answer "
            "percentages are recomputed from real player guesses at pool-build time.",
            "Seeded by manage.py seed_fan_favorites; not part of the NBA-API sync.",
        ],
    },
    {
        "id": "heatmap",
        "name": "The Heatmap",
        "status": "live",
        "modes": _modes(),
        "sources": ["pool:heatmap"],
        "config": ["Hex boards authored in data_static/heatmap_seed.json — no DB table."],
    },
    {
        "id": "connections",
        "name": "NBA Connections",
        "status": "live",
        "modes": _modes(),
        "sources": ["pool:connections"],
        "config": ["Boards of 16 tiles hiding 4 groups (difficulties 1–4); seed-authored, no DB."],
    },
    {
        "id": "career-path",
        "name": "Career Path Challenge",
        "status": "live",
        "modes": _modes(),
        "sources": ["pool:players-index", "pool:career-path"],
        "config": [
            "Client picks from players-index; eligible players have 3–7 team stints.",
            "Round pick is weighted 3× toward fame tiers 2–3.",
        ],
    },
    {
        "id": "nba-grid",
        "name": "NBA Grid",
        "status": "live",
        "modes": _modes(),
        "sources": ["pool:nba-grid", "db:guesslog"],
        "config": [
            "3×3 criteria grids; seed-authored.",
            "Answer rarity scores are aggregated live from community correct guesses "
            "(/trivia/nba-grid/tally/).",
        ],
    },
    {
        "id": "who-are-ya",
        "name": "Who Are Ya?",
        "status": "live",
        "modes": _modes(),
        "sources": ["pool:players-index", "pool:who-are-ya"],
        "config": ["Mystery player limited to fame tiers 1–2 with team stints; seed-authored."],
    },
    {
        "id": "tictactoe",
        "name": "NBA Tic-Tac-Toe",
        "status": "live",
        "modes": _modes(turn_based=True),
        "sources": ["pool:tictactoe", "pool:players-index"],
        "config": [
            "Head-to-head turn-based multiplayer: 25s turns, 3 steals.",
            "Answers validated against players-index (server-side in multiplayer).",
        ],
    },
    {
        "id": "bingo",
        "name": "NBA Bingo",
        "status": "live",
        "modes": _modes(),
        "sources": ["pool:bingo", "pool:players-index"],
        "config": [
            "16-cell cards; dealt hands capped at fame tier 3.",
            "Each cell needs ≥4 matching players in the curated roster.",
        ],
    },
    {
        "id": "contexto",
        "name": "LeContexto",
        "status": "live",
        "modes": _modes(),
        "sources": ["pool:contexto", "pool:players-index"],
        "config": [
            "Daily secret is computed, not stored: CRC32 of the UTC date modulo the "
            "secret-pool size — backend and client agree by hashing the same date.",
        ],
    },
    {
        "id": "pack-five",
        "name": "Pack 5",
        "status": "live",
        "modes": _modes(),
        "sources": ["pool:pack-five", "pool:players-index"],
        "config": ["Pack of 11 cards → 10 higher/lower comparisons; max 3 elite cards dealt."],
    },
    {
        "id": "superdraft",
        "name": "SuperDraft Five",
        "status": "live",
        "modes": _modes(),
        "sources": ["pool:superdraft", "pool:players-index"],
        "config": [
            "4 draft objectives in config; the daily objective is picked client-side by date hash.",
        ],
    },
    {
        "id": "imposter",
        "name": "NBA Imposter",
        "status": "live",
        "modes": _modes(singleplayer=False, party=True),
        "sources": ["pool:imposter", "pool:players-index"],
        "config": [
            "Friend-room party game for 3–5 players; 2 clue rounds, 45s steps.",
            "Mystery player prefers fame tier ≤2.",
        ],
    },
    {
        "id": "who-would-win",
        "name": "Who Would Win?",
        "status": "backend-only",
        "modes": _modes(singleplayer=False, multiplayer=False),
        "sources": ["pool:who-would-win", "db:guesslog"],
        "config": [
            "Fully built server-side (10 matchups/session, live community split from "
            "guess logs) but not yet wired into the frontend.",
        ],
    },
]

# Cross-game datasets shown as their own card in the panel.
SHARED_SOURCES = ["pool:players-index", "pool:all-players", "db:syncrun", "db:gamesession", "db:guesslog"]


# ---------------------------------------------------------------------------
#  Helpers
# ---------------------------------------------------------------------------
def _iso(dt):
    return dt.isoformat() if dt else None


def _db_source(key):
    spec = DB_SOURCES[key]
    model = spec["model"]
    src = {
        "key": f"db:{key}",
        "kind": "db",
        "label": model._meta.db_table,
        "count": model.objects.count(),
        "fields": [f.name for f in model._meta.concrete_fields],
        "last_updated": None,
        "sync": None,
    }
    dataset = spec["sync_dataset"]
    if dataset:
        last_ok = (
            SyncRun.objects.filter(dataset=dataset, status="success").order_by("-created_at").first()
        )
        last = SyncRun.objects.filter(dataset=dataset).order_by("-created_at").first()
        src["last_updated"] = _iso(last_ok.created_at) if last_ok else None
        if last:
            src["sync"] = {
                "dataset": dataset,
                "status": last.status,
                "rows": last.rows,
                "at": _iso(last.created_at),
            }
    elif spec.get("latest_field"):
        latest = model.objects.order_by("-" + spec["latest_field"]).values_list(
            spec["latest_field"], flat=True
        ).first()
        src["last_updated"] = _iso(latest)
    return src


def _pool_path(name):
    """Path of a pool JSON file, restricted to GAME_DATA_DIR."""
    return os.path.join(_game_data_dir(), os.path.basename(name) + ".json")


def _pool_source(name):
    fname = os.path.basename(name) + ".json"
    src = {
        "key": f"pool:{name}",
        "kind": "pool",
        "label": fname,
        # Pools are mirrored to the frontend CDN under /data/.
        "link": f"/data/{fname}",
        "count": None,
        "fields": None,
        "last_updated": None,
    }
    path = _pool_path(name)
    try:
        stat = os.stat(path)
        src["last_updated"] = _iso(datetime.fromtimestamp(stat.st_mtime, tz=dt_timezone.utc))
        # Read from disk (not views.load_dataset) so a pool rebuild is visible
        # without a process restart.
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        src["missing"] = True
        return src
    if isinstance(data, list):
        src["count"] = len(data)
        first = data[0] if data else None
        if isinstance(first, dict):
            src["fields"] = list(first.keys())
        elif first is not None:
            src["fields"] = ["(plain values)"]
    elif isinstance(data, dict):
        src["count"] = 1
        src["fields"] = list(data.keys())
    return src


def _source(ref):
    kind, _, name = ref.partition(":")
    return _db_source(name) if kind == "db" else _pool_source(name)


# ---------------------------------------------------------------------------
#  Views
# ---------------------------------------------------------------------------
@api_view(["GET"])
@permission_classes([IsAdminUser])
def admin_games(request):
    """Everything the Games tab needs, in one payload."""
    manifest_version = None
    try:
        with open(_pool_path("manifest"), encoding="utf-8") as fh:
            manifest_version = json.load(fh).get("version")
    except (OSError, ValueError):
        pass

    games = [
        {
            "id": spec["id"],
            "name": spec["name"],
            "status": spec["status"],
            "modes": spec["modes"],
            "config": spec["config"],
            "sources": [_source(ref) for ref in spec["sources"]],
        }
        for spec in GAME_REGISTRY
    ]
    return Response(
        {
            "games": games,
            "shared": [_source(ref) for ref in SHARED_SOURCES],
            "manifest_version": manifest_version,
            "generated_at": _iso(datetime.now(dt_timezone.utc)),
        }
    )


@api_view(["GET"])
@permission_classes([IsAdminUser])
def admin_source_rows(request):
    """Page through the records of one source: ?key=db:mvp&q=&limit=20&offset=0."""
    key = str(request.query_params.get("key") or "")
    query = str(request.query_params.get("q") or "").strip()
    try:
        limit = min(max(int(request.query_params.get("limit", 20)), 1), 100)
        offset = max(int(request.query_params.get("offset", 0)), 0)
    except ValueError:
        return Response({"error": "limit/offset must be integers"}, status=400)

    kind, _, name = key.partition(":")

    if kind == "db":
        spec = DB_SOURCES.get(name)
        if not spec:
            return Response({"error": f"Unknown source {key!r}"}, status=404)
        qs = spec["model"].objects.order_by("-pk")
        if query:
            cond = Q()
            for field in spec["search"]:
                cond |= Q(**{f"{field}__icontains": query})
            qs = qs.filter(cond)
        total = qs.count()
        rows = list(qs.values()[offset : offset + limit])
        return Response({"key": key, "total": total, "offset": offset, "rows": rows})

    if kind == "pool" and name != "manifest":
        try:
            with open(_pool_path(name), encoding="utf-8") as fh:
                data = json.load(fh)
        except (OSError, ValueError):
            return Response({"error": f"Unknown source {key!r}"}, status=404)
        rows = data if isinstance(data, list) else [data]
        if query:
            needle = query.lower()
            rows = [r for r in rows if needle in json.dumps(r, default=str).lower()]
        total = len(rows)
        return Response({"key": key, "total": total, "offset": offset, "rows": rows[offset : offset + limit]})

    return Response({"error": "key must look like db:<table> or pool:<file>"}, status=400)
