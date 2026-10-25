"""Make a check stack's (or a pipeline QA lane's) local sqlite database fit for parallel checks, right after migrate.

Runs inside `manage.py shell` against the LOCAL sqlite database (check-core/lib/stack.mjs and scripts/team/qa.mjs):

    python manage.py shell -c "import runpy; runpy.run_path(r'<this file>', run_name='prepare')"

1. WAL journal mode. The checks hit Django from several workers at once; in sqlite's default rollback journal a
   reader blocks the writer, and `trivia.awarding.award()` (read, then write, in one transaction) answered
   `database is locked` (HTTP 500) to most finished games of the 2026-10-25 weekly run. WAL lets readers and the one
   writer run side by side. It is a property of the database file, so it holds for every later connection,
   whatever settings.py says.
2. Player rows. Wordle and the All-Players game read the Player table, which production fills from nba_api
   (sync_nba_data, network). A fresh check database has none, so `GET /trivia/wordle/` answered 500 "no wordle words
   available" and every online Wordle round failed to load. Seeded from the repo's own
   backend/trivia/data_static/players_curated.json, only while the table is empty (a filled table is left alone).

Prints one line `PREPARE_SQLITE: journal=<mode> players=<count> (+<seeded>)`. Refuses anything but local sqlite.
"""
import json
import os
from pathlib import Path

from django.conf import settings
from django.db import connection

from trivia.models import Player

SUFFIXES = {"Jr", "Sr", "II", "III", "IV", "V"}


def guard():
    engine = settings.DATABASES["default"]["ENGINE"]
    if not engine.endswith("sqlite3") or os.environ.get("DATABASE_URL"):
        raise SystemExit(f"prepare_sqlite: refusing to run against {engine} (DATABASE_URL set?) - local sqlite only")


def wal():
    with connection.cursor() as c:
        c.execute("PRAGMA journal_mode=WAL")
        return str(c.fetchone()[0])


def seed_players():
    if Player.objects.exists():
        return 0
    src = Path(settings.BASE_DIR) / "trivia" / "data_static" / "players_curated.json"
    if not src.exists():
        return 0
    rows = json.loads(src.read_text(encoding="utf-8"))
    players = []
    for r in rows:
        name = str(r.get("full_name") or "").strip()
        if not name or r.get("person_id") is None:
            continue
        # "Gary Payton II" → last name "Payton" (nba_api's own last_name drops the suffix too).
        words = [w for w in name.split() if w.rstrip(".") not in SUFFIXES]
        first, last = (words[0], " ".join(words[1:])) if len(words) > 1 else (name, name)
        teams = r.get("teams") or []
        starts = [t["start_year"] for t in teams if isinstance(t.get("start_year"), int)]
        ends = [t["end_year"] for t in teams if isinstance(t.get("end_year"), int)]
        players.append(Player(
            person_id=int(r["person_id"]), full_name=name[:120], first_name=first[:60], last_name=last[:60],
            from_year=min(starts) if starts else None, to_year=max(ends) if ends else None, is_active=bool(r.get("is_active")),
        ))
    Player.objects.bulk_create(players, batch_size=500, ignore_conflicts=True)
    return len(players)


if __name__ in ("prepare", "__main__"):
    guard()
    mode = wal()
    seeded = seed_players()
    print(f"PREPARE_SQLITE: journal={mode} players={Player.objects.count()} (+{seeded})", flush=True)
