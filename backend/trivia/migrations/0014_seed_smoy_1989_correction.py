"""Seed the 1988-89 Sixth Man of the Year for Eddie Johnson (person 698).

No row of players_curated.json holds the 1989 Sixth Man of the Year (nba_api's
playerawards resolves by name and credits it to the Hawks' Eddie Johnson, whose
span drops it: curated_players.build_awards), which leaves Guess the MVP's award
seasons one Sixth Man short. Inserted only when absent; the reverse deletes it.
Once a regenerated players_curated.json holds 1989 itself, the correction is
marked redundant (corrections.mark_redundant).
"""
import json
import os

from django.conf import settings
from django.db import migrations

PERSON_ID = 698
FIELD_PATH = "awards.smoy"
YEAR = 1989
SOURCES = [
    "https://www.basketball-reference.com/awards/smoy.html",
    "https://en.wikipedia.org/wiki/NBA_Sixth_Man_of_the_Year_Award",
]
REASON = "1988-89 Sixth Man of the Year missing from nba_api awards"


def _current_smoy():
    path = os.path.join(settings.BASE_DIR, "trivia", "data_static", "players_curated.json")
    try:
        with open(path, encoding="utf-8") as f:
            rows = json.load(f)
    except (OSError, ValueError):
        return []
    for row in rows if isinstance(rows, list) else []:
        if isinstance(row, dict) and row.get("person_id") == PERSON_ID:
            return list((row.get("awards") or {}).get("smoy") or [])
    return []


def seed(apps, schema_editor):
    DataCorrection = apps.get_model("trivia", "DataCorrection")
    if DataCorrection.objects.filter(person_id=PERSON_ID, field_path=FIELD_PATH).exists():
        return
    current = _current_smoy()
    if YEAR in current:
        return
    DataCorrection.objects.create(
        person_id=PERSON_ID, field_path=FIELD_PATH, old_value=current,
        new_value=sorted(set(current) | {YEAR}), sources=SOURCES, reason=REASON,
        status="active", created_by="owner",
    )


def unseed(apps, schema_editor):
    DataCorrection = apps.get_model("trivia", "DataCorrection")
    DataCorrection.objects.filter(person_id=PERSON_ID, field_path=FIELD_PATH, created_by="owner",
                                  reason=REASON).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("trivia", "0013_data_corrections"),
    ]

    operations = [
        migrations.RunPython(seed, unseed),
    ]
