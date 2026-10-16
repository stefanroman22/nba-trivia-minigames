# Progression v2 (docs/superpowers/specs/2026-10-16-progression-design.md §3): the new account fields,
# then every existing account gets its active days recounted from its GameSession history (distinct
# Europe/Paris days), its rank recalculated under the new ladder, and the Founding Member flag
# (users.progression_recount, also `manage.py recount_progression`). db_default on every NOT NULL column:
# the old backend shares this database and keeps inserting users without them while both are live.
from django.db import migrations, models

from users.progression_recount import recount_progression


def recount(apps, schema_editor):
    recount_progression(apps.get_model("users", "CustomUser"), apps.get_model("trivia", "GameSession"))


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0012_customuser_consent_source"),
        ("trivia", "0008_factory_journal"),
    ]

    operations = [
        migrations.AddField(model_name="customuser", name="active_days", field=models.PositiveIntegerField(default=0, db_default=0)),
        migrations.AddField(model_name="customuser", name="last_active_day", field=models.DateField(blank=True, null=True)),
        migrations.AddField(model_name="customuser", name="streak_days", field=models.PositiveIntegerField(default=0, db_default=0)),
        migrations.AddField(model_name="customuser", name="streak_best", field=models.PositiveIntegerField(default=0, db_default=0)),
        migrations.AddField(model_name="customuser", name="streak_freezes", field=models.PositiveSmallIntegerField(default=1, db_default=1)),
        migrations.AddField(model_name="customuser", name="founding_member", field=models.BooleanField(default=False, db_default=False)),
        migrations.RunPython(recount, migrations.RunPython.noop),
    ]
