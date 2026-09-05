import json
import os
import tempfile
from contextlib import redirect_stdout
from io import StringIO
from unittest.mock import patch

import requests
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase, override_settings
from nba_api.stats.library.http import NBAStatsHTTP

from trivia.data_pipeline import curated_players as curated
from trivia.data_pipeline import sources

# team_id 1610612760 renamed Seattle SuperSonics -> Oklahoma City Thunder in 2008,
# 1610612766 Charlotte Bobcats -> Charlotte Hornets in 2014. Both come with the
# whole-franchise summary row the endpoint emits alongside the real name eras.
FRANCHISE_ROWS = [
    {"team_id": 1610612760, "name": "Oklahoma City Thunder", "start_year": 1967, "end_year": 2025},
    {"team_id": 1610612760, "name": "Oklahoma City Thunder", "start_year": 2008, "end_year": 2025},
    {"team_id": 1610612760, "name": "Seattle SuperSonics", "start_year": 1967, "end_year": 2007},
    {"team_id": 1610612766, "name": "Charlotte Hornets", "start_year": 1988, "end_year": 2025},
    {"team_id": 1610612766, "name": "Charlotte Bobcats", "start_year": 2004, "end_year": 2013},
]

DRAFT_ROWS = [
    {"person_id": 201142, "year": 2007, "round": 1, "pick": 2, "team_id": 1610612760,
     "team_abbr": "SEA", "organization": "Texas", "organization_type": "College/University"},
    {"person_id": 2544, "year": 2003, "round": 1, "pick": 1, "team_id": 1610612739,
     "team_abbr": "CLE", "organization": "St. Vincent-St. Mary HS (OH)",
     "organization_type": "High School"},
    {"person_id": 1629029, "year": 2018, "round": 1, "pick": 3, "team_id": 1610612737,
     "team_abbr": "ATL", "organization": "Real Madrid", "organization_type": "Other Team/Club"},
]

ABBRS = {1610612760: "OKC", 1610612766: "CHA", 1610612763: "MEM", 1610612755: "PHI"}


def _season(season_id, team_id, abbr, gp, pts, reb=0, ast=0):
    return {"SEASON_ID": season_id, "LEAGUE_ID": "00", "TEAM_ID": team_id,
            "TEAM_ABBREVIATION": abbr, "GP": gp, "PTS": pts, "REB": reb, "AST": ast}


def _profile(person_id=201142, name="Kevin Durant", status="Active", seasons=None,
             awards=None, totals=None, **info):
    base = {
        "PERSON_ID": person_id, "DISPLAY_FIRST_LAST": name, "POSITION": "Forward",
        "HEIGHT": "6-11", "WEIGHT": "240", "BIRTHDATE": "1988-09-29T00:00:00",
        "COUNTRY": "USA", "SCHOOL": "Texas", "JERSEY": "7", "ROSTERSTATUS": status,
        "DRAFT_YEAR": "2007",
    }
    base.update(info)
    seasons = seasons if seasons is not None else [_season("2007-08", 1610612760, "SEA", 80, 1624)]
    return {
        "info": [base],
        "career": seasons,
        "career_totals": totals if totals is not None else [{"GP": 80, "PTS": 1624, "REB": 347, "AST": 192}],
        "awards": awards or [],
    }


class EraNameTests(TestCase):
    def setUp(self):
        self.eras = curated.era_name_index(FRANCHISE_ROWS)

    def test_franchise_name_is_the_one_in_use_that_season(self):
        self.assertEqual(curated.era_name(self.eras, 1610612760, 2007), "Seattle SuperSonics")
        self.assertEqual(curated.era_name(self.eras, 1610612760, 2008), "Oklahoma City Thunder")

    def test_narrowest_era_wins_over_the_summary_row(self):
        # 2010 matches both "Charlotte Hornets 1988-2025" (the summary) and the
        # real Bobcats era; the era the team actually played under must win.
        self.assertEqual(curated.era_name(self.eras, 1610612766, 2010), "Charlotte Bobcats")
        self.assertEqual(curated.era_name(self.eras, 1610612766, 2016), "Charlotte Hornets")

    def test_an_unknown_franchise_era_is_none_not_a_name(self):
        self.assertIsNone(curated.era_name(self.eras, 42, 1950))
        self.assertIsNone(curated.era_name(self.eras, 1610612760, 1950))


