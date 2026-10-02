"""Question games on the manifest-v3 publisher (phase 6 of
docs/team/designs/2026-10-02-independent-game-data-publishing.md).

Lossless against the old Supabase snapshot, stable per-question files, unchanged
detection, maintenance + publish in one transaction, and a read-only check."""
import copy
import datetime
import json
import os
import random
import tempfile
from io import StringIO
from unittest.mock import patch

from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from trivia.data_pipeline import publish_v3
from trivia.data_pipeline.publish_v3 import (
    QNAMES_GAME,
    QUESTION_GAMES,
    PreviousSource,
    PublishError,
    build_games,
    decode_game,
    encode_game,
    publish,
    same_rows,
)
from trivia.models import Question
from trivia.questions import runner
from trivia.questions.snapshot import build_names, write_snapshot
from trivia.tests.questions_fixture import fixture_dataset

DAY = datetime.datetime(2026, 10, 2, 9, 0, tzinfo=datetime.timezone.utc)
GAMES = list(QUESTION_GAMES) + [QNAMES_GAME]

# Small targets so the 214-player fixture fills every game quickly.
SMALL = [
    patch("trivia.questions.games.career_path.TARGET", 20),
    patch("trivia.questions.games.career_path.MINIMUM", 5),
    patch("trivia.questions.games.tictactoe.TARGET", 3),
    patch("trivia.questions.games.tictactoe.MINIMUM", 1),
    patch("trivia.questions.games.contexto.TARGET", 35),
    patch("trivia.questions.games.contexto.MINIMUM", 30),
]


def _read_dir(out_dir):
    def read(rel):
        with open(os.path.join(out_dir, *rel.split("/")), "rb") as f:
            return f.read()
    return read


def _load(out_dir, name):
    with open(os.path.join(out_dir, *name.split("/")), encoding="utf-8") as f:
        return json.load(f)


def _rows(per_game, ds):
    rows = {slug: [publish_v3.question_row(q, i, m, ds.version) for q, i, m in kept]
            for slug, kept in per_game.items()}
    rows[QNAMES_GAME] = build_names(ds.playable)
    return rows


def _builders(rows_by_game):
    return {g: (lambda r=r: copy.deepcopy(r)) for g, r in rows_by_game.items()}


class QuestionsTestCase(TestCase):
    def setUp(self):
        for p in SMALL:
            p.start()
            self.addCleanup(p.stop)
        self.ds = fixture_dataset("curated-fixture0001")
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.tmp = self._tmp.name

    def maintain(self, games=QUESTION_GAMES, seed=7):
        per_game, _ = runner.maintain(list(games), self.ds, random.Random(seed), out=lambda *_: None)
        return per_game

    def _publish(self, out, rows, previous=None, games=None):
        return publish(games or list(rows), os.path.join(self.tmp, out),
                       previous=PreviousSource(os.path.join(self.tmp, previous)) if previous else None,
                       builders=_builders(rows), now=DAY, warn=lambda m: None)


