from django.core.management.base import BaseCommand, CommandError

from users import leaderboard


class Command(BaseCommand):
    help = "Backfill the Redis leaderboard ZSET from Postgres (requires REDIS_URL)."

    def handle(self, *args, **opts):
        r = leaderboard._redis()
        if r is None:
            raise CommandError("REDIS_URL is not set; nothing to sync.")
        mapping = {
            u.public_id: u.points
            # Only accounts that may appear on the board (leaderboard._on_board: banned ones and admins are hidden).
            for u in leaderboard._on_board().only("public_id", "points")
        }
        r.delete(leaderboard.ZKEY)
        if mapping:
            r.zadd(leaderboard.ZKEY, mapping)
        self.stdout.write(
            self.style.SUCCESS(f"Synced {len(mapping)} users to the leaderboard ZSET.")
        )
