"""Build the manifest-v3 game-data folder for the static data host.

Builds the selected games from the DB, validates them, lays them out as
content-addressed files (trivia/data_pipeline/publish_v3.py), diffs against the
live manifest and writes a deploy folder (default build/game-data) for
.github/workflows/publish-game-data.yml to upload. Uploads nothing itself and
never calls the NBA website: needs only DATABASE_URL + DJANGO_SECRET_KEY (plus
DATA_PUBLIC_BASE to diff against the live publication).

Games: the pool games (playoff, name-logo, mvps, starting-five, fan-favorites,
all-players) and the question games (career-path, who-are-ya, tictactoe,
contexto, plus their names list question-names, added automatically with any of
them). For the question games the run first does the question maintenance
(trivia/questions/runner.maintain: re-materialize, retire, top up, minimum gate)
against the committed curated dataset, in ONE transaction with every game's
build: a gate or build failure rolls the maintenance back and writes nothing.
``--skip-maintain`` publishes the current active questions instead (read-only).
``--no-commit`` writes the folder but rolls the DB writes back (workflow dry runs).

Exit codes: 0 with "nothing to publish" when no selected game changed (and
``result=nothing-to-publish`` in $GITHUB_OUTPUT); non-zero with nothing written
on any maintenance/build/validation/fetch failure.

``--check-only`` is the daily freshness check (.github/workflows/game-data-freshness.yml):
it builds the rows read-only (no DB writes: Fan Favorites re-ranked in memory,
question games materialized from their current rows, no maintenance), diffs them
against the live manifest, writes only the optional --report JSON and always
exits 0, with ``result=fresh|stale|unknown`` and ``stale=<games>`` in $GITHUB_OUTPUT.
"""

import json
import os
import random

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from trivia.data_pipeline import publish_v3
from trivia.questions import runner