class LosslessAgainstSnapshotTests(QuestionsTestCase):
    """The v3 files hold exactly what the Supabase snapshot (and the frontend) got."""

    def setUp(self):
        super().setUp()
        self.per_game = self.maintain()
        self.rows = _rows(self.per_game, self.ds)
        snap = os.path.join(self.tmp, "snapshot")
        write_snapshot(snap, "2026-10-02.1", self.ds.version, self.per_game, self.rows[QNAMES_GAME])
        self.snap = snap
        self._publish("v3", self.rows)
        self.out = os.path.join(self.tmp, "v3")
        self.manifest = _load(self.out, "manifest.json")

    def _assert_game(self, slug):
        entry = self.manifest["games"][slug]
        self.assertEqual(entry["kind"], "questions")
        index = _load(self.out, entry["index"])
        snap_index = _load(self.snap, f"{slug}/index.json")
        # Same index, minus the per-publish version (the manifest version replaces it).
        self.assertEqual({k: v for k, v in snap_index.items() if k != "version"},
                         {k: v for k, v in index.items() if k != "files"})
        self.assertEqual(entry["rows"], len(snap_index["items"]))
        self.assertEqual(sorted(index["files"]), sorted(item[0] for item in snap_index["items"]))
        for qid, sha12 in index["files"].items():
            with open(os.path.join(self.snap, slug, f"{qid}.json"), "rb") as f:
                old = f.read()
            new = _read_dir(self.out)(f"{slug}/{qid}.{sha12}.json")
            self.assertEqual(new, old, f"{slug}/{qid}: bytes differ from the snapshot")
        rebuilt = decode_game(entry, _read_dir(self.out))
        self.assertTrue(same_rows(rebuilt, self.rows[slug]))
        self.assertEqual([r["qid"] for r in rebuilt], [r["qid"] for r in self.rows[slug]])

    def test_career_path(self):
        self._assert_game("career-path")
        self.assertTrue(all(len(item) == 2 for item in _load(self.snap, "career-path/index.json")["items"]))

    def test_who_are_ya(self):
        self._assert_game("who-are-ya")

    def test_tictactoe(self):
        self._assert_game("tictactoe")
        q = decode_game(self.manifest["games"]["tictactoe"], _read_dir(self.out))[0]["question"]
        self.assertEqual(len(q["valid"]), 9)

    def test_contexto_keeps_the_daily_schedule(self):
        self._assert_game("contexto")
        index = _load(self.out, self.manifest["games"]["contexto"]["index"])
        today = timezone.now().date().isoformat()
        days = [item[1] for item in index["items"]]
        self.assertIn(today, days)
        self.assertEqual(len(days), len(set(days)))
        qid = next(item[0] for item in index["items"] if item[1] == today)
        question = _load(self.out, f"contexto/{qid}.{index['files'][qid]}.json")
        self.assertEqual(question["day"], today)
        self.assertEqual(question["ranking"][0][1], 1)

    def test_question_names_equal_the_snapshot_names_file(self):
        path = self.manifest["question_names"]
        self.assertRegex(path, r"^shared/question-names\.[0-9a-f]{12}\.json$")
        self.assertEqual(_load(self.out, path), _load(self.snap, "players-names.json"))
        # The all-players "names" pointer is a different file and is not touched here.
        self.assertNotIn("names", self.manifest)

    def test_question_names_keep_every_field(self):
        entry = _load(self.out, self.manifest["question_names"])[0]
        self.assertEqual(set(entry), {"id", "full_name", "aliases", "position", "birth_year",
                                      "jersey", "team_abbr", "draft"})


class StabilityTests(QuestionsTestCase):
    def setUp(self):
        super().setUp()
        self.rows = _rows(self.maintain(["career-path", "who-are-ya"]), self.ds)

    def test_same_rows_same_files(self):
        a = encode_game("career-path", self.rows["career-path"])
        b = encode_game("career-path", copy.deepcopy(self.rows["career-path"]))
        self.assertEqual(a.entry, b.entry)
        self.assertEqual(a.files, b.files)
        for path, data in a.files.items():
            self.assertRegex(path, r"^career-path/[a-z0-9-]+\.[0-9a-f]{12}\.json$")
            self.assertEqual(path.rsplit(".", 2)[1], publish_v3.sha256_hex(data)[:12])

    def test_one_changed_question_changes_only_its_file_and_the_index(self):
        before = encode_game("career-path", self.rows["career-path"])
        rows = copy.deepcopy(self.rows["career-path"])
        rows[3]["question"]["player"]["full_name"] += " Jr."
        after = encode_game("career-path", rows)
        new = set(after.files) - set(before.files)
        self.assertEqual(len(new), 2)
        self.assertIn(after.entry["index"], new)
        self.assertTrue(any(p.startswith(f"career-path/{rows[3]['qid']}.") for p in new))

    def test_an_added_question_keeps_every_other_url(self):
        before = encode_game("who-are-ya", self.rows["who-are-ya"][:-1])
        after = encode_game("who-are-ya", self.rows["who-are-ya"])
        kept = set(before.files) - {before.entry["index"]}
        self.assertTrue(kept <= set(after.files))
        self.assertEqual(len(set(after.files) - set(before.files)), 2)  # new question + index

    def test_qids_are_the_db_qids(self):
        index = json.loads(encode_game("career-path", self.rows["career-path"]).files[
            encode_game("career-path", self.rows["career-path"]).entry["index"]])
        self.assertEqual(sorted(index["files"]),
                         sorted(Question.objects.filter(game="career-path", status="active")
                                .values_list("qid", flat=True)))

    def test_bad_rows_fail_validation(self):
        rows = copy.deepcopy(self.rows["career-path"])
        rows[1]["qid"] = rows[0]["qid"]
        with self.assertRaises(PublishError):
            build_games(["career-path"], _builders({"career-path": rows}))
        rows = copy.deepcopy(self.rows["career-path"])
        rows[0]["question"]["game"] = "who-are-ya"
        with self.assertRaises(PublishError):
            build_games(["career-path"], _builders({"career-path": rows}))
        with self.assertRaises(PublishError):
            build_games(["career-path"], _builders({"career-path": []}))


