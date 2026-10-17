"""Write the editorial author's weekly brief (spec §4.6).

Job 1 of .github/workflows/editorial-author.yml. Needs DATABASE_URL; calls no model and no
website. Writes <out>/brief.json (trivia.questions.editorial_author.build_brief): the rule
language with examples, the dataset's field catalogue, the existing prompts, pairs and group
labels, each game's coverage gaps, the per-game quota, 40 sample players and the notable
team-seasons.
"""
import json
import os

from django.core.management.base import BaseCommand
from django.utils import timezone

from trivia.data_pipeline import publish_v3
from trivia.questions.editorial_author import build_brief


class Command(BaseCommand):
    help = "Export the brief for the weekly editorial author (Fan Favorites, Who Would Win, Connections)."

    def add_arguments(self, parser):
        parser.add_argument("--out", required=True, help="Folder to write brief.json into")

    def handle(self, *args, **opts):
        dataset = publish_v3.curated_dataset()
        brief = build_brief(dataset, timezone.now())
        os.makedirs(opts["out"], exist_ok=True)
        with open(os.path.join(opts["out"], "brief.json"), "w", encoding="utf-8") as f:
            json.dump(brief, f, ensure_ascii=False, indent=1)
        self.stdout.write(f"Exported the editorial brief to {opts['out']} ("
                          + ", ".join(f"{slug} {c['questions']} live or pending"
                                      for slug, c in brief["coverage"].items()) + ")")
