import copy
import json
import os
import tempfile
from datetime import datetime, timezone
from io import StringIO
from unittest.mock import patch

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase

from trivia.data_pipeline import publish_v3
from trivia.data_pipeline.publish_v3 import (
    GAMES,
    NAMES_GAME,
    PreviousSource,
    PublishError,
    build_games,
    decode_game,
    encode_game,
    expand,
    host_config,
    next_version,
    publish,
    same_rows,
)
from trivia.data_pipeline.starting_five import is_playable_lineup
from trivia.management.commands import build_pools_from_db
from trivia.models import FanFavoritesQuestion, Mvp, PlayoffSeries, StartingFiveGame, Team
from trivia.tests.published_pool import published_pool

DAY = datetime(2026, 10, 2, 9, 0, tzinfo=timezone.utc)


def _committed():
    """The committed pools (backend/trivia/data/*.json) = current builder output."""
    return {game: published_pool(game) for game in GAMES}


def _builders(rows_by_game):
    return {game: (lambda rows=rows: copy.deepcopy(rows)) for game, rows in rows_by_game.items()}


def _read_dir(out_dir):
    def read(rel):
        with open(os.path.join(out_dir, *rel.split("/")), "rb") as f:
            return f.read()
    return read


def _load(out_dir, name):
    with open(os.path.join(out_dir, name), encoding="utf-8") as f:
        return json.load(f)


class LosslessRoundTripTests(TestCase):
    """expand(chunks, lookups) == builder rows for EVERY game, on the real current data."""

    def setUp(self):
        self.pools = _committed()

    def _assert_round_trip(self, game):
        rows = self.pools[game]
        build = encode_game(game, rows)
        rebuilt = decode_game(build.entry, build.files.__getitem__)
        self.assertEqual(len(rebuilt), len(rows), game)
        if rows and isinstance(rows[0], dict):
            # Field by field: every original row has an identical rebuilt twin.
            remaining = [publish_v3.canonical(r) for r in rebuilt]
            for row in rows:
                key = publish_v3.canonical(row)
                self.assertIn(key, remaining, f"{game}: lost or altered row {key[:200]}")
                remaining.remove(key)
        self.assertTrue(same_rows(rebuilt, rows), game)
        return build

    def test_playoff(self):
        build = self._assert_round_trip("playoff")
        self.assertIn("teams", build.entry["lookups"])

    def test_name_logo(self):
        self._assert_round_trip("name-logo")

    def test_mvps(self):
        self._assert_round_trip("mvps")

    def test_starting_five(self):
        build = self._assert_round_trip("starting-five")
        self.assertIn("teams", build.entry["lookups"])

    def test_fan_favorites(self):
        self._assert_round_trip("fan-favorites")

    def test_all_players(self):
        build = self._assert_round_trip(NAMES_GAME)
        self.assertTrue(build.entry["file"].startswith("shared/players-names."))

    def test_lookup_rows_carry_no_repeated_team_fields(self):
        build = encode_game("playoff", self.pools["playoff"])
        chunk = json.loads(build.files[build.entry["chunks"][0]])
        self.assertIn("team_a@teams", chunk[0])
        self.assertNotIn("team_a_logo", chunk[0])
        self.assertNotIn("team_b_abbreviation", chunk[0])

    def test_a_lost_field_is_detected(self):
        build = encode_game("playoff", self.pools["playoff"])
        lookup_path = build.entry["lookups"]["teams"]
        teams = json.loads(build.files[lookup_path])
        del teams[0]["_logo"]
        files = dict(build.files, **{lookup_path: json.dumps(teams).encode()})
        self.assertFalse(same_rows(decode_game(build.entry, files.__getitem__), self.pools["playoff"]))

    def test_expand_passes_unreferenced_rows_and_strings_through(self):
        lookups = {"teams": [{"": "Boston Celtics", "_logo": "x.svg"}]}
        self.assertEqual(
            expand([{"team_a@teams": 0, "season": "2008"}, "Larry Bird"], lookups),
            [{"team_a": "Boston Celtics", "team_a_logo": "x.svg", "season": "2008"}, "Larry Bird"],
        )

    def test_partial_group_is_left_unencoded(self):
        rows = [{"team_a": "A", "team_a_logo": "a.svg", "team_b": "B"}]  # no team_b_logo
        build = encode_game("starting-five", rows, spec=publish_v3.GameSpec(
            "single", refs=GAMES["starting-five"].refs))
        stored = json.loads(build.files[build.entry["file"]])
        self.assertIn("team_b", stored[0])
        self.assertTrue(same_rows(decode_game(build.entry, build.files.__getitem__), rows))