class UnchangedDetectionTests(QuestionsTestCase):
    def setUp(self):
        super().setUp()
        self.rows = _rows(self.maintain(["career-path", "tictactoe"]), self.ds)
        self.games = ["career-path", "tictactoe", QNAMES_GAME]
        self._publish("v1", self.rows, games=self.games)

    def test_same_questions_again_is_nothing_to_publish(self):
        report = self._publish("v2", self.rows, previous="v1", games=self.games)
        self.assertEqual(report["result"], "nothing-to-publish")
        self.assertEqual({g["status"] for g in report["games"]}, {"unchanged"})
        self.assertEqual(report["changed_files"], [])
        self.assertFalse(os.path.exists(os.path.join(self.tmp, "v2")))

    def test_one_changed_question_uploads_two_files(self):
        rows = copy.deepcopy(self.rows)
        rows["career-path"][0]["question"]["player"]["full_name"] += " II"
        report = self._publish("v2", rows, previous="v1", games=self.games)
        status = {g["game"]: g for g in report["games"]}
        self.assertEqual(status["career-path"]["status"], "changed")
        self.assertEqual(status["career-path"]["new_files"], 2)  # the question + the index
        self.assertEqual(status["tictactoe"]["status"], "unchanged")
        self.assertEqual(status["tictactoe"]["new_files"], 0)
        self.assertEqual(status[QNAMES_GAME]["status"], "unchanged")
        self.assertEqual(len(report["changed_files"]), 2)
        out = os.path.join(self.tmp, "v2")
        # The previous question file stays deployed for clients on the old manifest.
        old_index = _load(os.path.join(self.tmp, "v1"),
                          _load(os.path.join(self.tmp, "v1"), "manifest.json")["games"]["career-path"]["index"])
        qid = rows["career-path"][0]["qid"]
        self.assertTrue(os.path.isfile(os.path.join(out, "career-path", f"{qid}.{old_index['files'][qid]}.json")))

    def test_publishing_a_pool_game_carries_every_question_file_over(self):
        pools = {"mvps": [{"season": "2015-16", "mvp": "Stephen Curry", "team": "GSW", "team_logo_url": "x"}]}
        self._publish("v2", pools, previous="v1", games=["mvps"])
        out = os.path.join(self.tmp, "v2")
        manifest = _load(out, "manifest.json")
        self.assertEqual(manifest["games"]["career-path"],
                         _load(os.path.join(self.tmp, "v1"), "manifest.json")["games"]["career-path"])
        for slug in ("career-path", "tictactoe"):
            self.assertTrue(same_rows(decode_game(manifest["games"][slug], _read_dir(out)), self.rows[slug]))
        self.assertEqual(_load(out, manifest["question_names"]), self.rows[QNAMES_GAME])

    def test_a_missing_carried_over_question_file_aborts(self):
        manifest = _load(os.path.join(self.tmp, "v1"), "manifest.json")
        index = _load(os.path.join(self.tmp, "v1"), manifest["games"]["tictactoe"]["index"])
        qid, sha12 = next(iter(index["files"].items()))
        os.remove(os.path.join(self.tmp, "v1", "tictactoe", f"{qid}.{sha12}.json"))
        with self.assertRaises(PublishError):
            self._publish("v2", {"mvps": [{"season": "x", "mvp": "y"}]}, previous="v1", games=["mvps"])
        self.assertFalse(os.path.exists(os.path.join(self.tmp, "v2")))

    def test_file_count_stays_within_vercel_limits(self):
        # 15,000 files per CLI deployment (https://vercel.com/docs/limits#files): one file
        # per question + index, plus the manifest and host config.
        files = sum(len(f) for _, _, f in os.walk(os.path.join(self.tmp, "v1")))
        expected = sum(len(self.rows[g]) + 1 for g in ("career-path", "tictactoe")) + 1 + 4
        self.assertEqual(files, expected)


