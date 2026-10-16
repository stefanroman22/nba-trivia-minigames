"""The editorial rule language (trivia.questions.rules, spec §4.6)."""
from django.test import SimpleTestCase

from trivia.questions import rules
from trivia.questions.rules import RuleError
from trivia.questions.base import load_dataset_from_rows
from trivia.tests.questions_fixture import fixture_dataset, fixture_rows


def names(rows):
    return {r.get("full_name") or r.get("name") for r in rows}


class PlayerPredicateTests(SimpleTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.ds = fixture_dataset()

    def where(self, test):
        return {r["full_name"] for r in self.ds.playable if test(r)}

    def ev(self, rule):
        return names(rules.evaluate(rule, self.ds))

    def test_award(self):
        got = self.ev({"award": "mvp", "min": 2})
        self.assertEqual(got, self.where(lambda r: len(r["awards"]["mvp"]) >= 2))
        self.assertIn("Michael Jordan", got)
        self.assertNotIn("Derrick Rose", got)
        self.assertIn("Derrick Rose", self.ev({"award": "mvp"}))  # min defaults to 1
        self.assertEqual(self.ev({"award": "roty"}), self.where(lambda r: bool(r["awards"]["roty"])))
        self.assertEqual(self.ev({"award": "rings", "min": 5}),
                         self.where(lambda r: len(r["awards"]["rings"]) >= 5))
        for kind in ("fmvp", "dpoy", "smoy"):
            self.assertEqual(self.ev({"award": kind}), self.where(lambda r, k=kind: len(r["awards"][k]) >= 1))

    def test_allstar_and_allnba(self):
        self.assertEqual(self.ev({"allstar": 15}), self.where(lambda r: r["awards"]["allstar_count"] >= 15))
        self.assertEqual(self.ev({"allnba": 10}), self.where(lambda r: r["awards"]["allnba_count"] >= 10))

    def test_career(self):
        got = self.ev({"career": "pts", "min": 30000})
        self.assertEqual(got, {"Karl Malone", "Michael Jordan", "Kobe Bryant", "Dirk Nowitzki", "LeBron James",
                               "Kareem Abdul-Jabbar", "Wilt Chamberlain", "Kevin Durant"})
        self.assertEqual(self.ev({"career": "ppg", "min": 25.5}),
                         self.where(lambda r: (r["career"].get("ppg") or 0) >= 25.5))
        self.assertEqual(self.ev({"career": "seasons", "min": 20}),
                         self.where(lambda r: (r["career"].get("seasons") or 0) >= 20))

    def test_draft(self):
        self.assertEqual(self.ev({"draft": {"pick_max": 1, "year_from": 2010}}),
                         {"Kyrie Irving", "Anthony Davis", "Karl-Anthony Towns", "Zion Williamson",
                          "Anthony Edwards", "Victor Wembanyama"})
        self.assertEqual(self.ev({"draft": {"undrafted": True}}), self.where(lambda r: not r.get("draft")))
        self.assertEqual(self.ev({"draft": {"round": 2}}),
                         self.where(lambda r: (r.get("draft") or {}).get("round") == 2))
        self.assertEqual(self.ev({"draft": {"year_from": 1984, "year_to": 1984}}),
                         self.where(lambda r: (r.get("draft") or {}).get("year") == 1984))

    def test_pick_max_counts_real_picks_only(self):
        # A territorial / unknown pick is stored as pick 0 (205 rows in the real data): not a top pick.
        rows = fixture_rows()
        row = next(r for r in rows if r["full_name"] == "Bill Russell")
        row["draft"] = {"year": 1956, "round": 1, "pick": 0, "team_abbr": "BOS"}
        ds = load_dataset_from_rows(rows, "fixture-pick0")
        got = names(rules.evaluate({"draft": {"pick_max": 14}}, ds))
        self.assertNotIn("Bill Russell", got)
        self.assertIn("Tim Duncan", got)
        self.assertIn("Bill Russell", names(rules.evaluate({"draft": {"round": 1}}, ds)))

    def test_country_and_international(self):
        self.assertEqual(self.ev({"country": "france"}), self.where(lambda r: r.get("country") == "France"))
        got = self.ev({"international": True})
        self.assertEqual(got, self.where(lambda r: r.get("country") not in (None, "", "USA")))
        self.assertIn("Nikola Jokić", got)
        self.assertNotIn("Michael Jordan", got)

    def test_stint_debut_decade_seasons_position(self):
        self.assertEqual(self.ev({"stint": "GSW"}),
                         self.where(lambda r: any(s["abbr"] == "GSW" for s in r["teams"])))
        self.assertEqual(self.ev({"debut_decade": 1990}),
                         self.where(lambda r: min(s["start_year"] for s in r["teams"]) // 10 * 10 == 1990))
        self.assertEqual(self.ev({"seasons": 20}), self.ev({"career": "seasons", "min": 20}))
        centers = self.ev({"position": "C"})
        self.assertEqual(centers, self.where(lambda r: "C" in (r.get("position") or "").split("-")))
        self.assertIn("Tim Duncan", centers | self.ev({"position": "F"}))

    def test_playoff_team(self):
        got = self.ev({"playoff_team": {"season": "2014-15", "franchise": "Golden State Warriors"}})
        self.assertTrue({"Stephen Curry", "Klay Thompson", "Draymond Green", "Andre Iguodala"} <= got)
        self.assertNotIn("Kevin Durant", got)  # joined in 2016
        # 2019-20: the Warriors missed the playoffs, so that team-season is not in playoff.json.
        self.assertEqual(self.ev({"playoff_team": {"season": "2019-20", "franchise": "Golden State Warriors"}}),
                         set())

    def test_combinators(self):
        mvp2 = self.ev({"award": "mvp", "min": 2})
        intl = self.ev({"international": True})
        self.assertEqual(self.ev({"all": [{"award": "mvp", "min": 2}, {"international": True}]}), mvp2 & intl)
        self.assertEqual(self.ev({"any": [{"award": "mvp", "min": 2}, {"international": True}]}), mvp2 | intl)
        self.assertEqual(self.ev({"all": [{"award": "mvp", "min": 2}, {"not": {"international": True}}]}),
                         mvp2 - intl)

    def test_evaluate_keeps_the_pool_order(self):
        rows = rules.evaluate({"award": "mvp", "min": 2}, self.ds)
        order = [r["person_id"] for r in self.ds.playable]
        self.assertEqual([r["person_id"] for r in rows], sorted((r["person_id"] for r in rows), key=order.index))


class TeamPredicateTests(SimpleTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.ds = fixture_dataset()

    def ev(self, rule):
        return names(rules.evaluate(rule, self.ds, category="team"))

    def test_champion_range(self):
        self.assertEqual(self.ev({"champion": {"year_from": 2000, "year_to": 2011}}),
                         {"Los Angeles Lakers", "San Antonio Spurs", "Detroit Pistons", "Miami Heat",
                          "Boston Celtics", "Dallas Mavericks"})

    def test_champion_min(self):
        got = self.ev({"champion": {"min": 3}})
        self.assertTrue({"Los Angeles Lakers", "Boston Celtics", "Chicago Bulls", "San Antonio Spurs",
                         "Golden State Warriors", "Miami Heat", "Detroit Pistons"} <= got)
        self.assertNotIn("Phoenix Suns", got)

    def test_finals(self):
        got = self.ev({"finals": {"year_from": 2020, "year_to": 2025}})
        self.assertTrue({"Los Angeles Lakers", "Miami Heat", "Milwaukee Bucks", "Phoenix Suns",
                         "Golden State Warriors", "Boston Celtics", "Denver Nuggets", "Dallas Mavericks",
                         "Oklahoma City Thunder", "Indiana Pacers"} <= got)
        self.assertNotIn("Utah Jazz", got)

    def test_playoff_team_season(self):
        got = self.ev({"playoff_team": {"season": "2014-15"}})
        self.assertIn("Golden State Warriors", got)
        self.assertNotIn("Los Angeles Lakers", got)  # missed the 2015 playoffs
        self.assertEqual(self.ev({"playoff_team": {"season": "2014-15", "franchise": "Golden State Warriors"}}),
                         {"Golden State Warriors"})

    def test_team_rows_are_the_current_franchises(self):
        rows = rules.evaluate({"not": {"champion": {}}}, self.ds, category="team")
        self.assertTrue(all(set(r) >= {"name", "abbr"} for r in rows))
        self.assertIn("Charlotte Hornets", names(rows))
        self.assertEqual(len(rules.team_rows()), 30)


class DescribeTests(SimpleTestCase):
    def test_sentences(self):
        self.assertEqual(rules.describe({"award": "mvp", "min": 2}), "won MVP at least 2 times")
        self.assertEqual(rules.describe({"award": "dpoy"}), "won Defensive Player of the Year")
        self.assertEqual(rules.describe({"career": "pts", "min": 30000}), "scored at least 30000 career points")
        self.assertEqual(rules.describe({"draft": {"pick_max": 1, "year_from": 2010}}),
                         "was drafted with pick 1 or better, in 2010 or later")
        self.assertEqual(rules.describe({"all": [{"international": True}, {"not": {"stint": "LAL"}}]}),
                         "was born outside the USA and not (played for LAL)")
        self.assertEqual(rules.describe({"champion": {"year_from": 2000, "year_to": 2011}}),
                         "won the NBA title from 2000 to 2011")
        self.assertIsInstance(rules.describe({"any": [{"allstar": 10}, {"allnba": 5}]}), str)


class ValidatorTests(SimpleTestCase):
    BAD = [
        ("not an object", ["award"]),
        ("no predicate", {}),
        ("unknown predicate", {"height": 80}),
        ("two predicates", {"allstar": 1, "allnba": 1}),
        ("unknown extra key", {"award": "mvp", "max": 3}),
        ("unknown award kind", {"award": "coy"}),
        ("bool is not an int", {"allstar": True}),
        ("min below 1", {"allnba": 0}),
        ("career needs min", {"career": "pts"}),
        ("career stat", {"career": "blk", "min": 1}),
        ("draft empty", {"draft": {}}),
        ("draft unknown key", {"draft": {"pick": 1}}),
        ("undrafted with others", {"draft": {"undrafted": True, "round": 2}}),
        ("undrafted false", {"draft": {"undrafted": False}}),
        ("draft range reversed", {"draft": {"year_from": 2010, "year_to": 2000}}),
        ("international must be true", {"international": False}),
        ("country empty", {"country": ""}),
        ("stint lowercase", {"stint": "gsw"}),
        ("decade not a decade", {"debut_decade": 1995}),
        ("position", {"position": "PG"}),
        ("season format", {"playoff_team": {"season": "2015", "franchise": "Golden State Warriors"}}),
        ("season years", {"playoff_team": {"season": "2014-16", "franchise": "Golden State Warriors"}}),
        ("player playoff_team needs a franchise", {"playoff_team": {"season": "2014-15"}}),
        ("all needs a list", {"all": {"allstar": 1}}),
        ("all empty", {"any": []}),
        ("not needs a rule", {"not": [{"allstar": 1}]}),
        ("team predicate on players", {"champion": {"min": 1}}),
    ]

    def test_bad_player_rules(self):
        for why, rule in self.BAD:
            with self.subTest(why):
                with self.assertRaises(RuleError):
                    rules.validate(rule)

    def test_bad_team_rules(self):
        for rule in ({"award": "mvp"}, {"champion": {"min": 0}}, {"finals": {"year": 2000}},
                     {"champion": 3}, {"playoff_team": {"franchise": "Boston Celtics"}}):
            with self.subTest(rule=rule):
                with self.assertRaises(RuleError):
                    rules.validate(rule, category="team")

    def test_unknown_category(self):
        with self.assertRaises(RuleError):
            rules.validate({"allstar": 1}, category="coach")

    def test_evaluate_validates_first(self):
        with self.assertRaises(RuleError):
            rules.evaluate({"award": "coy"}, fixture_dataset())

    def test_good_rules_pass(self):
        for rule in ({"award": "rings", "min": 3}, {"career": "apg", "min": 8.5},
                     {"draft": {"undrafted": True}}, {"all": [{"stint": "GSW"}, {"not": {"position": "C"}}]},
                     {"playoff_team": {"season": "1999-00", "franchise": "Los Angeles Lakers"}}):
            with self.subTest(rule=rule):
                rules.validate(rule)
        rules.validate({"any": [{"champion": {}}, {"finals": {"year_from": 2020}}]}, category="team")
