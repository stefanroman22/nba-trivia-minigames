"""Verify a game-data publish is live: manifest version + SHA-256 of every changed file.

Used by .github/workflows/publish-game-data.yml after the upload step. Reads the
report written by ``manage.py publish_game_data_v3`` and compares it with what
the data host actually serves. Exits 1 on any mismatch. Standard library only.

    python backend/scripts/verify_game_data.py --base https://data.example.com \
        --report build/game-data-report.json
"""

import argparse
import hashlib
import json
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor


def fetch(url):
    req = urllib.request.Request(url, headers={
        "User-Agent": "nba-minigames-publish-verify", "Cache-Control": "no-cache"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read()


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--base", required=True, help="Public base URL of the data host")
    parser.add_argument("--report", required=True, help="game-data-report.json from the publisher")
    parser.add_argument("--attempts", type=int, default=10)
    parser.add_argument("--delay", type=float, default=6.0)
    args = parser.parse_args()

    base = args.base.rstrip("/")
    with open(args.report, encoding="utf-8") as f:
        report = json.load(f)
    expected = report["version"]

    live = None
    for attempt in range(1, args.attempts + 1):
        try:
            raw = fetch(f"{base}/manifest.json?verify={int(time.time())}")
            live = json.loads(raw)
            if live.get("version") == expected:
                break
            print(f"attempt {attempt}: live version {live.get('version')!r}, want {expected!r}")
        except (urllib.error.URLError, ValueError, OSError) as e:
            print(f"attempt {attempt}: manifest fetch failed: {e}")
        time.sleep(args.delay)
    if not live or live.get("version") != expected:
        print(f"::error::live manifest at {base} is not version {expected}")
        return 1
    if report.get("manifest_sha256") and hashlib.sha256(raw).hexdigest() != report["manifest_sha256"]:
        print("::error::live manifest bytes differ from the built manifest")
        return 1

    def check(item):
        url = f"{base}/{item['path']}"
        try:
            got = hashlib.sha256(fetch(url)).hexdigest()
        except (urllib.error.URLError, OSError) as e:
            return f"::error::{item['path']}: fetch failed: {e}"
        if got != item["sha256"]:
            return f"::error::{item['path']}: sha256 {got} != {item['sha256']}"
        return None

    # A first question publish changes ~800 small files: check them in parallel.
    with ThreadPoolExecutor(16) as pool:
        errors = [e for e in pool.map(check, report.get("changed_files", [])) if e]
    for e in errors:
        print(e)
    failures = len(errors)
    if failures:
        print(f"::error::{failures} changed file(s) failed verification")
        return 1
    print(f"verified version {expected}: manifest + {len(report.get('changed_files', []))} changed file(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
