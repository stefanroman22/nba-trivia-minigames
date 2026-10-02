"""Manifest-v3 game-data publisher: content-addressed, chunked, lossless files.

Design: docs/team/designs/2026-10-02-independent-game-data-publishing.md. This
module turns each game's builder rows into a static folder any CDN can serve:

    manifest.json                       mutable pointer, max-age=60, written LAST
    manifest-history.json               the last HISTORY_LIMIT manifests (rollback)
    <game>/<name>.<sha12>.json          immutable, cached for a year
    shared/players-names.<sha12>.json   autocomplete names (the "all-players" pool)
    vercel.json, _headers.json          host config (Vercel headers / R2 object metadata)

``<sha12>`` is the first 12 hex chars of the SHA-256 of the file's bytes, so the
same content always gets the same URL: unchanged data is never re-uploaded or
re-downloaded, and a stale file can never be cached under a new name.

Manifest v3::

    {"schema": 3, "version": "2026-10-02.1", "published_at": "2026-10-02T09:00:00Z",
     "games": {
       "playoff": {"kind": "chunked", "rows": 912, "chunk_size": 50,
                   "lookups": {"teams": "playoff/teams.1a2b3c4d5e6f.json"},
                   "chunks": ["playoff/c00.9f8e7d6c5b4a.json", ...]},
       "mvps": {"kind": "single", "rows": 71, "file": "mvps/all.3f9a1c2b7e04.json"}},
     "names": "shared/players-names.5e6f7a8b9c0d.json"}

Every data file (a chunk or a single file) is a JSON array of encoded rows. A
lookup file is a JSON array of entries. A future ``kind: "questions"`` entry
(``{"kind": "questions", "rows": N, "index": "<game>/index.<sha12>.json"}``)
plugs in as one more branch of ``encode_game``/``decode_game``/``entry_files``.

THE expand() CONTRACT (mirror it exactly in the website and multiplayer loaders)
-------------------------------------------------------------------------------
An encoded row is the builder's row with some field groups replaced by one
reference key ``"<prefix>@<lookup>": <index>``. ``lookups[<lookup>][<index>]`` is
an object of ``{suffix: value}``; expanding writes ``row[prefix + suffix] = value``
for each of its entries (the suffix may be the empty string). Keys without an
``@`` are copied as is; rows that are not objects (e.g. name strings) pass through.
Field order is not significant. Reference JS/TS::

    function expand(rows, lookups) {
      return rows.map((row) => {
        if (row === null || typeof row !== "object" || Array.isArray(row)) return row;
        const out = {};
        for (const [key, value] of Object.entries(row)) {
          const at = key.indexOf("@");
          if (at < 0) { out[key] = value; continue; }
          const prefix = key.slice(0, at);
          const entry = lookups[key.slice(at + 1)][value];
          for (const [suffix, v] of Object.entries(entry)) out[prefix + suffix] = v;
        }
        return out;
      });
    }

where ``lookups`` is ``{name: <parsed lookup file>}`` for ``entry.lookups``.
Example (playoff): ``{"team_a@teams": 3, "season": "1980-81", ...}`` with
``teams[3] = {"": "Chicago Bulls", "_abbreviation": "CHI", "_logo": "https://..."}``
expands to ``team_a``, ``team_a_abbreviation`` and ``team_a_logo``.
"""

import hashlib
import json
import math
import os
import random
import re
import shutil
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone

SCHEMA = 3
CHUNK_SIZE = 50
HISTORY_LIMIT = 5
# Files referenced by this many previous manifests stay deployed, so a player
# holding a manifest up to 60 seconds old never hits a missing file.
KEEP_PREVIOUS = 3
IMMUTABLE_CACHE = "public, max-age=31536000, immutable"
MANIFEST_CACHE = "public, max-age=60"
JSON_CONTENT_TYPE = "application/json; charset=utf-8"

# The autocomplete names pool: built and selected like a game, but published as
# the manifest's top-level "names" pointer rather than under "games".
NAMES_GAME = "all-players"
NAMES_DIR = "shared"
NAMES_NAME = "players-names"

