# views.py
import json
from django.conf import settings
from django.contrib.auth import authenticate, login, logout, get_user_model
from django.http import JsonResponse
from django.views.decorators.http import require_POST
from django.views.decorators.csrf import csrf_protect
from django.utils.decorators import method_decorator
from django.core.exceptions import ValidationError
from django.utils.translation import gettext_lazy as _
from django.views.decorators.http import require_GET
from django.middleware.csrf import get_token
from django.utils import timezone

import os
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests
from PIL import Image
from io import BytesIO

User = get_user_model()

CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID")
CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET")
REDIRECT_URI = "postmessage"  # SPA one-time code exchange

GENERIC_AUTH_ERROR = {"error": "Invalid credentials"}

def json_bad_request(msg="Bad request"):
    return JsonResponse({"error": msg}, status=400)

def json_unauthorized(msg="Unauthorized"):
    return JsonResponse({"error": msg}, status=401)

def ensure_authenticated(request):
    if not request.user.is_authenticated:
        return json_unauthorized()
    return None

@require_GET
def csrf_cookie(request):
    # Generate a new CSRF token
    token = get_token(request)

    # Create a JSON response
    response = JsonResponse({"status": "ok", "csrfToken": token})

    # Explicitly set CSRF cookie
    response.set_cookie(
        "csrftoken",
        token,
        max_age=31449600,  # 1 year
        secure=True,       # Required because you're using HTTPS
        httponly=False,    # Must be False so frontend JS can read it
        samesite='None',   # Required for cross-site cookies
    )

    return response


@require_POST
@csrf_protect
def login_view(request):
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return json_bad_request("Invalid JSON")

    user_id = data.get("id")
    password = data.get("password")
    if not user_id or not password:
        return json_bad_request("Missing id/password")

    # Try username, then email; BUT always return generic errors to avoid enumeration.
    try:
        try:
            user_obj = User.objects.get(username=user_id)
        except User.DoesNotExist:
            user_obj = User.objects.get(email=user_id)
        username = user_obj.username
    except User.DoesNotExist:
        return JsonResponse(GENERIC_AUTH_ERROR, status=401)

    user = authenticate(request, username=username, password=password)
    if user is None:
        return JsonResponse(GENERIC_AUTH_ERROR, status=401)

    login(request, user)  # Django rotates the session
    profile_photo_url = user.profile_photo.url if getattr(user, "profile_photo", None) else None
    return JsonResponse({
        "user": {
            "username": user.username,
            "email": user.email,
            "rank": getattr(user, "rank", None),
            "points": getattr(user, "points", 0),
            "profile_photo": request.build_absolute_uri(profile_photo_url) if profile_photo_url else None
        }
    })

@require_POST
@csrf_protect
def signup_view(request):
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return json_bad_request("Invalid JSON")

    username = (data.get("username") or "").strip()
    email = (data.get("email") or "").strip().lower()
    password = data.get("password")

    if not username or not email or not password:
        return json_bad_request("All fields are required")

    if User.objects.filter(username=username).exists():
        return JsonResponse({"error": "Username already in use"}, status=409)
    if User.objects.filter(email=email).exists():
        return JsonResponse({"error": "Email already in use"}, status=409)

    user = User.objects.create_user(username=username, email=email, password=password)
    login(request, user)
    profile_photo_url = user.profile_photo.url if getattr(user, "profile_photo", None) else None
    return JsonResponse({
        "user": {
            "username": user.username,
            "email": user.email,
            "rank": getattr(user, "rank", None),
            "points": getattr(user, "points", 0),
            "profile_photo": request.build_absolute_uri(profile_photo_url) if profile_photo_url else None
        }
    }, status=201)

@require_GET
def get_current_user(request):
    if not request.user.is_authenticated:
        return json_unauthorized()
    user = request.user
    profile_photo_url = user.profile_photo.url if getattr(user, "profile_photo", None) else None
    return JsonResponse({
        "user": {
            "username": user.username,
            "email": user.email,
            "rank": getattr(user, "rank", None),
            "points": getattr(user, "points", 0),
            "profile_photo": request.build_absolute_uri(profile_photo_url) if profile_photo_url else None
        }
    })

