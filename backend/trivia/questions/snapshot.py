"""Materialized questions -> files on disk -> publish plan for Storage."""
import json
import os

from trivia.data_pipeline.publish import MANIFEST_CACHE, POOL_CACHE
from trivia.questions.base import SCHEMA
from trivia.questions.storage import version_key


def _current_team_abbr(teams):
    """The stint with the greatest start_year - mirrors the frontend's currentTeam()."""
    if not teams:
        return None
    return max(teams, key=lambda t: t["start_year"])["abbr"]


def build_names(playable):
    """The shared name list every game's autocomplete reads, plus the small set
    of bio facts (position/age/jersey/team/draft) a game needs to render
    feedback about whichever player someone GUESSES - not just the mystery
    player, who already carries a full row in their own question payload.
    Deliberately excludes career stats/awards/full team history: those stay
    inside each game's own precomputed question, never in this shared file.
    """
    names = [
        {
            "id": r["person_id"],
            "full_name": r["full_name"],
            "aliases": list(r.get("aliases") or []),
            "position": r.get("position"),
            "birth_year": r.get("birth_year"),
            "jersey": r.get("jersey"),
            "team_abbr": _current_team_abbr(r.get("teams") or []),
            "draft": r.get("draft"),
        }
        for r in playable
    ]
    return sorted(names, key=lambda n: n["full_name"])


def _dump(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))


def write_snapshot(out_dir, version, dataset_version, per_game, names):
    _dump(os.path.join(out_dir, "players-names.json"), names)
    counts = {}
    for slug, items in per_game.items():
        index_items = []
        for qid, index_item, materialized in items:
            _dump(os.path.join(out_dir, slug, f"{qid}.json"), materialized)
            index_items.append(index_item)
        _dump(os.path.join(out_dir, slug, "index.json"), {
            "schema": SCHEMA, "game": slug, "version": version,
            "dataset": {"players": dataset_version}, "items": index_items,
        })
        counts[slug] = len(items)
    return counts


def build_questions_publish_plan(out_dir, version, dataset_version, public_base, counts):
    base = public_base.rstrip("/")
    prefix = f"questions/v/{version}"
    objects = []
    for root, _, files in os.walk(out_dir):
        for name in sorted(files):
            local = os.path.join(root, name)
            rel = os.path.relpath(local, out_dir).replace(os.sep, "/")
            objects.append({"local_path": local, "key": f"{prefix}/{rel}",
                            "content_type": "application/json", "cache_control": POOL_CACHE})
    games = {slug: {"index": f"{base}/{prefix}/{slug}/index.json", "count": n} for slug, n in counts.items()}
    manifest = {
        "schema": SCHEMA, "version": version,
        "dataset": {"players": dataset_version},
        "names": f"{base}/{prefix}/players-names.json",
        "games": games,
    }
    return {"objects": objects, "manifest": manifest,
            "manifest_key": "questions/manifest.json", "manifest_cache": MANIFEST_CACHE}


def _list_version_prefixes(client, bucket):
    prefixes, token = [], None
    while True:
        kwargs = {"Bucket": bucket, "Prefix": "questions/v/", "Delimiter": "/"}
        if token:
            kwargs["ContinuationToken"] = token
        page = client.list_objects_v2(**kwargs)
        prefixes += [p["Prefix"] for p in page.get("CommonPrefixes", [])]
        if not page.get("IsTruncated"):
            return prefixes
        token = page.get("NextContinuationToken")


def apply_retention(client, bucket, keep=3):
    prefixes = _list_version_prefixes(client, bucket)
    ordered = sorted(prefixes, key=lambda p: version_key(p.rstrip("/").rsplit("/", 1)[-1]))
    doomed = ordered[:-keep] if len(ordered) > keep else []
    for prefix in doomed:
        keys, token = [], None
        while True:
            kwargs = {"Bucket": bucket, "Prefix": prefix}
            if token:
                kwargs["ContinuationToken"] = token
            page = client.list_objects_v2(**kwargs)
            keys += [o["Key"] for o in page.get("Contents", [])]
            if not page.get("IsTruncated"):
                break
            token = page.get("NextContinuationToken")
        for i in range(0, len(keys), 1000):
            client.delete_objects(Bucket=bucket, Delete={"Objects": [{"Key": k} for k in keys[i:i + 1000]]})
    return doomed
