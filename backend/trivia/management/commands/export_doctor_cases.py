"""Write the doctor's research cases (spec §4.9).

Job 1 of .github/workflows/doctor-research.yml. Needs DATABASE_URL; calls no model and no
website. Writes <out>/case-NNN.json, one per quarantined or queued question of the staged games
(trivia.questions.doctor_verdicts.export_cases), and, for the workflow matrix, cases=[...] and
count=N to $GITHUB_OUTPUT.
"""
import json
import os

from django.core.management.base import BaseCommand

from trivia.data_pipeline import publish_v3
from trivia.questions.doctor_verdicts import MAX_CASES, export_cases


class Command(BaseCommand):
    help = "Export quarantined and queued questions as cases for the doctor agent."

    def add_arguments(self, parser):
        parser.add_argument("--out", required=True, help="Folder to write case-NNN.json files into")
        parser.add_argument("--limit", type=int, default=MAX_CASES, help=f"Most cases to export (default {MAX_CASES})")

    def handle(self, *args, **opts):
        dataset = publish_v3.curated_dataset()
        cases = export_cases(dataset, max(0, opts["limit"]), out=self.stdout.write)
        os.makedirs(opts["out"], exist_ok=True)
        for case in cases:
            with open(os.path.join(opts["out"], f"case-{case['case']}.json"), "w", encoding="utf-8") as f:
                json.dump(case, f, ensure_ascii=False, indent=1)
        self.stdout.write(f"Exported {len(cases)} case(s) to {opts['out']}")
        path = os.environ.get("GITHUB_OUTPUT")
        if path:
            with open(path, "a", encoding="utf-8") as f:
                f.write(f"cases={json.dumps([c['case'] for c in cases])}\n")
                f.write(f"count={len(cases)}\n")
