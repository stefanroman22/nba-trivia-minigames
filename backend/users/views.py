import logging
import re
import secrets
from django.core import signing
from django.contrib.auth import authenticate, get_user_model
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.contrib.auth.password_validation import validate_password
from django.db import IntegrityError
from django.http import JsonResponse
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework.decorators import api_view, permission_classes, parser_classes, throttle_classes
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework import status
from rest_framework.parsers import JSONParser, MultiPartParser, FormParser
from backend.throttles import AccountDataRateThrottle, LoginRateThrottle, NameCheckRateThrottle, SignupRateThrottle

from users import leaderboard, photo_moderation, strikes
from users.account_data import delete_account, export_account
from users.consent import CONSENT_REQUIRED_MESSAGE, check_consent, stamp_consent
from users.google_auth import GoogleAuthError, verify_google_code
from users.moderation_text import MESSAGE_SIGNUP_SEVERE, MESSAGE_STRIKE, check_username, message_for
from users.photos import InvalidPhoto, MAX_PHOTO_UPLOAD_BYTES, normalize_profile_photo, profile_photo_data_url
from users.tokens import issue_session_tokens, revoke_sessions

User = get_user_model()

# Display names: 3-20 letters/digits/underscores. NOT unique — the public id
# (#K7F3QD) is what tells two players with the same name apart.
USERNAME_RE = re.compile(r"^[A-Za-z0-9_]{3,20}$")
USERNAME_RULES = "Username must be 3-20 characters using letters, numbers or underscores."
EMAIL_IN_USE = "Email already in use! Please use a different email address."

logger = logging.getLogger(__name__)


class GoogleAccountConflict(Exception):
    """The email matches an account already linked to a different Google account."""


class GoogleConsentRequired(Exception):
    """A brand-new Google account needs the Terms/age consent before it can be created."""


GOOGLE_CONSENT_SALT = "google-consent"
GOOGLE_CONSENT_MAX_AGE = 600  # seconds the player has to tick the boxes after Google verified them


class GoogleSignupBlocked(Exception):
    """The email belongs to a banned account, so it can't open a new one."""


# ---------------------------------------------------------------------------
#  Reusable helpers
# ---------------------------------------------------------------------------
def profile_photo_url(request, user):
    """Inline data URL of the user's normalized profile photo, or None (see users.photos)."""
    return profile_photo_data_url(user.profile_photo_data)


def user_payload(request, user):
    """The user object shape the frontend expects."""
    return {
        "id": user.public_id,
        "username": user.username,
        "email": user.email,
        "rank": user.rank,
        "points": user.points,
        "profile_photo": profile_photo_url(request, user),
        # UI hint only — every admin endpoint re-checks is_staff server-side.
        "is_admin": bool(user.is_staff),
    }


def auth_response(request, user, status_code=status.HTTP_200_OK, **extra):
    """A fresh JWT access/refresh pair plus the user payload (and any extra fields).

    The refresh token is stamped with the session's start time so rotation can't
    extend a session past MAX_SESSION_AGE (see users.tokens).
    """
    refresh = issue_session_tokens(user)
    return Response(
        {
            "access": str(refresh.access_token),
            "refresh": str(refresh),
            "user": user_payload(request, user),
            **extra,
        },
        status=status_code,
    )