class Command(BaseCommand):
    help = "Build the manifest-v3 game-data deploy folder (pool and question games)."

    def add_arguments(self, parser):
        parser.add_argument("--games", default="",
                            help=f"Comma-separated games (default all: {','.join(publish_v3.ALL_GAMES)})")
        parser.add_argument("--skip-maintain", action="store_true",
                            help="Question games: publish the current active questions without the "
                                 "maintenance (no retire / top-up, no DB writes for them)")
        parser.add_argument("--no-commit", action="store_true",
                            help="Write the folder but roll back every DB write of this run "
                                 "(question maintenance, Fan Favorites re-rank); for dry runs")
        parser.add_argument("--rng-seed", type=int, default=None,
                            help="Seed for the question top-up generator (tests / reproducible runs)")
        parser.add_argument("--out", default=os.path.join("build", "game-data"),
                            help="Deploy folder to write (default build/game-data)")
        parser.add_argument("--previous", default=None,
                            help="Live manifest to diff against: URL or path (default "
                                 "$DATA_PUBLIC_BASE/manifest.json; none = everything is new)")
        parser.add_argument("--report", default=None,
                            help="JSON report path (default game-data-report.json next to --out)")
        parser.add_argument("--dry-run", action="store_true",
                            help="Build, validate and diff only; write nothing")
        parser.add_argument("--check-only", action="store_true",
                            help="Read-only freshness check: no DB writes, no folder; reports which "
                                 "games differ from the live manifest (JSON only with --report) and "
                                 "always exits 0")

    def handle(self, *args, **opts):
        games = [g.strip() for g in opts["games"].split(",") if g.strip()] or list(publish_v3.ALL_GAMES)
        games = publish_v3.with_question_names(games)
        if opts["check_only"]:
            return self._check(games, opts)
        out_dir = os.path.abspath(opts["out"])
        report_path = opts["report"] or os.path.join(os.path.dirname(out_dir), "game-data-report.json")
        location = opts["previous"] or os.environ.get("DATA_PUBLIC_BASE", "").strip() or None
        previous = publish_v3.PreviousSource(location) if location else None
        self.stdout.write(f"Games: {', '.join(games)}")
        self.stdout.write(f"Previous publication: {previous or 'none (everything is new)'}")

        unknown = [g for g in games if g not in publish_v3.SPECS]
        if unknown:
            raise CommandError(f"Publish aborted, nothing written: unknown game(s): {', '.join(unknown)} "
                               f"(known: {', '.join(publish_v3.SPECS)})")
        to_maintain = [] if opts["skip_maintain"] else [g for g in games if g in publish_v3.QUESTION_GAMES]
        rollback = opts["dry_run"] or opts["no_commit"]
        try:
            # Maintenance and every game's build share one transaction: the minimum
            # gate or any build/validation failure rolls the question writes back.
            with transaction.atomic():
                maintained, dataset = {}, None
                if to_maintain:
                    dataset = publish_v3.curated_dataset()
                    self.stdout.write(f"Question maintenance ({', '.join(to_maintain)}) against dataset "
                                      f"{dataset.version}: {len(dataset.playable)} playable players")
                    maintained, _ = runner.maintain(to_maintain, dataset, random.Random(opts["rng_seed"]),
                                                    out=self.stdout.write)
                builds = publish_v3.build_games(
                    games, publish_v3.default_builders(maintained=maintained, dataset=dataset))
                if rollback:
                    transaction.set_rollback(True)
                    self.stdout.write("  DB writes of this run rolled back (--dry-run / --no-commit)")
            report = publish_v3.publish(
                games, out_dir, previous=previous,
                origins=getattr(settings, "CORS_ALLOWED_ORIGINS", []),
                dry_run=opts["dry_run"], builds=builds,
                warn=lambda msg: self.stdout.write(self.style.WARNING(f"  warning: {msg}")),
            )
        except runner.BelowMinimum as e:
            raise CommandError(f"Publish aborted, nothing written, question maintenance rolled back: {e}") from e
        except publish_v3.PublishError as e:
            raise CommandError(f"Publish aborted, nothing written: {e}") from e

        self._print_table(report)
        _github_output({"result": report["result"], "version": report["version"] or ""})
        _github_summary(report)
        if report["result"] == "nothing-to-publish":
            self.stdout.write(self.style.SUCCESS("nothing to publish"))
            return
        if opts["dry_run"]:
            self.stdout.write(self.style.SUCCESS(f"Dry run: would publish version {report['version']}"))
            return
        os.makedirs(os.path.dirname(report_path), exist_ok=True)
        with open(report_path, "w", encoding="utf-8") as f:
            json.dump(report, f, indent=2)
        _github_output({"report": report_path, "out": out_dir})
        self.stdout.write(self.style.SUCCESS(
            f"Wrote {out_dir} (version {report['version']}); report {report_path}"))

    def _check(self, games, opts):
        """--check-only: never writes to the DB or the deploy folder, never fails."""
        location = opts["previous"] or os.environ.get("DATA_PUBLIC_BASE", "").strip() or None
        self.stdout.write(f"Freshness check: {', '.join(games)} vs {location or '(no live manifest)'}")
        try:
            previous = publish_v3.PreviousSource(location) if location else None
            report = publish_v3.check(games, previous=previous)
        except Exception as e:  # the check must never fail the job
            report = {"result": "unknown", "live_version": None, "stale": [],
                      "error": f"check crashed: {e}",
                      "games": [{"game": g, "status": "unknown", "rows": 0, "bytes": 0} for g in games]}
        for g in report["games"]:
            self.stdout.write(f"{g['game']:<15} {g['status']:<10} {g['rows']:>6} {g['bytes']:>9}"
                              + (f"  {g['error']}" if g.get("error") else ""))
        if report.get("error"):
            self.stdout.write(self.style.WARNING(f"  warning: {report['error']}"))
        stale = ",".join(report["stale"])
        self.stdout.write(f"result: {report['result']}" + (f" (stale: {stale})" if stale else "")
                          + f"; live version {report.get('live_version') or 'unknown'}")
        if opts["report"]:
            try:
                os.makedirs(os.path.dirname(os.path.abspath(opts["report"])), exist_ok=True)
                with open(opts["report"], "w", encoding="utf-8") as f:
                    json.dump(report, f, indent=2)
            except OSError as e:
                self.stdout.write(self.style.WARNING(f"  warning: could not write report: {e}"))
        _github_output({"result": report["result"], "stale": stale,
                        "live_version": report.get("live_version") or ""})
        lines = [f"### Game data freshness: {report['result']}"
                 + (f" (live version {report['live_version']})" if report.get("live_version") else ""),
                 "", "| game | status | rows | bytes |", "|---|---|---:|---:|"]
        lines += [f"| {g['game']} | {g['status']} | {g['rows']} | {g['bytes']} |" for g in report["games"]]
        if report.get("error"):
            lines += ["", f"Warning: {report['error']}"]
        _github_summary_lines(lines)

    def _print_table(self, report):
        self.stdout.write(f"{'game':<15} {'status':<10} {'rows':>6} {'files':>6} {'bytes':>9} {'upload':>9}")
        for g in report["games"]:
            self.stdout.write(f"{g['game']:<15} {g['status']:<10} {g['rows']:>6} {g['files']:>6} "
                              f"{g['bytes']:>9} {g['upload_bytes']:>9}")


def _github_output(values):
    path = os.environ.get("GITHUB_OUTPUT")
    if not path:
        return
    with open(path, "a", encoding="utf-8") as f:
        for key, value in values.items():
            f.write(f"{key}={value}\n")


def _github_summary(report):
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not path:
        return
    lines = [f"### Game data: {report['result']}"
             + (f" (version {report['version']})" if report["version"] else ""), "",
             "| game | status | rows | bytes | upload bytes |", "|---|---|---:|---:|---:|"]
    lines += [f"| {g['game']} | {g['status']} | {g['rows']} | {g['bytes']} | {g['upload_bytes']} |"
              for g in report["games"]]
    with open(path, "a", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n\n")


def _github_summary_lines(lines):
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not path:
        return
    try:
        with open(path, "a", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n\n")
    except OSError:
        pass