class LayoutTests(TestCase):
    def setUp(self):
        self.pools = _committed()

    def test_content_address_names_are_stable_and_match_the_bytes(self):
        rows = self.pools["playoff"]
        a = encode_game("playoff", rows)
        b = encode_game("playoff", list(reversed(rows)))  # DB order doesn't matter
        self.assertEqual(a.entry, b.entry)
        self.assertEqual(a.files, b.files)
        for path, data in a.files.items():
            self.assertRegex(path, r"^playoff/[a-z0-9-]+\.[0-9a-f]{12}\.json$")
            self.assertEqual(path.rsplit(".", 2)[1], publish_v3.sha256_hex(data)[:12])
            self.assertNotIn(b"\n", data)  # compact

    def test_playoff_chunks_are_small_and_mix_eras(self):
        build = encode_game("playoff", self.pools["playoff"])
        chunks = [json.loads(build.files[p]) for p in build.entry["chunks"]]
        self.assertEqual(sum(len(c) for c in chunks), len(self.pools["playoff"]))
        self.assertTrue(all(len(c) <= 50 for c in chunks))
        for chunk in chunks:
            seasons = sorted(r["season"] for r in chunk)
            self.assertLess(seasons[0], "1990")
            self.assertGreater(seasons[-1], "2010")

    def test_fan_favorites_is_one_file_per_board_named_by_qid(self):
        rows = self.pools["fan-favorites"]
        build = encode_game("fan-favorites", rows)
        self.assertEqual(len(build.entry["chunks"]), len(rows))
        self.assertTrue(build.entry["chunks"][0].startswith(f"fan-favorites/{rows[0]['qid']}."))
        changed = copy.deepcopy(rows)
        changed[3]["answers"][0]["count"] += 1
        after = encode_game("fan-favorites", changed)
        self.assertEqual(len(set(after.entry["chunks"]) - set(build.entry["chunks"])), 1)

    def test_versions_bump_per_day(self):
        self.assertEqual(next_version(None, DAY), "2026-10-02.1")
        self.assertEqual(next_version("2026-10-02.3", DAY), "2026-10-02.4")
        self.assertEqual(next_version("2026-10-01.7", DAY), "2026-10-02.1")
        self.assertEqual(next_version("garbage", DAY), "2026-10-02.1")

    def test_host_config_headers_and_cors(self):
        vercel, r2 = host_config(["https://a.example", "https://b.example"])
        rules = {r["source"]: {h["key"]: h["value"] for h in r["headers"]} for r in vercel["headers"]}
        immutable = rules[r"/(.*)\.([0-9a-f]{12})\.json"]
        self.assertEqual(immutable["Cache-Control"], "public, max-age=31536000, immutable")
        self.assertEqual(immutable["Access-Control-Allow-Origin"], "*")
        self.assertEqual(rules["/manifest.json"]["Cache-Control"], "public, max-age=60")
        self.assertEqual(rules["/manifest-history.json"]["Cache-Control"], "public, max-age=60")
        single, _ = host_config(["https://a.example"])
        self.assertEqual(single["headers"][0]["headers"][1]["value"], "https://a.example")
        self.assertEqual(r2["cors"]["AllowedMethods"], ["GET", "HEAD"])


