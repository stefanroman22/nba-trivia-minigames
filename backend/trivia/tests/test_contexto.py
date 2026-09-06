"""LeContexto — the multiplayer round is the same pool single-player loads.

The renderer ranks EVERY pool player against the secret, so a round payload has
to carry full player profiles. Multiplayer used to receive one bare
``{secret, full_name}`` row, and the renderer crashed reading ``teams`` off it.
These tests pin the payload to the single-player pool, which also makes the two
modes structurally incapable of picking different secrets.
"""
import datetime
from unittest import mock

from django.test import TestCase
from django.urls import reverse

from trivia.games import contexto, players_index


# --- Python mirror of dailySecret() in src/Game Renderers/Contexto.tsx -------
# Both modes run THAT function, on whatever array they were handed. Mirroring it
# here lets a test ask the real question: given the same day, do the two payloads
# resolve to the same player?
def _fnv1a(s):
    h = 2166136261
    for ch in s:
        h = (h ^ ord(ch)) & 0xFFFFFFFF
        h = (h * 16777619) & 0xFFFFFFFF
    return h


def daily_secret(pool, day):
    candidates = [p for p in pool if p.get("fame_tier", 9) <= 2]
    rows = sorted(candidates or pool, key=lambda p: p["person_id"])
    return rows[_fnv1a(day) % len(rows)]


class ContextoPayloadTests(TestCase):
    def test_round_is_an_array_of_full_player_profiles(self):
        res = self.client.get(reverse("contexto"))
        self.assertEqual(res.status_code, 200)
        series = res.json()["series"]
        self.assertGreater(len(series), 1)
        for row in series:
            # The similarity ranking reads all of these; the old payload had none.
            for key in ("person_id", "full_name", "aliases", "fame_tier", "position",
                        "country", "draft", "teams", "awards"):
                self.assertIn(key, row)
            self.assertIsInstance(row["teams"], list)

    def test_multiplayer_payload_is_the_single_player_pool(self):
        """SP downloads pool:players-index; MP must get exactly those rows."""
        sp_pool = players_index.build_pool()
        mp_payload = self.client.get(reverse("contexto")).json()["series"]
        self.assertEqual(mp_payload, sp_pool)

    def test_single_player_and_multiplayer_agree_on_the_days_secret(self):
        sp_pool = players_index.build_pool()
        mp_payload = self.client.get(reverse("contexto")).json()["series"]
        for day in ("2026-09-06", "2026-09-07", "2027-01-01", "2030-12-31"):
            self.assertEqual(
                daily_secret(sp_pool, day)["person_id"],
                daily_secret(mp_payload, day)["person_id"],
            )

    def test_the_secret_is_a_fame_tier_1_2_player(self):
        series = self.client.get(reverse("contexto")).json()["series"]
        day = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
        self.assertIn(daily_secret(series, day)["fame_tier"], (1, 2))

    def test_empty_pool_returns_503(self):
        with mock.patch.object(contexto, "load_players", return_value=[]):
            res = self.client.get(reverse("contexto"))
        self.assertEqual(res.status_code, 503)

    def test_no_longer_publishes_a_static_seed_pool(self):
        self.assertFalse(hasattr(contexto, "build_pool"))
        self.assertFalse(hasattr(contexto, "SEED_PATH"))
