# Adds CustomUser.google_sub: the stable Google account id used to link "Continue with Google".

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0008_moderation"),
    ]

    operations = [
        migrations.AddField(
            model_name="customuser",
            name="google_sub",
            field=models.CharField(blank=True, editable=False, max_length=64, null=True, unique=True),
        ),
    ]
