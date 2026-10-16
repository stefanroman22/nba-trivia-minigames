"""Award seasons for Guess the MVP (trivia/data_pipeline/award_seasons.py).

One row per (season, award) for the five major awards: the MVP rows from the
committed CSV, the other four from the curated rows' award years, with the 1989
Sixth Man of the Year gap filled by a seeded DataCorrection.
"""
import json
import os
from collections import Counter

from django.conf import settings
from django.test import TestCase

from trivia.data_pipeline import award_seasons, publish_v3
from trivia.data_pipeline.live_pool import CURATED_PATH
from trivia.data_pipeline.sources import load_mvps
from trivia.management.commands import build_pools_from_db
from trivia.models import DataCorrection, Mvp, Team
from trivia.questions import corrections
from trivia.questions.base import load_dataset_from_rows

MVPS_CSV = os.path.join(settings.BASE_DIR, "trivia", "utils", "nba_mvps.csv")
OLD_KEYS = ("season", "mvp", "team", "team_logo_url")


def _shipped():
    with open(CURATED_PATH, encoding="utf-8") as f:
        rows = json.load(f)
    return corrections.apply(rows), load_mvps(MVPS_CSV)


def _player(person_id, name, teams, **awards):
    base = {"mvp": [], "fmvp": [], "dpoy": [], "roty": None, "smoy": [],
            "allstar_count": 0, "allnba_count": 0, "rings": []}
    base.update(awards)
    return {"person_id": person_id, "full_name": name, "teams": teams, "awards": base}


def _stint(abbr, name, start, end):
    return {"abbr": abbr, "name": name, "start_year": start, "end_year": end, "gp": 82, "ppg": 10.0}


class ShippedDataTests(TestCase):
    """The shipped curated file + MVP CSV, with the seeded correction applied."""

    @classmethod
    def setUpTestData(cls):
        rows, mvps = _shipped()
        cls.built = award_seasons.build(rows, mvps)

    def _row(self, season, award):
        hits = [r for r in self.built if r["season"] == season and r["award"] == award]
        self.assertEqual(len(hits), 1, (season, award))
        return hits[0]

    def test_counts_per_award(self):
        counts = Counter(r["award"] for r in self.built)
        self.assertEqual(dict(counts), {
            "MVP": 71, "Finals MVP": 58, "Defensive Player of the Year": 44,
            "Rookie of the Year": 74, "Sixth Man of the Year": 44,
        })

    def test_one_row_per_season_and_award(self):
        keys = [(r["season"], r["award"]) for r in self.built]
        self.assertEqual(len(keys), len(set(keys)))

    def test_co_winners_share_one_row_sorted_by_name(self):
        for season, names in (("1970-71", ["Dave Cowens", "Geoff Petrie"]),
                              ("1994-95", ["Grant Hill", "Jason Kidd"]),
                              ("1999-00", ["Elton Brand", "Steve Francis"])):
            row = self._row(season, "Rookie of the Year")
            self.assertEqual([w["name"] for w in row["winners"]], names)
            self.assertEqual(row["mvp"], names[0])

    def test_the_1989_sixth_man_comes_from_the_correction(self):
        row = self._row("1988-89", "Sixth Man of the Year")
        self.assertEqual(row["winners"], [{"name": "Eddie Johnson", "person_id": 698,
                                           "team": "Phoenix Suns", "team_logo_url": None}])
        self.assertEqual(row["prompt"], "Who was the Sixth Man of the Year in 1988-89?")

    def test_mvp_rows_keep_the_csv_fields_and_find_the_player(self):
        csv_rows = load_mvps(MVPS_CSV)
        mvp_rows = [r for r in self.built if r["award"] == "MVP"]
        self.assertEqual([{k: r[k] for k in OLD_KEYS} for r in mvp_rows], csv_rows)
        self.assertTrue(all(len(r["winners"]) == 1 and r["winners"][0]["person_id"] for r in mvp_rows))
        self.assertEqual([r["winners"][0]["name"] for r in mvp_rows], [r["mvp"] for r in csv_rows])

    def test_order_is_season_then_award(self):
        order = [a for a, _ in award_seasons.AWARDS]
        keys = [(award_seasons.end_year(r["season"]), order.index(r["award"])) for r in self.built]
        self.assertEqual(keys, sorted(keys))
        self.assertEqual([r["award"] for r in self.built if r["season"] == "2024-25"],
                         ["MVP", "Finals MVP", "Defensive Player of the Year",
                          "Rookie of the Year", "Sixth Man of the Year"])

    def test_prompts(self):
        self.assertEqual(self._row("2024-25", "MVP")["prompt"], "Who was the MVP in 2024-25?")
        self.assertEqual(self._row("2024-25", "Finals MVP")["prompt"], "Who was the Finals MVP in 2024-25?")
        self.assertEqual(self._row("1982-83", "Defensive Player of the Year")["prompt"],
                         "Who was the Defensive Player of the Year in 1982-83?")
        self.assertEqual(self._row("1952-53", "Rookie of the Year")["prompt"],
                         "Who was the Rookie of the Year in 1952-53?")