class CommandTests(QuestionsTestCase):
    """manage.py publish_game_data_v3: maintenance + publish in one run."""

    def setUp(self):
        super().setUp()
        p = patch.object(publish_v3, "curated_dataset", return_value=self.ds)
        p.start()
        self.addCleanup(p.stop)
        env = patch.dict(os.environ, {"GITHUB_OUTPUT": os.path.join(self.tmp, "gh-output")})
        env.start()
        self.addCleanup(env.stop)
        os.environ.pop("DATA_PUBLIC_BASE", None)
        os.environ.pop("GITHUB_STEP_SUMMARY", None)
        self.out = os.path.join(self.tmp, "out")

    def _call(self, *args):
        buf = StringIO()
        call_command("publish_game_data_v3", "--out", self.out, "--rng-seed", "7", *args, stdout=buf)
        return buf.getvalue()

    def test_maintains_then_publishes_every_question_game(self):
        output = self._call("--games", ",".join(QUESTION_GAMES))
        self.assertIn("Question maintenance", output)
        manifest = _load(self.out, "manifest.json")
        self.assertEqual(sorted(manifest["games"]), sorted(QUESTION_GAMES))
        self.assertTrue(manifest["question_names"].startswith("shared/question-names."))
        for slug in QUESTION_GAMES:
            rebuilt = decode_game(manifest["games"][slug], _read_dir(self.out))
            active = set(Question.objects.filter(game=slug, status="active").values_list("qid", flat=True))
            self.assertEqual({r["qid"] for r in rebuilt}, active, slug)
            self.assertTrue(all(r["dataset"] == self.ds.version for r in rebuilt))
        self.assertEqual(Question.objects.filter(game="career-path").first().dataset_version, self.ds.version)

    def test_second_run_with_no_changes_is_nothing_to_publish(self):
        self._call("--games", "career-path,who-are-ya")
        output = self._call("--games", "career-path,who-are-ya",
                            "--previous", os.path.join(self.out, "manifest.json"))
        self.assertIn("nothing to publish", output)

    def test_minimum_gate_aborts_with_nothing_published_and_rolls_back(self):
        with patch("trivia.questions.games.contexto.MINIMUM", 10_000):
            with self.assertRaises(CommandError) as ctx:
                self._call("--games", "career-path,contexto")
        self.assertIn("contexto", str(ctx.exception))
        self.assertIn("rolled back", str(ctx.exception))
        self.assertFalse(os.path.exists(self.out))
        self.assertEqual(Question.objects.count(), 0)  # career-path's top-up rolled back too

    def test_a_failing_pool_game_rolls_the_maintenance_back(self):
        with patch.object(publish_v3, "default_builders",
                          side_effect=lambda **kw: {**publish_v3.question_builders(kw.get("maintained"), self.ds),
                                                    "mvps": lambda: []}):
            with self.assertRaises(CommandError):
                self._call("--games", "career-path,mvps")
        self.assertFalse(os.path.exists(self.out))
        self.assertEqual(Question.objects.count(), 0)

    def test_no_commit_writes_the_folder_and_rolls_the_db_back(self):
        self._call("--games", "career-path", "--no-commit")
        self.assertTrue(os.path.isfile(os.path.join(self.out, "manifest.json")))
        self.assertEqual(Question.objects.count(), 0)

    def test_dry_run_writes_nothing(self):
        output = self._call("--games", "career-path", "--dry-run")
        self.assertIn("Dry run", output)
        self.assertFalse(os.path.exists(self.out))
        self.assertEqual(Question.objects.count(), 0)

    def test_skip_maintain_publishes_current_rows_without_writes(self):
        runner.maintain(["career-path"], self.ds, random.Random(1), out=lambda *_: None)
        broken = Question.objects.create(game="career-path", qid="cp-999999", definition={"person_id": -1},
                                         content_hash="x" * 64)
        before = Question.objects.count()
        with CaptureQueriesContext(connection) as ctx:
            self._call("--games", "career-path", "--skip-maintain")
        writes = [q["sql"] for q in ctx.captured_queries
                  if q["sql"].lstrip().split(" ", 1)[0].upper() in ("INSERT", "UPDATE", "DELETE")]
        self.assertEqual(writes, [])
        self.assertEqual(Question.objects.count(), before)
        broken.refresh_from_db()
        self.assertEqual(broken.status, "active")  # not retired: maintenance did not run
        manifest = _load(self.out, "manifest.json")
        qids = {r["qid"] for r in decode_game(manifest["games"]["career-path"], _read_dir(self.out))}
        self.assertNotIn("cp-999999", qids)  # left out, it no longer materializes
        self.assertEqual(len(qids), before - 1)

    def test_question_names_come_with_any_question_game(self):
        self._call("--games", "who-are-ya")
        self.assertIn("question_names", _load(self.out, "manifest.json"))


