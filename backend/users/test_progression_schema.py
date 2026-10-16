"""The progression columns carry database defaults (db_default), not only Django ones.

Dev and prod share one database, and the old backend keeps serving prod for a window after the new one
migrates: its INSERTs name none of the new columns, so each NOT NULL one needs a DEFAULT in the DDL.
"""
from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TestCase
from django.utils import timezone

from trivia.models import GameSession

User = get_user_model()


class OldBackendInsertTests(TestCase):
    def test_a_user_row_without_the_progression_columns_gets_the_defaults(self):
        with connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO users_customuser (password, is_superuser, username, first_name, last_name, is_staff,"
                " is_active, date_joined, public_id, email, points, rank, profile_photo, profile_photo_version,"
                " strike_count, ban_reason, canonical_email, terms_version, age_group, consent_source)"
                " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                ["!", False, "Old", "", "", False, True, timezone.now(), "OLDB01", "old@example.com", 0, "Rookie",
                 "profiles/default.png", 0, 0, "", "", "", "", ""],
            )
        user = User.objects.get(public_id="OLDB01")
        self.assertEqual(user.streak_freezes, 1)
        self.assertEqual(user.active_days, 0)
        self.assertEqual(user.streak_days, 0)
        self.assertEqual(user.streak_best, 0)
        self.assertIs(user.founding_member, False)
        self.assertIsNone(user.last_active_day)

    def test_a_session_row_without_awarded_gets_zero(self):
        user = User.objects.create_user(username="Old", email="old@example.com", password="x")
        with connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO trivia_gamesession (user_id, game, mode, score, duration_ms, finished_at)"
                " VALUES (%s, %s, %s, %s, %s, %s)",
                [user.pk, "wordle", "single", 200, 5000, timezone.now()],
            )
        self.assertEqual(GameSession.objects.get(user=user).awarded, 0)