class SeededCorrectionTests(TestCase):
    def test_the_migration_seeds_one_active_sourced_correction(self):
        c = DataCorrection.objects.get(person_id=698, field_path="awards.smoy")
        self.assertEqual(c.status, DataCorrection.STATUS_ACTIVE)
        self.assertEqual(c.created_by, "owner")
        self.assertEqual(c.old_value, [])
        self.assertEqual(c.new_value, [1989])
        self.assertEqual(len(c.sources), 2)
        self.assertTrue(any("basketball-reference.com" in s for s in c.sources))
        self.assertTrue(any("en.wikipedia.org" in s for s in c.sources))
        self.assertEqual(c.reason, "1988-89 Sixth Man of the Year missing from nba_api awards")


class BuildTests(TestCase):
    """build() on small synthetic rows: team inference, logos, purity."""

    LOGOS = {"PHX": "https://cdn/phx.svg", "OKC": "https://cdn/okc.svg"}

    def test_team_is_the_stint_covering_the_season(self):
        rows = [_player(1, "Kevin Durant", [_stint("OKC", "Seattle SuperSonics", 2007, 2008),
                                            _stint("OKC", "Oklahoma City Thunder", 2008, 2016),
                                            _stint("GSW", "Golden State Warriors", 2016, 2019)],
                        fmvp=[2017], roty=2008)]
        built = award_seasons.build(rows, [], self.LOGOS)
        roty = next(r for r in built if r["award"] == "Rookie of the Year")
        self.assertEqual(roty["winners"][0]["team"], "Seattle SuperSonics")
        self.assertEqual(roty["winners"][0]["team_logo_url"], "https://cdn/okc.svg")
        self.assertEqual((roty["team"], roty["team_logo_url"]), ("Seattle SuperSonics", "https://cdn/okc.svg"))
        fmvp = next(r for r in built if r["award"] == "Finals MVP")
        self.assertEqual(fmvp["winners"][0]["team"], "Golden State Warriors")
        self.assertIsNone(fmvp["winners"][0]["team_logo_url"], "no logo for a franchise the map lacks")

    def test_a_trade_season_gives_no_team(self):
        # Traded during 2003-04: one stint ends with it, the next starts with it.
        rows = [_player(2, "Rasheed Wallace", [_stint("POR", "Portland Trail Blazers", 1996, 2004),
                                               _stint("DET", "Detroit Pistons", 2003, 2009)],
                        smoy=[2004])]
        row = award_seasons.build(rows, [], self.LOGOS)[0]
        self.assertEqual(row["winners"][0]["team"], None)
        self.assertEqual(row["winners"][0]["team_logo_url"], None)
        self.assertEqual((row["team"], row["team_logo_url"]), (None, None))

    def test_no_covering_stint_gives_no_team(self):
        rows = [_player(3, "Nobody", [_stint("PHX", "Phoenix Suns", 1990, 1992)], dpoy=[1999])]
        self.assertEqual(award_seasons.build(rows, [], self.LOGOS)[0]["winners"][0]["team"], None)

    def test_an_open_ended_stint_covers_the_current_season(self):
        rows = [_player(4, "Active", [_stint("PHX", "Phoenix Suns", 2020, None)], dpoy=[2026])]
        winner = award_seasons.build(rows, [], self.LOGOS)[0]["winners"][0]
        self.assertEqual((winner["team"], winner["team_logo_url"]), ("Phoenix Suns", "https://cdn/phx.svg"))

    def test_logo_for_may_be_a_callable(self):
        rows = [_player(4, "Active", [_stint("PHX", "Phoenix Suns", 2020, None)], dpoy=[2026])]
        winner = award_seasons.build(rows, [], lambda abbr: f"https://cdn/{abbr}")[0]["winners"][0]
        self.assertEqual(winner["team_logo_url"], "https://cdn/PHX")

    def test_mvp_row_shape_is_additive(self):
        mvps = [{"season": "2015-16", "mvp": "Stephen Curry", "team": "Golden State Warriors",
                 "team_logo_url": "https://example.com/gsw.png"}]
        rows = [_player(201939, "Stephen Curry", [_stint("GSW", "Golden State Warriors", 2009, None)],
                        mvp=[2015, 2016])]
        self.assertEqual(award_seasons.build(rows, mvps), [{
            "season": "2015-16", "mvp": "Stephen Curry", "team": "Golden State Warriors",
            "team_logo_url": "https://example.com/gsw.png", "award": "MVP",
            "winners": [{"name": "Stephen Curry", "person_id": 201939, "team": "Golden State Warriors",
                         "team_logo_url": "https://example.com/gsw.png"}],
            "prompt": "Who was the MVP in 2015-16?",
        }])

    def test_build_is_pure(self):
        rows = [_player(2, "Rasheed Wallace", [_stint("POR", "Portland Trail Blazers", 1996, 2004)], smoy=[2000])]
        before = json.dumps(rows, sort_keys=True)
        with self.assertNumQueries(0):
            award_seasons.build(rows, [], self.LOGOS)
        self.assertEqual(json.dumps(rows, sort_keys=True), before)


