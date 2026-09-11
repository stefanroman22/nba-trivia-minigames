"""Read a committed pool from trivia/data/ the way the CDN would serve it.

Seed validators prove the *seed* is sound, but what ships is the built
trivia/data/<key>.json that build_pools_from_db wrote from it. Nothing used to
assert the two still agree, so a hand-edit of the published file — or a seed fix
committed without rebuilding — would pass every suite and ship anyway.
"""
import json
import os

from django.conf import settings


def data_dir():
    """Same resolution build_pools_from_db / publish_game_data use."""
    return getattr(
        settings, "GAME_DATA_DIR", os.path.join(settings.BASE_DIR, "trivia", "data")
    )


def published_pool(key):
    """Parsed trivia/data/<key>.json (the artifact the frontend downloads)."""
    with open(os.path.join(data_dir(), f"{key}.json"), "r", encoding="utf-8") as f:
        return json.load(f)
