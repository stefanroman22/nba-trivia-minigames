"""Phase 6 editorial author (spec §4.6): the weekly brief, and the author's proposals applied as
pending questions through the module gates (the Checker decides what goes live)."""
import copy
import json
import os
import sys
import tempfile
from io import StringIO
from unittest.mock import patch

from django.core.management import call_command
from django.test import TestCase

from trivia.data_pipeline import publish_v3
from trivia.models import FactoryRun, Question
from trivia.questions import rules
from trivia.questions.hashing import content_hash
from trivia.tests.questions_fixture import fixture_dataset

WORKFLOW = os.path.join(os.path.dirname(__file__), "..", "..", "..", ".github", "workflows", "editorial-author.yml")


def board(prompt="Name a player with 2 or more MVP awards", rule=None, **extra):
    return {"prompt": prompt, "category": "player", "rule": rule or {"award": "mvp", "min": 2}, **extra}


def side(season, franchise, sub="A great team"):
    return {"season": season, "franchise": franchise, "sub": sub}


def matchup():
    return {"a": side("1995-96", "Chicago Bulls", "72-10, Jordan and Pippen"),
            "b": side("2016-17", "Golden State Warriors", "Curry, Durant, 16-1 in the playoffs")}


def groups():
    return [
        {"label": "Three-time MVPs", "rule": {"award": "mvp", "min": 3}, "difficulty": 1,
         "members": ["Kareem Abdul-Jabbar", "LeBron James", "Larry Bird", "Wilt Chamberlain"]},
        {"label": "Defensive Players of the Year", "rule": {"award": "dpoy"}, "difficulty": 2,
         "members": ["Gary Payton", "Ben Wallace", "Dikembe Mutombo", "Rudy Gobert"]},
        {"label": "Sixth Men of the Year", "rule": {"award": "smoy"}, "difficulty": 3,
         "members": ["Kevin McHale", "Manu Ginobili", "Detlef Schrempf", "Toni Kukoc"]},
        {"label": "Averaged 8 assists a game", "rule": {"career": "apg", "min": 8}, "difficulty": 4,
         "members": ["John Stockton", "Steve Nash", "Isiah Thomas", "Jason Kidd"]},
    ]


def proposal(game, definition, why="Fans love this"):
    return {"game": game, "definition": definition, "why": why}


class EditorialAuthorTestCase(TestCase):
    def setUp(self):
        self.ds = fixture_dataset("ds-author")
        p = patch.object(publish_v3, "curated_dataset", return_value=self.ds)
        p.start()
        self.addCleanup(p.stop)
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.tmp = self._tmp.name
        self.dir = os.path.join(self.tmp, "editorial")
        os.makedirs(self.dir)
        self.gh = os.path.join(self.tmp, "gh-output")
        env = patch.dict(os.environ, {"GITHUB_OUTPUT": self.gh})
        env.start()
        self.addCleanup(env.stop)

    def live(self, game, definition, qid, status=Question.STATUS_ACTIVE):
        return Question.objects.create(game=game, qid=qid, definition=definition, status=status,
                                       content_hash=content_hash(definition), created_by="seed")

    def write(self, proposals, raw=None):
        with open(os.path.join(self.dir, "proposals.json"), "w", encoding="utf-8") as f:
            f.write(raw if raw is not None else json.dumps({"proposals": proposals}))

    def apply(self):
        call_command("apply_editorial_proposals", self.dir, stdout=StringIO())

    def run_(self):
        return FactoryRun.objects.order_by("-id").first()

    def events(self, action):
        return list(self.run_().events.filter(action=action).order_by("id"))

    def reasons(self):
        return [e.reason for e in self.events("rejected")]

    def gh_output(self):
        with open(self.gh, encoding="utf-8") as f:
            return f.read()

    def authored(self, game=None):
        rows = Question.objects.filter(created_by="author").order_by("id")
        return list(rows.filter(game=game) if game else rows)