class PoolTests(TestCase):
    """The published `mvps` pool: build_pools_from_db.build_mvps and the v3 layout."""

    def setUp(self):
        Team.objects.create(team_id=1610612744, full_name="Golden State Warriors", abbreviation="GSW")
        Team.objects.create(team_id=1610612756, full_name="Phoenix Suns", abbreviation="PHX",
                            logo="https://example.com/phx.svg")
        Mvp.objects.create(season="2015-16", mvp="Stephen Curry", team="Golden State Warriors",
                           team_logo_url="https://example.com/gsw.png")
        Mvp.objects.create(season="1992-93", mvp="Charles Barkley", team="Phoenix Suns", team_logo_url="")
        self.dataset = load_dataset_from_rows([
            _player(201939, "Stephen Curry", [_stint("GSW", "Golden State Warriors", 2009, None)],
                    mvp=[2015, 2016], fmvp=[2022]),
            _player(698, "Eddie Johnson", [_stint("PHX", "Phoenix Suns", 1987, 1991)], smoy=[1989]),
            _player(787, "Charles Barkley", [_stint("PHX", "Phoenix Suns", 1992, 1996)], mvp=[1993]),
        ], "curated-test")

    def test_mvp_rows_keep_their_old_fields_exactly(self):
        pool = build_pools_from_db.build_mvps(dataset=self.dataset)
        old = [{"season": m.season, "mvp": m.mvp, "team": m.team, "team_logo_url": m.team_logo_url}
               for m in Mvp.objects.all().order_by("season")]
        self.assertEqual([{k: r[k] for k in OLD_KEYS} for r in pool if r["award"] == "MVP"], old)
        for r in pool:
            self.assertEqual(set(r), set(OLD_KEYS) | {"award", "winners", "prompt"})

    def test_other_awards_get_the_team_table_logo(self):
        pool = build_pools_from_db.build_mvps(dataset=self.dataset)
        smoy = next(r for r in pool if r["award"] == "Sixth Man of the Year")
        self.assertEqual((smoy["season"], smoy["mvp"], smoy["team"], smoy["team_logo_url"]),
                         ("1988-89", "Eddie Johnson", "Phoenix Suns", "https://example.com/phx.svg"))
        fmvp = next(r for r in pool if r["award"] == "Finals MVP")
        self.assertEqual(fmvp["team_logo_url"], "https://cdn.nba.com/logos/nba/1610612744/primary/L/logo.svg")

    def test_without_a_dataset_it_reads_the_curated_file_with_corrections(self):
        pool = build_pools_from_db.build_mvps()
        self.assertTrue(any(r["season"] == "1988-89" and r["award"] == "Sixth Man of the Year" for r in pool))

    def test_published_file_keeps_season_then_award_order(self):
        rows = build_pools_from_db.build_mvps(dataset=self.dataset)
        build = publish_v3.encode_game("mvps", list(reversed(rows)))
        published = publish_v3.decode_game(build.entry, build.files.__getitem__)
        self.assertEqual([(r["season"], r["award"]) for r in published],
                         [("1988-89", "Sixth Man of the Year"), ("1992-93", "MVP"),
                          ("2015-16", "MVP"), ("2021-22", "Finals MVP")])
