"""How long personal data is kept, and the job that enforces it.

These periods are the ones the Privacy Policy states (src/app/privacy/page.tsx, docs/legal/RETENTION.md):
change them in all three places together. Everything here is deletion of rows that no longer have a
purpose; nothing is rewritten.
"""
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.utils import timezone

from trivia.models import Feedback, GameSession, GuessLog
from users.models import ModerationEvent

# Per-guess answers feed question statistics; the per-game score history backs a player's own record.
GUESS_LOG_DAYS = 365
GAME_SESSION_DAYS = 730
# Moderation events (including the hashed-IP signup locks) outlive their purpose quickly. Events
# belonging to an account that is STILL banned are kept for as long as the ban stands.
MODERATION_EVENT_DAYS = 365
# Feedback that has been dealt with. Unresolved feedback stays until someone handles it.
RESOLVED_FEEDBACK_DAYS = 365


def prune_personal_data(now=None):
    """Delete everything past its retention period. Returns {name: rows_deleted}."""
    now = now or timezone.now()

    def before(days):
        return now - timedelta(days=days)

    # Events of a still-banned account are the ban record (users.account_data); keep those.
    banned_public_ids = get_user_model().objects.filter(banned_at__isnull=False).values_list("public_id", flat=True)

    return {
        "guess_logs": GuessLog.objects.filter(created_at__lt=before(GUESS_LOG_DAYS)).delete()[0],
        "game_sessions": GameSession.objects.filter(finished_at__lt=before(GAME_SESSION_DAYS)).delete()[0],
        "moderation_events": ModerationEvent.objects.filter(created_at__lt=before(MODERATION_EVENT_DAYS))
        .exclude(public_id__in=list(banned_public_ids))
        .delete()[0],
        "resolved_feedback": Feedback.objects.filter(
            status=Feedback.RESOLVED, created_at__lt=before(RESOLVED_FEEDBACK_DAYS)
        ).delete()[0],
    }


def flush_expired_tokens():
    """Drop expired refresh-token rows (they otherwise pile up between deploys)."""
    call_command("flushexpiredtokens")
