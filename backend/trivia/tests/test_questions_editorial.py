"""Editorial games as question modules (spec §4.6): Fan Favorites, Who Would Win, Connections."""
import copy
import datetime
import json
import os
import random
import tempfile
from io import StringIO
from unittest.mock import patch

from django.core.management import call_command
from django.test import SimpleTestCase, TestCase
from django.utils import timezone

from trivia.data_pipeline import publish_v3
from trivia.games import connections as connections_pool
from trivia.games import who_would_win as www_pool
from trivia.management.commands import build_pools_from_db
from trivia.models import FactoryEvent, FactoryRun, GuessLog, Question, QuestionStats, WrongAnswerStats
from trivia.questions import checker, doctor, fame, rules, runner, specs
from trivia.questions.base import Invalid
from trivia.questions.games import GAME_MODULES, connections, fan_favorites, who_would_win
from trivia.questions.hashing import content_hash
from trivia.questions.journal import Journal
from trivia.tests.published_pool import published_pool
from trivia.questions.base import load_dataset_from_rows
from trivia.tests.questions_fixture import fixture_dataset, fixture_rows
from trivia.utils.fan_favorites import LIVE_STANDINGS_MIN_GUESSES

EDITORIAL = ("fan-favorites", "who-would-win", "connections")


def mvp_board(**extra):
    return {"prompt": "Name a player with 2 or more MVP awards", "category": "player",
            "rule": {"award": "mvp", "min": 2}, "survey_date": "2026-10-16", **extra}


def side(season, franchise, sub="sub"):
    return {"season": season, "franchise": franchise, "sub": sub}


def ruled_board():
    return {"groups": [
        {"label": "Three-time MVPs", "rule": {"award": "mvp", "min": 3}, "difficulty": 1,
         "members": ["Kareem Abdul-Jabbar", "LeBron James", "Larry Bird", "Magic Johnson"]},
        {"label": "Defensive Players of the Year", "rule": {"award": "dpoy"}, "difficulty": 2,
         "members": ["Gary Payton", "Ben Wallace", "Dikembe Mutombo", "Rudy Gobert"]},
        {"label": "Sixth Men of the Year", "rule": {"award": "smoy"}, "difficulty": 3,
         "members": ["Kevin McHale", "Manu Ginobili", "Detlef Schrempf", "Toni Kukoc"]},
        {"label": "1990s Bulls", "difficulty": 4,
         "members": ["Scottie Pippen", "Ron Harper", "Luc Longley", "Steve Kerr"]},
    ]}


class RegistryAndSpecTests(SimpleTestCase):
    def test_registered_and_staged(self):
        for slug in EDITORIAL:
            with self.subTest(slug=slug):
                mod = GAME_MODULES[slug]
                self.assertEqual(mod.SLUG, slug)
                self.assertIn(slug, checker.STAGED_GAMES)
                for name in ("features", "coverage", "dup_key", "checker_view", "pool_row"):
                    self.assertTrue(callable(getattr(mod, name)), f"{slug} lacks {name}")

    def test_specs(self):
        expected = {"fan-favorites": (30, 120), "who-would-win": (30, 200), "connections": (20, 60)}
        for slug, (minimum, target) in expected.items():
            with self.subTest(slug=slug):
                spec = specs.load(slug)
                self.assertEqual(spec["difficulty"]["mix"], {"easy": 0.4, "medium": 0.4, "hard": 0.2})
                self.assertEqual(spec["refill"], {"runway_days": 90, "minimum": minimum, "target": target,
                                                  "max_new_per_run": 20})
                mod = GAME_MODULES[slug]
                self.assertEqual((mod.MINIMUM, mod.TARGET), (minimum, target))

    def test_generate_proposes_nothing(self):
        ds = fixture_dataset()
        for slug in EDITORIAL:
            self.assertEqual(GAME_MODULES[slug].generate(ds, set(), random.Random(1), 10), [])


class ScoredMixin:
    def assert_scored(self, mod, m, definition):
        spec = specs.load(mod.SLUG)
        features = mod.features(m, self.ds)
        for name in list(spec["difficulty"]["features"]) + list(spec["interest"]["features"]):
            self.assertIn(name, features)
            self.assertTrue(0 <= features[name] <= 1, f"{name}={features[name]}")
        coverage = mod.coverage(m, self.ds)
        self.assertTrue(set(spec["coverage"]["axes"]) <= set(coverage))
        self.assertIsInstance(mod.dup_key(definition, m), str)
        json.dumps(mod.checker_view(m, self.ds))  # JSON-able: it is hashed and sent to the Checker


