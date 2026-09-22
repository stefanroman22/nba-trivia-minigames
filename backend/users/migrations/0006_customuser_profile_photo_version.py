# Adds CustomUser.profile_photo_version and backfills it for photos that were uploaded
# before the column existed (dbc9a0f stored bytes with no version), so that
# `profile_photo_version > 0` means "has a photo" for every row.

from django.db import migrations, models


def backfill_photo_version(apps, schema_editor):
    """Every row that already holds photo bytes becomes version 1 (idempotent: rows with a
    non-zero version are left alone). users.friends._brief and users.photos rely on the
    invariant `version > 0 <=> photo present`."""
    CustomUser = apps.get_model("users", "CustomUser")
    CustomUser.objects.filter(profile_photo_data__isnull=False, profile_photo_version=0).update(
        profile_photo_version=1
    )


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0005_customuser_profile_photo_data"),
    ]

    operations = [
        migrations.AddField(
            model_name="customuser",
            name="profile_photo_version",
            field=models.PositiveIntegerField(default=0, editable=False),
        ),
        migrations.RunPython(backfill_photo_version, migrations.RunPython.noop),
    ]