@require_POST
@csrf_protect
def update_profile(request):
    if not request.user.is_authenticated:
        return json_unauthorized()
    user = request.user
    content_type = request.META.get('CONTENT_TYPE', '')

    if "application/json" in content_type:
        try:
            data = json.loads(request.body)
        except json.JSONDecodeError:
            return json_bad_request("Invalid JSON")

        username = (data.get("username") or "").strip()
        # REMOVE points update from client input
        if username and username != user.username:
            if User.objects.filter(username=username).exists():
                return JsonResponse({"error": "Username already in use"}, status=409)
            user.username = username
            user.save(update_fields=["username"])
            return JsonResponse({"status": "success"})
        return json_bad_request("Nothing to update")

    elif "multipart/form-data" in content_type:
        profile_photo = request.FILES.get("profile_photo")
        if not profile_photo:
            return json_bad_request("No file provided")

        # Validate file (size/type) and content
        max_bytes = 2 * 1024 * 1024  # 2MB
        if profile_photo.size > max_bytes:
            return json_bad_request("File too large")

        allowed_types = {"image/jpeg", "image/png", "image/webp"}
        if profile_photo.content_type not in allowed_types:
            return json_bad_request("Unsupported file type")

        # Verify image payload
        try:
            img = Image.open(profile_photo)
            img.verify()
        except Exception:
            return json_bad_request("Invalid image")

        user.profile_photo = profile_photo
        user.save(update_fields=["profile_photo"])
        return JsonResponse({"status": "success"})

    return json_bad_request("Unsupported content type")

@require_POST
@csrf_protect
def logout_view(request):
    if not request.user.is_authenticated:
        return JsonResponse({"status": "success"})  # idempotent
    logout(request)
    resp = JsonResponse({"status": "success"})
    # Session cookie removal is handled by Django; explicit delete is fine but optional
    resp.delete_cookie(settings.SESSION_COOKIE_NAME)
    return resp

@require_POST
@csrf_protect
def google_login(request):
    # Exchange one-time code for tokens (sent from SPA after Google JS SDK sign-in)
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return json_bad_request("Invalid JSON")

    code = data.get("code")
    if not code:
        return json_bad_request("Missing code")

    # Token exchange (server-side)
    import requests as pyrequests
    token_url = "https://oauth2.googleapis.com/token"
    token_data = {
        "code": code,
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "redirect_uri": REDIRECT_URI,
        "grant_type": "authorization_code",
    }
    token_r = pyrequests.post(token_url, data=token_data, timeout=10)
    token_json = token_r.json()
    idtok = token_json.get("id_token")
    if not idtok:
        return json_bad_request("Failed to obtain id_token")

    # Verify id_token claims
    req = google_requests.Request()
    idinfo = id_token.verify_oauth2_token(idtok, req, CLIENT_ID)
    if idinfo.get("aud") != CLIENT_ID:
        return json_bad_request("Invalid audience")
    if idinfo.get("iss") not in ("https://accounts.google.com", "accounts.google.com"):
        return json_bad_request("Invalid issuer")

    email = (idinfo.get("email") or "").lower()
    if not email:
        return json_bad_request("Invalid token: no email")

    try:
        user = User.objects.get(email=email)
    except User.DoesNotExist:
        # Create user; set unusable password
        base_username = email.split("@")[0]
        username = base_username
        if User.objects.filter(username=username).exists():
            username = email  # fallback
        user = User.objects.create_user(username=username, email=email)
        user.set_unusable_password()
        user.save(update_fields=["password"])

    login(request, user)
    profile_photo_url = user.profile_photo.url if getattr(user, "profile_photo", None) else None
    return JsonResponse({
        "user": {
            "username": user.username,
            "email": user.email,
            "rank": getattr(user, "rank", None),
            "points": getattr(user, "points", 0),
            "profile_photo": request.build_absolute_uri(profile_photo_url) if profile_photo_url else None
        }
    })

@require_GET
def get_users(request):
    # Consider pagination to avoid large responses
    users = User.objects.order_by("-points").values("username", "points")[:100]
    return JsonResponse({"users": list(users)}, status=200)