class PublishFlowTests(TestCase):
    def setUp(self):
        self.pools = _committed()
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.tmp = self._tmp.name

    def _publish(self, out, pools=None, previous=None, games=None, now=DAY):
        pools = pools or self.pools
        return publish(
            games or list(GAMES), os.path.join(self.tmp, out),
            previous=PreviousSource(os.path.join(self.tmp, previous)) if previous else None,
            origins=["https://a.example", "https://b.example"],
            builders=_builders(pools), now=now, warn=lambda m: None,
        )

    def test_first_publish_writes_folder_with_everything_new(self):
        report = self._publish("v1")
        out = os.path.join(self.tmp, "v1")
        self.assertEqual(report["result"], "publish")
        self.assertEqual({g["status"] for g in report["games"]}, {"new"})
        manifest = _load(out, "manifest.json")
        self.assertEqual(manifest["schema"], 3)
        self.assertEqual(manifest["version"], "2026-10-02.1")
        self.assertEqual(manifest["published_at"], "2026-10-02T09:00:00Z")
        self.assertEqual(sorted(manifest["games"]), sorted(set(GAMES) - {NAMES_GAME}))
        self.assertTrue(manifest["names"].startswith("shared/players-names."))
        self.assertEqual(manifest["games"]["mvps"]["kind"], "single")
        self.assertEqual(manifest["games"]["playoff"]["kind"], "chunked")
        self.assertEqual(_load(out, "manifest-history.json"), [manifest])
        self.assertTrue(os.path.isfile(os.path.join(out, "vercel.json")))
        headers = _load(out, "_headers.json")
        self.assertEqual(headers["objects"]["manifest.json"]["Cache-Control"], "public, max-age=60")
        # The published folder rebuilds every game exactly.
        for game, entry in manifest["games"].items():
            self.assertTrue(same_rows(decode_game(entry, _read_dir(out)), self.pools[game]), game)

    def test_same_data_again_is_nothing_to_publish_and_writes_nothing(self):
        self._publish("v1")
        report = self._publish("v2", previous="v1")
        self.assertEqual(report["result"], "nothing-to-publish")
        self.assertEqual({g["status"] for g in report["games"]}, {"unchanged"})
        self.assertFalse(os.path.exists(os.path.join(self.tmp, "v2")))

    def test_diff_reports_changed_unchanged_and_new(self):
        self._publish("v1", games=["playoff", "mvps", NAMES_GAME])
        pools = copy.deepcopy(self.pools)
        pools["mvps"][0]["mvp"] = "Someone Else"
        report = self._publish("v2", pools=pools, previous="v1")
        status = {g["game"]: g for g in report["games"]}
        self.assertEqual(status["mvps"]["status"], "changed")
        self.assertGreater(status["mvps"]["upload_bytes"], 0)
        self.assertEqual(status["playoff"]["status"], "unchanged")
        self.assertEqual(status["playoff"]["upload_bytes"], 0)
        self.assertEqual(status["name-logo"]["status"], "new")
        self.assertEqual(_load(os.path.join(self.tmp, "v2"), "manifest.json")["version"], "2026-10-02.2")
        changed = {f["path"] for f in report["changed_files"]}
        self.assertIn(_load(os.path.join(self.tmp, "v2"), "manifest.json")["games"]["mvps"]["file"], changed)

    def test_publishing_one_game_carries_the_others_over(self):
        self._publish("v1")
        pools = copy.deepcopy(self.pools)
        pools["mvps"][0]["mvp"] = "Someone Else"
        self._publish("v2", pools=pools, previous="v1", games=["mvps"])
        out = os.path.join(self.tmp, "v2")
        old, new = _load(os.path.join(self.tmp, "v1"), "manifest.json"), _load(out, "manifest.json")
        self.assertEqual(new["games"]["playoff"], old["games"]["playoff"])
        self.assertEqual(new["names"], old["names"])
        self.assertNotEqual(new["games"]["mvps"], old["games"]["mvps"])
        # The carried-over files were fetched into the deploy folder.
        self.assertTrue(same_rows(decode_game(new["games"]["playoff"], _read_dir(out)), self.pools["playoff"]))
        # The old mvps file stays for clients holding the previous manifest.
        self.assertTrue(os.path.isfile(os.path.join(out, *old["games"]["mvps"]["file"].split("/"))))

    def test_a_missing_carried_over_file_aborts(self):
        self._publish("v1")
        old = _load(os.path.join(self.tmp, "v1"), "manifest.json")
        os.remove(os.path.join(self.tmp, "v1", *old["games"]["playoff"]["chunks"][0].split("/")))
        pools = copy.deepcopy(self.pools)
        pools["mvps"][0]["mvp"] = "Someone Else"
        with self.assertRaises(PublishError):
            self._publish("v2", pools=pools, previous="v1", games=["mvps"])
        self.assertFalse(os.path.exists(os.path.join(self.tmp, "v2")))

    def test_history_keeps_five_and_files_of_three_previous_manifests(self):
        previous = None
        manifests = []
        for i in range(7):
            pools = copy.deepcopy(self.pools)
            pools["mvps"][0]["mvp"] = f"Variant {i}"
            out = f"run{i}"
            self._publish(out, pools=pools, previous=previous)
            manifests.append(_load(os.path.join(self.tmp, out), "manifest.json"))
            previous = out
        last = os.path.join(self.tmp, previous)
        history = _load(last, "manifest-history.json")
        self.assertEqual(len(history), 5)
        self.assertEqual([m["version"] for m in history],
                         [f"2026-10-02.{n}" for n in (7, 6, 5, 4, 3)])
        mvp_file = lambda m: os.path.join(last, *m["games"]["mvps"]["file"].split("/"))
        for kept in manifests[-4:]:  # current + previous 3
            self.assertTrue(os.path.isfile(mvp_file(kept)), kept["version"])
        for dropped in manifests[:3]:
            self.assertFalse(os.path.isfile(mvp_file(dropped)), dropped["version"])

    def test_failing_validation_aborts_with_no_output(self):
        pools = dict(self.pools, playoff=[])
        with self.assertRaises(PublishError) as ctx:
            self._publish("v1", pools=pools)
        self.assertIn("playoff", str(ctx.exception))
        self.assertFalse(os.path.exists(os.path.join(self.tmp, "v1")))

    def test_unknown_game_is_rejected(self):
        with self.assertRaises(PublishError):
            self._publish("v1", games=["wordle"])


