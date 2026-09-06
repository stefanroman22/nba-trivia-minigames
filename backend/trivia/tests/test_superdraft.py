"""SuperDraft Five — the round is the live pool in the standard envelope.

The renderer builds slots and objectives client-side out of the players-index
pool, so the round payload IS that pool. It used to be the raw objectives
config with no 'series' key at all, which the socket server reads as an empty
round (multiplayer_server/src/index.js fetchRound), so a match never started.
"""
from unittest import mock

from django.test import TestCase
from django.urls import reverse

from trivia.games import players_index, superdraft


class SuperDraftRoundTests(TestCase):
    def test_round_uses_the_standard_series_envelope(self):
        body = self.client.get(reverse("superdraft")).json()
        self.assertIn("series", body)
        # What the socket server extracts from the response (index.js fetchRound).
        self.assertTrue(body.get("series"))

    def test_round_is_the_single_player_pool(self):
        series = self.client.get(reverse("superdraft")).json()["series"]
        self.assertEqual(series, players_index.build_pool())

    def test_round_rows_carry_the_fields_every_objective_and_slot_reads(self):
        series = self.client.get(reverse("superdraft")).json()["series"]
        for row in series:
            for key in ("person_id", "full_name", "height_in", "birth_year",
                        "country", "draft", "teams", "awards", "career"):
                self.assertIn(key, row)

    def test_slot_constraints_are_not_usa_only(self):
        """Country slots must stay derivable from the data, never hard-coded."""
        countries = {r.get("country") for r in players_index.build_pool()}
        self.assertGreater(len({c for c in countries if c}), 1)

    def test_empty_pool_returns_503(self):
        with mock.patch.object(superdraft, "load_players", return_value=[]):
            res = self.client.get(reverse("superdraft"))
        self.assertEqual(res.status_code, 503)

    def test_no_longer_publishes_a_static_pool(self):
        self.assertFalse(hasattr(superdraft, "build_pool"))
        self.assertFalse(hasattr(superdraft, "SEED_PATH"))