class CheckOnlyTests(QuestionsTestCase):
    """--check-only covers the question games read-only: no maintenance, no writes."""

    def setUp(self):
        super().setUp()
        runner.maintain(list(QUESTION_GAMES), self.ds, random.Random(3), out=lambda *_: None)
        p = patch.object(publish_v3, "curated_dataset", return_value=self.ds)
        p.start()
        self.addCleanup(p.stop)

    def test_check_performs_zero_db_writes_and_sees_new_games(self):
        with patch.object(runner, "maintain", side_effect=AssertionError("maintenance must not run")), \
                CaptureQueriesContext(connection) as ctx:
            report = publish_v3.check(GAMES, previous=PreviousSource(self.tmp))
        writes = [q["sql"] for q in ctx.captured_queries
                  if q["sql"].lstrip().split(" ", 1)[0].upper() in ("INSERT", "UPDATE", "DELETE")]
        self.assertEqual(writes, [])
        self.assertEqual(report["result"], "stale")
        self.assertEqual(sorted(report["stale"]), sorted(GAMES))

    def test_fresh_after_publishing_the_current_rows_then_stale_after_a_change(self):
        builds = build_games(GAMES, publish_v3.default_builders(read_only=True))
        publish(GAMES, os.path.join(self.tmp, "live"), builds=builds, now=DAY, warn=lambda m: None)
        live = PreviousSource(os.path.join(self.tmp, "live"))
        self.assertEqual(publish_v3.check(GAMES, previous=live)["result"], "fresh")
        row = Question.objects.filter(game="who-are-ya", status="active").first()
        row.status = "retired"
        row.save()
        report = publish_v3.check(GAMES, previous=live)
        self.assertEqual(report["stale"], ["who-are-ya"])

    def test_a_game_below_minimum_is_an_error_not_a_crash(self):
        with patch("trivia.questions.games.who_are_ya.MINIMUM", 10_000):
            report = publish_v3.check(GAMES, previous=PreviousSource(self.tmp))
        status = {g["game"]: g["status"] for g in report["games"]}
        self.assertEqual(status["who-are-ya"], "error")
        self.assertEqual(status["career-path"], "new")

    def test_command_check_only_writes_nothing_to_the_db(self):
        before = list(Question.objects.order_by("id").values_list("id", "status", "updated_at"))
        buf = StringIO()
        with patch.dict(os.environ, {"GITHUB_OUTPUT": os.path.join(self.tmp, "gh")}):
            call_command("publish_game_data_v3", "--check-only", "--games", "career-path,contexto",
                         "--previous", self.tmp, stdout=buf)
        self.assertIn("question-names", buf.getvalue())
        self.assertEqual(list(Question.objects.order_by("id").values_list("id", "status", "updated_at")), before)