HASHED_NAME = re.compile(r"\.([0-9a-f]{12})\.json$")
SAFE_NAME = re.compile(r"[A-Za-z0-9_-]{1,64}")
VERSION_RE = re.compile(r"(\d{4}-\d{2}-\d{2})\.(\d+)")

PLAYOFF_TEAM = ("", "_abbreviation", "_logo")
STARTING_FIVE_TEAM = ("", "_logo")


class PublishError(Exception):
    """Anything that must stop a publish with nothing written."""


@dataclass(frozen=True)
class GameSpec:
    """How one game's rows are laid out as files.

    kind: "single" (one file) or "chunked" (``chunk_size`` rows per file).
    sort_key: canonical row order, so the bytes don't depend on DB order
        (None keeps the builder's order).
    refs: (prefix, lookup, suffixes) field groups moved into a lookup table.
    chunk_name: row -> file name, for chunk_size 1 (one stable file per row).
    """

    kind: str
    sort_key: object = None
    chunk_size: int = CHUNK_SIZE
    refs: tuple = ()
    chunk_name: object = None


GAMES = {
    # 912 series: ~19 chunks of ~48 rows, each spanning every era; one teams lookup.
    "playoff": GameSpec(
        "chunked",
        sort_key=lambda r: (r.get("season", ""), r.get("match_id", "")),
        refs=(("team_a", "teams", PLAYOFF_TEAM), ("team_b", "teams", PLAYOFF_TEAM)),
    ),
    # 30 teams / 71 MVPs: one small file each. The MVP rows repeat a team name +
    # logo URL, but in a single gzip'd file that repetition costs well under 1 KB,
    # less than the extra request a lookup file would add.
    "name-logo": GameSpec("single", sort_key=lambda r: r.get("team_id", 0)),
    "mvps": GameSpec("single", sort_key=lambda r: r.get("season", "")),
    "starting-five": GameSpec(
        "chunked",
        sort_key=lambda r: r.get("game_id", ""),
        refs=(("team_a", "teams", STARTING_FIVE_TEAM), ("team_b", "teams", STARTING_FIVE_TEAM)),
    ),
    # One board per file, named by qid: a game plays one board, and the live
    # re-ranking of one board then changes only that board's file.
    "fan-favorites": GameSpec(
        "chunked", sort_key=lambda r: r.get("qid", ""), chunk_size=1,
        chunk_name=lambda r: r["qid"],
    ),
    NAMES_GAME: GameSpec("single"),
}


@dataclass
class GameBuild:
    """One game's manifest entry plus the bytes of every file it references."""

    game: str
    rows: list
    entry: dict
    files: dict = field(default_factory=dict)


# ---------------------------------------------------------------- serialization

def canonical(obj):
    """Stable text form used for hashing, sorting and set comparison."""
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def dump(obj):
    """The exact bytes a published file holds (compact, UTF-8, sorted keys)."""
    return canonical(obj).encode("utf-8")


def sha256_hex(data):
    return hashlib.sha256(data).hexdigest()


def hashed_path(game_dir, name, data):
    """``<game_dir>/<name>.<sha12>.json`` for these bytes."""
    return f"{game_dir}/{name}.{sha256_hex(data)[:12]}.json"


# ------------------------------------------------------------- lookups / expand

def _entry_for(row, prefix, suffixes):
    if all(prefix + s in row for s in suffixes):
        return {s: row[prefix + s] for s in suffixes}
    return None


def encode_rows(rows, refs):
    """Replace each ref's field group with ``"<prefix>@<lookup>": index``.

    Returns (encoded_rows, lookups). Lossless by construction: a group is only
    encoded when every one of its fields is present, rows that already use "@"
    in a key are left untouched, and lookup entries carry the exact values.
    """
    if not refs:
        return list(rows), {}
    tables = {}
    for row in rows:
        if not isinstance(row, dict) or any("@" in k for k in row):
            continue
        work = dict(row)
        for prefix, lookup, suffixes in refs:
            entry = _entry_for(work, prefix, suffixes)
            if entry is None:
                continue
            tables.setdefault(lookup, {})[canonical(entry)] = entry
            for s in suffixes:
                del work[prefix + s]
    order = {name: sorted(t) for name, t in tables.items()}
    index = {name: {key: i for i, key in enumerate(keys)} for name, keys in order.items()}
    lookups = {name: [tables[name][key] for key in keys] for name, keys in order.items()}

    encoded = []
    for row in rows:
        if not isinstance(row, dict) or any("@" in k for k in row):
            encoded.append(row)
            continue
        out = dict(row)
        for prefix, lookup, suffixes in refs:
            entry = _entry_for(out, prefix, suffixes)
            if entry is None:
                continue
            for s in suffixes:
                del out[prefix + s]
            out[f"{prefix}@{lookup}"] = index[lookup][canonical(entry)]
        encoded.append(out)
    return encoded, lookups


