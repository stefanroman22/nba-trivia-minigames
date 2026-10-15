# Progression v2 (docs/superpowers/specs/2026-10-16-progression-design.md §3): the new account fields,
# then every existing account gets its active days recounted from its GameSession history (distinct
# Europe/Paris days), its rank recalculated under the new ladder, and the Founding Member flag.
import datetime
from zoneinfo import ZoneInfo

from django.db import migrations, models

CET = ZoneInfo("Europe/Paris")

LADDER = (
    ("Rookie", 0, 0), ("Role Player", 100, 0), ("Sixth Man", 500, 0), ("Starter", 1_500, 3),
    ("All-Star", 5_000, 7), ("All-NBA", 15_000, 20), ("MVP", 40_000, 45),
    ("Hall of Famer", 80_000, 90), ("GOAT", 150_000, 180),
)


def _rank_for(points, days):
    current = LADDER[0][0]
    for name, p, d in LADDER:
        if points >= p and days >= d:
            current = name
    return current


def recount(apps, schema_editor):
    User = apps.get_model("users", "CustomUser")
    GameSession = apps.get_model("trivia", "GameSession")
    for user in User.objects.all():
        days = set()
        last = None
        for finished_at in GameSession.objects.filter(user_id=user.pk, score__gt=0).values_list("finished_at", flat=True):
            day = finished_at.astimezone(CET).date()
            days.add(day)
            last = day if last is None or day > last else last
        user.active_days = len(days)
        user.last_active_day = last
        user.founding_member = True
        user.rank = _rank_for(user.points, user.active_days)
        user.save(update_fields=["active_days", "last_active_day", "founding_member", "rank"])


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0012_customuser_consent_source"),
        ("trivia", "0008_factory_journal"),
    ]

    operations = [
        migrations.AddField(model_name="customuser", name="active_days", field=models.PositiveIntegerField(default=0)),
        migrations.AddField(model_name="customuser", name="last_active_day", field=models.DateField(blank=True, null=True)),
        migrations.AddField(model_name="customuser", name="streak_days", field=models.PositiveIntegerField(default=0)),
        migrations.AddField(model_name="customuser", name="streak_best", field=models.PositiveIntegerField(default=0)),
        migrations.AddField(model_name="customuser", name="streak_freezes", field=models.PositiveSmallIntegerField(default=1)),
        migrations.AddField(model_name="customuser", name="founding_member", field=models.BooleanField(default=False)),
        migrations.RunPython(recount, migrations.RunPython.noop),
    ]