class PublishCommandTests(TestCase):
    def setUp(self):
        self.pools = _committed()
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.tmp = self._tmp.name
        patcher = patch.object(publish_v3, "default_builders", return_value=_builders(self.pools))
        patcher.start()
        self.addCleanup(patcher.stop)
        env = patch.dict(os.environ, {"GITHUB_OUTPUT": os.path.join(self.tmp, "gh-output")})
        env.start()
        self.addCleanup(env.stop)
        os.environ.pop("DATA_PUBLIC_BASE", None)
        os.environ.pop("GITHUB_STEP_SUMMARY", None)

    def _call(self, *args):
        out = StringIO()
        call_command("publish_game_data_v3", *args, stdout=out)
        return out.getvalue()

    def _gh_output(self):
        with open(os.environ["GITHUB_OUTPUT"], encoding="utf-8") as f:
            return f.read()

    def test_publish_then_nothing_to_publish(self):
        out1 = os.path.join(self.tmp, "a")
        self._call("--out", out1)
        self.assertTrue(os.path.isfile(os.path.join(out1, "manifest.json")))
        report = _load(self.tmp, "game-data-report.json")
        self.assertEqual(report["result"], "publish")
        self.assertIn("result=publish", self._gh_output())

        out2 = os.path.join(self.tmp, "b")
        output = self._call("--out", out2, "--previous", os.path.join(out1, "manifest.json"))
        self.assertIn("nothing to publish", output)
        self.assertFalse(os.path.exists(out2))
        self.assertIn("result=nothing-to-publish", self._gh_output())

    def test_failing_validation_exits_non_zero_with_nothing_written(self):
        self.pools["fan-favorites"] = [{"qid": "ff-x", "prompt": "p", "answers": []}]
        out = os.path.join(self.tmp, "a")
        with patch.object(publish_v3, "default_builders", return_value=_builders(self.pools)):
            with self.assertRaises(CommandError):
                self._call("--out", out)
        self.assertFalse(os.path.exists(out))
        self.assertFalse(os.path.exists(os.path.join(self.tmp, "game-data-report.json")))

    def test_dry_run_writes_nothing(self):
        out = os.path.join(self.tmp, "a")
        output = self._call("--out", out, "--dry-run", "--games", "mvps,name-logo")
        self.assertIn("Dry run", output)
        self.assertFalse(os.path.exists(out))