class ApplyProposalsTests(EditorialAuthorTestCase):
    def test_good_proposals_land_pending_with_scores(self):
        self.write([proposal("fan-favorites", board()), proposal("who-would-win", matchup()),
                    proposal("connections", {"groups": groups()})])
        self.apply()
        rows = self.authored()
        self.assertEqual(sorted(r.game for r in rows), ["connections", "fan-favorites", "who-would-win"])
        for row in rows:
            with self.subTest(game=row.game):
                self.assertEqual(row.status, Question.STATUS_PENDING)
                for key in ("difficulty", "band", "interest", "coverage", "dup_key", "payload_sha"):
                    self.assertIn(key, row.quality)
                self.assertEqual(row.dataset_version, "ds-author")
        ff = self.authored("fan-favorites")[0]
        self.assertTrue(ff.definition["survey_date"])  # filled in by code
        self.assertTrue(ff.players_referenced)
        self.assertEqual(self.run_().kind, "editorial")
        generated = self.events("generated")
        self.assertEqual([e.reason for e in generated], ["author"] * 3)
        self.assertEqual(generated[0].detail["why"], "Fans love this")
        self.assertIn("accepted=3", self.gh_output())
        self.assertFalse(Question.objects.filter(status=Question.STATUS_ACTIVE).exists())

    def test_duplicates_are_rejected(self):
        self.live("fan-favorites", {**board(), "survey_date": "2026-01-01"}, "ff-001")
        self.live("who-would-win", matchup(), "www-001", status=Question.STATUS_PENDING)
        swapped = {"a": matchup()["b"], "b": matchup()["a"]}
        self.write([proposal("fan-favorites", board(prompt="Name a player with 2 or more MVP awards!")),
                    proposal("who-would-win", swapped),
                    proposal("fan-favorites", board(prompt="Name a two-time MVP")),
                    proposal("fan-favorites", board(prompt="Name a two-time MVP"))])
        self.apply()
        self.assertEqual(self.reasons(), ["duplicate", "duplicate", "duplicate"])
        self.assertEqual([r.definition["prompt"] for r in self.authored()], ["Name a two-time MVP"])
        self.assertIn("accepted=1", self.gh_output())

    def test_unknown_player_is_rejected(self):
        g = groups()
        g[3]["members"][0] = "Not A Real Player"
        self.write([proposal("connections", {"groups": g})])
        self.apply()
        self.assertEqual(self.reasons(), ["invalid"])
        self.assertIn("Not A Real Player", self.events("rejected")[0].detail["problems"][0])
        self.assertEqual(self.authored(), [])
        self.assertIn("accepted=0", self.gh_output())

    def test_invalid_definitions_are_rejected(self):
        self.write([proposal("fan-favorites", board(rule={"award": "nobel"})),
                    proposal("fan-favorites", board(prompt="Name a player with 10+ All-Star picks",
                                                    rule={"allstar": 10})),  # 33 answers: over 17
                    proposal("who-would-win", {"a": side("1995-96", "Chicago Bulls"),
                                               "b": side("1995-96", "Atlantis Tridents")})])
        self.apply()
        self.assertEqual(self.reasons(), ["invalid"] * 3)
        self.assertEqual(self.authored(), [])

    def test_malformed_file_is_rejected_and_journaled(self):
        for raw in ("not json {", json.dumps({"proposals": "nope"}), json.dumps([1, 2])):
            with self.subTest(raw=raw):
                self.write(None, raw=raw)
                self.apply()
                self.assertEqual(self.reasons(), ["malformed_file"])
                self.assertIn("accepted=0", self.gh_output())
        os.remove(os.path.join(self.dir, "proposals.json"))
        self.apply()
        self.assertEqual(self.reasons(), ["malformed_file"])
        self.assertEqual(self.authored(), [])

    def test_malformed_proposals_and_other_games(self):
        self.write(["x", {"game": "fan-favorites"}, proposal("fan-favorites", board(), why=7),
                    proposal("career-path", {"person_id": 1}), proposal("nope", {})])
        self.apply()
        self.assertEqual(self.reasons(), ["malformed", "malformed", "malformed", "not_editorial", "not_editorial"])

    def test_too_deeply_nested_definition_is_malformed(self):
        # json.load must read it, copy.deepcopy must hit the recursion limit. deepcopy spends two frames
        # per level and json's own limit differs by interpreter (3.11 counts Python recursion, 3.12 does not),
        # so derive the depth from the limit: 0.6x is parsed by json everywhere, yet 1.2x frames overflow deepcopy.
        depth = int(sys.getrecursionlimit() * 0.6)
        nested = json.loads("[" * depth + "]" * depth)
        with self.assertRaises(RecursionError):
            copy.deepcopy(nested)
        deep = '{"game": "fan-favorites", "definition": {"rule": ' + "[" * depth + "]" * depth + '}, "why": "x"}'
        good = json.dumps(proposal("fan-favorites", board()))
        self.write(None, raw='{"proposals": [' + deep + ", " + good + "]}")
        self.apply()
        self.assertEqual(self.reasons(), ["malformed"])
        self.assertEqual(len(self.authored("fan-favorites")), 1)
        self.assertIn("accepted=1", self.gh_output())

    def test_answers_or_members_only_need_a_rule(self):
        answers = {"prompt": "Name a coach", "category": "coach", "survey_date": "2026-10-16",
                   "answers": [{"answer": "Phil Jackson", "count": 50, "aliases": []}]}
        g = groups()
        del g[3]["rule"]
        self.write([proposal("fan-favorites", answers), proposal("connections", {"groups": g})])
        self.apply()
        self.assertEqual(self.reasons(), ["needs_rule", "needs_rule"])
        self.assertEqual(self.authored(), [])

    def test_oversized_strings_are_rejected(self):
        long_label = groups()
        long_label[0]["label"] = "x" * 61
        self.write([proposal("fan-favorites", board(prompt="Name " + "a" * 200)),
                    proposal("connections", {"groups": long_label}),
                    proposal("who-would-win", {"a": side("1995-96", "Chicago Bulls", "s" * 91),
                                               "b": matchup()["b"]}),
                    proposal("fan-favorites", board(), why="w" * 501)])
        self.apply()
        self.assertEqual(self.reasons(), ["too_long"] * 4)
        self.assertEqual(self.authored(), [])

    def test_at_most_five_per_game(self):
        self.write([proposal("fan-favorites", board(prompt=f"Name a multiple MVP winner, take {i}"))
                    for i in range(7)] + [proposal("who-would-win", matchup())])
        self.apply()
        self.assertEqual(len(self.authored("fan-favorites")), 5)
        self.assertEqual(len(self.authored("who-would-win")), 1)
        self.assertEqual(self.reasons(), ["over_quota", "over_quota"])
        self.assertIn("accepted=6", self.gh_output())

    def test_owner_bulk_import_raises_the_quota(self):
        self.write([proposal("fan-favorites", board(prompt=f"Name a multiple MVP winner, take {i}"))
                    for i in range(7)])
        call_command("apply_editorial_proposals", self.dir, "--quota", "6", stdout=StringIO())
        self.assertEqual(len(self.authored("fan-favorites")), 6)
        self.assertEqual(self.reasons(), ["over_quota"])
        self.assertTrue(all(r.status == Question.STATUS_PENDING for r in self.authored()))

    def test_owner_bulk_import_raises_the_file_limit(self):
        self.write([proposal("fan-favorites", board(prompt=f"Name a multiple MVP winner, take {i}"))
                    for i in range(4)])
        call_command("apply_editorial_proposals", self.dir, "--max-proposals", "2", stdout=StringIO())
        self.assertEqual(len(self.authored("fan-favorites")), 2)
        self.assertEqual(self.reasons(), ["too_many"])

    def test_low_interest_is_rejected(self):
        early = [r for r in rules.playoff_rows() if r["round"] == "First Round"]
        a, b = early[0], early[1]
        loser = lambda r: r["team_b"] if r["winner"] == r["team_a"] else r["team_a"]  # noqa: E731
        self.write([proposal("who-would-win", {"a": side(a["season"], loser(a)), "b": side(b["season"], loser(b))})])
        self.apply()
        self.assertEqual(self.reasons(), ["low_interest"])

    def test_nothing_becomes_active(self):
        self.live("fan-favorites", {**board(prompt="Seed board"), "survey_date": "2026-01-01"}, "ff-001")
        self.write([proposal("fan-favorites", board()), proposal("connections", {"groups": groups()})])
        self.apply()
        self.assertEqual(list(Question.objects.filter(status=Question.STATUS_ACTIVE).values_list("qid", flat=True)),
                         ["ff-001"])
        self.assertTrue(all(r.status == Question.STATUS_PENDING for r in self.authored()))
        self.assertEqual(self.authored("fan-favorites")[0].qid, "ff-002")


