"""S3-style upload of a publish plan (Supabase Storage: maintain_questions, upload_dataset).

The R2 whole-pool publisher that lived here (build_publish_plan + manage.py
publish_game_data) was removed: game data is published by publish_v3.py.
"""
import json

# Versioned pool files never change for a given version -> cache forever.
POOL_CACHE = "public, max-age=31536000, immutable"
# The manifest is the single mutable pointer -> short TTL so clients see new versions fast.
MANIFEST_CACHE = "public, max-age=60"


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
