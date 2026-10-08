"""Strikes, bans and the signup IP lock (docs/team/designs/2026-10-06-ban-system-and-username.md D2/D3).

* Accounts collect strikes (a severe name or a blocked photo on update-profile); they never expire
  (owner decision 5) and the MAX_STRIKES-th one bans inside the same transaction.
* A ban sets `banned_at` (THE switch: users.authentication refuses every request), blacklists every
  outstanding refresh token, drops the player from the Redis leaderboard and stores the canonical email
  so the same address can't simply sign up again. Nothing is deleted, so `unban_user` restores everything.
* Signup attempts create no account, so a severe name there counts against the client IP in the shared
  cache (settings.CACHES — shared in production, BE-19); the SIGNUP_IP_LIMIT-th locks sign-ups from that
  IP for SIGNUP_IP_LOCK_SECONDS.

Only a reason code and tier are ever logged (ModerationEvent), never the matched text or the raw IP.
"""
import hashlib

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied

from users import leaderboard
from users.models import ModerationEvent

MAX_STRIKES = 3
BAN_CODE = "account_banned"
BAN_MESSAGE = "This account has been banned."
BAN_REASON_NAME = "name_severe"
BAN_REASON_PHOTO = "photo"
BAN_REASON_ADMIN = "admin"
SIGNUP_IP_LIMIT = 3
SIGNUP_IP_LOCK_SECONDS = 24 * 3600

SIGNUP_LOCKED_CODE = "signup_locked"
SIGNUP_LOCKED_MESSAGE = "Sign-ups from your network are paused for 24 hours."
SIGNUP_BLOCKED_CODE = "signup_blocked"
SIGNUP_BLOCKED_MESSAGE = "This email can't be used to create an account."

_GMAIL_DOMAINS = {"gmail.com", "googlemail.com"}


def client_ip_hash(request):
    """Salted SHA-256 of the caller's IP (first X-Forwarded-For hop, else REMOTE_ADDR). Never the IP."""
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    ip = forwarded.split(",")[0].strip() if forwarded else request.META.get("REMOTE_ADDR", "")
    return hashlib.sha256(f"{settings.SECRET_KEY}:{ip}".encode()).hexdigest()


def canonical_email(email):
    """Lowercase; "+tag" dropped everywhere; Gmail dots dropped ("A.b+x@Gmail.com" -> "ab@gmail.com")."""
    email = str(email or "").strip().lower()
    local, sep, domain = email.rpartition("@")
    if not sep:
        return email
    local = local.split("+", 1)[0]
    if domain in _GMAIL_DOMAINS:
        local = local.replace(".", "")
        domain = "gmail.com"
    return f"{local}@{domain}"


def email_is_banned(email):
    """True if a banned account already holds this email's canonical form."""
    return get_user_model().objects.filter(
        canonical_email=canonical_email(email), banned_at__isnull=False
    ).exists()


def ban_payload(user):
    """The 403 body every surface returns for a banned account (the frontend keys on `code`)."""
    return {
        "code": BAN_CODE,
        "error": BAN_MESSAGE,
        "public_id": user.public_id,
        "strikes": user.strike_count,
        "reason": user.ban_reason,
        "banned_at": user.banned_at.isoformat() if user.banned_at else None,
        # DSA Art 17 statement of reasons: whether an automatic tool decided, and where to appeal.
        "automated": user.ban_reason != "admin",
        "appeal_email": settings.LEGAL_CONTACT_EMAIL,
    }


class AccountBanned(PermissionDenied):
    """403 whose body is exactly ban_payload(user). DRF would stringify a dict `detail`
    ("strikes": "3"); setting it after __init__ keeps the JSON types the frontend reads."""

    def __init__(self, user):
        super().__init__()
        self.detail = ban_payload(user)


def log_event(user, kind, tier, reason, ip_hash=""):
    return ModerationEvent.objects.create(
        user=user,
        public_id=getattr(user, "public_id", "") or "",
        kind=kind,
        tier=tier,
        reason=reason,
        ip_hash=ip_hash or "",
    )


def record_strike(user, kind, ip_hash=""):
    """Add one strike atomically; ban on the MAX_STRIKES-th. Returns (strike_count, banned):
    `banned` is True when the account is banned after this call (this strike banned it, or a
    racing request already had, in which case nothing is added and the caller answers 403).

    `user` is refreshed in place, so the caller can build the response from it.
    """
    User = get_user_model()
    with transaction.atomic():
        # Lock first, then increment: two concurrent third strikes serialize on the row lock, so
        # the count can't pass MAX_STRIKES and only one of them bans.
        locked = User.objects.select_for_update().get(pk=user.pk)
        if locked.banned_at is not None:
            user.refresh_from_db(fields=["strike_count", "banned_at", "ban_reason", "canonical_email"])
            return user.strike_count, True
        locked.strike_count += 1
        locked.save(update_fields=["strike_count"])
        log_event(locked, kind, "severe", "strike", ip_hash)
        banned_now = locked.strike_count >= MAX_STRIKES
        if banned_now:
            reason = BAN_REASON_PHOTO if kind == "photo" else BAN_REASON_NAME
            ban_user(locked, reason, kind=kind, ip_hash=ip_hash)
    user.refresh_from_db(fields=["strike_count", "banned_at", "ban_reason", "canonical_email"])
    return user.strike_count, banned_now


def ban_user(user, reason, kind="name_change", ip_hash=""):
    """Ban now: set the switch, end every session, hide from the leaderboard, log it."""
    from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken

    with transaction.atomic():
        user.banned_at = timezone.now()
        user.ban_reason = reason
        user.canonical_email = canonical_email(user.email)
        user.save(update_fields=["banned_at", "ban_reason", "canonical_email"])
        # Access tokens die at the auth class; refresh tokens are blacklisted so no new ones are minted.
        for token in OutstandingToken.objects.filter(user=user):
            BlacklistedToken.objects.get_or_create(token=token)
        log_event(user, kind, "none", "ban", ip_hash)
    leaderboard.remove(user)


def unban_user(user):
    """Lift a ban and reset strikes; the account's points and data were never touched."""
    kind = "photo" if user.ban_reason == "photo" else "name_change"
    with transaction.atomic():
        user.banned_at = None
        user.ban_reason = ""
        user.canonical_email = ""
        user.strike_count = 0
        user.save(update_fields=["banned_at", "ban_reason", "canonical_email", "strike_count"])
        log_event(user, kind, "none", "unban")
    leaderboard.record_score(user)


def _lock_key(ip_hash):
    return f"signup-lock:{ip_hash}"


def signup_ip_locked(ip_hash):
    return bool(cache.get(_lock_key(ip_hash)))


def note_blocked_signup(ip_hash):
    """Count a severe signup name from this IP; True once it locks sign-ups for 24 h."""
    key = f"signup-severe:{ip_hash}"
    cache.add(key, 0, SIGNUP_IP_LOCK_SECONDS)
    try:
        count = cache.incr(key)
    except ValueError:  # expired between add and incr
        cache.set(key, 1, SIGNUP_IP_LOCK_SECONDS)
        count = 1
    if count >= SIGNUP_IP_LIMIT:
        cache.set(_lock_key(ip_hash), 1, SIGNUP_IP_LOCK_SECONDS)
        log_event(None, "name_signup", "severe", "signup_ip_locked", ip_hash)
        return True
    return False