class StintTests(TestCase):
    def setUp(self):
        self.eras = curated.era_name_index(FRANCHISE_ROWS)

    def test_rename_splits_the_stint_and_keeps_the_modern_abbr(self):
        seasons = [
            _season("2006-07", 1610612760, "SEA", 35, 700),
            _season("2007-08", 1610612760, "SEA", 80, 1624),
            _season("2008-09", 1610612760, "OKC", 74, 1871),
            _season("2009-10", 1610612760, "OKC", 82, 2472),
        ]
        stints = curated.build_stints(seasons, self.eras, ABBRS, is_active=False)
        self.assertEqual(
            [(s["abbr"], s["name"], s["start_year"], s["end_year"]) for s in stints],
            [("OKC", "Seattle SuperSonics", 2006, 2008),
             ("OKC", "Oklahoma City Thunder", 2008, 2010)],
        )
        self.assertEqual(stints[0]["gp"], 115)
        self.assertEqual(stints[0]["ppg"], round(2324 / 115, 1))

    def test_multi_team_summary_row_is_not_counted(self):
        seasons = [
            _season("2009-10", 1610612763, "MEM", 3, 37),
            _season("2009-10", 1610612755, "PHI", 25, 348),
            _season("2009-10", 0, "TOT", 28, 385),
        ]
        stints = curated.build_stints(seasons, self.eras, ABBRS, is_active=False)
        self.assertEqual([s["abbr"] for s in stints], ["MEM", "PHI"])
        self.assertEqual([s["gp"] for s in stints], [3, 25])

    def test_active_players_last_stint_is_open_ended(self):
        seasons = [_season("2024-25", 1610612760, "OKC", 70, 1400)]
        active = curated.build_stints(seasons, self.eras, ABBRS, is_active=True)
        retired = curated.build_stints(seasons, self.eras, ABBRS, is_active=False)
        self.assertIsNone(active[0]["end_year"])
        self.assertEqual(retired[0]["end_year"], 2025)

    def test_player_with_no_games_has_no_stints(self):
        self.assertEqual(curated.build_stints([], self.eras, ABBRS, is_active=True), [])

    def test_a_franchise_with_no_era_is_counted_not_silently_named(self):
        seasons = [_season("1949-50", 1610610025, "CHS", 60, 500)]  # Chicago Stags
        missing = []
        stints = curated.build_stints(seasons, self.eras, ABBRS, False, missing_eras=missing)
        # The abbreviation stands in so the row is still publishable, but the
        # gap is reported rather than passing for a franchise name.
        self.assertEqual(stints[0]["name"], "CHS")
        self.assertEqual(missing, [(1610610025, 1949, "CHS")])