def expand(rows, lookups):
    """Rebuild the builder's rows from encoded rows + lookups (see module docstring)."""
    out = []
    for row in rows:
        if not isinstance(row, dict):
            out.append(row)
            continue
        full = {}
        for key, value in row.items():
            prefix, sep, lookup = key.partition("@")
            if not sep:
                full[key] = value
                continue
            for suffix, v in lookups[lookup][value].items():
                full[prefix + suffix] = v
        out.append(full)
    return out


# ------------------------------------------------------------------- chunking

def _content_seed(rows):
    return int(sha256_hex(dump(rows))[:16], 16)


def split_chunks(rows, size, seed):
    """Deal canonically ordered rows round-robin into ceil(n/size) chunks.

    Round-robin over the sorted order means every chunk spans every era; each
    chunk is then shuffled with a seed derived from the content, so the same data
    always gives the same chunks (and the same file names).
    """
    count = max(1, math.ceil(len(rows) / size))
    chunks = [rows[i::count] for i in range(count)]
    rng = random.Random(seed)
    for chunk in chunks:
        rng.shuffle(chunk)
    return chunks


def encode_game(game, rows, spec=None):
    """Lay out one game's rows as content-addressed files + its manifest entry."""
    spec = spec or GAMES[game]
    ordered = list(rows)
    if spec.sort_key is not None:
        ordered.sort(key=lambda r: (spec.sort_key(r), canonical(r)))
    encoded, lookups = encode_rows(ordered, spec.refs)
    game_dir = NAMES_DIR if game == NAMES_GAME else game
    files = {}
    lookup_paths = {}
    for name in sorted(lookups):
        data = dump(lookups[name])
        path = hashed_path(game_dir, name, data)
        files[path] = data
        lookup_paths[name] = path

    if spec.kind == "single":
        data = dump(encoded)
        name = NAMES_NAME if game == NAMES_GAME else "all"
        path = hashed_path(game_dir, name, data)
        files[path] = data
        entry = {"kind": "single", "rows": len(rows), "file": path}
    elif spec.kind == "chunked":
        chunks = split_chunks(encoded, spec.chunk_size, _content_seed(ordered))
        width = max(2, len(str(len(chunks) - 1)))
        paths = []
        for i, chunk in enumerate(chunks):
            data = dump(chunk)
            name = f"c{i:0{width}d}"
            if spec.chunk_name and len(chunk) == 1:
                # A qid-style name keeps a row's file name stable when rows are
                # added or removed elsewhere; anything unsafe keeps the index name.
                own = str(spec.chunk_name(chunk[0]))
                name = own if SAFE_NAME.fullmatch(own) else name
            path = hashed_path(game_dir, name, data)
            files[path] = data
            paths.append(path)
        entry = {"kind": "chunked", "rows": len(rows), "chunk_size": spec.chunk_size,
                 "chunks": paths}
    else:  # "questions" lands here in the next phase.
        raise PublishError(f"{game}: unsupported kind {spec.kind!r}")
    if lookup_paths:
        entry["lookups"] = lookup_paths
    return GameBuild(game=game, rows=list(rows), entry=entry, files=files)


def entry_files(entry):
    """Every file path a manifest entry references."""
    paths = []
    if entry.get("file"):
        paths.append(entry["file"])
    paths.extend(entry.get("chunks") or [])
    paths.extend((entry.get("lookups") or {}).values())
    return paths


