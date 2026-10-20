"""The rank ladder is decided by lifetime points alone (the day gates are all 0 since 2026-10-20); ranks never drop."""
from django.test import SimpleTestCase

from users import ranks


class RankForTests(SimpleTestCase):
    def test_bottom_and_early_ranks_need_only_points(self):
        self.assertEqual(ranks.rank_for(0, 0), "Rookie")
        self.assertEqual(ranks.rank_for(99, 0), "Rookie")
        self.assertEqual(ranks.rank_for(100, 0), "Role Player")
        self.assertEqual(ranks.rank_for(500, 0), "Sixth Man")

    def test_no_rank_needs_active_days(self):
        self.assertEqual([r.days for r in ranks.LADDER], [0] * len(ranks.LADDER))
        self.assertEqual(ranks.rank_for(20_000, 0), "All-NBA")
        self.assertEqual(ranks.rank_for(150_000, 1), "GOAT")

    def test_goat_needs_its_points(self):
        self.assertEqual(ranks.rank_for(150_000, 0), "GOAT")
        self.assertEqual(ranks.rank_for(149_999, 400), "Hall of Famer")

    def test_ladder_is_monotonic(self):
        pts = [r.points for r in ranks.LADDER]
        self.assertEqual(pts, sorted(pts))
        self.assertEqual(ranks.RANK_NAMES[0], "Rookie")
        self.assertEqual(ranks.RANK_NAMES[-1], "GOAT")


class DivisionTests(SimpleTestCase):
    def test_no_divisions_below_all_star_or_at_goat(self):
        self.assertIsNone(ranks.division("Starter", 3_000))
        self.assertIsNone(ranks.division("GOAT", 200_000))

    def test_thirds_of_the_span(self):
        # All-Star spans 5,000 -> 15,000: thirds at 8,333 and 11,667.
        self.assertEqual(ranks.division("All-Star", 5_000), 3)
        self.assertEqual(ranks.division("All-Star", 8_000), 3)
        self.assertEqual(ranks.division("All-Star", 9_000), 2)
        self.assertEqual(ranks.division("All-Star", 12_000), 1)

    def test_points_past_the_next_threshold_are_division_one(self):
        # A stored rank can lag its points (rank updates on the next play): points beyond All-NBA's 15,000.
        self.assertEqual(ranks.division("All-Star", 20_000), 1)


class ProgressTests(SimpleTestCase):
    def test_points_to_next(self):
        p = ranks.progress(300, 1)
        self.assertEqual(p["rank"], "Role Player")
        self.assertEqual(p["next_rank"], "Sixth Man")
        self.assertEqual(p["points_to_next"], 200)
        self.assertEqual(p["days_to_next"], 0)
        self.assertEqual(p["progress_pct"], 50)
        self.assertIsNone(p["division"])

    def test_progress_ignores_active_days(self):
        p = ranks.progress(20_000, 0)
        self.assertEqual(p["rank"], "All-NBA")
        self.assertEqual(p["next_rank"], "MVP")
        self.assertEqual(p["points_to_next"], 20_000)
        self.assertEqual(p["days_to_next"], 0)

    def test_goat_has_no_next(self):
        p = ranks.progress(200_000, 365)
        self.assertEqual(p["rank"], "GOAT")
        self.assertIsNone(p["next_rank"])
        self.assertEqual(p["progress_pct"], 100)
        self.assertEqual(p["points_to_next"], 0)


from django.contrib.auth import get_user_model
from django.test import TestCase


class UpdateRankTests(TestCase):
    def test_update_rank_uses_points_only(self):
        user = get_user_model().objects.create_user(username="u", email="u@example.com", password="x")
        user.points, user.active_days = 20_000, 0
        user.update_rank()
        self.assertEqual(user.rank, "All-NBA")

    def test_new_accounts_start_with_one_freeze_and_no_founding_flag(self):
        user = get_user_model().objects.create_user(username="u", email="u@example.com", password="x")
        self.assertEqual(user.streak_freezes, 1)
        self.assertFalse(user.founding_member)
        self.assertEqual(user.active_days, 0)
