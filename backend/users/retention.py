"""How long personal data is kept, and the job that enforces it.

These periods are the ones the Privacy Policy states (src/app/privacy/page.tsx, docs/legal/RECORD_OF_PROCESSING.md):
change them in all three places together. Everything here is deletion of rows that no longer have a
purpose; nothing is rewritten.
"""
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.utils import timezone

from trivia.models import Feedback, GameSession, GuessLog, RollupWatermark
from trivia.questions.rollup import GUESS_LOG
from users.models import ModerationEvent

# Per-guess answers feed question statistics; the per-game score history backs a player's own record.
# An answer is deleted only once the nightly roll-up has counted it (id at or below its watermark).
GUESS_LOG_DAYS = 30
GAME_SESSION_DAYS = 730
# Moderation events (including the hashed-IP signup locks) outlive their purpose quickly. Events
# belonging to an account that is STILL banned are kept for as long as the ban stands.
MODERATION_EVENT_DAYS = 365
# Feedback that has been dealt with. Unresolved feedback stays until someone handles it.
RESOLVED_FEEDBACK_DAYS = 365
# The Privacy Policy promises a ban record is never kept longer than five years after the ban.
BAN_RECORD_DAYS = 365 * 5


def prune_personal_data(now=None):
    """Delete everything past its retention period. Returns {name: rows_deleted}."""
    now = now or timezone.now()

    def before(days):
        return now - timedelta(days=days)

    # Events of a still-banned account are the ban record (users.account_data); keep those.
    banned_public_ids = get_user_model().objects.filter(banned_at__isnull=False).values_list("public_id", flat=True)

    # Bans older than the cap are lifted by erasing the account (it can then simply sign up again).
    expired_bans = get_user_model().objects.filter(banned_at__lt=before(BAN_RECORD_DAYS))
    expired_ban_count = expired_bans.count()
    expired_bans.delete()

    counted_up_to = RollupWatermark.objects.filter(name=GUESS_LOG).values_list("last_id", flat=True).first() or 0

    return {
        "expired_ban_records": expired_ban_count,
        "guess_logs": GuessLog.objects.filter(created_at__lt=before(GUESS_LOG_DAYS), id__lte=counted_up_to)
        .delete()[0],
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