def decode_game(entry, read):
    """Rebuild a game's full rows from its entry; ``read(path) -> bytes``."""
    lookups = {name: json.loads(read(path)) for name, path in (entry.get("lookups") or {}).items()}
    rows = []
    if entry["kind"] == "single":
        rows = json.loads(read(entry["file"]))
    elif entry["kind"] == "chunked":
        for path in entry["chunks"]:
            rows.extend(json.loads(read(path)))
    else:
        raise PublishError(f"unsupported kind {entry['kind']!r}")
    return expand(rows, lookups)


def same_rows(a, b):
    """Equal as multisets of rows, field by field (row and key order ignored)."""
    return sorted(canonical(r) for r in a) == sorted(canonical(r) for r in b)


# ---------------------------------------------------------------- build rows

def winner_first(series):
    """Stable stand-in for build_playoff's coin flip: same series, same side."""
    digest = hashlib.sha256(f"{series.season}|{series.series_id}".encode("utf-8")).digest()
    return digest[0] % 2 == 0


def default_builders():
    """The existing pool builders (build_pools_from_db), keyed by game."""
    from trivia.management.commands import build_pools_from_db as pools

    return {
        "playoff": lambda: pools.build_playoff(winner_first=winner_first),
        "name-logo": pools.build_name_logo,
        "mvps": pools.build_mvps,
        "starting-five": pools.build_starting_five,
        "fan-favorites": pools.build_fan_favorites,
        NAMES_GAME: pools.build_all_players,
    }


def build_games(games, builders=None):
    """Build, validate, encode and self-check every selected game, or raise."""
    from trivia.data_pipeline.validate import validate_pool

    builders = builders or default_builders()
    unknown = [g for g in games if g not in GAMES]
    if unknown:
        raise PublishError(f"unknown game(s): {', '.join(unknown)} (known: {', '.join(GAMES)})")
    problems = []
    rows_by_game = {}
    for game in games:
        try:
            rows = builders[game]()
        except Exception as e:  # a crashing builder is a failed game, not a partial publish
            problems.append(f"{game}: builder failed: {e}")
            continue
        problems.extend(validate_pool(game, rows))
        rows_by_game[game] = rows
    if problems:
        raise PublishError("validation failed:\n  " + "\n  ".join(problems))

    builds = {}
    for game, rows in rows_by_game.items():
        build = encode_game(game, rows)
        if not same_rows(decode_game(build.entry, build.files.__getitem__), rows):
            raise PublishError(f"{game}: round-trip check failed (expand(rows, lookups) != builder rows)")
        builds[game] = build
    return builds


# ------------------------------------------------------- previous publication

class PreviousSource:
    """Where the live publication can be read from: a base URL or a local folder."""

    def __init__(self, location):
        location = location.rstrip("/\\")
        self.manifest_name = "manifest.json"
        if location.endswith(".json"):
            location, _, self.manifest_name = location.replace("\\", "/").rpartition("/")
        self.base = location
        self.is_url = location.startswith(("http://", "https://"))

    def __str__(self):
        return self.base

    def read(self, rel):
        """Bytes of ``rel`` under the base; None when it doesn't exist."""
        if self.is_url:
            url = f"{self.base}/{urllib.parse.quote(rel)}"
            req = urllib.request.Request(url, headers={"User-Agent": "nba-minigames-publisher"})
            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    return resp.read()
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    return None
                raise PublishError(f"GET {url} failed: HTTP {e.code}") from e
            except (urllib.error.URLError, TimeoutError, OSError) as e:
                raise PublishError(f"GET {url} failed: {e}") from e
        path = os.path.join(self.base, *rel.split("/"))
        if not os.path.isfile(path):
            return None
        with open(path, "rb") as f:
            return f.read()


