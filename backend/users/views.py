import os
import json
import re
import requests
from django.contrib.auth import authenticate, get_user_model
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.contrib.auth.password_validation import validate_password
from django.db import IntegrityError
from django.http import JsonResponse
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework.decorators import api_view, permission_classes, parser_classes
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework import status
from rest_framework.parsers import JSONParser, MultiPartParser, FormParser

from users import leaderboard
from users.tokens import issue_session_tokens

User = get_user_model()

# Display names: 3-20 letters/digits/underscores. NOT unique — the public id
# (#K7F3QD) is what tells two players with the same name apart.
USERNAME_RE = re.compile(r"^[A-Za-z0-9_]{3,20}$")
USERNAME_RULES = "Username must be 3-20 characters using letters, numbers or underscores."

GOOGLE_CLIENT_ID = os.getenv("CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.getenv("CLIENT_SECRET")
REDIRECT_URI = "postmessage"


# ---------------------------------------------------------------------------
#  Reusable helpers
# ---------------------------------------------------------------------------
def profile_photo_url(request, user):
    """Absolute URL of the user's profile photo, or None."""
    return request.build_absolute_uri(user.profile_photo.url) if user.profile_photo else None


def user_payload(request, user):
    """The user object shape the frontend expects."""
    return {
        "id": user.public_id,
        "username": user.username,
        "email": user.email,
        "rank": user.rank,
        "points": user.points,
        "profile_photo": profile_photo_url(request, user),
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


# ---------------------------------------------------------------------------
#  Auth views
# ---------------------------------------------------------------------------
@api_view(["POST"])
@permission_classes([AllowAny])
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

    return auth_response(request, authenticated_user)


@api_view(["POST"])
@permission_classes([AllowAny])
def signup_view(request):
    try:
        username = str(request.data.get("username") or "").strip()
        email = str(request.data.get("email") or "").strip().lower()
        password = request.data.get("password")

        if not username or not email or not password:
            return Response({"error": "All fields are required."}, status=status.HTTP_400_BAD_REQUEST)

        if not USERNAME_RE.match(username):
            return Response({"error": USERNAME_RULES}, status=status.HTTP_400_BAD_REQUEST)

        try:
            validate_email(email)
        except ValidationError:
            return Response({"error": "That email address doesn't look valid."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            validate_password(password)
        except ValidationError as e:
            return Response({"error": " ".join(e.messages)}, status=status.HTTP_400_BAD_REQUEST)

        # Usernames may repeat (players are distinguished by public id) — only
        # the email has to be unique.
        if User.objects.filter(email__iexact=email).exists():
            return Response({"error": "Email already in use! Please use a different email address."}, status=status.HTTP_409_CONFLICT)

        try:
            user = User.objects.create_user(username=username, email=email, password=password)
        except IntegrityError:
            # Race with a concurrent signup on the same email.
            return Response({"error": "Email already in use! Please use a different email address."}, status=status.HTTP_409_CONFLICT)

        leaderboard.record_score(user)
        return auth_response(request, user, status_code=status.HTTP_201_CREATED)

    except Exception as e:
        return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def get_current_user(request):
    try:
        return Response({"user": user_payload(request, request.user)})
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=400)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@parser_classes([JSONParser, MultiPartParser, FormParser])
def update_profile(request):
    """Update username/points (JSON) or the profile photo (multipart/form-data)."""
    user = request.user

    if request.content_type.startswith("application/json"):
        username = request.data.get("username")
        points = request.data.get("points")
        updated = False

        if username and username != user.username:
            # Names may repeat — the public id keeps players distinct — so the
            # only gate is the format rule.
            if not USERNAME_RE.match(username):
                return Response({"error": USERNAME_RULES}, status=status.HTTP_400_BAD_REQUEST)
            user.username = username
            updated = True

        if points is not None:
            user.points += points
            user.update_rank()
            updated = True

        if updated:
            user.save()
            leaderboard.record_score(user)
            return Response({"status": "success"}, status=status.HTTP_200_OK)
        return Response({"error": "Nothing to update"}, status=status.HTTP_400_BAD_REQUEST)

    if request.content_type.startswith("multipart/form-data"):
        profile_photo = request.FILES.get("profile_photo")
        if profile_photo:
            user.profile_photo = profile_photo
            user.save()
            return Response({"status": "success"}, status=status.HTTP_200_OK)
        return Response({"error": "No file provided"}, status=status.HTTP_400_BAD_REQUEST)

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
def google_login(request):
    try:
        code = json.loads(request.body).get("code")
        if not code:
            return Response({"error": "Missing code"}, status=status.HTTP_400_BAD_REQUEST)

        token_json = requests.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": code,
                "client_id": GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "redirect_uri": REDIRECT_URI,
                "grant_type": "authorization_code",
            },
        ).json()

        if "id_token" not in token_json:
            return Response({"error": "Failed to obtain id_token"}, status=status.HTTP_400_BAD_REQUEST)

        idinfo = id_token.verify_oauth2_token(token_json["id_token"], google_requests.Request(), GOOGLE_CLIENT_ID)
        email = idinfo.get("email")
        if not email:
            return Response({"error": "Invalid token: no email"}, status=status.HTTP_400_BAD_REQUEST)

        new_account = False
        try:
            user = User.objects.get(email__iexact=email)
        except User.DoesNotExist:
            new_account = True
            # Names may repeat (public id disambiguates) — use the address's
            # local part directly, trimmed to the allowed charset/length.
            base = re.sub(r"[^A-Za-z0-9_]", "", email.split("@")[0])[:20] or "Player"
            if len(base) < 3:
                base = f"{base}NBA"[:20]
            user = User.objects.create_user(
                username=base,
                email=email.lower(),
                password=None,
            )
            leaderboard.record_score(user)

        return auth_response(request, user, new_account=new_account)

    except Exception as e:
        return Response({"error": f"Unexpected error: {str(e)}"}, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET'])
def get_users(request):
    try:
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
    except Exception as e:
        return JsonResponse({"error": f"Unexpected error: {str(e)}"}, status=400)
