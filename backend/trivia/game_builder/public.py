"""The public, read-only side of a custom game an admin has published (frontend route /custom/<slug>).

    GET /trivia/custom-games/<slug>/        {game: {slug, title, description, mode, rounds, points_per_correct}}
    GET /trivia/custom-games/<slug>/play/   {rounds, points_per_correct, max_points}

Only a game with status "published" answers; a draft is a 404, exactly like an unknown slug. Rounds carry their
answers and the browser judges them, as the static pools of the built-in games do: a custom game awards no points
and logs no session, so there is nothing to protect. The spec, the conversation and the usage never leave the
admin API.
"""
from django.shortcuts import get_object_or_404
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from backend.throttles import CustomGameRateThrottle
from trivia.models import CustomGame

from . import engine
from .spec import SpecError


def _published(slug):
    return get_object_or_404(CustomGame, slug=slug, status=CustomGame.PUBLISHED)


@api_view(["GET"])
@permission_classes([AllowAny])
@throttle_classes([CustomGameRateThrottle])
def custom_game(request, slug):
    game = _published(slug)
    return Response({"game": {
        "slug": game.slug,
        "title": game.title,
        "description": game.description,
        "mode": game.spec.get("mode"),
        "rounds": game.spec.get("rounds"),
        "points_per_correct": game.spec.get("points_per_correct", 10),
    }})


@api_view(["GET"])
@permission_classes([AllowAny])
@throttle_classes([CustomGameRateThrottle])
def custom_game_play(request, slug):
    game = _published(slug)
    try:
        rounds = engine.build_rounds(game.spec)
    except (SpecError, KeyError, OSError):
        # A dataset publish shrank the pool after the game was approved: to a visitor the game is simply gone.
        return Response({"error": "This game is not available right now."}, status=404)
    points = game.spec.get("points_per_correct", 10)
    return Response({"rounds": rounds, "points_per_correct": points, "max_points": points * len(rounds)})
