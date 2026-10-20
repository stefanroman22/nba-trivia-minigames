"""The ladder endpoint: rank distribution, percentile thresholds, the signed-in `you` block (ladder spec §1)."""
import hashlib
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import Client, TestCase, override_settings

from trivia import awarding
from users import ladder, ranks
from users.views import GUEST_CARRYOVER_MAX

User = get_user_model()

# The local default cache is the DatabaseCache (a cache hit is itself a query); an in-memory cache
# lets `test_second_call_is_cached` assert zero queries.
LOCMEM = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}


def _player(i, points, rank, age_group="adult"):
    return User.objects.create_user(
        username=f"p{i}", email=f"p{i}@example.com", password="x", points=points, rank=rank, age_group=age_group
    )


@override_settings(CACHES=LOCMEM)
class DistributionTests(TestCase):
    def setUp(self):
        cache.clear()
        # 10 public players: 4 Rookie, 3 Role Player, 2 Sixth Man, 1 Starter; points 0..9000.
        pts = [0, 10, 20, 30, 100, 150, 200, 600, 900, 9000]
        ranks = ["Rookie"] * 4 + ["Role Player"] * 3 + ["Sixth Man"] * 2 + ["Starter"]
        for i, (p, r) in enumerate(zip(pts, ranks)):
            _player(i, p, r)
        # Hidden from the public population: a banned account.
        banned = _player(91, 50_000, "GOAT")
        from django.utils import timezone
        User.objects.filter(pk=banned.pk).update(banned_at=timezone.now())

    def tearDown(self):
        cache.clear()

    def test_counts_and_shares_follow_the_ladder_order(self):
        d = ladder.distribution()
        self.assertEqual(d["total_players"], 10)
        names = [row["name"] for row in d["ladder"]]
        self.assertEqual(names, list(ladder.RANK_NAMES))
        by = {row["name"]: row for row in d["ladder"]}
        self.assertEqual(by["Rookie"]["players"], 4)
        self.assertEqual(by["Rookie"]["share_pct"], 40.0)
        self.assertEqual(by["Starter"]["players"], 1)
        self.assertEqual(by["GOAT"]["players"], 0)
        self.assertEqual(by["GOAT"]["share_pct"], 0.0)
        self.assertEqual(by["Starter"]["points"], 1_500)
        self.assertEqual(by["Starter"]["days"], 3)

    def test_percentile_thresholds(self):
        d = ladder.distribution()
        # top 10% of 10 players = the single best (9000); top 50% = the 5th best (150); 25% = 3rd best (600).
        self.assertEqual(d["percentiles"]["10"], 9_000)
        self.assertEqual(d["percentiles"]["25"], 600)
        self.assertEqual(d["percentiles"]["50"], 150)
        self.assertEqual(d["percentiles"]["1"], 9_000)

    def test_second_call_is_cached(self):
        ladder.distribution()
        with self.assertNumQueries(0):
            ladder.distribution()

    def test_cache_outage_falls_back_to_the_database(self):
        with patch("django.core.cache.cache.get", side_effect=ConnectionError("down")), \
                patch("django.core.cache.cache.set", side_effect=ConnectionError("down")), \
                self.assertLogs("users.ladder", level="WARNING"):
            d = ladder.distribution()
        self.assertEqual(d["total_players"], 10)

    def test_cache_key_follows_the_ladder(self):
        digest = hashlib.md5(repr(ranks.LADDER).encode()).hexdigest()[:8]
        self.assertEqual(ladder.LADDER_CACHE_KEY, f"ladder:v1:{digest}")

    def test_teens_and_unknown_ages_count_like_everyone(self):
        _player(90, 50_000, "GOAT", age_group="teen")
        _player(92, 5, "Rookie", age_group="")
        cache.clear()
        d = ladder.distribution()
        self.assertEqual(d["total_players"], 12)
        by = {row["name"]: row for row in d["ladder"]}
        self.assertEqual((by["GOAT"]["players"], by["Rookie"]["players"]), (1, 5))

    def test_empty_population(self):
        User.objects.all().delete()
        cache.clear()
        d = ladder.distribution()
        self.assertEqual(d["total_players"], 0)
        self.assertTrue(all(row["share_pct"] == 0.0 for row in d["ladder"]))
        self.assertEqual(set(d["percentiles"].values()), {0})


class YouBlockTests(TestCase):
    def setUp(self):
        cache.clear()
        for i, p in enumerate([0, 50, 120, 400, 900, 2_000, 6_000, 20_000, 50_000, 160_000]):
            _player(i, p, "Rookie")
        User.objects.filter(points__gte=100).update(rank="Role Player")
        User.objects.filter(points__gte=500).update(rank="Sixth Man")
        self.me = User.objects.get(points=900)  # 5th best of 10 -> top 50%, Sixth Man

    def tearDown(self):
        cache.clear()

    def test_you_block(self):
        you = ladder.you_block(self.me, ladder.distribution())
        self.assertEqual(you["rank"], "Sixth Man")
        self.assertEqual(you["position"], 6)
        self.assertEqual(you["percentile"], 60.0)
        self.assertEqual(you["ahead_of_pct"], 40.0)
        self.assertEqual(you["same_rank_pct"], 60.0)  # 6 of 10 have >= 500 and rank Sixth Man
        self.assertEqual(you["next_rank"], "Starter")
        self.assertEqual(you["points_to_next"], 600)
        # Top 50% of 10 = the 5th best (2,000): position 6 is just outside it.
        self.assertEqual(you["to_top"]["50"], 2_000 - 900)
        self.assertEqual(you["to_top"]["10"], 160_000 - 900)

    def test_teen_is_ranked_like_everyone(self):
        teen = _player(99, 700, "Sixth Man", age_group="teen")
        you = ladder.you_block(teen, ladder.distribution())
        self.assertEqual(you["position"], 7)  # 6 players have more points; the teen is one of the 11
        self.assertLessEqual(you["same_rank_pct"], 100.0)
        self.assertGreater(you["percentile"], 0)


class LadderEndpointTests(TestCase):
    def setUp(self):
        cache.clear()
        _player(1, 300, "Role Player")

    def tearDown(self):
        cache.clear()

    def test_guest_gets_the_ladder_and_rules_without_you(self):
        res = Client().get("/api/ranks/ladder/")
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertIsNone(body["you"])
        self.assertEqual(len(body["ladder"]), 9)
        self.assertEqual(body["rules"]["first_game_bonus"], awarding.FIRST_GAME_BONUS)
        self.assertNotIn("daily_full", body["rules"])
        self.assertEqual(body["rules"]["streak_milestones"], {str(k): v for k, v in awarding.STREAK_MILESTONES.items()})
        self.assertEqual(body["rules"]["max_freezes"], awarding.MAX_FREEZES)
        self.assertEqual(body["rules"]["guest_carryover_max"], GUEST_CARRYOVER_MAX)

    def test_signed_in_gets_you(self):
        c = Client()
        tokens = c.post("/api/login/", {"id": "p1@example.com", "password": "x"}, content_type="application/json").json()
        body = c.get("/api/ranks/ladder/", HTTP_AUTHORIZATION=f"Bearer {tokens['access']}").json()
        self.assertEqual(body["you"]["rank"], "Role Player")
        self.assertEqual(body["you"]["position"], 1)
