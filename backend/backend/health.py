"""GET /api/health/ — the pre-warm target (src/utils/session.ts prewarmBackend).

No DB, no auth, no throttle: it exists so a guest's first real request (guess log, login,
leaderboard) finds an already-warm serverless function. Guarded by trivia/tests/test_startup.py."""
from django.http import JsonResponse
from django.views.decorators.http import require_GET


@require_GET
def health_view(request):
    resp = JsonResponse({"ok": True})
    resp["Cache-Control"] = "no-store"
    return resp
