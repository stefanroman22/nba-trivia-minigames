# GameSession.awarded (docs/superpowers/specs/2026-10-16-progression-design.md §2). Past credited plays
# (an account, single or match) are backfilled with their score: before this column, score == awarded.
from django.db import migrations, models
from django.db.models import F


def backfill(apps, schema_editor):
    GameSession = apps.get_model("trivia", "GameSession")
    GameSession.objects.filter(user__isnull=False, mode__in=["single", "match"]).update(awarded=F("score"))


class Migration(migrations.Migration):

    dependencies = [("trivia", "0008_factory_journal")]

    operations = [
        migrations.AddField(model_name="gamesession", name="awarded", field=models.IntegerField(default=0, db_default=0)),
        migrations.RunPython(backfill, migrations.RunPython.noop),
    ]
