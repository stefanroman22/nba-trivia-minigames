from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse

from users import leaderboard

User = get_user_model()


class FakeRedis:
    """Minimal in-memory stand-in for the ZSET ops the leaderboard service uses."""

    def __init__(self):
        self.z = {}

    def zadd(self, key, mapping):
        self.z.setdefault(key, {}).update(mapping)

    def zrem(self, key, member):
        self.z.get(key, {}).pop(member, None)

    def zcard(self, key):
        return len(self.z.get(key, {}))

    def delete(self, key):
        self.z.pop(key, None)

    def _sorted(self, key):
        return sorted(self.z.get(key, {}).items(), key=lambda kv: (-kv[1], kv[0]))

    def zrevrange(self, key, start, end, withscores=False):
        stop = None if end == -1 else end + 1
        items = self._sorted(key)[start:stop]
        return items if withscores else [m for m, _ in items]

    def zrevrank(self, key, member):
        order = [m for m, _ in self._sorted(key)]
        return order.index(member) if member in order else None

    def pipeline(self):
        return _FakePipe(self)


class _FakePipe:
    def __init__(self, r):
        self.r = r
        self.ops = []

    def zrem(self, key, member):
        self.ops.append(("zrem", key, member))
        return self

    def zadd(self, key, mapping):
        self.ops.append(("zadd", key, mapping))
        return self

    def execute(self):
        for op in self.ops:
            if op[0] == "zrem":
                self.r.zrem(op[1], op[2])
            else:
                self.r.zadd(op[1], op[2])


def _make_users():
    User.objects.create_user(username="alice", password="x", points=300)
    User.objects.create_user(username="bob", password="x", points=100)
    User.objects.create_user(username="carol", password="x", points=200)


class LeaderboardPostgresFallbackTests(TestCase):
    """With no Redis, the service returns exactly the original Postgres results."""

    def setUp(self):
        _make_users()

    def test_top_orders_by_points_desc(self):
        self.assertEqual(
            [r["username"] for r in leaderboard.top(10)], ["alice", "carol", "bob"]
        )

    def test_rank_of(self):
        self.assertEqual(leaderboard.rank_of(User.objects.get(username="bob")), 3)

    def test_total(self):
        self.assertEqual(leaderboard.total(), 3)

    def test_record_and_rename_are_noops_without_redis(self):
        bob = User.objects.get(username="bob")
        leaderboard.record_score(bob)
        leaderboard.rename("bob", bob)  # must not raise


class LeaderboardRedisTests(TestCase):
    def setUp(self):
        _make_users()
        self.fake = FakeRedis()
        patcher = patch("users.leaderboard._redis", return_value=self.fake)
        patcher.start()
        self.addCleanup(patcher.stop)
        for u in User.objects.all():
            leaderboard.record_score(u)

    def test_top_from_zset(self):
        rows = leaderboard.top(10)
        self.assertEqual([r["username"] for r in rows], ["alice", "carol", "bob"])
        self.assertEqual(rows[0], {"username": "alice", "points": 300})

    def test_rank_from_zset(self):
        self.assertEqual(leaderboard.rank_of(User.objects.get(username="alice")), 1)
        self.assertEqual(leaderboard.rank_of(User.objects.get(username="bob")), 3)

    def test_total_from_zset(self):
        self.assertEqual(leaderboard.total(), 3)

    def test_record_score_updates_rank(self):
        bob = User.objects.get(username="bob")
        bob.points = 999
        leaderboard.record_score(bob)
        self.assertEqual(leaderboard.rank_of(bob), 1)

    def test_rename_moves_entry(self):
        bob = User.objects.get(username="bob")
        bob.username = "bobby"
        leaderboard.rename("bob", bob)
        names = [r["username"] for r in leaderboard.top(10)]
        self.assertIn("bobby", names)
        self.assertNotIn("bob", names)


class SignupSyncsLeaderboardTests(TestCase):
    """New accounts must enter the ZSET on creation, so total()/ranks stay consistent."""

    def test_new_signup_enters_zset(self):
        fake = FakeRedis()
        with patch("users.leaderboard._redis", return_value=fake):
            resp = self.client.post(
                reverse("signup"),
                data={
                    "username": "dave",
                    "email": "dave@example.com",
                    "password": "Testpass123!",
                },
                content_type="application/json",
            )
            self.assertIn(resp.status_code, (200, 201))
            self.assertEqual(leaderboard.total(), 1)
            self.assertEqual([r["username"] for r in leaderboard.top(10)], ["dave"])