class ExportBriefTests(EditorialAuthorTestCase):
    def export(self):
        out = os.path.join(self.tmp, "brief-out")
        call_command("export_editorial_brief", "--out", out, stdout=StringIO())
        with open(os.path.join(out, "brief.json"), encoding="utf-8") as f:
            return json.load(f)

    def test_brief(self):
        self.live("fan-favorites", {**board(), "survey_date": "2026-01-01"}, "ff-001")
        self.live("who-would-win", matchup(), "www-001")
        self.live("connections", {"groups": groups()}, "cn-001", status=Question.STATUS_PENDING)
        brief = self.export()
        self.assertEqual(brief["quota"], {"fan-favorites": 5, "who-would-win": 5, "connections": 5})
        lang = brief["rule_language"]
        self.assertIn("award", lang["player_predicates"])
        self.assertIn("champion", lang["team_predicates"])
        examples = lang["examples"]
        self.assertGreaterEqual(len(examples), 6)
        self.assertTrue(any(e.get("category") == "team" for e in examples))
        group = next(e for e in examples if "group" in e)
        self.assertEqual(len(group["group"]["members"]), 4)
        for e in examples:
            rule = e["group"]["rule"] if "group" in e else e["rule"]
            rules.validate(rule, e.get("category", "player"))
        fields = brief["fields"]
        for key in ("positions", "countries", "debut_decades", "stints", "awards", "career", "draft"):
            self.assertIn(key, fields)
        self.assertLessEqual(len(fields["countries"]), 20)
        self.assertEqual(brief["existing"]["fan-favorites"], ["Name a player with 2 or more MVP awards"])
        self.assertEqual(brief["existing"]["who-would-win"],
                         ["1995-96 Chicago Bulls | 2016-17 Golden State Warriors"])
        self.assertEqual(sorted(brief["existing"]["connections"])[0], "Averaged 8 assists a game")
        self.assertEqual(set(brief["coverage"]), {"fan-favorites", "who-would-win", "connections"})
        self.assertIn("decade", brief["coverage"]["who-would-win"]["counts"])
        self.assertEqual(len(brief["sample_players"]), 40)
        sample = brief["sample_players"][0]
        self.assertIn("full_name", sample)
        self.assertNotIn("person_id", sample)
        notable = brief["notable_team_seasons"]
        self.assertIn({"season": "1995-96", "franchise": "Chicago Bulls", "result": "champion"},
                      [{k: n[k] for k in ("season", "franchise", "result")} for n in notable])
        self.assertTrue(all(int(n["season"][:4]) >= 1979 for n in notable))
        self.assertEqual(len(brief["allowed_sites"]), 4)


class WorkflowTests(TestCase):
    def test_ai_job_holds_no_database_secret(self):
        with open(WORKFLOW, encoding="utf-8") as f:
            text = f.read()  # plain text: PyYAML is not a backend requirement
        head, jobs = text.split("\njobs:\n")
        export, rest = jobs.split("\n  author:\n")
        author, apply = rest.split("\n  apply:\n")
        self.assertIn("DATABASE_URL", export)
        self.assertIn("DATABASE_URL", apply)
        self.assertNotIn("DATABASE_URL", author)
        self.assertIn("github_token: ${{ secrets.GITHUB_TOKEN }}", author)
        self.assertIn('--disallowedTools "Bash,Edit,MultiEdit,WebSearch,Agent,Task,NotebookEdit"', author)
        self.assertIn('cron: "0 3 * * 3"', head)
        self.assertIn("group: editorial-author", head)
        self.assertNotIn("gh workflow run", text)  # the daily Checker picks the pending rows up