class FieldTests(TestCase):
    def setUp(self):
        self.drafts = curated.draft_index(DRAFT_ROWS)

    def test_draft_team_is_the_team_that_drafted_him(self):
        self.assertEqual(
            curated.build_draft(curated.pick_draft(201142, self.drafts, 2007)),
            {"year": 2007, "round": 1, "pick": 2, "team_abbr": "SEA"},
        )

    def test_no_draft_record_is_a_null_draft(self):
        self.assertIsNone(curated.build_draft(curated.pick_draft(1112, self.drafts, 1996)))

    def test_a_player_drafted_twice_keeps_the_pick_that_started_his_career(self):
        drafts = curated.draft_index([
            {"person_id": 717, "year": 1986, "round": 1, "pick": 24, "team_id": 1,
             "team_abbr": "POR", "organization": "", "organization_type": ""},
            {"person_id": 717, "year": 1985, "round": 4, "pick": 77, "team_id": 2,
             "team_abbr": "ATL", "organization": "", "organization_type": ""},
        ])
        self.assertEqual(curated.pick_draft(717, drafts, 1986)["team_abbr"], "POR")
        # A re-entry draft during a career that had already started is not the
        # pick that started it (and would break the draft <= first-season rule).
        self.assertEqual(curated.pick_draft(717, drafts, 1985)["team_abbr"], "ATL")

    def test_college_drops_high_schools_and_clubs(self):
        self.assertIsNone(curated.build_college("St. Vincent-St. Mary HS (OH)", self.drafts[2544][0]))
        self.assertIsNone(curated.build_college("Real Madrid", self.drafts[1629029][0]))
        self.assertIsNone(curated.build_college("", None))
        self.assertEqual(curated.build_college("Texas", self.drafts[201142][0]), "Texas")
        self.assertEqual(curated.build_college("Virginia Union", None), "Virginia Union")

    def test_position_height_and_birth_year(self):
        self.assertEqual(curated.build_position("Forward-Guard"), "G-F")
        self.assertEqual(curated.build_position("Center-Forward"), "F-C")
        self.assertEqual(curated.build_position("Center"), "C")
        self.assertIsNone(curated.build_position(""))
        self.assertEqual(curated.build_height_in("6-9"), 81)
        self.assertIsNone(curated.build_height_in(""))
        self.assertEqual(curated.build_birth_year("1984-12-30T00:00:00"), 1984)

    def test_awards_aggregate_by_description(self):
        awards = curated.build_awards([
            {"DESCRIPTION": "NBA Most Valuable Player", "SEASON": "2013-14"},
            {"DESCRIPTION": "NBA Finals Most Valuable Player", "SEASON": "2016-17"},
            {"DESCRIPTION": "NBA Champion", "SEASON": "2016-17"},
            {"DESCRIPTION": "NBA Rookie of the Year", "SEASON": "2007-08"},
            {"DESCRIPTION": "NBA All-Star", "SEASON": "2009-10"},
            {"DESCRIPTION": "NBA All-Star", "SEASON": "2010-11"},
            {"DESCRIPTION": "All-NBA", "SEASON": "2009-10"},
            {"DESCRIPTION": "NBA Sporting News Most Valuable Player of the Year", "SEASON": "2013-14"},
            {"DESCRIPTION": "NBA Player of the Week", "SEASON": "2013-14"},
        ])
        self.assertEqual(awards["mvp"], [2014])
        self.assertEqual(awards["fmvp"], [2017])
        self.assertEqual(awards["rings"], [2017])
        self.assertEqual(awards["roty"], 2008)
        self.assertEqual(awards["allstar_count"], 2)
        self.assertEqual(awards["allnba_count"], 1)
        self.assertEqual(awards["dpoy"], [])

    def test_career_totals_and_derived_averages(self):
        career = curated.build_career(
            [{"GP": 100, "PTS": 2000, "REB": 500, "AST": 250}],
            [_season("2007-08", 1610612760, "SEA", 50, 1000),
             _season("2008-09", 1610612760, "OKC", 50, 1000)],
        )
        self.assertEqual(career, {"pts": 2000, "reb": 500, "ast": 250,
                                  "ppg": 20.0, "rpg": 5.0, "apg": 2.5, "seasons": 2})

    def test_career_of_a_player_who_never_played(self):
        career = curated.build_career([], [])
        self.assertEqual(career["pts"], 0)
        self.assertEqual(career["ppg"], 0.0)
        self.assertEqual(career["seasons"], 0)


class RowTests(TestCase):
    def setUp(self):
        self.drafts = curated.draft_index(DRAFT_ROWS)
        self.eras = curated.era_name_index(FRANCHISE_ROWS)

    def _row(self, profile, carry=None):
        return curated.build_row(profile, self.drafts, self.eras, ABBRS, carry or {})

    def test_row_has_exactly_the_frozen_schema_keys(self):
        row = self._row(_profile())
        self.assertEqual(list(row.keys()), [
            "person_id", "full_name", "aliases", "fame_tier", "position", "height_in",
            "weight_lb", "birth_year", "country", "college", "draft", "jersey",
            "is_active", "teams", "awards", "career",
        ])
        self.assertEqual(row["position"], "F")
        self.assertEqual(row["height_in"], 83)
        self.assertEqual(row["jersey"], 7)
        self.assertTrue(row["is_active"])
        self.assertEqual(row["draft"]["team_abbr"], "SEA")

    def test_accented_name_is_canonical_and_gains_a_folded_alias(self):
        row = self._row(_profile(person_id=1629029, name="Luka Dončić"))
        self.assertEqual(row["full_name"], "Luka Dončić")
        self.assertIn("Luka Doncic", row["aliases"])

    def test_fame_tier_and_aliases_carry_over_new_players_get_the_default(self):
        carry = {201142: {"fame_tier": 1, "aliases": ["KD", "Kevin Wayne Durant"]}}
        carried = self._row(_profile(), carry)
        self.assertEqual(carried["fame_tier"], 1)
        self.assertEqual(carried["aliases"], ["KD", "Kevin Wayne Durant"])
        newcomer = self._row(_profile(person_id=999999, name="Rookie Newcomer"), carry)
        self.assertEqual(newcomer["fame_tier"], curated.DEFAULT_FAME_TIER)

    def test_iguodala_moves_to_tier_two_in_the_carry_over_map(self):
        carry = curated.carry_over_index([
            {"person_id": 2738, "full_name": "Andre Iguodala", "fame_tier": 3, "aliases": []},
            {"person_id": 2544, "full_name": "LeBron James", "fame_tier": 1, "aliases": []},
        ])
        self.assertEqual(carry[2738]["fame_tier"], 2)
        self.assertEqual(carry[2544]["fame_tier"], 1)

    def test_inactive_roster_status_is_not_active(self):
        self.assertFalse(self._row(_profile(status="Inactive"))["is_active"])


