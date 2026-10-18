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
    User.objects.create_user(username="alice", email="alice@example.com", password="x", points=300, age_group="adult")
    User.objects.create_user(username="bob", email="bob@example.com", password="x", points=100, age_group="adult")
    User.objects.create_user(username="carol", email="carol@example.com", password="x", points=200, age_group="adult")


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

    def test_rows_carry_the_stored_rank_name(self):
        User.objects.filter(username="alice").update(rank="Role Player")
        self.assertEqual(leaderboard.top(10)[0]["rank"], "Role Player")
        board, _, _ = leaderboard.friends_board(User.objects.get(username="alice"))
        self.assertEqual(board, [{"id": board[0]["id"], "username": "alice", "rank": "Role Player", "points": 300}])


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
        self.assertEqual(rows[0], {"id": alice.public_id, "username": "alice", "rank": "Rookie", "points": 300})

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

    def _swap_bob_for_a_ghost(self, points):
        """Same member count, different set: bob is missing and a deleted account's id sits in his place."""
        self.fake.zrem(leaderboard.ZKEY, User.objects.get(username="bob").public_id)
        self.fake.zadd(leaderboard.ZKEY, {"GHOST1": points})

    def test_top_skips_members_that_are_not_on_the_board(self):
        self._swap_bob_for_a_ghost(999)
        rows = leaderboard.top(10)
        self.assertEqual([r["username"] for r in rows], ["alice", "carol"])
        self.assertNotIn("Player", [r["username"] for r in rows])

    def test_top_still_fills_n_rows_past_skipped_members(self):
        self._swap_bob_for_a_ghost(999)
        self.assertEqual([r["username"] for r in leaderboard.top(2)], ["alice", "carol"])

    def test_drifted_zset_falls_back_to_postgres(self):
        """A ZSET missing a player (never synced) must not hide them, nor rank others above them."""
        dave = User.objects.create_user(username="dave", email="dave@example.com", password="x", points=250, age_group="adult")
        self.assertEqual([r["username"] for r in leaderboard.top(10)], ["alice", "dave", "carol", "bob"])
        self.assertEqual(leaderboard.rank_of(dave), 2)
        self.assertEqual(leaderboard.rank_of(User.objects.get(username="bob")), 4)
        self.assertEqual(leaderboard.total(), 4)

    def test_total_counts_board_players_only(self):
        self.fake.zadd(leaderboard.ZKEY, {"GHOST1": 5, "GHOST2": 7})
        self.assertEqual(leaderboard.total(), 3)
        self.assertEqual([r["username"] for r in leaderboard.top(10)], ["alice", "carol", "bob"])

    def test_rank_of_is_none_for_an_account_off_the_board(self):
        banned = User.objects.create_user(username="eve", email="eve@example.com", password="x", points=999, age_group="adult")
        User.objects.filter(pk=banned.pk).update(banned_at="2026-10-01T00:00:00Z")
        banned.refresh_from_db()
        self.assertIsNone(leaderboard.rank_of(banned))

    def test_sync_adds_only_board_accounts(self):
        from io import StringIO

        from django.core.management import call_command

        banned = User.objects.create_user(username="eve", email="eve@example.com", password="x", points=999, age_group="adult")
        User.objects.filter(pk=banned.pk).update(banned_at="2026-10-01T00:00:00Z")
        self.fake.zadd(leaderboard.ZKEY, {"GHOST1": 5})
        call_command("sync_leaderboard", stdout=StringIO())
        self.assertEqual(set(self.fake.z[leaderboard.ZKEY]), {u.public_id for u in User.objects.filter(banned_at__isnull=True)})


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
                    "accepted_terms": True,
                    "birth_year": 1990,
                    "birth_month": 6,
                },
                content_type="application/json",
            )
            self.assertIn(resp.status_code, (200, 201))
            self.assertEqual(leaderboard.total(), 1)
            self.assertEqual([r["username"] for r in leaderboard.top(10)], ["dave"])
