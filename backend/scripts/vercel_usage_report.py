"""Weekly usage report for the game-data host (phase 5 of the publishing design).

Run by .github/workflows/game-data-usage.yml; writes a Slack message (--out) that
the workflow posts with ``node scripts/slack.mjs post-text``. Standard library only,
read-only: it only GETs the public manifest/files and Vercel's deployments list.

What it CAN measure:
  * the live manifest version and publish time (DATA_PUBLIC_BASE/manifest.json)
  * the bytes of the live published set, raw and as served gzip'd, per game
  * deployments of the data project in the last N days
    (GET /v7/deployments, https://vercel.com/docs/rest-api/deployments/list-deployments)

What it CANNOT measure: bandwidth / Fast Data Transfer served. Vercel's only usage
endpoint (GET /v1/billing/charges) needs the ``billing`` scope, which is "Only
available to Pro and Enterprise teams"
(https://vercel.com/docs/integrations/create-integration/vercel-api-integrations#scopes);
this project is on Hobby. So the report links to the usage dashboard instead of
inventing a percentage of the allowance.

    VERCEL_TOKEN=... VERCEL_ORG_ID=team_... VERCEL_DATA_PROJECT_ID=prj_... \
    python backend/scripts/vercel_usage_report.py --base https://data.example --out usage.txt
"""

import argparse
import gzip
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

API = "https://api.vercel.com"
# Hobby included usage, https://vercel.com/docs/plans/hobby (shown for context only:
# without a usage API we can't say how much of it is used).
HOBBY_FAST_DATA_TRANSFER_GB = 100
USAGE_DASHBOARD = "https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fusage&title=Usage"
DAY_MS = 24 * 3600 * 1000
MAX_PAGES = 20


# ---------------------------------------------------------------- HTTP

