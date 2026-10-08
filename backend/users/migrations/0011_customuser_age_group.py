# Adds CustomUser.age_group ("teen" 13-15, "adult" 16+, "" for older accounts).

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0010_customuser_consent_record"),
    ]

    operations = [
        migrations.AddField(
            model_name="customuser",
            name="age_group",
            field=models.CharField(blank=True, default="", editable=False, max_length=5),
        ),
    ]
