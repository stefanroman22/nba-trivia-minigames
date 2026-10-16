from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from trivia.models import GameSession
from users.progression_recount import recount_progression

User = get_user_model()


class Command(BaseCommand):
    help = "Recount active days, rank, Founding Member and live streaks from GameSession history (safe to re-run)."

    def handle(self, *args, **opts):
        count = recount_progression(User, GameSession)
        self.stdout.write(self.style.SUCCESS(f"Recounted progression for {count} accounts."))
