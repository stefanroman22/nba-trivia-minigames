"""Rebuild every account's progression fields from its GameSession history.

Run by migration users 0013 (with the historical models) and by `manage.py recount_progression`, which
is re-run once after the backend is promoted to prod: dev and prod share one database, so plays made on
the old backend during the window are logged but never counted as active days. Mirrors trivia.awarding:
a day is a Europe/Paris day with a scoring (score > 0) single or match session; friend rooms never count.
Takes the models as arguments and never imports them, so the migration can pass `apps.get_model`.
"""
import datetime
from zoneinfo import ZoneInfo

from django.db import transaction
from django.utils import timezone

from users.ranks import rank_for

CET = ZoneInfo("Europe/Paris")
# Founding Member = the account predates the ladder (Paris midnight, 2026-10-16).
FOUNDING_CUTOFF = datetime.datetime(2026, 10, 16, tzinfo=CET)
COUNTED_MODES = ("single", "match")
FIELDS = ["active_days", "last_active_day", "founding_member", "rank", "streak_days", "streak_best"]


def recount_progression(User, GameSession, today=None):
    """Recount active days, the last active day, Founding Member and the rank of every account; a player
    whose last active day is today or yesterday gets a live streak of at least 1. Returns the count."""
    today = today or timezone.now().astimezone(CET).date()
    count = 0
    for pk in User.objects.values_list("pk", flat=True).order_by("pk"):
        with transaction.atomic():
            user = User.objects.select_for_update().get(pk=pk)
            stamps = GameSession.objects.filter(user_id=pk, score__gt=0, mode__in=COUNTED_MODES).values_list("finished_at", flat=True)
            days = {finished_at.astimezone(CET).date() for finished_at in stamps}
            user.active_days = len(days)
            user.last_active_day = max(days) if days else None
            if user.date_joined < FOUNDING_CUTOFF:
                user.founding_member = True
            user.rank = rank_for(user.points, user.active_days)
            if user.last_active_day is not None and today - user.last_active_day <= datetime.timedelta(days=1):
                user.streak_days = max(user.streak_days, 1)
                user.streak_best = max(user.streak_best, user.streak_days)
            user.save(update_fields=FIELDS)
            count += 1
    return count