def http_get(url, headers=None):
    """(status, headers, body bytes). Raises OSError/URLError on network failure."""
    req = urllib.request.Request(url, headers={"User-Agent": "nba-minigames-usage-report",
                                               **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, dict(resp.headers), resp.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers or {}), e.read() or b""


# ---------------------------------------------------------------- manifest

def manifest_files(manifest):
    """{game: [paths]} for every file the manifest references ("names" as all-players)."""
    out = {}
    for game, entry in (manifest.get("games") or {}).items():
        paths = []
        if entry.get("file"):
            paths.append(entry["file"])
        paths.extend(entry.get("chunks") or [])
        paths.extend((entry.get("lookups") or {}).values())
        if entry.get("index"):
            paths.append(entry["index"])
        out[game] = paths
    if manifest.get("names"):
        out["all-players"] = [manifest["names"]]
    if manifest.get("question_names"):
        out["question-names"] = [manifest["question_names"]]
    return out


def question_files(base, index_path, get=http_get):
    """The question files a published question index lists ({game}/{qid}.{sha12}.json)."""
    status, headers, body = get(f"{base}/{urllib.parse.quote(index_path)}", {"Accept-Encoding": "gzip"})
    if status != 200:
        raise OSError(f"{index_path}: HTTP {status}")
    if "gzip" in {k.lower(): v for k, v in headers.items()}.get("content-encoding", ""):
        body = gzip.decompress(body)
    index = json.loads(body)
    return [f"{index['game']}/{qid}.{sha}.json" for qid, sha in index["files"].items()]


def file_size(base, path, get=http_get):
    """(raw bytes, bytes as served with gzip) of one published file."""
    status, headers, body = get(f"{base}/{urllib.parse.quote(path)}", {"Accept-Encoding": "gzip"})
    if status != 200:
        raise OSError(f"{path}: HTTP {status}")
    encoding = {k.lower(): v for k, v in headers.items()}.get("content-encoding", "")
    raw = gzip.decompress(body) if "gzip" in encoding else body
    return len(raw), len(body)


def published_bytes(base, manifest, get=http_get):
    """Totals and per-game sizes of the live published set; failed files are listed."""
    games, failed = {}, []
    for game, paths in sorted(manifest_files(manifest).items()):
        index = ((manifest.get("games") or {}).get(game) or {}).get("index")
        if index:  # a question game: the index lists one file per question
            try:
                paths = paths + question_files(base, index, get)
            except (OSError, ValueError, KeyError, TypeError) as e:
                failed.append(f"{index}: question files not listed ({e})")
        raw = served = 0
        for path in paths:
            try:
                r, s = file_size(base, path, get)
            except (OSError, ValueError) as e:
                failed.append(str(e))
                continue
            raw += r
            served += s
        games[game] = {"files": len(paths), "raw": raw, "served": served}
    return {
        "files": sum(g["files"] for g in games.values()),
        "raw": sum(g["raw"] for g in games.values()),
        "served": sum(g["served"] for g in games.values()),
        "games": games, "failed": failed,
    }


# ---------------------------------------------------------------- deployments

def deployments_since(token, project_id, team_id, since_ms, get=http_get):
    """Every deployment of the project created at or after since_ms (paginated)."""
    found, until = [], None
    for _ in range(MAX_PAGES):
        params = {"projectId": project_id, "since": str(since_ms), "limit": "100"}
        if team_id and team_id.startswith("team_"):
            params["teamId"] = team_id
        if until:
            params["until"] = str(until)
        status, _, body = get(f"{API}/v7/deployments?{urllib.parse.urlencode(params)}",
                              {"Authorization": f"Bearer {token}"})
        if status != 200:
            raise OSError(f"GET /v7/deployments: HTTP {status} {body[:200].decode('utf-8', 'replace')}")
        page = json.loads(body)
        found.extend(d for d in page.get("deployments", []) if (d.get("created") or 0) >= since_ms)
        until = (page.get("pagination") or {}).get("next")
        if not until:
            break
    return found


def summarize_deployments(deployments):
    states = [d.get("readyState") or d.get("state") or "UNKNOWN" for d in deployments]
    return {
        "total": len(deployments),
        "ready": states.count("READY"),
        "failed": sum(s in ("ERROR", "CANCELED") for s in states),
        "production": sum(d.get("target") == "production" for d in deployments),
    }


# ---------------------------------------------------------------- message

def kb(n):
    return f"{n / 1024:.1f} KB"


def format_message(base, days, manifest=None, manifest_error=None, sizes=None,
                   deploys=None, deploys_error=None, dashboard=USAGE_DASHBOARD):
    host = urllib.parse.urlparse(base).netloc or base
    lines = [f":bar_chart: *Game data weekly usage* ({host})"]
    if manifest:
        lines.append(f"• Live data version {manifest.get('version', '?')}, "
                     f"published {manifest.get('published_at', '?')}")
    else:
        lines.append(f"• Live manifest unavailable: {manifest_error}")
    if sizes:
        biggest = sorted(sizes["games"].items(), key=lambda kv: kv[1]["served"], reverse=True)[:3]
        detail = ", ".join(f"{g} {kb(v['served'])}" for g, v in biggest)
        lines.append(f"• Published set: {sizes['files']} files, {kb(sizes['raw'])} raw / "
                     f"{kb(sizes['served'])} gzip as served (largest: {detail})")
        if sizes["failed"]:
            lines.append(f"  ({len(sizes['failed'])} file(s) could not be measured: "
                         f"{'; '.join(sizes['failed'][:3])})")
    if deploys is not None:
        lines.append(f"• Data deployments, last {days} days: {deploys['total']} "
                     f"({deploys['ready']} ready, {deploys['failed']} failed/canceled)")
    else:
        lines.append(f"• Data deployments: unavailable ({deploys_error})")
    lines.append(f"• Bandwidth used: not available via API on the Hobby plan (Vercel's usage API "
                 f"is Pro/Enterprise only). Hobby includes {HOBBY_FAST_DATA_TRANSFER_GB} GB Fast Data "
                 f"Transfer a month, shared with the website; check it on the "
                 f"<{dashboard}|Vercel usage dashboard>.")
    return "\n".join(lines)


def build_report(base, token, project_id, team_id, days, now_ms, get=http_get):
    """The Slack message; every section degrades to a note instead of failing."""
    manifest = manifest_error = sizes = deploys = deploys_error = None
    try:
        status, _, body = get(f"{base}/manifest.json?usage={now_ms // 1000}", {"Cache-Control": "no-cache"})
        if status != 200:
            raise OSError(f"HTTP {status}")
        manifest = json.loads(body)
        sizes = published_bytes(base, manifest, get)
    except (OSError, ValueError) as e:
        manifest_error = str(e)
    if token and project_id:
        try:
            deploys = summarize_deployments(
                deployments_since(token, project_id, team_id, now_ms - days * DAY_MS, get))
        except (OSError, ValueError) as e:
            deploys_error = str(e)
    else:
        deploys_error = "VERCEL_TOKEN / VERCEL_DATA_PROJECT_ID not set"
    return format_message(base, days, manifest, manifest_error, sizes, deploys, deploys_error)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--base", default=os.environ.get("DATA_PUBLIC_BASE", ""),
                        help="Public base URL of the data host (default $DATA_PUBLIC_BASE)")
    parser.add_argument("--days", type=int, default=7)
    parser.add_argument("--out", default=None, help="Write the Slack message here (also printed)")
    args = parser.parse_args(argv)
    if not args.base:
        print("::error::no --base / DATA_PUBLIC_BASE")
        return 1
    message = build_report(
        args.base.rstrip("/"), os.environ.get("VERCEL_TOKEN", ""),
        os.environ.get("VERCEL_DATA_PROJECT_ID", ""), os.environ.get("VERCEL_ORG_ID", ""),
        args.days, int(time.time() * 1000))
    print(message)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(message + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
