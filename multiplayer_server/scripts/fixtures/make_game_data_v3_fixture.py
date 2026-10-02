"""Regenerate the shared manifest-v3 test fixture (game-data-v3/) with the REAL publisher.

Both loaders are tested against it: src/utils/gameData.ts (scripts/test-game-data.mjs at the
repo root) and multiplayer_server/src/gameData.js (multiplayer_server/scripts/test_game_data.js).
It encodes small, fixed slices of the committed pools (backend/trivia/data/*.json) through
backend/trivia/data_pipeline/publish_v3.publish(), so a change to the expand() contract or the
manifest shape shows up as a fixture diff and a failing loader test.

    python multiplayer_server/scripts/fixtures/make_game_data_v3_fixture.py

expected.json holds the source rows per game: what expand(files) must give back, field for field.
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

# Enough rows for 3 playoff chunks and 2 starting-five chunks at chunk_size 50.
SLICES = {"playoff": 120, "name-logo": 30, "mvps": 12, "starting-five": 60, "fan-favorites": 3,
          publish_v3.NAMES_GAME: 25}
OUT = os.path.join(HERE, "game-data-v3")


def main():
    data = os.path.join(ROOT, "backend", "trivia", "data")
    rows = {}
    for game, count in SLICES.items():
        with open(os.path.join(data, f"{game}.json"), encoding="utf-8") as f:
            rows[game] = json.load(f)[:count]
    builders = {g: (lambda r=r: copy.deepcopy(r)) for g, r in rows.items()}
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    publish_v3.publish(list(SLICES), OUT, builders=builders,
                       now=datetime(2026, 10, 2, 9, 0, tzinfo=timezone.utc), warn=print)
    for extra in ("vercel.json", "_headers.json", "manifest-history.json"):
        os.remove(os.path.join(OUT, extra))
    with open(os.path.join(OUT, "expected.json"), "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, separators=(",", ":"))
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
