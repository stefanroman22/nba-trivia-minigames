import json
import os

# Versioned pool files never change for a given version -> cache forever.
POOL_CACHE = "public, max-age=31536000, immutable"
# The manifest is the single mutable pointer -> short TTL so clients see new versions fast.
MANIFEST_CACHE = "public, max-age=60"


def build_publish_plan(data_dir, version, public_base_url):
    """Plan the R2/S3 upload: versioned immutable pool files + a manifest of public URLs.

    Returns {"objects": [{local_path, key, content_type, cache_control}, ...],
             "manifest": {"version", "games": {key: public_url}},
             "manifest_key": "manifest.json", "manifest_cache": str}.
    """
    # NOTE: the published manifest is intentionally a DIFFERENT shape from the on-disk
    # manifest (see manifest.py) — here games[key] is the public CDN URL string for clients
    # to fetch. Version-prefixed paths (v/<version>/...), not content-hashed filenames, are the
    # cache-bust key; this is safe because refresh_game_data bumps the version on every run.
    base = public_base_url.rstrip("/")
    objects = []
    games = {}
    for name in sorted(os.listdir(data_dir)):
        if not name.endswith(".json") or name == "manifest.json":
            continue
        key_name = name[: -len(".json")]
        remote_key = f"v/{version}/{name}"
        objects.append(
            {
                "local_path": os.path.join(data_dir, name),
                "key": remote_key,
                "content_type": "application/json",
                "cache_control": POOL_CACHE,
            }
        )
        games[key_name] = f"{base}/{remote_key}"
    return {
        "objects": objects,
        "manifest": {"version": version, "games": games},
        "manifest_key": "manifest.json",
        "manifest_cache": MANIFEST_CACHE,
    }


def upload_plan(plan, client, bucket):
    """Upload a publish plan using an S3-compatible client. Returns the keys written."""
    written = []
    for obj in plan["objects"]:
        with open(obj["local_path"], "rb") as f:
            body = f.read()
        client.put_object(
            Bucket=bucket,
            Key=obj["key"],
            Body=body,
            ContentType=obj["content_type"],
            CacheControl=obj["cache_control"],
        )
        written.append(obj["key"])
    # INVARIANT: write the manifest LAST, after every immutable pool object. The manifest
    # is the version pointer clients read; writing it last means a partial pool-upload
    # failure aborts before the pointer flips, so clients never see a version whose files
    # aren't all present. Do NOT wrap the per-pool loop above in error-swallowing try/except.
    client.put_object(
        Bucket=bucket,
        Key=plan["manifest_key"],
        Body=json.dumps(plan["manifest"]).encode("utf-8"),
        ContentType="application/json",
        CacheControl=plan["manifest_cache"],
    )
    written.append(plan["manifest_key"])
    return written
