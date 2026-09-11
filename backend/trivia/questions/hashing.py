import hashlib
import json


def content_hash(definition):
    """sha256 over canonical JSON so equal definitions dedupe regardless of key order."""
    canonical = json.dumps(definition, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()
