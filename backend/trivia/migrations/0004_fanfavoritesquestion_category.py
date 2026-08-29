from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("trivia", "0003_fanfavoritesquestion_gamesession_guesslog"),
    ]

    operations = [
        migrations.AddField(
            model_name="fanfavoritesquestion",
            name="category",
            field=models.CharField(default="player", max_length=12),
        ),
    ]