class CacheTests(TestCase):
    def test_cached_players_are_not_refetched(self):
        calls = []

        def fetch(person_id):
            calls.append(person_id)
            return _profile(person_id=person_id)

        with tempfile.TemporaryDirectory() as d:
            cache = curated.ProfileCache(d)
            fetched, skipped, failures = curated.fetch_missing([1, 2], cache, fetch)
            self.assertEqual((fetched, skipped, failures), (2, 0, {}))
            fetched, skipped, failures = curated.fetch_missing([1, 2, 3], cache, fetch)
            self.assertEqual((fetched, skipped), (1, 2))
            self.assertEqual(calls, [1, 2, 3])

    def test_a_failing_player_is_reported_and_never_becomes_a_row(self):
        def fetch(person_id):
            if person_id == 2:
                raise RuntimeError("read timeout")
            return _profile(person_id=person_id)

        with tempfile.TemporaryDirectory() as d:
            cache = curated.ProfileCache(d)
            fetched, _, failures = curated.fetch_missing([1, 2], cache, fetch)
            self.assertEqual(fetched, 1)
            self.assertIn("read timeout", failures[2])
            rows, uncached, _, _, _ = curated.assemble_rows(
                [1, 2], cache, {}, {}, ABBRS, {}
            )
            self.assertEqual([r["person_id"] for r in rows], [1])
            self.assertEqual(uncached, [2])

    def test_bulk_payloads_are_fetched_once(self):
        calls = []
        with tempfile.TemporaryDirectory() as d:
            cache = curated.ProfileCache(d)
            for _ in range(2):
                payload = cache.bulk("draft_history", lambda: calls.append(1) or DRAFT_ROWS)
            self.assertEqual(len(calls), 1)
            self.assertEqual(payload, DRAFT_ROWS)

    def test_draft_gaps_are_reported_separately_from_undrafted_players(self):
        with tempfile.TemporaryDirectory() as d:
            cache = curated.ProfileCache(d)
            cache.put(1, _profile(person_id=1, DRAFT_YEAR="1966"))       # claims a draft
            cache.put(2, _profile(person_id=2, DRAFT_YEAR="Undrafted"))  # genuinely undrafted
            rows, _, draft_gaps, _, _ = curated.assemble_rows([1, 2], cache, {}, {}, ABBRS, {})
            self.assertEqual([r["draft"] for r in rows], [None, None])
            self.assertEqual(draft_gaps, [1])


_INFO_HEADERS = ["PERSON_ID", "DISPLAY_FIRST_LAST", "POSITION", "HEIGHT", "WEIGHT",
                 "BIRTHDATE", "COUNTRY", "SCHOOL", "JERSEY", "ROSTERSTATUS", "DRAFT_YEAR"]
_INFO_ROW = [2839, "James Thomas", "Forward", "6-7", "230", "1982-01-24T00:00:00",
             "USA", "Texas", "34", "Inactive", "2004"]
_SEASON_HEADERS = ["SEASON_ID", "LEAGUE_ID", "TEAM_ID", "TEAM_ABBREVIATION",
                   "GP", "PTS", "REB", "AST"]
# playercareerstats' load_response indexes all ten of these by name.
_CAREER_DATA_SETS = (
    "CareerTotalsAllStarSeason", "CareerTotalsCollegeSeason", "CareerTotalsPostSeason",
    "CareerTotalsRegularSeason", "SeasonRankingsPostSeason", "SeasonRankingsRegularSeason",
    "SeasonTotalsAllStarSeason", "SeasonTotalsCollegeSeason", "SeasonTotalsPostSeason",
    "SeasonTotalsRegularSeason",
)


def _result_set(name, headers=(), rows=()):
    return {"name": name, "headers": list(headers), "rowSet": [list(r) for r in rows]}


def _body(*result_sets):
    """A stats.nba.com response body, in the legacy resultSets format."""
    return json.dumps({"resource": "test", "parameters": {}, "resultSets": list(result_sets)})