def _user_for_google_identity(identity, consent_ok=False):
    """Find or create the account for a VERIFIED Google identity -> (user, new_account).

    Linked by Google's stable `sub` first, then by the verified email. Signup does not
    verify email ownership, so a password account that merely carries this address may
    belong to someone else (an attacker can pre-register a victim's email and wait for
    them to use Google). The first Google sign-in therefore takes the account over: the
    password is disabled and old sessions are revoked. The owner keeps access via Google.
    """
    sub, email = identity["sub"], identity["email"]

    user = User.objects.filter(google_sub=sub).first()
    if user:
        return user, False

    user = User.objects.filter(email__iexact=email).first()
    if user:
        if user.google_sub and user.google_sub != sub:
            raise GoogleAccountConflict()
        if user.has_usable_password():
            user.set_unusable_password()
            revoke_sessions(user)
        user.google_sub = sub
        user.save(update_fields=["password", "google_sub"])
        return user, False

    # Not an oracle here: Google has just proven the caller owns this address.
    if strikes.email_is_banned(email):
        strikes.log_event(None, "name_signup", "none", strikes.SIGNUP_BLOCKED_CODE)
        raise GoogleSignupBlocked()

    # A new account needs the Terms/age consent first (existing accounts were consented already).
    if not consent_ok:
        raise GoogleConsentRequired()

    # Names may repeat (public id disambiguates) — use the address's
    # local part directly, trimmed to the allowed charset/length.
    base = re.sub(r"[^A-Za-z0-9_]", "", email.split("@")[0])[:20] or "Player"
    if len(base) < 3:
        base = f"{base}NBA"[:20]
    # The player didn't choose this name, so a flagged one is replaced, never struck.
    if check_username(base).tier != "ok":
        base = f"Player{secrets.randbelow(9000) + 1000}"
    try:
        user = User.objects.create_user(username=base, email=email, password=None, google_sub=sub)
    except IntegrityError:
        # A concurrent first sign-in created it between our lookup and insert.
        user = User.objects.filter(google_sub=sub).first() or User.objects.get(email__iexact=email)
        return user, False
    stamp_consent(user)
    user.save(update_fields=["terms_accepted_at", "terms_version", "age_confirmed_at"])
    leaderboard.record_score(user)
    return user, True


