"""Staff-only API behind Admin -> Game Builder (mounted at /api/admin/game-builder/).

    GET    /                  {enabled, model, sources, games}
    POST   /                  {prompt}  -> 201 {game}     the agent builds a new draft
    GET    /<id>/             {game}
    DELETE /<id>/             204
    POST   /<id>/refine/      {prompt}  -> {game}         the agent changes the game (or answers without changing it);
                                                          a changed game is a draft again
    POST   /<id>/publish/     {action: publish | unpublish} -> {game}    the approval step for /custom/<slug>
    GET    /<id>/play/        {rounds, points_per_correct, max_points}   a fresh random set; ?seed=<int> to pin it

Every view REQUIRES is_staff (IsAdminUser). Rounds include their answers: the client judges them and nothing is
awarded. Errors are {error}: 400 bad input, 502 the agent failed, 503 not configured. The public, read-only side of
a published game is public.py.
"""
from django.conf import settings
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.text import slugify
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response

from backend.throttles import GameBuilderRateThrottle
from trivia.models import CustomGame

from . import agent, engine
from .sources import catalog
from .spec import SpecError

MAX_PROMPT = 1000


def _summary(game):
    return {
        "id": game.pk,
        "slug": game.slug,
        "title": game.title,
        "description": game.description,
        "mode": game.spec.get("mode"),
        "source": game.spec.get("source"),
        "status": game.status,
        "published_at": game.published_at.isoformat() if game.published_at else None,
        "public_path": f"/custom/{game.slug}",
        "updated_at": game.updated_at.isoformat(),
    }


def _preview(spec):
    """The stored spec's preview. A dataset publish can shrink a pool after the game was built: report that as a
    warning instead of failing the whole panel."""
    try:
        result = engine.preview(spec)
    except (SpecError, KeyError, OSError) as e:
        return {"pool_size": 0, "answer_values": 0, "rounds": [], "warnings": [f"This game no longer runs: {e}"]}
    return {k: result[k] for k in ("pool_size", "answer_values", "rounds", "warnings")}


def _detail(game):
    usage = {"input_tokens": 0, "output_tokens": 0, "turns": 0, **(game.usage or {})}
    return {
        **_summary(game),
        "spec": game.spec,
        "transcript": game.transcript,
        "preview": _preview(game.spec),
        "model": game.model,
        "usage": usage,
    }


def _prompt(request):
    prompt = request.data.get("prompt")
    if not isinstance(prompt, str) or not prompt.strip():
        return None, Response({"error": "Describe the game first."}, status=400)
    if len(prompt) > MAX_PROMPT:
        return None, Response({"error": f"Keep the description under {MAX_PROMPT} characters."}, status=400)
    return prompt.strip(), None


def _unique_slug(title, exclude_pk=None):
    base = slugify(title)[:70] or "game"
    slug, n = base, 2
    while CustomGame.objects.filter(slug=slug).exclude(pk=exclude_pk).exists():
        slug, n = f"{base}-{n}", n + 1
    return slug


def _entry(role, text):
    return {"role": role, "text": text, "at": timezone.now().isoformat()}


def _add_usage(total, usage):
    total = total or {}
    return {k: int(total.get(k, 0)) + int(usage.get(k, 0)) for k in ("input_tokens", "output_tokens", "turns")}


def _run_agent(prompt, current_spec=None):
    """(BuildResult, None) or (None, error Response)."""
    if not settings.GAME_BUILDER_ENABLED:
        return None, Response({"error": "The AI game builder is not configured on this server."}, status=503)
    try:
        return agent.run(prompt, current_spec), None
    except agent.BuilderError as e:
        return None, Response({"error": str(e)}, status=502)


@api_view(["GET", "POST"])
@permission_classes([IsAdminUser])
@throttle_classes([GameBuilderRateThrottle])
def games(request):
    if request.method == "GET":
        return Response({
            "enabled": settings.GAME_BUILDER_ENABLED,
            "model": settings.GAME_BUILDER_MODEL,
            "sources": catalog(),
            "games": [_summary(g) for g in CustomGame.objects.all()],
        })

    prompt, error = _prompt(request)
    if error:
        return error
    result, error = _run_agent(prompt)
    if error:
        return error
    if not result.spec:  # the agent explained why it cannot build this instead of building it
        return Response({"error": result.message}, status=502)
    game = CustomGame.objects.create(
        slug=_unique_slug(result.spec["title"]),
        title=result.spec["title"],
        description=result.spec["description"],
        spec=result.spec,
        transcript=[_entry("admin", prompt), _entry("agent", result.message)],
        model=result.model,
        usage=_add_usage({}, result.usage),
        created_by=request.user,
    )
    return Response({"game": _detail(game)}, status=201)


@api_view(["GET", "DELETE"])
@permission_classes([IsAdminUser])
def game(request, pk):
    obj = get_object_or_404(CustomGame, pk=pk)
    if request.method == "DELETE":
        obj.delete()
        return Response(status=204)
    return Response({"game": _detail(obj)})


@api_view(["POST"])
@permission_classes([IsAdminUser])
@throttle_classes([GameBuilderRateThrottle])
def refine(request, pk):
    obj = get_object_or_404(CustomGame, pk=pk)
    prompt, error = _prompt(request)
    if error:
        return error
    result, error = _run_agent(prompt, obj.spec)
    if error:
        return error
    if result.spec:
        obj.spec = result.spec
        obj.title = result.spec["title"]
        obj.description = result.spec["description"]
        obj.slug = _unique_slug(obj.title, exclude_pk=obj.pk)
        # The approval covered the spec that was published, not this one.
        obj.status, obj.published_at, obj.published_by = CustomGame.DRAFT, None, None
    obj.transcript = [*obj.transcript, _entry("admin", prompt), _entry("agent", result.message)]
    obj.model = result.model
    obj.usage = _add_usage(obj.usage, result.usage)
    obj.save()
    return Response({"game": _detail(obj)})


@api_view(["GET"])
@permission_classes([IsAdminUser])
def play(request, pk):
    obj = get_object_or_404(CustomGame, pk=pk)
    seed = request.query_params.get("seed")
    try:
        rounds = engine.build_rounds(obj.spec, int(seed) if seed and seed.lstrip("-").isdigit() else None)
    except (SpecError, KeyError, OSError) as e:
        return Response({"error": f"This game no longer runs: {e}"}, status=400)
    points = obj.spec.get("points_per_correct", 10)
    return Response({"rounds": rounds, "points_per_correct": points, "max_points": points * len(rounds)})


@api_view(["POST"])
@permission_classes([IsAdminUser])
def publish(request, pk):
    obj = get_object_or_404(CustomGame, pk=pk)
    action = request.data.get("action")
    if action == "publish":
        try:  # what a visitor's first request would do
            engine.build_rounds(obj.spec, seed=0)
        except (SpecError, KeyError, OSError):
            return Response({"error": "This game does not fill its rounds any more. Refine it before publishing."}, status=400)
        obj.status, obj.published_at, obj.published_by = CustomGame.PUBLISHED, timezone.now(), request.user
    elif action == "unpublish":
        obj.status, obj.published_at, obj.published_by = CustomGame.DRAFT, None, None
    else:
        return Response({"error": "action must be publish or unpublish."}, status=400)
    obj.save()
    return Response({"game": _detail(obj)})

