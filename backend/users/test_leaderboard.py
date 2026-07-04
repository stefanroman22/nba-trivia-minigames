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


def _make_users():
    User.objects.create_user(username="alice", email="alice@example.com", password="x", points=300)
    User.objects.create_user(username="bob", email="bob@example.com", password="x", points=100)
    User.objects.create_user(username="carol", email="carol@example.com", password="x", points=200)


class LeaderboardPostgresFallbackTests(TestCase):
    """With no Redis, the service returns exactly the original Postgres results."""

    def setUp(self):
        _make_users()

    def test_top_orders_by_points_desc(self):
        self.assertEqual(
            [r["username"] for r in leaderboard.top(10)], ["alice", "carol", "bob"]
        )

    def test_top_rows_carry_public_ids(self):
        rows = leaderboard.top(10)
        expected = {u.username: u.public_id for u in User.objects.all()}
        for row in rows:
            self.assertEqual(row["id"], expected[row["username"]])

    def test_rank_of(self):
        self.assertEqual(leaderboard.rank_of(User.objects.get(username="bob")), 3)

    def test_total(self):
        self.assertEqual(leaderboard.total(), 3)

    def test_record_is_noop_without_redis(self):
        leaderboard.record_score(User.objects.get(username="bob"))  # must not raise


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
        alice = User.objects.get(username="alice")
        self.assertEqual(rows[0], {"id": alice.public_id, "username": "alice", "points": 300})

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

    def test_rename_needs_no_board_update(self):
        """Entries are keyed by public id, so a display-name change just works."""
        bob = User.objects.get(username="bob")
        bob.username = "bobby"
        bob.save()
        names = [r["username"] for r in leaderboard.top(10)]
        self.assertIn("bobby", names)
        self.assertNotIn("bob", names)

    def test_same_display_name_stays_distinct(self):
        """Two players named identically keep separate rows (distinct ids)."""
        for u in User.objects.all():
            u.username = "SameName"
            u.save()
        rows = leaderboard.top(10)
        self.assertEqual(len(rows), 3)
        self.assertEqual(len({r["id"] for r in rows}), 3)


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
