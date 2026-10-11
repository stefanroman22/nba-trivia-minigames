# Adds CustomUser.consent_source: how the 13+/Terms confirmation was given at sign-up.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0011_customuser_age_group"),
    ]

    operations = [
        migrations.AddField(
            model_name="customuser",
            name="consent_source",
            field=models.CharField(blank=True, db_default="", default="", editable=False, max_length=30),
        ),
    ]
