"""LeContexto — the multiplayer round carries the secret, not the pool.

The renderer ranks EVERY pool player against the secret, so it needs full
player profiles — but it already loads the shared players-index pool from the
CDN for single-player, so a round payload does not have to carry them. It used
to ship the whole pool (O(dataset) per player per round, re-emitted on every
reconnect); it now ships ``{pool, day, secret_person_id}``.

What must not change is the property an earlier fix established: single-player
and multiplayer resolve the SAME secret for the same day. Single-player runs
``dailySecret`` in src/Game Renderers/Contexto.tsx over the CDN pool; the
endpoint runs ``contexto.daily_secret`` over the live pool those rows are
published from. ``daily_secret`` below is an independent mirror of the TSX
function, so the tests can assert both ends land on the same player, and the
source guards pin the renderer to the rule the mirror encodes.
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
# Single-player still runs THAT function over the CDN pool. Mirroring it here
# lets a test ask the real question: given the same day, does the secret the
# endpoint hands multiplayer match the one single-player picks for itself?
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
    def round_payload(self):
        res = self.client.get(reverse("contexto"))
        self.assertEqual(res.status_code, 200)
        series = res.json()["series"]
        self.assertEqual(len(series), 1)
        return series[0]

    def test_round_is_config_not_the_player_array(self):
        payload = self.round_payload()
        self.assertEqual(sorted(payload), ["day", "pool", "secret_person_id"])
        self.assertEqual(payload["pool"], "players-index")
        self.assertIsInstance(payload["secret_person_id"], int)
        # Not one player profile in it — the renderer loads the pool itself.
        body = self.client.get(reverse("contexto")).content.decode()
        self.assertNotIn("full_name", body)
        self.assertNotIn("fame_tier", body)

    def test_payload_size_does_not_grow_with_the_dataset(self):
        """Defect A: the old payload WAS the pool, so it scaled with it."""
        rows = players_index.build_pool()
        small = len(self.client.get(reverse("contexto")).content)
        with mock.patch.object(contexto, "load_players", return_value=rows * 30):
            big = len(self.client.get(reverse("contexto")).content)
        # 30x the rows, same payload (only the id's digit count can move).
        self.assertLess(small, 200)
        self.assertLess(big, 200)

    def test_single_player_and_multiplayer_agree_on_the_days_secret(self):
        """SP picks the secret out of pool:players-index with dailySecret();
        MP is handed one from here. They must be the same player."""
        sp_pool = players_index.build_pool()
        payload = self.round_payload()
        self.assertEqual(
            payload["secret_person_id"],
            daily_secret(sp_pool, payload["day"])["person_id"],
        )
        # …and for any other day, not just today's.
        for day in ("2026-09-06", "2026-09-07", "2027-01-01", "2030-12-31"):
            self.assertEqual(
                contexto.daily_secret(sp_pool, day)["person_id"],
                daily_secret(sp_pool, day)["person_id"],
            )

    def test_the_day_is_the_utc_date(self):
        """Clients in different timezones must not roll over at different times."""
        today = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
        self.assertEqual(self.round_payload()["day"], today)

    def test_the_secret_is_a_fame_tier_1_2_player(self):
        pid = self.round_payload()["secret_person_id"]
        row = next(r for r in players_index.build_pool() if r["person_id"] == pid)
        self.assertIn(row["fame_tier"], (1, 2))

    def test_the_secret_is_a_row_the_renderer_will_find_in_the_pool(self):
        pids = {r["person_id"] for r in players_index.build_pool()}
        self.assertIn(self.round_payload()["secret_person_id"], pids)

    def test_the_renderer_resolves_the_same_secret(self):
        """The multiplayer path must use the id it was sent, and fall back to
        the identical local rule when the pool it loaded doesn't have it."""
        with open(CONTEXTO_TSX, "r", encoding="utf-8") as f:
            src = f.read()
        self.assertIn("pool.find((p) => p.person_id === round.secret_person_id)", src)
        self.assertIn("return dailySecret(pool, round?.day);", src)
        # …and dailySecret still encodes the rule this module mirrors.
        self.assertIn("pool.filter((p) => p.fame_tier <= 2)", src)
        self.assertIn("(a, b) => a.person_id - b.person_id", src)
        self.assertIn("h = 2166136261;", src)
        self.assertIn("Math.imul(h, 16777619)", src)
        self.assertIn("new Date().toISOString().slice(0, 10)", src)
        # The pool arrives from the CDN cache, never through the socket server.
        self.assertIn("useRoundPool(localPool, round?.pool)", src)

    def test_empty_pool_returns_503(self):
        with mock.patch.object(contexto, "load_players", return_value=[]):
            res = self.client.get(reverse("contexto"))
        self.assertEqual(res.status_code, 503)

    def test_no_longer_publishes_a_static_seed_pool(self):
        self.assertFalse(hasattr(contexto, "build_pool"))
        self.assertFalse(hasattr(contexto, "SEED_PATH"))