def _info_body():
    return _body(
        _result_set("AvailableSeasons", ["SEASON_ID"], [["22004"]]),
        _result_set("CommonPlayerInfo", _INFO_HEADERS, [_INFO_ROW]),
        _result_set("PlayerHeadlineStats", ["PLAYER_ID"], [[2839]]),
    )


def _career_body():
    filled = {
        "SeasonTotalsRegularSeason": (
            _SEASON_HEADERS, [["2004-05", "00", 1610612760, "SEA", 20, 100, 40, 10]]
        ),
        "CareerTotalsRegularSeason": (["GP", "PTS", "REB", "AST"], [[20, 100, 40, 10]]),
    }
    return _body(*[_result_set(n, *filled.get(n, ((), ()))) for n in _CAREER_DATA_SETS])


def _awards_body():
    return _body(_result_set("PlayerAwards", ["PERSON_ID", "DESCRIPTION", "SEASON"], []))


class _FakeHTTPResponse:
    status_code = 200

    def __init__(self, text):
        self.url = "https://stats.nba.com/stats/test"
        self.text = text


class _FakeSession:
    """Stands in for requests.Session at nba_api's real HTTP boundary."""

    def __init__(self, bodies):
        self.bodies = bodies  # endpoint name -> body text, or an Exception to raise
        self.calls = []

    def get(self, url, params=None, headers=None, proxies=None, timeout=None):
        endpoint = url.rsplit("/", 1)[-1]
        self.calls.append(endpoint)
        answer = self.bodies[endpoint]
        if isinstance(answer, Exception):
            raise answer
        return _FakeHTTPResponse(answer)


class EmptyApiResponseTests(TestCase):
    """stats.nba.com answers some real players with a literal 2-byte `{}`.

    Mocked at nba_api's HTTP boundary, so the real endpoint classes, the real
    response parser, the real retry ladder and the real row assembly all run.
    """

    def _serve(self, **bodies):
        session = _FakeSession({
            "commonplayerinfo": bodies.get("info", _info_body()),
            "playercareerstats": bodies.get("career", _career_body()),
            "playerawards": bodies.get("awards", _awards_body()),
        })
        NBAStatsHTTP.set_session(session)
        self.addCleanup(NBAStatsHTTP.set_session, None)
        self.sleeps = []
        patcher = patch("trivia.data_pipeline.sources.time.sleep", self.sleeps.append)
        patcher.start()
        self.addCleanup(patcher.stop)
        return session

    def test_an_empty_career_response_yields_a_zeroed_row_and_is_counted(self):
        self._serve(career="{}")
        profile = sources.fetch_player_profile(2839, pause=0)
        self.assertEqual(profile["career"], [])
        self.assertEqual(profile["career_totals"], [])
        self.assertEqual(profile["info"][0]["DISPLAY_FIRST_LAST"], "James Thomas")

        with tempfile.TemporaryDirectory() as d:
            cache = curated.ProfileCache(d)
            cache.put(2839, profile)
            rows, uncached, _, _, empty_careers = curated.assemble_rows(
                [2839], cache, {}, {}, ABBRS, {}
            )
        self.assertEqual(uncached, [])
        self.assertEqual(empty_careers, [2839])
        row = rows[0]
        self.assertEqual(list(row.keys()),
                         list(curated.build_row(_profile(), {}, {}, ABBRS, {}).keys()))
        self.assertEqual(row["full_name"], "James Thomas")
        self.assertEqual(row["teams"], [])
        self.assertEqual(row["career"], {"pts": 0, "reb": 0, "ast": 0, "ppg": 0.0,
                                         "rpg": 0.0, "apg": 0.0, "seasons": 0})
        self.assertEqual(curated.check_plausibility(rows), [])
        self.assertEqual(curated.check_cross_stints(rows), [])

    def test_the_empty_answer_costs_one_call_and_no_backoff(self):
        session = self._serve(career="{}")
        sources.fetch_player_profile(2839, pause=0)
        self.assertEqual(session.calls.count("playercareerstats"), 1)
        self.assertEqual([s for s in self.sleeps if s >= 1.5], [])  # retry()'s ladder

    def test_an_empty_awards_response_is_an_empty_award_list(self):
        self._serve(awards="{}")
        profile = sources.fetch_player_profile(2839, pause=0)
        self.assertEqual(profile["awards"], [])
        self.assertEqual(len(profile["career"]), 1)  # the career still came through

    def test_genuine_failures_still_retry_and_still_raise(self):
        for label, answer in (
            ("a read timeout", requests.exceptions.ReadTimeout("read timed out")),
            ("a connection reset", requests.exceptions.ConnectionError("Connection aborted")),
            ("a truncated body", '{"resultSets": [{"name": "Season'),
            ("an error page", "<html><body>502 Bad Gateway</body></html>"),
            # Not empty, but raises the very same KeyError('resultSet') the fix
            # keys off — it must NOT be mistaken for a legitimate empty.
            ("a body with no result sets", '{"Message": "An error has occurred."}'),
        ):
            with self.subTest(label):
                session = self._serve(career=answer)
                with redirect_stdout(StringIO()):  # retry() narrates every attempt
                    with self.assertRaises(
                        (KeyError, ValueError, requests.exceptions.RequestException)
                    ):
                        sources.fetch_player_profile(2839, pause=0)
                self.assertEqual(session.calls.count("playercareerstats"), 4)
                self.assertEqual([s for s in self.sleeps if s >= 1.5], [1.5, 3.0, 6.0, 12.0])

    def test_an_empty_commonplayerinfo_is_a_failure_not_an_identityless_row(self):
        session = self._serve(info="{}")
        with self.assertRaises(ValueError) as caught:
            sources.fetch_player_profile(200603, pause=0)
        self.assertIn("empty body", str(caught.exception))
        # One call, no ladder, and the other two endpoints are never asked.
        self.assertEqual(session.calls, ["commonplayerinfo"])


