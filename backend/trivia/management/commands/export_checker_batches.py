"""Write pending questions as Checker batches (spec §4.12).

Job 1 of .github/workflows/question-checker.yml. Needs DATABASE_URL; calls no model
and no website. Writes <out>/batch-NNN.json and, for the workflow matrix,
batches=[...] and count=N to $GITHUB_OUTPUT.
"""
import json
import os

from django.core.management.base import BaseCommand

from trivia.data_pipeline import publish_v3
from trivia.questions.checker_jobs import export_batches


class Command(BaseCommand):
    help = "Export pending questions as small batches for the Checker agent."

    def add_arguments(self, parser):
        parser.add_argument("--out", required=True, help="Folder to write batch-NNN.json files into")
        parser.add_argument("--limit", type=int, default=60, help="Most questions to export (default 60)")
        parser.add_argument("--batch-size", type=int, default=10, help="Questions per batch (default 10)")

    def handle(self, *args, **opts):
        dataset = publish_v3.curated_dataset()
        batches = export_batches(dataset, max(0, opts["limit"]), max(1, opts["batch_size"]), out=self.stdout.write)
        os.makedirs(opts["out"], exist_ok=True)
        for b in batches:
            with open(os.path.join(opts["out"], f"batch-{b['batch']}.json"), "w", encoding="utf-8") as f:
                json.dump(b, f, ensure_ascii=False, indent=1)
        count = sum(len(b["questions"]) for b in batches)
        self.stdout.write(f"Exported {count} pending question(s) in {len(batches)} batch(es) to {opts['out']}")
        path = os.environ.get("GITHUB_OUTPUT")
        if path:
            with open(path, "a", encoding="utf-8") as f:
                f.write(f"batches={json.dumps([b['batch'] for b in batches])}\n")
                f.write(f"count={count}\n")
