"""Rebuild players_curated.json from nba_api — resumable, one player at a time.

Replaces the hand-typed ROSTER that used to live in data_static/author_curated.py.
Every raw API response is cached under backend/.nba_api_cache/ (git-ignored), so
a re-run picks up exactly where the last one stopped and re-shaping a row costs
no network at all. A player whose fetch keeps failing is reported, never turned
into a null-filled row.

    manage.py generate_players_curated --fetch-only          # long background fetch
    manage.py generate_players_curated                       # assemble + write
    manage.py generate_players_curated --limit 3 --out /tmp/smoke.json
"""
import json
import os

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from trivia.data_pipeline import curated_players as curated
from trivia.data_pipeline.sources import (
    fetch_draft_history,
    fetch_franchise_history,
    fetch_player_profile,
    fetch_players,
)

PROGRESS_EVERY = 25


def _default_cache_dir():
    return os.path.join(settings.BASE_DIR, ".nba_api_cache")


def _curated_path():
    return os.path.join(settings.BASE_DIR, "trivia", "data_static", "players_curated.json")


def _all_players_path():
    return os.path.join(settings.BASE_DIR, "trivia", "data", "all-players.json")


def _load_json(path, default):
    if not os.path.exists(path):
        return default
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _write_json(path, data, indent=1):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=indent)


class Command(BaseCommand):
    help = (
        "Rebuild trivia/data_static/players_curated.json from nba_api "
        "(drafthistory + franchisehistory in bulk, then commonplayerinfo + "
        "playercareerstats + playerawards per player). Resumable: already-cached "
        "players are skipped, so the full run can be stopped and restarted."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--limit", type=int, default=None,
            help="Process only the first N players (smoke test). Needs --out.",
        )
        parser.add_argument(
            "--player-ids", default=None,
            help="Comma-separated person_ids to process instead of the whole league. Needs --out.",
        )
        parser.add_argument(
            "--out", default=None,
            help=f"Where to write the dataset (default: {_curated_path()}).",
        )
        parser.add_argument(
            "--cache-dir", default=None,
            help=f"Raw-response cache directory (default: {_default_cache_dir()}).",
        )
        parser.add_argument(
            "--fetch-only", action="store_true",
            help="Populate the cache and stop — no assembly, nothing written.",
        )
        parser.add_argument(
            "--rewrite-all-players", action="store_true",
            help="Also rewrite trivia/data/all-players.json to the canonical accented "
                 "names (complete, problem-free runs only).",
        )

    def handle(self, *args, **opts):
        out_path = opts["out"] or _curated_path()
        partial = bool(opts["limit"] or opts["player_ids"])
        if partial and not opts["out"]:
            raise CommandError(
                "--limit/--player-ids build a PARTIAL dataset; pass --out to a scratch "
                "path so the published players_curated.json is never half-written."
            )

        cache = curated.ProfileCache(opts["cache_dir"] or _default_cache_dir())
        roster = cache.bulk("roster", fetch_players)
        person_ids = sorted({r["person_id"] for r in roster})
        if opts["player_ids"]:
            wanted = {int(p) for p in opts["player_ids"].split(",") if p.strip()}
            person_ids = [p for p in person_ids if p in wanted]
            missing = wanted - set(person_ids)
            if missing:
                raise CommandError(f"person_ids not in the league index: {sorted(missing)}")
        elif opts["limit"]:
            person_ids = person_ids[: opts["limit"]]
        self.stdout.write(f"league index: {len(roster)} players; processing {len(person_ids)}")

        drafts = curated.draft_index(cache.bulk("draft_history", fetch_draft_history))
        eras = curated.era_name_index(cache.bulk("franchise_history", fetch_franchise_history))
        abbrs = curated.modern_abbr_index()
        self.stdout.write(f"draft picks: {len(drafts)}; franchise name eras: {sum(len(v) for v in eras.values())}")

        fetched, skipped, failures = curated.fetch_missing(
            person_ids, cache, fetch_player_profile, on_progress=self._progress
        )
        self.stdout.write(
            f"fetched {fetched}, already cached {skipped}, failed {len(failures)}"
        )
        if failures:
            path = cache.write_failures(failures)
            self.stderr.write(self.style.ERROR(
                f"{len(failures)} player(s) failed to fetch — recorded in {path}. "
                f"Re-run to retry them (cached players are skipped)."
            ))

        if opts["fetch_only"]:
            self.stdout.write(self.style.SUCCESS("Fetch-only run finished; nothing written."))
            return

        carry = curated.carry_over_index(_load_json(_curated_path(), []))
        rows, uncached, draft_gaps = curated.assemble_rows(
            person_ids, cache, drafts, eras, abbrs, carry
        )
        self.stdout.write(
            f"assembled {len(rows)} rows ({len(uncached)} without a cached profile, "
            f"{len(draft_gaps)} drafted players missing a draft-history pick)"
        )

        problems = curated.check_cross_stints(rows) + curated.check_plausibility(rows)
        all_players = _load_json(_all_players_path(), [])
        if not partial:
            problems += curated.check_parity(rows, all_players)
        for problem in problems[:20]:
            self.stdout.write(f"  - {problem}")
        if len(problems) > 20:
            self.stdout.write(f"  ...and {len(problems) - 20} more")

        # A dataset that fails its own gate never overwrites the published one,
        # but a run that cost hours of fetching is never thrown away either.
        if problems:
            out_path = f"{out_path}.rejected.json"
        _write_json(out_path, rows)
        self.stdout.write(f"wrote {len(rows)} rows to {out_path}")

        if opts["rewrite_all_players"]:
            self._rewrite_all_players(rows, all_players, partial, problems, uncached, failures)

        if problems or failures or uncached:
            raise CommandError(
                f"{len(problems)} validation problem(s), {len(failures)} fetch failure(s), "
                f"{len(uncached)} player(s) with no profile"
            )
        self.stdout.write(self.style.SUCCESS(f"players_curated.json rebuilt: {len(rows)} rows"))

    def _progress(self, done, total, fetched, skipped, failed):
        if done % PROGRESS_EVERY and done != total:
            return
        self.stdout.write(
            f"  [{done}/{total}] fetched={fetched} cached={skipped} failed={failed}"
        )

    def _rewrite_all_players(self, rows, all_players, partial, problems, uncached, failures):
        """Rewrite all-players.json to the canonical accented names, in place.

        Names are matched accent-blind, so 'Jonas Valanciunas' becomes 'Jonas
        Valančiūnas' without reordering the file; genuinely new players are
        appended. Only ever runs on a complete, problem-free dataset.
        """
        if partial or problems or uncached or failures:
            raise CommandError(
                "--rewrite-all-players needs a complete, problem-free run "
                "(no --limit/--player-ids, no validation problems, no failures)."
            )
        by_folded = {}
        for row in rows:
            for name in [row["full_name"]] + list(row["aliases"]):
                by_folded.setdefault(curated.ascii_fold(name).casefold(), row["full_name"])
        names = []
        seen = set()
        for name in all_players:
            canonical = by_folded.get(curated.ascii_fold(name).casefold())
            if canonical and canonical not in seen:
                names.append(canonical)
                seen.add(canonical)
        for row in rows:
            if row["full_name"] not in seen:
                names.append(row["full_name"])
                seen.add(row["full_name"])
        _write_json(_all_players_path(), names, indent=None)
        self.stdout.write(f"rewrote all-players.json with {len(names)} canonical names")
