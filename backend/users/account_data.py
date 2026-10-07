"""A player's rights over their own data: delete the account, export everything we hold.

Deletion removes the account and everything tied to it. One deliberate exception: a BANNED
account is anonymised instead of deleted, keeping only what stops the same person simply
re-registering (the ban switch, reason code, strike count and canonical email) plus the
moderation events behind it. That is a legitimate-interest record disclosed in the Privacy
Policy (GDPR Art 17(3)(e) / Art 6(1)(f)), not a loophole: nothing else is kept.
"""
import base64

from django.db import transaction
from django.utils import timezone

from trivia.models import Feedback, GameSession, GuessLog, WordlePlay
from users import friends_cache, leaderboard
from users.models import BlockedUser, FriendRequest, Friendship, ModerationEvent
from users.tokens import revoke_sessions

ANONYMISED_NAME = "Deleted player"


class _PublicId:
    """leaderboard.remove only needs the public id, and the user row may already be gone."""

    def __init__(self, public_id):
        self.public_id = public_id


def _counterpart_pks(user):
    """Every other account whose cached friends overview mentions this user."""
    pks = set(Friendship.objects.filter(user_low=user).values_list("user_high_id", flat=True))
    pks.update(Friendship.objects.filter(user_high=user).values_list("user_low_id", flat=True))
    pks.update(FriendRequest.objects.filter(sender=user).values_list("receiver_id", flat=True))
    pks.update(FriendRequest.objects.filter(receiver=user).values_list("sender_id", flat=True))
    pks.discard(user.pk)
    return pks


def delete_account(user):
    """Erase the account and its data. Returns "deleted" or, for a banned account, "anonymised"."""
    pk, public_id = user.pk, user.public_id
    banned = user.banned_at is not None
    others = _counterpart_pks(user)

    with transaction.atomic():
        revoke_sessions(user)
        GameSession.objects.filter(user=user).delete()
        GuessLog.objects.filter(user=user).delete()
        WordlePlay.objects.filter(user=user).delete()
        Feedback.objects.filter(user=user).delete()
        Feedback.objects.filter(public_id=public_id).delete()  # snapshot rows whose FK was nulled

        if banned:
            # Keep the ban record; drop everything that identifies or describes the person.
            FriendRequest.objects.filter(sender=user).delete()
            FriendRequest.objects.filter(receiver=user).delete()
            Friendship.objects.filter(user_low=user).delete()
            Friendship.objects.filter(user_high=user).delete()
            BlockedUser.objects.filter(blocker=user).delete()
            BlockedUser.objects.filter(blocked=user).delete()
            user.username = ANONYMISED_NAME
            user.email = f"deleted-{public_id.lower()}@deleted.invalid"
            user.set_unusable_password()
            user.google_sub = None
            user.profile_photo_data = None
            user.profile_photo_version = 0
            user.points = 0
            user.rank = "Rookie"
            user.first_name = user.last_name = ""
            user.is_active = False
            user.save()
            outcome = "anonymised"
        else:
            ModerationEvent.objects.filter(user=user).delete()
            ModerationEvent.objects.filter(public_id=public_id).delete()
            user.delete()  # cascades friendships, requests, blocks, token rows
            outcome = "deleted"

    # Best-effort caches, outside the transaction so a Redis hiccup can't undo the erasure.
    leaderboard.remove(_PublicId(public_id))
    friends_cache.invalidate_friends(pk, *others)
    return outcome


def _iso(value):
    return value.isoformat() if value else None


def _person(u):
    return {"id": u.public_id, "username": u.username}


def export_account(user):
    """Everything we hold about the player, as JSON-serialisable data (GDPR Art 15 and 20)."""
    photo = None
    if user.profile_photo_data:
        photo = base64.b64encode(bytes(user.profile_photo_data)).decode("ascii")

    friends = [(f.user_high, f.created_at) for f in Friendship.objects.filter(user_low=user).select_related("user_high")]
    friends += [(f.user_low, f.created_at) for f in Friendship.objects.filter(user_high=user).select_related("user_low")]

    return {
        "exported_at": _iso(timezone.now()),
        "account": {
            "id": user.public_id,
            "username": user.username,
            "email": user.email,
            "signed_up_with_google": bool(user.google_sub),
            "points": user.points,
            "rank": user.rank,
            "date_joined": _iso(user.date_joined),
            "last_login": _iso(user.last_login),
            "terms_accepted_at": _iso(user.terms_accepted_at),
            "terms_version": user.terms_version,
            "age_confirmed_at": _iso(user.age_confirmed_at),
            "strike_count": user.strike_count,
            "banned_at": _iso(user.banned_at),
            "ban_reason": user.ban_reason,
        },
        "profile_photo_jpeg_base64": photo,
        "friends": [{**_person(u), "since": _iso(at)} for u, at in friends],
        "friend_requests_sent": [
            {**_person(r.receiver), "at": _iso(r.created_at)}
            for r in FriendRequest.objects.filter(sender=user).select_related("receiver")
        ],
        "friend_requests_received": [
            {**_person(r.sender), "at": _iso(r.created_at)}
            for r in FriendRequest.objects.filter(receiver=user).select_related("sender")
        ],
        "blocked_players": [
            {**_person(b.blocked), "at": _iso(b.created_at)}
            for b in BlockedUser.objects.filter(blocker=user).select_related("blocked")
        ],
        "game_sessions": [
            {"game": s.game, "mode": s.mode, "score": s.score, "duration_ms": s.duration_ms, "at": _iso(s.finished_at)}
            for s in GameSession.objects.filter(user=user).order_by("finished_at")
        ],
        "guesses": [
            {"game": g.game, "question_id": g.question_id, "answer": g.answer, "correct": g.correct, "elapsed_ms": g.elapsed_ms}
            for g in GuessLog.objects.filter(user=user).order_by("id")
        ],
        "wordle_plays": [{"date": p.play_date.isoformat()} for p in WordlePlay.objects.filter(user=user)],
        "feedback": [
            {"rating": f.rating, "message": f.message, "page": f.page, "game": f.game, "at": _iso(f.created_at)}
            for f in Feedback.objects.filter(user=user).order_by("created_at")
        ],
        "moderation_events": [
            {"kind": e.kind, "tier": e.tier, "reason": e.reason, "ip_hash": e.ip_hash, "at": _iso(e.created_at)}
            for e in ModerationEvent.objects.filter(user=user).order_by("created_at")
        ],
    }
