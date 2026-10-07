# Adds the consent record on CustomUser: Terms/Privacy acceptance time + version, and the
# time the age requirement was confirmed. All nullable/blank: existing accounts have none.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0009_customuser_google_sub"),
    ]

    operations = [
        migrations.AddField(
            model_name="customuser",
            name="terms_accepted_at",
            field=models.DateTimeField(blank=True, editable=False, null=True),
        ),
        migrations.AddField(
            model_name="customuser",
            name="terms_version",
            field=models.CharField(blank=True, default="", editable=False, max_length=20),
        ),
        migrations.AddField(
            model_name="customuser",
            name="age_confirmed_at",
            field=models.DateTimeField(blank=True, editable=False, null=True),
        ),
    ]
