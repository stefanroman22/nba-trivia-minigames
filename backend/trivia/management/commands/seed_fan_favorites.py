"""Upsert the bundled Fan Favorites survey questions into the central store."""

from django.core.management.base import BaseCommand
from trivia.models import FanFavoritesQuestion
from trivia.utils.fan_favorites import load_seed


class Command(BaseCommand):
    help = "Upsert the bundled Fan Favorites seed questions into the DB."

    def handle(self, *args, **opts):
        rows = 0
        for q in load_seed():
            FanFavoritesQuestion.objects.update_or_create(
                qid=q["qid"],
                defaults={
                    "prompt": q["prompt"],
                    "survey_date": q.get("survey_date", ""),
                    "answers": q["answers"],
                    "live": True,
                },
            )
            rows += 1
        self.stdout.write(self.style.SUCCESS(f"Seeded {rows} Fan Favorites questions"))