class CrossStintCheckTests(TestCase):
    def _row(self, teams):
        return {"full_name": "Test Player", "teams": teams}

    def test_overlapping_stints_are_flagged(self):
        problems = curated.check_cross_stints([self._row([
            {"abbr": "MIA", "start_year": 2010, "end_year": 2014},
            {"abbr": "CLE", "start_year": 2012, "end_year": 2016},
        ])])
        self.assertEqual(len(problems), 1)
        self.assertIn("both claim season(s) [2012, 2013]", problems[0])

    def test_out_of_order_stints_are_flagged(self):
        problems = curated.check_cross_stints([self._row([
            {"abbr": "LAL", "start_year": 2018, "end_year": 2025},
            {"abbr": "CLE", "start_year": 2003, "end_year": 2010},
        ])])
        self.assertTrue(any("out of order" in p for p in problems))

    def test_the_same_team_may_not_claim_a_season_twice(self):
        problems = curated.check_cross_stints([self._row([
            {"abbr": "PHI", "start_year": 2009, "end_year": 2010},
            {"abbr": "PHI", "start_year": 2009, "end_year": 2010},
        ])])
        self.assertEqual(len(problems), 1)

    def test_a_midseason_trade_shares_exactly_one_season_and_is_fine(self):
        problems = curated.check_cross_stints([self._row([
            {"abbr": "MEM", "start_year": 2009, "end_year": 2010},
            {"abbr": "PHI", "start_year": 2009, "end_year": 2010},
        ])])
        self.assertEqual(problems, [])

    def test_an_open_stint_is_measured_to_the_current_season(self):
        problems = curated.check_cross_stints(
            [self._row([
                {"abbr": "DAL", "start_year": 2018, "end_year": None},
                {"abbr": "LAL", "start_year": 2020, "end_year": 2024},
            ])],
            open_end=2026,
        )
        self.assertEqual(len(problems), 1)


class PlausibilityCheckTests(TestCase):
    def _row(self, teams, career, name="Test Player"):
        return {"full_name": name, "teams": teams, "career": career}

    def test_consistent_totals_pass(self):
        self.assertEqual(curated.check_plausibility([self._row(
            [{"abbr": "LAL", "gp": 1000}],
            {"pts": 20000, "reb": 5000, "ast": 5000, "ppg": 20.0, "rpg": 5.0,
             "apg": 5.0, "seasons": 15},
        )]), [])

    def test_averages_that_do_not_match_the_totals_are_flagged(self):
        problems = curated.check_plausibility([self._row(
            [{"abbr": "LAL", "gp": 1000}],
            {"pts": 20000, "reb": 5000, "ast": 5000, "ppg": 30.0, "rpg": 5.0,
             "apg": 5.0, "seasons": 15},
        )])
        self.assertEqual(len(problems), 1)
        self.assertIn("career ppg 30.0", problems[0])

    def test_totals_without_games_played_are_flagged(self):
        problems = curated.check_plausibility([self._row(
            [], {"pts": 500, "reb": 0, "ast": 0, "ppg": 10.0, "rpg": 0.0,
                 "apg": 0.0, "seasons": 1},
        )])
        self.assertEqual(len(problems), 1)
        self.assertIn("0 games played", problems[0])

    def test_a_drafted_player_who_never_debuted_is_legitimate(self):
        self.assertEqual(curated.check_plausibility([self._row(
            [], {"pts": 0, "reb": 0, "ast": 0, "ppg": 0.0, "rpg": 0.0,
                 "apg": 0.0, "seasons": 0},
        )]), [])

    def test_impossible_seasons_count_is_flagged(self):
        problems = curated.check_plausibility([self._row(
            [{"abbr": "LAL", "gp": 100}],
            {"pts": 1000, "reb": 100, "ast": 100, "ppg": 10.0, "rpg": 1.0,
             "apg": 1.0, "seasons": 44},
        )])
        self.assertTrue(any("seasons 44" in p for p in problems))