def load_previous(source):
    """(manifest, history) of the live publication; (None, []) when there is none.

    A missing manifest (404 / no file) means a first publish. Any other failure
    raises: publishing a subset of games blind would drop every other game from
    the manifest.
    """
    if source is None:
        return None, []
    raw = source.read(source.manifest_name)
    if raw is None:
        return None, []
    try:
        manifest = json.loads(raw)
    except ValueError as e:
        raise PublishError(f"previous manifest at {source} is not JSON: {e}") from e
    if not isinstance(manifest, dict) or manifest.get("schema") != SCHEMA:
        raise PublishError(f"previous manifest at {source} is not schema {SCHEMA}")
    history = []
    raw_history = source.read("manifest-history.json")
    if raw_history is not None:
        try:
            parsed = json.loads(raw_history)
            history = [m for m in parsed if isinstance(m, dict)] if isinstance(parsed, list) else []
        except ValueError:
            history = []
    if not history or history[0].get("version") != manifest.get("version"):
        history = [manifest] + history
    return manifest, history[:HISTORY_LIMIT]


def manifest_entries(manifest):
    """{game: entry} of a manifest, with "names" folded in as the all-players game."""
    if not manifest:
        return {}
    entries = dict(manifest.get("games") or {})
    if manifest.get("names"):
        entries[NAMES_GAME] = {"kind": "single", "file": manifest["names"]}
    return entries


def manifest_files(manifest):
    return {p for entry in manifest_entries(manifest).values() for p in entry_files(entry)}


def _comparable(game, entry):
    # "names" is only a path in the manifest, so compare all-players by path.
    return {"file": entry.get("file")} if game == NAMES_GAME else entry


def diff_games(previous, builds):
    """Per built game: status new / changed / unchanged, total and new bytes."""
    prev_entries = manifest_entries(previous)
    prev_files = manifest_files(previous)
    report = []
    for game, build in builds.items():
        prev = prev_entries.get(game)
        if prev is None:
            status = "new"
        elif _comparable(game, prev) == _comparable(game, build.entry):
            status = "unchanged"
        else:
            status = "changed"
        new_files = [p for p in build.files if p not in prev_files]
        report.append({
            "game": game, "status": status, "rows": len(build.rows),
            "files": len(build.files),
            "bytes": sum(len(b) for b in build.files.values()),
            "new_files": len(new_files),
            "upload_bytes": sum(len(build.files[p]) for p in new_files),
        })
    return report


def next_version(previous_version, now):
    """``YYYY-MM-DD.N``: N+1 on the same UTC day as the previous version, else 1."""
    today = now.strftime("%Y-%m-%d")
    m = VERSION_RE.fullmatch(previous_version or "")
    if m and m.group(1) == today:
        return f"{today}.{int(m.group(2)) + 1}"
    return f"{today}.1"


def build_manifest(previous, builds, now):
    """The new manifest: built games replace their entries, others carry over."""
    entries = manifest_entries(previous)
    for game, build in builds.items():
        entries[game] = build.entry
    names = entries.pop(NAMES_GAME, None)
    manifest = {
        "schema": SCHEMA,
        "version": next_version((previous or {}).get("version"), now),
        "published_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "games": {g: entries[g] for g in sorted(entries)},
    }
    if names:
        manifest["names"] = names["file"]
    return manifest


# ------------------------------------------------------------- host config

def host_config(origins):
    """(vercel.json, _headers.json) for the deploy folder.

    CORS: a Vercel header rule can't echo the request's Origin, so with more than
    one site origin the public, read-only data files get ``*`` (they are public
    game data anyway; nothing is credentialed). One origin is used verbatim.
    _headers.json carries the same headers per object plus a bucket CORS block,
    for an R2/S3 target that sets metadata at upload time.
    """
    origins = list(dict.fromkeys(origins or []))
    allow = origins[0] if len(origins) == 1 else "*"
    cors = [{"key": "Access-Control-Allow-Origin", "value": allow}]
    vercel = {"headers": [
        {"source": r"/(.*)\.([0-9a-f]{12})\.json",
         "headers": [{"key": "Cache-Control", "value": IMMUTABLE_CACHE}] + cors},
        {"source": "/manifest.json",
         "headers": [{"key": "Cache-Control", "value": MANIFEST_CACHE}] + cors},
        {"source": "/manifest-history.json",
         "headers": [{"key": "Cache-Control", "value": MANIFEST_CACHE}] + cors},
    ]}
    r2 = {
        "cors": {"AllowedOrigins": [allow] if allow == "*" else origins,
                 "AllowedMethods": ["GET", "HEAD"], "MaxAgeSeconds": 86400},
        "objects": {},
    }
    return vercel, r2


