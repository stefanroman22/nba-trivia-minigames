"""Strict NBA Bingo seed validation: structure + curated-player coverage.

Run with the sqlite fallback (never against Supabase):
    cd backend && DATABASE_URL="" python manage.py validate_bingo_seed
"""
from django.core.management.base import BaseCommand, CommandError

from trivia.games import bingo


class Command(BaseCommand):
    help = "Validate bingo_seed.json (structure + >=4 dealable players per cell)."

    def handle(self, *args, **options):
        rows = bingo._load_seed()
        if not rows:
            raise CommandError(f"bingo seed missing or empty: {bingo.SEED_PATH}")
        if len(rows) != bingo.EXPECTED_CARDS:
            self.stdout.write(self.style.WARNING(
                f"expected {bingo.EXPECTED_CARDS} cards, found {len(rows)}"))

        problems = bingo.validate_rows(rows, strict=True)
        if problems:
            for p in problems:
                self.stdout.write(self.style.ERROR(f"  - {p}"))
            raise CommandError(f"{len(problems)} problem(s) in bingo_seed.json")

        # Coverage table: min matches per card so thin-but-passing cells are visible.
        dealable = [p for p in bingo._load_curated()
                    if p.get("fame_tier", 4) <= bingo.MAX_FAME_TIER_DEALT]
        for row in rows:
            counts = [sum(1 for p in dealable if bingo.criterion_matches(p, c))
                      for c in row["cells"]]
            self.stdout.write(f"{row['qid']}: min={min(counts)} max={max(counts)} "
                              f"cells={sorted(counts)}")
        self.stdout.write(self.style.SUCCESS(
            f"OK — {len(rows)} cards, every cell has >= {bingo.MIN_MATCHES_PER_CELL} "
            f"dealable (fame<={bingo.MAX_FAME_TIER_DEALT}) players"))