# ---------------------------------------------------------------------------
#  Auth views
# ---------------------------------------------------------------------------
@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([LoginRateThrottle])
def login_view(request):
    """Sign in with email, username, or username#ID.

    Usernames aren't unique, so a bare username only works while exactly one
    account carries it; otherwise the caller is asked to use their email or
    qualified name (e.g. Baller23#K7F3QD).
    """
    user_id = str(request.data.get("id") or "").strip()
    password = request.data.get("password")
    if not user_id or not password:
        return JsonResponse({"error": "Email/username and password are required."}, status=400)

    if "@" in user_id:
        matches = User.objects.filter(email__iexact=user_id)
    elif "#" in user_id:
        name, _, pid = user_id.rpartition("#")
        matches = User.objects.filter(username__iexact=name, public_id__iexact=pid)
    else:
        matches = User.objects.filter(username__iexact=user_id)

    users = list(matches[:2])
    if not users:
        return JsonResponse({"error": "No account matches that email/username."}, status=401)
    if len(users) > 1:
        return JsonResponse(
            {"error": "Several players use that name. Log in with your email, or add your ID like Name#K7F3QD."},
            status=401,
        )

    authenticated_user = authenticate(request, username=users[0].email, password=password)
    if authenticated_user is None:
        return JsonResponse({"error": "Incorrect password"}, status=401)
    # Checked after the password, so a stranger can't probe an email's ban status.
    if authenticated_user.banned_at:
        return Response(strikes.ban_payload(authenticated_user), status=status.HTTP_403_FORBIDDEN)

    return auth_response(request, authenticated_user)


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([SignupRateThrottle])
def signup_view(request):
    try:
        ip_hash = strikes.client_ip_hash(request)
        if strikes.signup_ip_locked(ip_hash):
            return Response(
                {"code": strikes.SIGNUP_LOCKED_CODE, "error": strikes.SIGNUP_LOCKED_MESSAGE},
                status=status.HTTP_403_FORBIDDEN,
            )

        username = str(request.data.get("username") or "").strip()
        email = str(request.data.get("email") or "").strip().lower()
        password = request.data.get("password")

        if not username or not email or not password:
            return Response({"error": "All fields are required."}, status=status.HTTP_400_BAD_REQUEST)

        consented, consent_code, consent_message = check_consent(request.data)
        if not consented:
            return Response({"code": consent_code, "error": consent_message}, status=status.HTTP_400_BAD_REQUEST)

        if not USERNAME_RE.match(username):
            return Response({"error": USERNAME_RULES}, status=status.HTTP_400_BAD_REQUEST)

        # No account exists yet, so a severe name can't strike one: it counts against the IP
        # instead, and the third locks sign-ups from it for 24 h (users.strikes).
        verdict = check_username(username)
        if verdict.tier == "severe":
            strikes.log_event(None, "name_signup", "severe", "blocked", ip_hash)
            strikes.note_blocked_signup(ip_hash)
            return Response({"error": MESSAGE_SIGNUP_SEVERE}, status=status.HTTP_400_BAD_REQUEST)
        if verdict.tier != "ok":
            return Response({"error": message_for(verdict)}, status=status.HTTP_400_BAD_REQUEST)

        try:
            validate_email(email)
        except ValidationError:
            return Response({"error": "That email address doesn't look valid."}, status=status.HTTP_400_BAD_REQUEST)

        # A banned account's canonical email can't sign up again. Answered exactly like a taken
        # email, so this anonymous endpoint is not an oracle for "is this address banned" (login
        # only reveals a ban after the right password); the reason lives in the event log only.
        if strikes.email_is_banned(email):
            strikes.log_event(None, "name_signup", "none", strikes.SIGNUP_BLOCKED_CODE, ip_hash)
            return Response({"error": EMAIL_IN_USE}, status=status.HTTP_409_CONFLICT)

        try:
            validate_password(password)
        except ValidationError as e:
            return Response({"error": " ".join(e.messages)}, status=status.HTTP_400_BAD_REQUEST)

        # Usernames may repeat (players are distinguished by public id) — only
        # the email has to be unique.
        if User.objects.filter(email__iexact=email).exists():
            return Response({"error": EMAIL_IN_USE}, status=status.HTTP_409_CONFLICT)

        try:
            user = User.objects.create_user(username=username, email=email, password=password)
            stamp_consent(user)
            user.save(update_fields=["terms_accepted_at", "terms_version", "age_confirmed_at"])
        except IntegrityError:
            # Race with a concurrent signup on the same email.
            return Response({"error": EMAIL_IN_USE}, status=status.HTTP_409_CONFLICT)

        leaderboard.record_score(user)
        return auth_response(request, user, status_code=status.HTTP_201_CREATED)

    except Exception:
        logger.exception("signup failed")
        return Response({"error": "Something went wrong creating your account. Please try again."},
                        status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def get_current_user(request):
    try:
        return Response({"user": user_payload(request, request.user)})
    except Exception:
        logger.exception("could not build the /me/ payload")
        return JsonResponse({"error": "Could not load your account."}, status=400)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
@throttle_classes([AccountDataRateThrottle])
def export_my_data(request):
    """Download everything we hold about the signed-in player as JSON (GDPR Art 15 / 20)."""
    response = JsonResponse(export_account(request.user), json_dumps_params={"indent": 2})
    response["Content-Disposition"] = 'attachment; filename="swish-quest-my-data.json"'
    response["Cache-Control"] = "no-store"
    return response


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([AccountDataRateThrottle])
def delete_my_account(request):
    """Permanently delete the signed-in account and its data (GDPR Art 17).

    Always needs the word DELETE typed, and for password accounts the password too (Google-only
    accounts have none). See users.account_data for what is removed and the one exception for
    banned accounts.
    """
    user = request.user
    if request.data.get("confirm") != "DELETE":
        return Response({"error": "Type DELETE to confirm."}, status=status.HTTP_400_BAD_REQUEST)
    if user.has_usable_password() and not user.check_password(str(request.data.get("password") or "")):
        return Response({"error": "That password is incorrect."}, status=status.HTTP_403_FORBIDDEN)
    outcome = delete_account(user)
    return Response({"status": outcome})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@parser_classes([JSONParser, MultiPartParser, FormParser])
def update_profile(request):
    """Update the username (JSON) or the profile photo (multipart/form-data).

    Points are deliberately NOT settable here — see the guard below.
    """
    user = request.user

    if request.content_type.startswith("application/json"):
        username = request.data.get("username")
        updated = False

        # Points are never client-supplied. They are granted only by
        # trivia.views.log_session, against a recorded GameSession and a clamped
        # score; accepting them here let any signed-in player name their own total.
        if request.data.get("points") is not None:
            return Response(
                {"error": "Points are awarded from finished games, not set directly."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if username and username != user.username:
            # Names may repeat — the public id keeps players distinct — so the
            # gates are the format rule and the moderation check.
            if not USERNAME_RE.match(username):
                return Response({"error": USERNAME_RULES}, status=status.HTTP_400_BAD_REQUEST)
            verdict = check_username(username)
            if verdict.tier == "severe":
                count, banned = strikes.record_strike(user, "name_change", strikes.client_ip_hash(request))
                if banned:
                    return Response(strikes.ban_payload(user), status=status.HTTP_403_FORBIDDEN)
                return Response(
                    {"error": MESSAGE_STRIKE.format(n=count), "strikes": count},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if verdict.tier != "ok":
                return Response({"error": message_for(verdict)}, status=status.HTTP_400_BAD_REQUEST)
            user.username = username
            updated = True

        if updated:
            user.save()
            leaderboard.record_score(user)
            return Response({"status": "success"}, status=status.HTTP_200_OK)
        return Response({"error": "Nothing to update"}, status=status.HTTP_400_BAD_REQUEST)

    if request.content_type.startswith("multipart/form-data"):
        upload = request.FILES.get("profile_photo")
        if not upload:
            return Response({"error": "No file provided"}, status=status.HTTP_400_BAD_REQUEST)
        if upload.size > MAX_PHOTO_UPLOAD_BYTES:
            return Response(
                {"error": "Image is too large. Please choose one under 4 MB."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            # Kept in a local: the user is only touched once moderation allows the photo.
            photo = normalize_profile_photo(upload.read())
        except InvalidPhoto:
            return Response(
                {"error": "We couldn't read that image. Try a JPG, PNG, WebP or GIF."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        # Fail closed (users.photo_moderation): an unchecked photo is never saved in production.
        try:
            decision = photo_moderation.moderate_photo(photo, user_pk=user.pk)
        except photo_moderation.ModerationUnavailable:
            return Response(
                {"error": photo_moderation.MESSAGE_MODERATION_UNAVAILABLE, "code": "moderation_unavailable"},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        if decision == photo_moderation.BLOCK:
            count, banned = strikes.record_strike(user, "photo", strikes.client_ip_hash(request))
            if banned:
                return Response(strikes.ban_payload(user), status=status.HTTP_403_FORBIDDEN)
            return Response(
                {
                    "error": photo_moderation.MESSAGE_PHOTO_REJECTED.format(n=count),
                    "code": "photo_rejected",
                    "strikes": count,
                },
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )
        user.profile_photo_data = photo
        # New bytes = new version: list rows carry it as ?v= on the public photo URL, so the
        # browser cache of the previous photo is left behind rather than invalidated.
        user.profile_photo_version += 1
        user.save(update_fields=["profile_photo_data", "profile_photo_version"])
        if decision == photo_moderation.REVIEW:
            # Allowed, but queued for the owner's review (tier/reason codes only, never the image).
            strikes.log_event(user, "photo", "mild", "uncertain", strikes.client_ip_hash(request))
        return Response({"status": "success", "user": user_payload(request, user)}, status=status.HTTP_200_OK)

    return Response({"error": "Unsupported content type"}, status=status.HTTP_400_BAD_REQUEST)


@api_view(["POST"])
@permission_classes([AllowAny])
def logout_view(request):
    """Logout by blacklisting the refresh token."""
    refresh_token = request.data.get("refresh")
    if not refresh_token:
        return Response({"error": "Refresh token required"}, status=status.HTTP_400_BAD_REQUEST)
    try:
        RefreshToken(refresh_token).blacklist()
        return Response({"status": "success"}, status=status.HTTP_200_OK)
    except Exception:
        return Response({"error": "Invalid or expired refresh token"}, status=status.HTTP_400_BAD_REQUEST)


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([LoginRateThrottle])
def google_login(request):
    data = request.data if isinstance(request.data, dict) else {}
    consent_token = data.get("consent_token")
    code = data.get("code")

    if consent_token:
        # Second step for a new account: Google already verified the identity (signed token).
        ok, error_code, message = check_consent(data)
        if not ok:
            return Response({"code": error_code, "error": message}, status=status.HTTP_400_BAD_REQUEST)
        try:
            identity = signing.loads(consent_token, salt=GOOGLE_CONSENT_SALT, max_age=GOOGLE_CONSENT_MAX_AGE)
        except signing.BadSignature:
            return Response({"error": "Your sign-in took too long. Please try again."}, status=status.HTTP_400_BAD_REQUEST)
        consent_ok = True
    elif code and isinstance(code, str):
        try:
            identity = verify_google_code(code)
        except GoogleAuthError as exc:
            logger.warning("google login rejected: %s", exc)
            return Response({"error": exc.public_message}, status=status.HTTP_400_BAD_REQUEST)
        consent_ok = check_consent(data)[0]
    else:
        return Response({"error": "Missing code"}, status=status.HTTP_400_BAD_REQUEST)

    try:
        user, new_account = _user_for_google_identity(identity, consent_ok)
    except GoogleConsentRequired:
        return Response(
            {
                "code": "consent_required",
                "error": CONSENT_REQUIRED_MESSAGE,
                "consent_token": signing.dumps(identity, salt=GOOGLE_CONSENT_SALT),
            },
            status=status.HTTP_428_PRECONDITION_REQUIRED,
        )
    except GoogleSignupBlocked:
        return Response(
            {"code": strikes.SIGNUP_BLOCKED_CODE, "error": strikes.SIGNUP_BLOCKED_MESSAGE},
            status=status.HTTP_403_FORBIDDEN,
        )
    except GoogleAccountConflict:
        return Response(
            {"error": "This email is already linked to a different Google account."},
            status=status.HTTP_409_CONFLICT,
        )
    except Exception:
        logger.exception("google login failed after verification")
        return Response(
            {"error": "Something went wrong signing you in. Please try again."},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    if user.banned_at:
        return Response(strikes.ban_payload(user), status=status.HTTP_403_FORBIDDEN)
    if not user.is_active:
        return Response({"error": "This account is disabled."}, status=status.HTTP_403_FORBIDDEN)
    return auth_response(request, user, new_account=new_account)


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([NameCheckRateThrottle])
def check_name(request):
    """POST {"username"} -> {"ok": true} or {"ok": false, "error": "<generic message>"}.

    Instant feedback for the signup and profile forms. Never strikes, never logs, and never names
    the matched term — the word lists stay on the server.
    """
    if not isinstance(request.data, dict):
        return Response({"ok": False, "error": USERNAME_RULES}, status=status.HTTP_400_BAD_REQUEST)
    username = str(request.data.get("username") or "").strip()
    if not USERNAME_RE.match(username):
        return Response({"ok": False, "error": USERNAME_RULES})
    verdict = check_username(username)
    if verdict.tier != "ok":
        return Response({"ok": False, "error": message_for(verdict)})
    return Response({"ok": True})


@api_view(['GET'])
def get_users(request):
    try:
        scope = request.query_params.get("scope", "global")
        if scope == "friends":
            if not request.user.is_authenticated:
                return JsonResponse({"error": "Sign in to view your friends leaderboard."}, status=401)
            board, user_rank, number_users = leaderboard.friends_board(request.user)
            return Response(
                {"top_100_users": board, "user_rank": user_rank, "number_users": number_users},
                status=200,
            )

        user_rank = (
            leaderboard.rank_of(request.user)
            if request.user.is_authenticated
            else None
        )
        return Response(
            {
                "top_100_users": leaderboard.top(100),
                "user_rank": user_rank,
                "number_users": leaderboard.total(),
            },
            status=200,
        )
    except Exception:
        logger.exception("could not build the leaderboard response")
        return JsonResponse({"error": "Could not load the leaderboard."}, status=400)
