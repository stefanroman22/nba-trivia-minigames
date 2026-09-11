import json

from trivia.data_pipeline.manifest import sha256_file
from trivia.data_pipeline.publish import MANIFEST_CACHE, POOL_CACHE


def build_dataset_plan(path, version, public_base):
    base = public_base.rstrip("/")
    key = f"datasets/players/v/{version}/players_curated.json"
    with open(path, encoding="utf-8") as f:
        count = len(json.load(f))
    return {
        "objects": [{"local_path": path, "key": key, "content_type": "application/json", "cache_control": POOL_CACHE}],
        "manifest": {"players": {"version": version, "url": f"{base}/{key}", "sha256": sha256_file(path), "count": count}},
        "manifest_key": "datasets/manifest.json",
        "manifest_cache": MANIFEST_CACHE,
    }
