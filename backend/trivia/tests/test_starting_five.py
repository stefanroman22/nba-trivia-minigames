import json
import os

from django.conf import settings
from django.test import TestCase
from django.urls import reverse

from trivia import views
from trivia.data_pipeline.starting_five import (
    canonical_lineup_names,
    is_playable_lineup,
    playable_lineups,
)
from trivia.management.commands.build_pools_from_db import build_starting_five
from trivia.models import Player, StartingFiveGame

GOOD = [
    {"name": "Stephen Curry", "position": "G"},
    {"name": "Klay Thompson", "position": "G"},
    {"name": "Draymond Green", "position": "F"},
    {"name": "Andrew Wiggins", "position": "F"},
    {"name": "Kevon Looney", "position": "C"},
]
# Three guards and no center — the board has no third guard card, so there is
# no winning assignment.
THREE_GUARDS = [
    {"name": "Stephen Curry", "position": "G"},
    {"name": "Klay Thompson", "position": "G"},
    {"name": "Jordan Poole", "position": "G"},
    {"name": "Draymond Green", "position": "F"},
    {"name": "Andrew Wiggins", "position": "F"},
]


def _game(game_id, lineup):
    return {
        "game_id": game_id, "game_date": "2022-01-01",
        "team_a": "Golden State Warriors", "team_b": "Boston Celtics",
        "team_a_logo": "", "team_b_logo": "",
        "final_score": "100 - 90", "winning_team": "Golden State Warriors",
        "starting_5": lineup,
    }


class PlayableLineupTests(TestCase):
    def test_a_two_two_one_lineup_is_playable(self):
        self.assertTrue(is_playable_lineup(GOOD))

    def test_specific_positions_map_to_their_family(self):
        lineup = [dict(p) for p in GOOD]
        for p, pos in zip(lineup, ["PG", "SG", "SF", "PF", "C"]):
            p["position"] = pos
        self.assertTrue(is_playable_lineup(lineup))

    def test_three_guards_is_not_playable(self):
        self.assertFalse(is_playable_lineup(THREE_GUARDS))

    def test_two_centers_is_not_playable(self):
        lineup = [dict(p) for p in GOOD]
        lineup[0]["position"] = "C"
        self.assertFalse(is_playable_lineup(lineup))

    def test_short_unknown_or_nameless_lineups_are_not_playable(self):
        self.assertFalse(is_playable_lineup(GOOD[:4]))
        self.assertFalse(is_playable_lineup(None))
        unknown = [dict(p) for p in GOOD]
        unknown[0]["position"] = "?"
        self.assertFalse(is_playable_lineup(unknown))
        nameless = [dict(p) for p in GOOD]
        nameless[0]["name"] = ""
        self.assertFalse(is_playable_lineup(nameless))

    def test_playable_lineups_keeps_only_the_winnable_games(self):
        kept = playable_lineups([_game("1", GOOD), _game("2", THREE_GUARDS)])
        self.assertEqual([g["game_id"] for g in kept], ["1"])


class CanonicalLineupNameTests(TestCase):
    def test_accent_variants_are_pulled_to_the_autocomplete_spelling(self):
        rows = [_game("1", [{"name": "Bojan Bogdanović", "position": "F"}])]
        canonical_lineup_names(rows, ["Bojan Bogdanovic"])
        self.assertEqual(rows[0]["starting_5"][0]["name"], "Bojan Bogdanovic")

    def test_aliases_cover_the_names_accent_folding_cannot_reach(self):
        rows = [_game("1", [
            {"name": "Nene Hilario", "position": "C"},
            {"name": "Jianlian Yi", "position": "F"},
        ])]
        canonical_lineup_names(rows, ["Nene", "Yi Jianlian"])
        self.assertEqual(
            [p["name"] for p in rows[0]["starting_5"]], ["Nene", "Yi Jianlian"]
        )

    def test_an_unknown_name_is_left_alone(self):
        rows = [_game("1", [{"name": "Nobody At All", "position": "C"}])]
        canonical_lineup_names(rows, ["Bojan Bogdanovic"])
        self.assertEqual(rows[0]["starting_5"][0]["name"], "Nobody At All")


class StartingFivePoolBuildTests(TestCase):
    def setUp(self):
        views._cached_player_names = None  # the endpoint reads the list once per process
        Player.objects.create(person_id=1, full_name="Bojan Bogdanovic")
        StartingFiveGame.objects.create(**_game("good", GOOD))
        StartingFiveGame.objects.create(**_game("bad", THREE_GUARDS))
        StartingFiveGame.objects.create(
            **_game("accents", [dict(GOOD[0], name="Bojan Bogdanović")] + GOOD[1:])
        )

    def test_the_published_pool_drops_unwinnable_games_and_fixes_names(self):
        pool = build_starting_five()
        self.assertEqual(sorted(g["game_id"] for g in pool), ["accents", "good"])
        accents = next(g for g in pool if g["game_id"] == "accents")
        self.assertEqual(accents["starting_5"][0]["name"], "Bojan Bogdanovic")

    def test_the_endpoint_never_serves_an_unwinnable_lineup(self):
        for _ in range(10):
            body = self.client.get(reverse("starting-five")).json()
            game = body["series"][0]
            self.assertNotEqual(game["game_id"], "bad")
            self.assertTrue(is_playable_lineup(game["starting_5"]))
            if game["game_id"] == "accents":
                self.assertEqual(game["starting_5"][0]["name"], "Bojan Bogdanovic")


class ShippedStartingFivePoolTests(TestCase):
    """The committed pool is the rule's output — guard it against regressing."""

    def _pool(self, name):
        path = os.path.join(settings.BASE_DIR, "trivia", "data", f"{name}.json")
        with open(path, encoding="utf-8") as f:
            return json.load(f)

    def test_every_shipped_game_is_winnable_and_typeable(self):
        pool = self._pool("starting-five")
        names = set(self._pool("all-players"))
        self.assertTrue(pool)
        self.assertEqual([g["game_id"] for g in pool if not is_playable_lineup(g["starting_5"])], [])
        self.assertEqual(
            sorted({p["name"] for g in pool for p in g["starting_5"] if p["name"] not in names}), []
        )
