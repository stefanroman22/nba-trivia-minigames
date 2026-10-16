"""Check what the review agent wrote before anything acts on it (spec §4.8, improvement loop).

Job 4 of .github/workflows/factory-review.yml. Needs no database and no network.

    validate_review_cards <cards.json> --out <valid.json>
        The agent's cards file is untrusted: {"cards": [{title, category, priority, body}, ...]},
        at most MAX_CARDS cards, exactly those four string fields, category one of CATEGORIES,
        priority P0|P1|P2, title one line of at most MAX_TITLE characters, body at most MAX_BODY.
        Any problem (or a missing or malformed file) refuses the whole file: <valid.json> is then
        [] and the problems are printed. Never fails, so the review still lands.

    validate_review_cards --spec-edit <slug> <before.json>
        The agent may change only difficulty.bands of backend/trivia/questions/specs/<slug>.json
        (trivia.questions.calibration.spec_edit_problems). Fails (CommandError) when the file on
        disk is not a valid spec or differs from <before.json> anywhere else; the workflow then
        restores the file.

Writes no journal: it reads no database, and nothing it decides changes the factory itself.
"""
import json
import os

from django.core.management.base import BaseCommand, CommandError

from trivia.questions import calibration, specs

MAX_CARDS = 3
MAX_TITLE = 80
MAX_BODY = 2000
FIELDS = ("title", "category", "priority", "body")
CATEGORIES = ("frontend", "backend", "fullstack", "CI/CD", "pipeline", "AI", "docs")  # scripts/lib/team-config.mjs
PRIORITIES = ("P0", "P1", "P2")


def card_problems(data):
    """[problem, ...] for a parsed cards file (empty = every card is acceptable)."""
    if not isinstance(data, dict) or not isinstance(data.get("cards"), list):
        return ['the file must be an object {"cards": [...]}']
    cards = data["cards"]
    if len(cards) > MAX_CARDS:
        return [f"{len(cards)} cards: at most {MAX_CARDS} are allowed"]
    problems = []
    for i, card in enumerate(cards, 1):
        if not isinstance(card, dict):
            problems.append(f"card {i}: not an object")
            continue
        if set(card) != set(FIELDS):
            problems.append(f"card {i}: fields must be exactly {', '.join(FIELDS)} (got {', '.join(sorted(card))})")
            continue
        if not all(isinstance(card[f], str) and card[f].strip() for f in FIELDS):
            problems.append(f"card {i}: every field must be a non-empty string")
            continue
        title = card["title"]
        if len(title) > MAX_TITLE or any(ord(c) < 32 for c in title):
            problems.append(f"card {i}: title must be one line of at most {MAX_TITLE} characters")
        if card["category"] not in CATEGORIES:
            problems.append(f"card {i}: category {card['category'][:40]!r} is not one of {', '.join(CATEGORIES)}")
        if card["priority"] not in PRIORITIES:
            problems.append(f"card {i}: priority must be one of {', '.join(PRIORITIES)}")
        if len(card["body"]) > MAX_BODY:
            problems.append(f"card {i}: body is longer than {MAX_BODY} characters")
    return problems


class Command(BaseCommand):
    help = "Validate the review agent's cards file (or one spec edit) before the workflow acts on it."

    def add_arguments(self, parser):
        parser.add_argument("cards", nargs="?", help="The agent's cards.json")
        parser.add_argument("--out", help="Where to write the accepted cards (a JSON list; [] when refused)")
        parser.add_argument("--spec-edit", nargs=2, metavar=("SLUG", "BEFORE"),
                            help="Check backend/trivia/questions/specs/SLUG.json against its BEFORE version")

    def handle(self, *args, **opts):
        if opts["spec_edit"]:
            self._spec_edit(*opts["spec_edit"])
            return
        if not opts["cards"] or not opts["out"]:
            raise CommandError("give <cards.json> --out <valid.json>, or --spec-edit SLUG BEFORE")
        try:
            with open(opts["cards"], encoding="utf-8") as f:
                data = json.load(f)
            problems = card_problems(data)
        except FileNotFoundError:
            data, problems = None, ["no cards file"]
        except (OSError, ValueError) as e:
            data, problems = None, [f"unreadable cards file: {str(e)[:200]}"]
        cards = [] if problems else data["cards"]
        os.makedirs(os.path.dirname(os.path.abspath(opts["out"])), exist_ok=True)
        with open(opts["out"], "w", encoding="utf-8") as f:
            json.dump(cards, f, ensure_ascii=False, indent=1)
        for p in problems:
            self.stdout.write(f"refused: {p}")
        self.stdout.write(f"{len(cards)} card(s) accepted" + (" (the whole file was refused)" if problems else ""))

    def _spec_edit(self, slug, before_path):
        path = os.path.join(specs.SPEC_DIR, f"{os.path.basename(slug)}.json")
        try:
            with open(before_path, encoding="utf-8") as f:
                before = json.load(f)
            with open(path, encoding="utf-8") as f:
                after = json.load(f)
        except (OSError, ValueError) as e:
            raise CommandError(f"{slug}: unreadable spec: {str(e)[:200]}") from None
        problems = calibration.spec_edit_problems(slug, before, after)
        if problems:
            raise CommandError("; ".join(problems))
        self.stdout.write(f"{slug}: spec edit accepted")
