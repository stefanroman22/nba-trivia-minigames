import os
import json
import random
import requests
from django.contrib.auth import authenticate, get_user_model
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

User = get_user_model()

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
        "username": user.username,
        "email": user.email,
        "rank": user.rank,
        "points": user.points,
        "profile_photo": profile_photo_url(request, user),
    }


def auth_response(request, user, status_code=status.HTTP_200_OK, **extra):
    """A fresh JWT access/refresh pair plus the user payload (and any extra fields)."""
    refresh = RefreshToken.for_user(user)
    return Response(
        {
            "access": str(refresh.access_token),
            "refresh": str(refresh),
            "user": user_payload(request, user),
            **extra,
        },
        status=status_code,
    )


def unique_username(base):
    """Build a username from `base` that isn't already taken, widening the random range as needed."""
    ranges = [(10, 99), (100, 999), (1000, 9999)]
    attempt = 0
    while True:
        low, high = ranges[min(attempt // 8, len(ranges) - 1)]
        candidate = f"{base}{random.randint(low, high)}"
        if not User.objects.filter(username=candidate).exists():
            return candidate
        attempt += 1


# ---------------------------------------------------------------------------
#  Auth views
# ---------------------------------------------------------------------------
@api_view(["POST"])
@permission_classes([AllowAny])
def login_view(request):
    user_id = request.data.get("id")
    password = request.data.get("password")

    # Allow logging in with either username or email.
    try:
        user = User.objects.get(username=user_id)
    except User.DoesNotExist:
        try:
            user = User.objects.get(email=user_id)
        except User.DoesNotExist:
            return JsonResponse({"error": "Invalid username/email"}, status=401)

    authenticated_user = authenticate(request, username=user.username, password=password)
    if authenticated_user is None:
        return JsonResponse({"error": "Incorrect password"}, status=401)

    return auth_response(request, authenticated_user)


@api_view(["POST"])
@permission_classes([AllowAny])
def signup_view(request):
    try:
        username = request.data.get("username")
        email = request.data.get("email")
        password = request.data.get("password")

        if not username or not email or not password:
            return Response({"error": "All fields are required."}, status=status.HTTP_400_BAD_REQUEST)

        if User.objects.filter(username=username).exists():
            return Response({"error": "Username already in use! Please try a different one!"}, status=status.HTTP_409_CONFLICT)

        if User.objects.filter(email=email).exists():
            return Response({"error": "Email already in use! Please use a different email address."}, status=status.HTTP_409_CONFLICT)

        user = User.objects.create_user(username=username, email=email, password=password)
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
        old_username = user.username
        username_changed = False

        if username and username != user.username:
            if User.objects.filter(username=username).exists():
                return Response({"error": "Username already in use!"}, status=status.HTTP_409_CONFLICT)
            user.username = username
            username_changed = True
            updated = True

        if points is not None:
            user.points += points
            user.update_rank()
            updated = True

        if updated:
            user.save()
            if username_changed:
                leaderboard.rename(old_username, user)
            else:
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
            user = User.objects.get(email=email)
        except User.DoesNotExist:
            new_account = True
            user = User.objects.create_user(
                username=unique_username(email.split("@")[0]),
                email=email,
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
