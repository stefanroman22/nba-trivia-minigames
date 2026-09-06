"""LeContexto — the multiplayer round is the same pool single-player loads.

The renderer ranks EVERY pool player against the secret, so a round payload has
to carry full player profiles. Multiplayer used to receive one bare
``{secret, full_name}`` row, and the renderer crashed reading ``teams`` off it.
These tests pin the payload to the single-player pool, which also makes the two
modes structurally incapable of picking different secrets.
"""
import datetime
import math
import os
from unittest import mock

from django.conf import settings
from django.test import TestCase
from django.urls import reverse

from trivia.games import contexto, players_index

CONTEXTO_TSX = os.path.join(
    os.path.dirname(settings.BASE_DIR), "src", "Game Renderers", "Contexto.tsx"
)


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


# --- Python mirror of awardsSimilarity() in src/Game Renderers/Contexto.tsx --
# The résumé component of the ranking. Mirrored here so its properties can be
# asserted against the REAL curated pool the game ranks; the source guard at the
# bottom of this module fails if the renderer stops using it.
def awards_vec(p):
    aw = p["awards"]
    return [len(aw["mvp"]), aw["allstar_count"], len(aw["rings"]), len(aw["dpoy"])]


def _magnitude(v):
    return math.sqrt(sum(x * x for x in v))


def cosine(a, b):
    """The OLD metric — kept so the tests can pin what was actually wrong."""
    na, nb = _magnitude(a), _magnitude(b)
    if na == 0 or nb == 0:
        return 0.0
    return sum(x * y for x, y in zip(a, b)) / (na * nb)


def awards_similarity(a, b):
    na, nb = _magnitude(a), _magnitude(b)
    if na == 0 and nb == 0:
        return 1.0
    if na == 0 or nb == 0:
        return 0.0
    return cosine(a, b) * (min(na, nb) / max(na, nb))


class ContextoAwardsSimilarityTests(TestCase):
    """Cosine is scale-invariant; the ranking is not allowed to be."""

    def test_identical_vectors_are_maximal(self):
        for v in ([2, 15, 5, 0], [0, 1, 0, 0], [5, 14, 6, 1]):
            self.assertAlmostEqual(awards_similarity(v, v), 1.0)

    def test_two_empty_resumes_are_a_match(self):
        # Old behaviour: cosine returned 0.0 — the mathematical minimum — for
        # two players who are in fact identical on this axis.
        self.assertEqual(cosine([0, 0, 0, 0], [0, 0, 0, 0]), 0.0)
        self.assertAlmostEqual(awards_similarity([0, 0, 0, 0], [0, 0, 0, 0]), 1.0)

    def test_a_doubled_resume_is_not_identical(self):
        small, doubled = [1, 6, 2, 0], [2, 12, 4, 0]
        self.assertAlmostEqual(cosine(small, doubled), 1.0)  # the bug
        self.assertAlmostEqual(awards_similarity(small, doubled), 0.5)
        self.assertLess(
            awards_similarity(small, doubled), awards_similarity(small, small)
        )

    def test_similarity_falls_as_the_magnitude_gap_widens(self):
        base = [0, 12, 0, 0]
        scores = [awards_similarity(base, [0, n, 0, 0]) for n in (12, 9, 6, 3, 1)]
        self.assertEqual(scores, sorted(scores, reverse=True))
        self.assertEqual(len(set(scores)), len(scores))  # no plateau of ties

    def test_an_empty_resume_never_matches_a_decorated_one(self):
        self.assertEqual(awards_similarity([0, 0, 0, 0], [4, 21, 4, 0]), 0.0)

    def test_real_pool_award_less_players_now_match_each_other(self):
        blanks = [p for p in players_index.build_pool() if awards_vec(p) == [0, 0, 0, 0]]
        self.assertGreater(len(blanks), 1, "expected award-less players in the pool")
        for a in blanks:
            for b in blanks:
                self.assertEqual(cosine(awards_vec(a), awards_vec(b)), 0.0)
                self.assertAlmostEqual(awards_similarity(awards_vec(a), awards_vec(b)), 1.0)

    def test_real_pool_no_longer_calls_lopsided_resumes_a_perfect_match(self):
        pool = players_index.build_pool()
        lopsided = [
            (a, b)
            for i, a in enumerate(pool)
            for b in pool[i + 1:]
            if sum(awards_vec(a)) and sum(awards_vec(b))
            and awards_vec(a) != awards_vec(b)
            and math.isclose(cosine(awards_vec(a), awards_vec(b)), 1.0)
        ]
        self.assertGreater(len(lopsided), 0, "expected proportional-but-unequal pairs")
        for a, b in lopsided:
            self.assertLess(awards_similarity(awards_vec(a), awards_vec(b)), 1.0)

    def test_real_pool_still_spreads_players_out(self):
        """A daily round needs a gradient, not a metric that ties everyone."""
        pool = players_index.build_pool()
        secret = next(p for p in pool if sum(awards_vec(p)) > 10)
        scores = {
            round(awards_similarity(awards_vec(secret), awards_vec(p)), 6) for p in pool
        }
        self.assertGreater(len(scores), 20)

    def test_the_renderer_uses_the_magnitude_aware_metric(self):
        """Guards this mirror: the ranking must not fall back to bare cosine."""
        with open(CONTEXTO_TSX, "r", encoding="utf-8") as f:
            src = f.read()
        self.assertIn("awardsSimilarity(awardsVec(secret), awardsVec(p))", src)
        self.assertNotIn("cosine(awardsVec(", src)


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