def object_headers(path):
    cache = MANIFEST_CACHE if path in ("manifest.json", "manifest-history.json") else IMMUTABLE_CACHE
    return {"Cache-Control": cache, "Content-Type": JSON_CONTENT_TYPE}


# ------------------------------------------------------------------ output

def collect_files(manifest, history, builds, source, warn):
    """Every file the deploy folder must hold.

    A Vercel deploy is a full snapshot, so the folder holds the new manifest's
    complete file set (built locally, or fetched for games carried over — a
    failed fetch there aborts) plus the files of the previous KEEP_PREVIOUS
    manifests (fetched; a failure only warns).
    """
    files = {}
    for build in builds.values():
        files.update(build.files)
    required = manifest_files(manifest) - set(files)
    optional = set()
    for old in history[:KEEP_PREVIOUS]:
        optional |= manifest_files(old)
    optional -= set(files) | required

    def fetch(path):
        data = source.read(path) if source is not None else None
        if data is None:
            return None, "not found"
        m = HASHED_NAME.search(path)
        if m and sha256_hex(data)[:12] != m.group(1):
            return None, "content hash mismatch"
        return data, None

    for path in sorted(required):
        data, why = fetch(path)
        if data is None:
            raise PublishError(f"cannot fetch {path} from {source} ({why}); it is still in the manifest")
        files[path] = data
    for path in sorted(optional):
        try:
            data, why = fetch(path)
        except PublishError as e:
            data, why = None, str(e)
        if data is None:
            warn(f"skipping {path} from an older manifest ({why})")
            continue
        files[path] = data
    return files


def write_folder(out_dir, files, manifest, history, origins):
    """Write the deploy folder; the manifest goes last."""
    if os.path.isdir(out_dir) and os.listdir(out_dir):
        if not os.path.isfile(os.path.join(out_dir, "manifest.json")):
            raise PublishError(f"refusing to clear {out_dir}: not a previous publish folder")
        shutil.rmtree(out_dir)
    os.makedirs(out_dir, exist_ok=True)

    def write(rel, data):
        path = os.path.join(out_dir, *rel.split("/"))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(data)

    for rel in sorted(files):
        write(rel, files[rel])
    vercel, r2 = host_config(origins)
    for rel in sorted(files) + ["manifest-history.json", "manifest.json"]:
        r2["objects"][rel] = object_headers(rel)
    write("vercel.json", json.dumps(vercel, indent=2).encode("utf-8"))
    write("_headers.json", json.dumps(r2, indent=2).encode("utf-8"))
    write("manifest-history.json", dump(history))
    write("manifest.json", dump(manifest))


def publish(games, out_dir, previous=None, origins=(), builders=None, now=None,
            dry_run=False, warn=print):
    """Build, diff and (unless nothing changed or dry_run) write the deploy folder.

    Returns a report dict: result ("publish" | "nothing-to-publish"), version,
    games (per-game diff rows) and changed_files ([{path, sha256, bytes}]).
    Raises PublishError with nothing written on any failure.
    """
    now = now or datetime.now(timezone.utc)
    builds = build_games(games, builders)
    prev_manifest, prev_history = load_previous(previous)
    report_games = diff_games(prev_manifest, builds)
    prev_files = manifest_files(prev_manifest)
    changed_files = [
        {"path": p, "sha256": sha256_hex(b), "bytes": len(b)}
        for build in builds.values() for p, b in sorted(build.files.items()) if p not in prev_files
    ]
    report = {
        "result": "publish", "version": None, "games": report_games,
        "changed_files": changed_files, "previous_version": (prev_manifest or {}).get("version"),
    }
    if all(g["status"] == "unchanged" for g in report_games):
        report["result"] = "nothing-to-publish"
        return report
    manifest = build_manifest(prev_manifest, builds, now)
    report["version"] = manifest["version"]
    if dry_run:
        return report
    history = ([manifest] + prev_history)[:HISTORY_LIMIT]
    files = collect_files(manifest, prev_history, builds, previous, warn)
    write_folder(out_dir, files, manifest, history, origins)
    report["manifest_sha256"] = sha256_hex(dump(manifest))
    return report