class ParityCheckTests(TestCase):
    def test_every_name_needs_a_row(self):
        rows = [{"full_name": "LeBron James", "aliases": []}]
        problems = curated.check_parity(rows, ["LeBron James", "Stephen Curry"])
        self.assertTrue(any("row count 1 != all-players.json 2" in p for p in problems))
        self.assertTrue(any("Stephen Curry" in p for p in problems))

    def test_accented_rewrite_is_not_a_missing_player(self):
        rows = [{"full_name": "Jonas Valančiūnas", "aliases": ["Jonas Valanciunas"]}]
        self.assertEqual(curated.check_parity(rows, ["Jonas Valanciunas"]), [])


class _GeneratorRun:
    """Runs the command against fixtures instead of the network."""

    def _run(self, out_path, cache_dir, *args, fail_for=(), profiles=None):
        profiles = profiles if profiles is not None else {
            201142: _profile(),
            1629029: _profile(person_id=1629029, name="Luka Dončić", SCHOOL="Real Madrid",
                              COUNTRY="Slovenia", POSITION="Forward-Guard"),
        }
        roster = [
            {"person_id": pid, "full_name": curated.ascii_fold(p["info"][0]["DISPLAY_FIRST_LAST"])}
            for pid, p in profiles.items()
        ]

        def fetch_profile(person_id):
            if person_id in fail_for:
                raise RuntimeError("read timeout")
            return profiles[person_id]

        module = "trivia.management.commands.generate_players_curated"
        out = ["--out", out_path] if out_path else []
        stdout = StringIO()
        with patch(f"{module}.fetch_players", lambda: roster), patch(
            f"{module}.fetch_draft_history", lambda: DRAFT_ROWS
        ), patch(
            f"{module}.fetch_franchise_history", lambda: FRANCHISE_ROWS
        ), patch(f"{module}.fetch_player_profile", fetch_profile):
            call_command("generate_players_curated", *out,
                         "--cache-dir", cache_dir, *args,
                         stdout=stdout, stderr=StringIO())
        return stdout.getvalue()


class GenerateCommandTests(_GeneratorRun, TestCase):
    def test_end_to_end_fetch_cache_assemble_write(self):
        with tempfile.TemporaryDirectory() as d:
            out = os.path.join(d, "smoke.json")
            self._run(out, os.path.join(d, "cache"), "--player-ids", "201142,1629029")
            with open(out, encoding="utf-8") as f:
                rows = json.load(f)
            self.assertEqual([r["full_name"] for r in rows], ["Kevin Durant", "Luka Dončić"])
            self.assertEqual(rows[0]["draft"]["team_abbr"], "SEA")
            self.assertEqual(rows[0]["teams"][0]["name"], "Seattle SuperSonics")
            self.assertIsNone(rows[1]["college"])  # Real Madrid is not a college
            # The raw responses are cached, so a second run needs no network at all.
            self.assertTrue(os.path.exists(os.path.join(d, "cache", "players", "201142.json")))

    def test_fetch_only_writes_nothing(self):
        with tempfile.TemporaryDirectory() as d:
            out = os.path.join(d, "smoke.json")
            self._run(out, os.path.join(d, "cache"), "--limit", "1", "--fetch-only")
            self.assertFalse(os.path.exists(out))

    def test_a_player_with_no_career_stats_is_written_and_counted(self):
        profiles = {
            201142: _profile(),
            1629029: _profile(person_id=1629029, name="Never Debuted", seasons=[], totals=[]),
        }
        with tempfile.TemporaryDirectory() as d:
            out = os.path.join(d, "smoke.json")
            output = self._run(out, os.path.join(d, "cache"),
                               "--player-ids", "201142,1629029", profiles=profiles)
            with open(out, encoding="utf-8") as f:
                rows = json.load(f)
        self.assertEqual([r["full_name"] for r in rows], ["Kevin Durant", "Never Debuted"])
        self.assertEqual(rows[1]["teams"], [])
        self.assertEqual(rows[1]["career"]["seasons"], 0)
        self.assertIn("1 with no career stats", output)

    def test_partial_run_refuses_to_touch_the_published_dataset(self):
        with self.assertRaises(CommandError):
            call_command("generate_players_curated", "--limit", "1")