class FanFavoritesModuleTests(ScoredMixin, SimpleTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.ds = fixture_dataset()

    def test_rule_board(self):
        d = mvp_board()
        m = fan_favorites.materialize(d, self.ds)
        self.assertEqual(fan_favorites.validate(m), [])
        names = [a["answer"] for a in m["answers"]]
        self.assertEqual(set(names), {r["full_name"] for r in self.ds.playable if len(r["awards"]["mvp"]) >= 2})
        counts = [a["count"] for a in m["answers"]]
        self.assertEqual(sum(counts), 100)
        self.assertTrue(all(c >= 1 for c in counts))
        self.assertEqual(counts, sorted(counts, reverse=True))
        self.assertTrue(m["estimated"])
        famous = max((r for r in self.ds.playable if r["full_name"] in names), key=fame.fame_score)
        self.assertEqual(names[0], famous["full_name"])  # the most famous answer leads the estimate
        jokic = next(a for a in m["answers"] if a["answer"] == "Nikola Jokić")
        self.assertIn("nikola jokic", jokic["aliases"])
        self.assertIn("jokic", jokic["aliases"])
        self.assertEqual(set(fan_favorites.players_referenced(d, m, self.ds)),
                         {r["person_id"] for r in self.ds.playable if r["full_name"] in names})
        self.assert_scored(fan_favorites, m, d)

    def test_answer_count_bounds(self):
        too_few = fan_favorites.materialize(mvp_board(rule={"award": "mvp", "min": 6}), self.ds)
        self.assertTrue(any("answers" in p for p in fan_favorites.validate(too_few)))
        too_many = fan_favorites.materialize(mvp_board(rule={"international": True}), self.ds)
        self.assertTrue(any("answers" in p for p in fan_favorites.validate(too_many)))

    def test_team_board(self):
        d = {"prompt": "Name a team that won the NBA title between 2000 and 2011", "category": "team",
             "rule": {"champion": {"year_from": 2000, "year_to": 2011}}, "survey_date": "2026-10-16"}
        m = fan_favorites.materialize(d, self.ds)
        self.assertEqual(fan_favorites.validate(m), [])
        lakers = next(a for a in m["answers"] if a["answer"] == "Los Angeles Lakers")
        self.assertIn("lakers", lakers["aliases"])
        self.assertEqual(sum(a["count"] for a in m["answers"]), 100)
        def weight(team):
            titles, finals = rules.team_titles(team["abbr"], self.ds)
            return 2 * titles + finals

        top = max(rules.evaluate(d["rule"], self.ds, category="team"), key=weight)
        self.assertEqual(m["answers"][0]["answer"], top["name"])  # most titles and Finals
        self.assertEqual(fan_favorites.players_referenced(d, m, self.ds), [])
        self.assert_scored(fan_favorites, m, d)

    def test_answers_override_keeps_a_hand_written_board(self):
        answers = [{"answer": f"Coach {i}", "count": 10 + i, "aliases": [f"c{i}"]} for i in range(7)]
        d = {"prompt": "Name a coach", "category": "coach", "answers": answers, "survey_date": "2026-07-01"}
        m = fan_favorites.materialize(d, self.ds)
        self.assertEqual(fan_favorites.validate(m), [])
        self.assertEqual(m["answers"], sorted(answers, key=lambda a: a["count"], reverse=True))
        self.assert_scored(fan_favorites, m, d)

    def test_bad_definitions(self):
        answers = [{"answer": f"P{i}", "count": 1, "aliases": []} for i in range(6)]
        for why, d in [
            ("rule and answers", mvp_board(answers=answers)),
            ("neither", {"prompt": "p", "category": "player", "survey_date": "2026-10-16"}),
            ("bad rule", mvp_board(rule={"award": "coy"})),
            ("coach needs answers", mvp_board(category="coach")),
            ("no prompt", mvp_board(prompt="")),
            ("unknown key", mvp_board(extra=1)),
        ]:
            with self.subTest(why):
                with self.assertRaises(Invalid):
                    fan_favorites.materialize(d, self.ds)

    def test_checker_view_and_dup_key(self):
        d = mvp_board()
        m = fan_favorites.materialize(d, self.ds)
        view = fan_favorites.checker_view(m, self.ds)
        self.assertEqual(view, {"kind": "fan-favorites", "prompt": d["prompt"], "category": "player",
                                "answers": [a["answer"] for a in m["answers"]]})
        other = mvp_board(prompt="  name a PLAYER with 2 or more MVP awards!")
        self.assertEqual(fan_favorites.dup_key(d, m),
                         fan_favorites.dup_key(other, fan_favorites.materialize(other, self.ds)))

    def test_pool_row_is_the_published_shape(self):
        m = fan_favorites.materialize(mvp_board(), self.ds)
        m["qid"] = "ff-041"
        row = fan_favorites.pool_row(m)
        self.assertEqual(list(row), ["qid", "prompt", "survey_date", "category", "answers"])
        self.assertEqual(set(row["answers"][0]), {"answer", "count", "aliases"})


class WhoWouldWinModuleTests(ScoredMixin, SimpleTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.ds = fixture_dataset()

    def test_materialize_renders_the_seed_labels(self):
        d = {"a": side("1995-96", "Chicago Bulls", "72-10 · Jordan, Pippen, Rodman"),
             "b": side("2016-17", "Golden State Warriors", "Curry, Durant, Klay, Draymond")}
        m = who_would_win.materialize(d, self.ds)
        self.assertEqual(who_would_win.validate(m), [])
        m["qid"] = "www-001"
        self.assertEqual(who_would_win.pool_row(m), {
            "qid": "www-001", "a": {"label": "'96 Bulls", "sub": "72-10 · Jordan, Pippen, Rodman"},
            "b": {"label": "'17 Warriors", "sub": "Curry, Durant, Klay, Draymond"}})
        self.assertEqual(who_would_win.checker_view(m, self.ds), {
            "kind": "who-would-win",
            "a": {"team_season": "1995-96 Chicago Bulls", "sub": "72-10 · Jordan, Pippen, Rodman"},
            "b": {"team_season": "2016-17 Golden State Warriors", "sub": "Curry, Durant, Klay, Draymond"}})
        self.assert_scored(who_would_win, m, d)

    def test_nicknames_and_decades(self):
        for s, label in [(side("1978-79", "Seattle SuperSonics"), "'79 Sonics"),
                         (side("2000-01", "Philadelphia 76ers"), "'01 Sixers"),
                         (side("1999-00", "Portland Trail Blazers"), "'00 Blazers"),
                         (side("2003-04", "Minnesota Timberwolves"), "'04 Wolves"),
                         (side("1960s", "Boston Celtics"), "'60s Celtics")]:
            with self.subTest(label=label):
                m = who_would_win.materialize({"a": s, "b": side("2015-16", "Cleveland Cavaliers")}, self.ds)
                self.assertEqual(m["a"]["label"], label)
                self.assertEqual(m["b"]["label"], "'16 Cavs")

    def test_a_side_must_be_a_real_team_season(self):
        for bad in (side("1995-96", "Toronto Raptors"),       # an expansion team, no playoffs
                    side("1995-96", "Chicago Bull"),          # not a team name
                    side("1950s", "Miami Heat"),              # no playoff team that decade
                    side("1996", "Chicago Bulls"),            # not a season
                    {"season": "1995-96", "franchise": "Chicago Bulls"}):  # no sub
            with self.subTest(bad=bad):
                with self.assertRaises(Invalid):
                    who_would_win.materialize({"a": bad, "b": side("2016-17", "Golden State Warriors")}, self.ds)
        with self.assertRaises(Invalid):
            who_would_win.materialize({"a": side("1995-96", "Chicago Bulls"),
                                       "b": side("1995-96", "Chicago Bulls")}, self.ds)

    def test_dup_key_is_the_sorted_pair(self):
        a, b = side("1995-96", "Chicago Bulls", "x"), side("2016-17", "Golden State Warriors", "y")
        one, two = {"a": a, "b": b}, {"a": dict(b, sub="z"), "b": a}
        self.assertEqual(who_would_win.dup_key(one, who_would_win.materialize(one, self.ds)),
                         who_would_win.dup_key(two, who_would_win.materialize(two, self.ds)))

    def test_sub_length_is_validated(self):
        m = who_would_win.materialize({"a": side("1995-96", "Chicago Bulls", "x" * 91),
                                       "b": side("2016-17", "Golden State Warriors")}, self.ds)
        self.assertTrue(who_would_win.validate(m))


class ConnectionsModuleTests(ScoredMixin, SimpleTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.ds = fixture_dataset()

    def test_ruled_board(self):
        d = ruled_board()
        m = connections.materialize(d, self.ds)
        self.assertEqual(connections.validate(m), [])
        self.assertEqual(sorted(m["tiles"]), sorted(x for g in d["groups"] for x in g["members"]))
        self.assertEqual(connections.materialize(d, self.ds)["tiles"], m["tiles"])  # deterministic order
        self.assertEqual(connections.checker_view(m, self.ds), {
            "kind": "connections", "groups": [{"label": g["label"], "members": g["members"]} for g in d["groups"]]})
        m["qid"] = "cn-061"
        row = connections.pool_row(m)
        self.assertEqual(list(row), ["qid", "tiles", "groups"])
        self.assertEqual(list(row["groups"][0]), ["label", "difficulty", "members"])
        self.assertEqual(len(connections.players_referenced(d, m, self.ds)), 16)
        self.assert_scored(connections, m, d)

    def test_a_member_must_fit_its_own_rule(self):
        d = ruled_board()
        d["groups"][0]["members"][0] = "Derrick Rose"  # one MVP
        with self.assertRaisesRegex(Invalid, "Derrick Rose"):
            connections.materialize(d, self.ds)

    def test_no_member_may_fit_another_groups_rule(self):
        d = ruled_board()
        d["groups"][1]["members"][3] = "Michael Jordan"  # a DPOY, but also a three-time MVP
        with self.assertRaisesRegex(Invalid, "Michael Jordan"):
            connections.materialize(d, self.ds)

    def test_the_label_cross_trap_still_applies_to_unruled_groups(self):
        d = ruled_board()
        d["groups"][3]["label"] = "Wore #33"  # Pippen did; so did Bird and Kareem, in the MVP group
        with self.assertRaisesRegex(Invalid, "also satisfies 'Wore #33'"):
            connections.materialize(d, self.ds)
        d["groups"][3]["label"] = "Born in Germany"  # and the own-label check: Pippen was not
        with self.assertRaisesRegex(Invalid, "own label"):
            connections.materialize(d, self.ds)

    def test_structure(self):
        d = ruled_board()
        d["groups"][3]["difficulty"] = 3
        with self.assertRaises(Invalid):
            connections.materialize(d, self.ds)
        d = ruled_board()
        d["groups"][3]["members"] = d["groups"][3]["members"][:3]
        with self.assertRaises(Invalid):
            connections.materialize(d, self.ds)

    def test_tiles_override_keeps_the_seed_order(self):
        d = ruled_board()
        d["tiles"] = sorted(x for g in d["groups"] for x in g["members"])
        self.assertEqual(connections.materialize(d, self.ds)["tiles"], d["tiles"])
        d["tiles"] = d["tiles"][:15] + ["Someone Else"]
        with self.assertRaises(Invalid):
            connections.materialize(d, self.ds)

    def test_dup_key_ignores_order(self):
        d = ruled_board()
        other = copy.deepcopy(d)
        other["groups"].reverse()
        self.assertEqual(connections.dup_key(d, None), connections.dup_key(other, None))


class SeedImportTests(TestCase):
    """Against the committed curated dataset: what production imports (the 209-player fixture
    lacks players and colleges the seed boards' label checks read)."""

    @classmethod
    def setUpTestData(cls):
        cls.real = publish_v3.curated_dataset()

    def setUp(self):
        self.ds = self.real
        p = patch.object(publish_v3, "curated_dataset", return_value=self.ds)
        p.start()
        self.addCleanup(p.stop)

    def run_import(self):
        out = StringIO()
        call_command("import_editorial_seeds", stdout=out)
        return out.getvalue()

    def test_import_is_idempotent_and_marks_legacy(self):
        self.run_import()
        counts = {slug: Question.objects.filter(game=slug).count() for slug in EDITORIAL}
        self.assertEqual(counts, {"fan-favorites": 40, "who-would-win": 60, "connections": 60})
        for q in Question.objects.filter(game__in=EDITORIAL):
            self.assertEqual(q.status, Question.STATUS_ACTIVE, q.qid)
            self.assertEqual(q.quality["checked"], {"verdict": "legacy"})
            self.assertEqual(q.created_by, "seed")
            self.assertEqual(q.content_hash, content_hash(q.definition))
            self.assertIn("payload_sha", q.quality)
        self.assertTrue(Question.objects.filter(game="fan-favorites", qid="ff-001").exists())
        self.assertEqual(Question.objects.get(game="who-would-win", qid="www-001").definition["a"],
                         side("1995-96", "Chicago Bulls", "72-10 · Jordan, Pippen, Rodman"))
        out = self.run_import()
        self.assertEqual({slug: Question.objects.filter(game=slug).count() for slug in EDITORIAL}, counts)
        self.assertIn("imported 0", out)
        runs = FactoryRun.objects.filter(kind="editorial")
        self.assertEqual(runs.count(), 2)
        self.assertEqual(runs.order_by("id").first().status, FactoryRun.STATUS_OK)

    def test_above_minimum_after_import_and_maintenance_adds_nothing(self):
        self.run_import()
        for slug in EDITORIAL:
            self.assertGreaterEqual(Question.objects.filter(game=slug, status="active").count(),
                                    GAME_MODULES[slug].MINIMUM)
        per_game, stats = runner.maintain(list(EDITORIAL), self.ds, random.Random(3), out=lambda *_: None,
                                          journal=Journal("supply"), isolate=True, stage=True)
        for slug in EDITORIAL:
            with self.subTest(slug=slug):
                self.assertNotIn("held_back", stats[slug])
                self.assertEqual(stats[slug]["added"], 0)
                self.assertEqual(stats[slug]["retired"], 0)
                self.assertEqual(Question.objects.filter(game=slug, status="pending").count(), 0)

    def test_published_rows_equal_the_committed_files(self):
        self.run_import()
        built = {
            "fan-favorites": build_pools_from_db.build_fan_favorites(),
            "who-would-win": www_pool.build_pool(),
            "connections": connections_pool.build_pool(),
        }
        for slug, rows in built.items():
            with self.subTest(slug=slug):
                committed = published_pool(slug)
                self.assertEqual(rows[0], committed[0])  # field for field, one row
                self.assertEqual(sorted(rows, key=lambda r: r["qid"]), sorted(committed, key=lambda r: r["qid"]))

    def test_v3_builds_the_pool_games_from_the_questions(self):
        self.run_import()
        Question.objects.filter(game="who-would-win", qid="www-002").update(status=Question.STATUS_QUARANTINED)
        builds = publish_v3.build_games(["fan-favorites", "who-would-win"])
        www = publish_v3.decode_game(builds["who-would-win"].entry, builds["who-would-win"].files.__getitem__)
        self.assertEqual(builds["who-would-win"].entry["kind"], "single")
        self.assertEqual(len(www), 59)
        self.assertNotIn("www-002", {r["qid"] for r in www})
        self.assertEqual(builds["fan-favorites"].entry["rows"], 40)

    def test_live_standings_replace_the_estimate(self):
        self.run_import()
        board = Question.objects.get(game="fan-favorites", qid="ff-001")
        last = board.definition["answers"][-1]["answer"]
        GuessLog.objects.bulk_create([GuessLog(game="fan-favorites", question_id="ff-001", answer=last, correct=True)
                                      for _ in range(LIVE_STANDINGS_MIN_GUESSES)])
        read_only = build_pools_from_db.build_fan_favorites(persist=False)
        row = next(r for r in read_only if r["qid"] == "ff-001")
        self.assertEqual(row["answers"][0]["answer"], last)
        self.assertEqual(row["answers"][0]["count"], 100)
        self.assertEqual(build_pools_from_db.build_fan_favorites(), read_only)

    def test_without_questions_the_builders_fall_back_to_the_seeds(self):
        self.assertEqual(www_pool.build_pool(), www_pool._load_seed())
        self.assertEqual(connections_pool.build_pool(), connections_pool._load_seed())


class PublishMaintainsEditorialTests(TestCase):
    """publish_game_data_v3 maintains the editorial games it publishes (once imported)."""

    def setUp(self):
        self.before = fixture_dataset("curated-fixture0001")
        rows = fixture_rows()
        rose = next(r for r in rows if r["full_name"] == "Derrick Rose")
        rose["awards"]["mvp"] = rose["awards"]["mvp"] + [2012]  # the data refresh: a second MVP
        self.after = load_dataset_from_rows(rows, "curated-fixture0002")
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.tmp = self._tmp.name
        for p in (patch.dict(os.environ, {"GITHUB_OUTPUT": os.path.join(self.tmp, "gh-output")}),
                  patch.object(publish_v3, "curated_dataset", return_value=self.after),
                  patch("trivia.questions.games.fan_favorites.MINIMUM", 1)):
            p.start()
            self.addCleanup(p.stop)
        os.environ.pop("DATA_PUBLIC_BASE", None)
        self.mvp = self.board("ff-001", mvp_board())
        self.dpoy = self.board("ff-002", mvp_board(prompt="Name a Defensive Player of the Year",
                                                   rule={"award": "dpoy"}))

    def board(self, qid, d):
        row = Question.objects.create(game="fan-favorites", qid=qid, definition=d, content_hash=content_hash(d),
                                      status=Question.STATUS_ACTIVE, created_by="seed")
        self.assertIsNotNone(runner._materialize_row(fan_favorites, row, self.before, timezone.now(),
                                                     Journal("supply"), spec=specs.load("fan-favorites")))
        return row

    def publish(self, games):
        out = os.path.join(self.tmp, "out")
        buf = StringIO()
        call_command("publish_game_data_v3", "--out", out, "--games", games, stdout=buf)
        manifest = json.loads(open(os.path.join(out, "manifest.json"), encoding="utf-8").read())

        def read(rel):
            with open(os.path.join(out, *rel.split("/")), "rb") as f:
                return f.read()
        return buf.getvalue(), manifest, read

    def test_a_changed_rule_board_is_staged_and_left_out(self):
        output, manifest, read = self.publish("fan-favorites")
        self.mvp.refresh_from_db()
        self.dpoy.refresh_from_db()
        self.assertEqual(self.mvp.status, Question.STATUS_PENDING)
        self.assertEqual(self.dpoy.status, Question.STATUS_ACTIVE)
        self.assertTrue(FactoryEvent.objects.filter(action="staged_for_recheck", game="fan-favorites",
                                                    qid="ff-001").exists())
        rows = publish_v3.decode_game(manifest["games"]["fan-favorites"], read)
        self.assertEqual([r["qid"] for r in rows], ["ff-002"])
        self.assertIn("fan-favorites", output)

    def test_below_minimum_is_held_back_not_aborted(self):
        with patch("trivia.questions.games.fan_favorites.MINIMUM", 2):
            output, manifest, _ = self.publish("fan-favorites,who-would-win")
        self.assertNotIn("fan-favorites", manifest["games"])
        self.assertIn("who-would-win", manifest["games"])
        self.mvp.refresh_from_db()
        self.assertEqual(self.mvp.status, Question.STATUS_PENDING)  # staged work kept for the Checker
        self.assertIn("held back", output)
        with open(os.environ["GITHUB_OUTPUT"], encoding="utf-8") as f:
            self.assertIn("held_back=fan-favorites", f.read())

    def test_before_the_import_a_game_is_not_maintained(self):
        output, manifest, read = self.publish("who-would-win")
        self.assertEqual(len(publish_v3.decode_game(manifest["games"]["who-would-win"], read)), 60)  # the seed
        self.assertFalse(FactoryEvent.objects.filter(game="who-would-win").exists())
        self.assertFalse(Question.objects.filter(game="who-would-win").exists())

    def test_pool_rows_reports_the_boards_it_drops(self):
        printed = []
        rows = runner.pool_rows("fan-favorites", self.after, out=printed.append)
        self.assertEqual([r["qid"] for r in rows], ["ff-002"])
        self.assertTrue(any("ff-001" in line for line in printed), printed)

    def test_legacy_maintain_questions_default_skips_the_editorial_games(self):
        cmd = "trivia.management.commands.maintain_questions"
        with patch.object(runner, "run", return_value={"version": None}) as run, \
                patch(f"{cmd}.StorageConfig"), patch(f"{cmd}.download_players_dataset", return_value=self.after):
            call_command("maintain_questions", "--no-publish", stdout=StringIO())
        games = run.call_args.args[0]
        self.assertTrue(games)
        self.assertFalse(set(games) & set(EDITORIAL))


class DoctorVoteGameTests(TestCase):
    def test_who_would_win_votes_are_not_wrong_answers(self):
        q = Question.objects.create(game="who-would-win", qid="www-001", content_hash="h",
                                    definition={"a": {}, "b": {}}, status=Question.STATUS_ACTIVE)
        day = datetime.date(2026, 10, 1)
        QuestionStats.objects.create(game="who-would-win", question_id="www-001", day=day,
                                     attempts=500, correct=0, players=500)
        seen = datetime.datetime(2026, 10, 1, tzinfo=datetime.timezone.utc)
        WrongAnswerStats.objects.create(game="who-would-win", question_id="www-001", answer_norm="a",
                                        count=300, players=300, first_seen=seen, last_seen=seen)
        summary = doctor.scan(datetime.datetime(2026, 10, 2, tzinfo=datetime.timezone.utc), Journal("doctor"))
        q.refresh_from_db()
        self.assertEqual(q.status, Question.STATUS_ACTIVE)
        self.assertEqual((summary["quarantined"], summary["flagged"]), (0, 0))
