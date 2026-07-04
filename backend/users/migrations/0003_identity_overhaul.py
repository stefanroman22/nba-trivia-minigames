"""Identity overhaul: permanent 6-char public IDs, email as the unique login
identifier, and non-unique display usernames.

Order matters: public_id is added nullable, backfilled for existing accounts,
then locked down as unique — so the migration is safe on a live database.
"""
import secrets

import django.contrib.auth.validators
from django.db import migrations, models

import users.models

PUBLIC_ID_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"


def backfill_public_ids(apps, schema_editor):
    User = apps.get_model("users", "CustomUser")
    for user in User.objects.filter(public_id__isnull=True).iterator():
        while True:
            candidate = "".join(secrets.choice(PUBLIC_ID_ALPHABET) for _ in range(6))
            if not User.objects.filter(public_id=candidate).exists():
                user.public_id = candidate
                user.save(update_fields=["public_id"])
                break


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0002_alter_customuser_rank"),
    ]

    operations = [
        migrations.AddField(
            model_name="customuser",
            name="public_id",
            field=models.CharField(editable=False, max_length=6, null=True),
        ),
        migrations.RunPython(backfill_public_ids, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="customuser",
            name="public_id",
            field=models.CharField(editable=False, max_length=6, unique=True),
        ),
        migrations.AlterField(
            model_name="customuser",
            name="username",
            field=models.CharField(
                help_text="Display name shown to other players (does not need to be unique).",
                max_length=150,
                validators=[django.contrib.auth.validators.UnicodeUsernameValidator()],
            ),
        ),
        migrations.AlterField(
            model_name="customuser",
            name="email",
            field=models.EmailField(max_length=254, unique=True),
        ),
        migrations.AlterModelManagers(
            name="customuser",
            managers=[("objects", users.models.CustomUserManager())],
        ),
    ]
