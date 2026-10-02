"""Regenerate the shared manifest-v3 test fixture (game-data-v3/) with the REAL publisher.

Both loaders are tested against it: src/utils/gameData.ts (scripts/test-game-data.mjs at the
repo root) and multiplayer_server/src/gameData.js (multiplayer_server/scripts/test_game_data.js).
It encodes small, fixed slices of the committed pools (backend/trivia/data/*.json) through
backend/trivia/data_pipeline/publish_v3.publish(), so a change to the expand() contract or the
manifest shape shows up as a fixture diff and a failing loader test.

The four question games are built from the backend's test players fixture
(backend/trivia/tests/fixtures/players_fixture.json) in the exact envelope the game modules
materialize ({"schema": 1, "game", "qid", ...payload}); contexto is scheduled for
2026-10-01..2026-10-05 so the tests can pin "today".

    python multiplayer_server/scripts/fixtures/make_game_data_v3_fixture.py

expected.json holds the source rows per game: what expand(files) must give back, field for field.
For question games it holds the rows {qid, item, question, dataset}; for question-names the
NamesEntry list.
"""
import copy
import json
import os
import shutil
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "backend"))

from trivia.data_pipeline import publish_v3  # noqa: E402
from trivia.questions.snapshot import build_names  # noqa: E402

# Enough rows for 3 playoff chunks and 2 starting-five chunks at chunk_size 50.
SLICES = {"playoff": 120, "name-logo": 30, "mvps": 12, "starting-five": 60, "fan-favorites": 3,
          publish_v3.NAMES_GAME: 25}
OUT = os.path.join(HERE, "game-data-v3")
PLAYERS = os.path.join(ROOT, "backend", "trivia", "tests", "fixtures", "players_fixture.json")
DATASET = "curated-fixture00001"
CONTEXTO_DAYS = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"]


def envelope(game, qid, payload):
    return {"schema": 1, "game": game, "qid": qid, **payload}


def question_rows(players):
    playable = [p for p in players if p.get("teams")]
    famous = [p for p in playable if p.get("fame_tier") in (1, 2)]
    journeymen = [p for p in playable if 3 <= len(p["teams"]) <= 7]
    rows = {}
    rows["career-path"] = [
        publish_v3.question_row(f"cp-{i:06d}", [f"cp-{i:06d}", 3 if p.get("fame_tier") in (2, 3) else 1],
                                envelope("career-path", f"cp-{i:06d}", {"player": p}), DATASET)
        for i, p in enumerate(journeymen[:6], 1)]
    rows["who-are-ya"] = [
        publish_v3.question_row(f"way-{i:06d}", [f"way-{i:06d}"],
                                envelope("who-are-ya", f"way-{i:06d}", {"player": p}), DATASET)
        for i, p in enumerate(famous[:5], 1)]
    ids = [p["person_id"] for p in playable]
    rows["tictactoe"] = []
    for i in range(1, 4):
        teams = sorted({s["abbr"] for p in playable for s in p["teams"]})[i * 3:i * 3 + 3]
        board = {
            "rows": [{"type": "team", "value": t, "label": t} for t in teams],
            "cols": [{"type": "award", "value": v, "label": v.upper()} for v in ("mvp", "ring", "allnba")],
            "valid": [ids[(i + c) * 5:(i + c) * 5 + 4] for c in range(9)],
        }
        qid = f"ttt-{i:04d}"
        rows["tictactoe"].append(publish_v3.question_row(qid, [qid], envelope("tictactoe", qid, board), DATASET))
    rows["contexto"] = []
    for day, secret in zip(CONTEXTO_DAYS, famous):
        ranking = [[secret["person_id"], 1]] + [[pid, r] for r, pid in enumerate(
            [x for x in ids if x != secret["person_id"]][:20], 2)]
        qid = f"ctx-{day}"
        rows["contexto"].append(publish_v3.question_row(
            qid, [qid, day], envelope("contexto", qid, {"day": day, "secret": secret, "ranking": ranking}), DATASET))
    rows[publish_v3.QNAMES_GAME] = build_names(playable[:40])
    return rows


def main():
    data = os.path.join(ROOT, "backend", "trivia", "data")
    rows = {}
    for game, count in SLICES.items():
        with open(os.path.join(data, f"{game}.json"), encoding="utf-8") as f:
            rows[game] = json.load(f)[:count]
    with open(PLAYERS, encoding="utf-8") as f:
        rows.update(question_rows(json.load(f)))
    builders = {g: (lambda r=r: copy.deepcopy(r)) for g, r in rows.items()}
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    publish_v3.publish(list(rows), OUT, builders=builders,
                       now=datetime(2026, 10, 2, 9, 0, tzinfo=timezone.utc), warn=print)
    for extra in ("vercel.json", "_headers.json", "manifest-history.json"):
        os.remove(os.path.join(OUT, extra))
    with open(os.path.join(OUT, "expected.json"), "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, separators=(",", ":"))
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
