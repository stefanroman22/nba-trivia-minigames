from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

from users import leaderboard

User = get_user_model()


class Command(BaseCommand):
    help = "Backfill the Redis leaderboard ZSET from Postgres (requires REDIS_URL)."

    def handle(self, *args, **opts):
        r = leaderboard._redis()
        if r is None:
            raise CommandError("REDIS_URL is not set; nothing to sync.")
        mapping = {
            u.username: u.points for u in User.objects.all().only("username", "points")
        }
        r.delete(leaderboard.ZKEY)
        if mapping:
            r.zadd(leaderboard.ZKEY, mapping)
        self.stdout.write(
            self.style.SUCCESS(f"Synced {len(mapping)} users to the leaderboard ZSET.")
        )
