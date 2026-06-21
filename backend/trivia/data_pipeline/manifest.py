import hashlib
import json
import os


def sha256_file(path):
    """Return the hex SHA-256 of a file's bytes."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def build_manifest(data_dir, version):
    """List every published <key>.json (excluding manifest.json) with hash + count."""
    games = {}
    for name in sorted(os.listdir(data_dir)):
        if not name.endswith(".json") or name == "manifest.json":
            continue
        key = name[: -len(".json")]
        path = os.path.join(data_dir, name)
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        games[key] = {
            "file": name,
            "sha256": sha256_file(path),
            "count": len(data) if isinstance(data, list) else None,
        }
    return {"version": version, "games": games}
