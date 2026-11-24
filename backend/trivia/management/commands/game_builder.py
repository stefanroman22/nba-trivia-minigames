"""The AI game builder from the command line (the same agent as Admin -> Game Builder).

    python manage.py game_builder sources                       the datasets a game can draw on
    python manage.py game_builder build "guess who drafted each all-star"
    python manage.py game_builder refine <slug> "only players drafted after 2000"
    python manage.py game_builder preview <slug> [--seed 7]     print one full set of rounds
    python manage.py game_builder check spec.json               validate and test-run a hand-written spec (no model)

build and refine call the Anthropic API (ANTHROPIC_API_KEY) and are billed to that key.
"""
import json

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from trivia.game_builder import agent, engine
from trivia.game_builder.api import _add_usage, _entry, _unique_slug
from trivia.game_builder.sources import catalog
from trivia.game_builder.spec import SpecError, validate
from trivia.models import CustomGame


class Command(BaseCommand):
    help = "Build, refine, preview or check an AI-built game."

    def add_arguments(self, parser):
        parser.add_argument("action", choices=["sources", "build", "refine", "preview", "check"])
        parser.add_argument("args", nargs="*")
        parser.add_argument("--seed", type=int, default=None)

    def handle(self, *args, **opts):
        action = opts["action"]
        if action == "sources":
            for s in catalog():
                self.stdout.write(f"{s['id']} ({s['rows']} rows): {', '.join(f['name'] for f in s['fields'])}")
            return
        if action == "check":
            spec = self._checked(json.load(open(self._arg(args, 0, "a spec file"), encoding="utf-8")))
            return self._print(engine.preview(spec))
        if action == "preview":
            game = self._game(self._arg(args, 0, "a game slug"))
            return self._print(self._rounds(game.spec, opts["seed"]))

        if not settings.GAME_BUILDER_ENABLED:
            raise CommandError("Set ANTHROPIC_API_KEY to use build and refine.")
        game = self._game(self._arg(args, 0, "a game slug")) if action == "refine" else None
        prompt = self._arg(args, 1 if game else 0, "a description")
        try:
            result = agent.run(prompt, game.spec if game else None)
        except agent.BuilderError as e:
            raise CommandError(str(e))
        self.stdout.write(result.message)
        if not result.spec:
            return
        game = game or CustomGame(transcript=[], usage={})
        game.spec, game.title, game.description = result.spec, result.spec["title"], result.spec["description"]
        game.slug = _unique_slug(game.title, exclude_pk=game.pk)
        game.transcript = [*game.transcript, _entry("admin", prompt), _entry("agent", result.message)]
        game.model, game.usage = result.model, _add_usage(game.usage, result.usage)
        game.save()
        self.stdout.write(self.style.SUCCESS(f"{game.slug}: {result.preview['pool_size']} rows match"))
        self._print(game.spec)

    def _arg(self, args, i, what):
        if len(args) <= i:
            raise CommandError(f"Give {what}.")
        return args[i]

    def _game(self, slug):
        try:
            return CustomGame.objects.get(slug=slug)
        except CustomGame.DoesNotExist:
            raise CommandError(f"No game with slug {slug!r}.")

    def _checked(self, raw):
        try:
            return validate(raw)
        except SpecError as e:
            raise CommandError("\n".join(e.problems))

    def _rounds(self, spec, seed):
        try:
            return engine.build_rounds(spec, seed)
        except SpecError as e:
            raise CommandError("\n".join(e.problems))

    def _print(self, data):
        self.stdout.write(json.dumps(data, indent=1, ensure_ascii=False))