class FullRunRewriteTests(_GeneratorRun, TestCase):
    """The Task-11 finisher: a complete run that also rewrites all-players.json."""

    def _published(self, root, all_players, curated_rows):
        data = os.path.join(root, "trivia", "data")
        static = os.path.join(root, "trivia", "data_static")
        os.makedirs(data)
        os.makedirs(static)
        self.all_players_path = os.path.join(data, "all-players.json")
        self.curated_path = os.path.join(static, "players_curated.json")
        for path, payload in ((self.all_players_path, all_players),
                              (self.curated_path, curated_rows)):
            with open(path, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False)

    def _read(self, path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)

    def test_full_run_with_rewrite_leaves_both_files_1_to_1(self):
        with tempfile.TemporaryDirectory() as d:
            # The published index lags the league index: an accent-free name, a
            # name no player answers to any more, and a missing newcomer.
            self._published(
                d,
                all_players=["Luka Doncic", "Retired Ghost", "Kevin Durant"],
                curated_rows=[{"person_id": 201142, "full_name": "Kevin Durant",
                               "fame_tier": 1, "aliases": ["KD"]}],
            )
            with override_settings(BASE_DIR=d):
                # No --out: the full run writes the published dataset itself.
                self._run(None, os.path.join(d, "cache"), "--rewrite-all-players")
            rows = self._read(self.curated_path)
            names = self._read(self.all_players_path)

            self.assertEqual([r["full_name"] for r in rows], ["Kevin Durant", "Luka Dončić"])
            self.assertEqual(rows[0]["fame_tier"], 1)  # carry-over read before the write
            # 1:1 by construction: one entry per row, file order kept, the name
            # no row claims dropped — and the parity gate now agrees.
            self.assertEqual(names, ["Luka Dončić", "Kevin Durant"])
            self.assertEqual(len(names), len(rows))
            self.assertEqual(curated.check_parity(rows, names), [])
            self.assertFalse(os.path.exists(f"{self.curated_path}.rejected.json"))

    def test_two_players_sharing_a_name_keep_two_entries(self):
        with tempfile.TemporaryDirectory() as d:
            self._published(d, all_players=["Kevin Durant", "Kevin Durant"], curated_rows=[])
            with override_settings(BASE_DIR=d):
                self._run(None, os.path.join(d, "cache"), "--rewrite-all-players")
            rows = self._read(self.curated_path)
            names = self._read(self.all_players_path)
            self.assertEqual(len(names), len(rows))
            self.assertEqual(sorted(names), ["Kevin Durant", "Luka Dončić"])

    def test_a_blocked_rewrite_keeps_the_work_and_leaves_all_players_alone(self):
        with tempfile.TemporaryDirectory() as d:
            self._published(d, all_players=["Kevin Durant", "Luka Doncic"], curated_rows=[])
            with override_settings(BASE_DIR=d), self.assertRaises(CommandError):
                self._run(None, os.path.join(d, "cache"), "--rewrite-all-players",
                          fail_for={1629029})
            # The published files are untouched, but the rows that DID assemble
            # are kept aside instead of thrown away.
            self.assertEqual(self._read(self.all_players_path), ["Kevin Durant", "Luka Doncic"])
            self.assertEqual(self._read(self.curated_path), [])
            rejected = self._read(f"{self.curated_path}.rejected.json")
            self.assertEqual([r["full_name"] for r in rejected], ["Kevin Durant"])

    def test_rewrite_is_refused_on_a_partial_run(self):
        with tempfile.TemporaryDirectory() as d:
            self._published(d, all_players=["Kevin Durant"], curated_rows=[])
            with override_settings(BASE_DIR=d), self.assertRaises(CommandError):
                self._run(os.path.join(d, "partial.json"), os.path.join(d, "cache"),
                          "--limit", "1", "--rewrite-all-players")
            self.assertEqual(self._read(self.all_players_path), ["Kevin Durant"])