def _series(season, sid, winner, loser, loser_wins=2, total=6, rnd="First Round"):
    return PlayoffSeries.objects.create(
        season=season, series_id=sid, round=rnd,
        winner_team_id=winner[0], winner_name=winner[1], winner_abbreviation=winner[2],
        loser_team_id=loser[0], loser_name=loser[1], loser_abbreviation=loser[2],
        loser_wins=loser_wins, total_games=total,
    )


class RealBuildersTests(TestCase):
    """The publisher runs the existing builders against the DB and stays lossless."""

    GOOD = [
        {"name": "Stephen Curry", "position": "G"},
        {"name": "Klay Thompson", "position": "G"},
        {"name": "Draymond Green", "position": "F"},
        {"name": "Andrew Wiggins", "position": "F"},
        {"name": "Kevon Looney", "position": "C"},
    ]

    def setUp(self):
        names = ["Bojan Bogdanovic", "Stephen Curry", "Klay Thompson"]
        patcher = patch.object(build_pools_from_db, "build_all_players", return_value=names)
        patcher.start()
        self.addCleanup(patcher.stop)
        gsw = (1610612744, "Golden State Warriors", "GSW")
        bos = (1610612738, "Boston Celtics", "BOS")
        lal = (1610612747, "Los Angeles Lakers", "LAL")
        _series("1985-86", "1985-86-a", bos, lal)
        _series("2021-22", "2021-22-b", gsw, bos, rnd="NBA Finals")
        _series("2016-17", "2016-17-c", gsw, lal, loser_wins=0, total=4)
        Team.objects.create(team_id=gsw[0], full_name=gsw[1], abbreviation=gsw[2])
        Mvp.objects.create(season="2015-16", mvp="Stephen Curry", team="Golden State Warriors",
                           team_logo_url="https://example.com/gsw.png")
        game = {"game_date": "2022-01-01", "team_a": gsw[1], "team_b": bos[1],
                "team_a_logo": "https://cdn/gsw.svg", "team_b_logo": "https://cdn/bos.svg",
                "final_score": "100 - 90", "winning_team": gsw[1]}
        StartingFiveGame.objects.create(game_id="good", starting_5=self.GOOD, **game)
        StartingFiveGame.objects.create(
            game_id="accents", starting_5=[dict(self.GOOD[0], name="Bojan Bogdanović")] + self.GOOD[1:],
            **game)
        StartingFiveGame.objects.create(  # three guards, no center: unwinnable
            game_id="bad", starting_5=self.GOOD[:2] + [dict(self.GOOD[0], name="Jordan Poole")]
            + self.GOOD[2:4], **game)
        FanFavoritesQuestion.objects.create(
            qid="ff-001", prompt="Name a player", survey_date="2026-07-01",
            answers=[{"answer": f"P{i}", "count": 40 - i, "aliases": []} for i in range(6)])

    def test_every_game_round_trips_from_the_real_builders(self):
        builds = build_games(list(GAMES))
        for game, build in builds.items():
            self.assertTrue(same_rows(decode_game(build.entry, build.files.__getitem__), build.rows), game)

    def test_playoff_bytes_are_deterministic(self):
        first = build_games(["playoff"])["playoff"]
        second = build_games(["playoff"])["playoff"]
        self.assertEqual(first.files, second.files)

    def test_starting_five_applies_the_endpoint_rules(self):
        build = build_games(["starting-five"])["starting-five"]
        rows = decode_game(build.entry, build.files.__getitem__)
        self.assertEqual(sorted(r["game_id"] for r in rows), ["accents", "good"])
        self.assertTrue(all(is_playable_lineup(r["starting_5"]) for r in rows))
        accents = next(r for r in rows if r["game_id"] == "accents")
        self.assertEqual(accents["starting_5"][0]["name"], "Bojan Bogdanovic")
