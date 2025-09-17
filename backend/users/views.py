from django.contrib.auth import authenticate, login
from django.contrib.auth import get_user_model
from django.http import JsonResponse
import json
import requests
from django.views.decorators.csrf import csrf_exempt
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests
from rest_framework_simplejwt.tokens import RefreshToken
from django.views.decorators.csrf import csrf_exempt
from django.http import JsonResponse
from django.contrib.auth import authenticate
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.permissions import AllowAny
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework import status
from rest_framework_simplejwt.tokens import RefreshToken

User = get_user_model()
CLIENT_ID = "504454176332-ut7po2glf32fv3dajltgnb5aho65er7i.apps.googleusercontent.com"
CLIENT_SECRET = "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"
REDIRECT_URI = "postmessage"  # special value for SPA

@csrf_exempt
def login_view(request):
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=400)

    data = json.loads(request.body)
    user_id = data.get("id")
    password = data.get("password")

    # Try fetching user by username or email
    try:
        user = User.objects.get(username=user_id)
    except User.DoesNotExist:
        try:
            user = User.objects.get(email=user_id)
        except User.DoesNotExist:
            return JsonResponse({"error": "Invalid username/email"}, status=401)

    # Now authenticate
    authenticated_user = authenticate(request, username=user.username, password=password)
    if authenticated_user is None:
        # User exists but password incorrect
        return JsonResponse({"error": "Incorrect password"}, status=401)

    # Instead of login() and sessionid cookie, create JWT tokens
    refresh = RefreshToken.for_user(authenticated_user)
    access_token = str(refresh.access_token) #used str() because refresh.access_token is actually an object
    refresh_token = str(refresh)

    print(access_token)
    print(refresh_token)
    
    #Get the profile_photo
    profile_photo_url = (
        request.build_absolute_uri(authenticated_user.profile_photo.url)
        if authenticated_user.profile_photo else None
    )
    return JsonResponse({
        "access": access_token,
        "refresh": refresh_token,
        "user": {
            "username": authenticated_user.username,
            "email": authenticated_user.email,
            "rank": authenticated_user.rank,
            "points": authenticated_user.points,
            "profile_photo": profile_photo_url,
        }
    })

from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework import status

@api_view(["POST"])
@permission_classes([AllowAny])
def signup_view(request):
    try:
        data = request.data  # DRF automatically parses JSON body
        username = data.get("username")
        email = data.get("email")
        password = data.get("password")

        # Validate required fields
        if not username or not email or not password:
            return Response({"error": "All fields are required."}, status=status.HTTP_400_BAD_REQUEST)

        # Check if username already exists
        if User.objects.filter(username=username).exists():
            return Response(
                {"error": "Username already in use! Please try a different one!"},
                status=status.HTTP_409_CONFLICT
            )

        # Check if email already exists
        if User.objects.filter(email=email).exists():
            return Response(
                {"error": "Email already in use! Please use a different email address."},
                status=status.HTTP_409_CONFLICT
            )

        # Create the user
        user = User.objects.create_user(username=username, email=email, password=password)

        # Generate JWT tokens
        refresh = RefreshToken.for_user(user)
        access_token = str(refresh.access_token)
        refresh_token = str(refresh)

        profile_photo_url = (
            request.build_absolute_uri(user.profile_photo.url)
            if user.profile_photo else None
        )

        return Response({
            "access": access_token,
            "refresh": refresh_token,
            "user": {
                "username": user.username,
                "email": user.email,
                "rank": user.rank,
                "points": getattr(user, "points", 0),
                "profile_photo": profile_photo_url,
            }
        }, status=status.HTTP_201_CREATED)

    except Exception as e:
        return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def get_current_user(request): # before the above code is exectuted the request will go in the middleware where sessionID is checked
    # is sessionID is found and active => attached to request user associated with that sessionID
    try: 
        user = request.user
        profile_photo_url = user.profile_photo.url if user.profile_photo else None
        return JsonResponse({
        "user": {
            "username": user.username,
            "email": user.email,
            "rank": user.rank,
            "points": user.points,
            "profile_photo": request.build_absolute_uri(profile_photo_url) if profile_photo_url else None
        }
    })
    except Exception as e:
            return JsonResponse({"error": str(e)}, status=400)
        

from rest_framework.decorators import api_view, permission_classes, parser_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.parsers import JSONParser, MultiPartParser, FormParser
from rest_framework.response import Response
from rest_framework import status

@api_view(["POST"])
@permission_classes([IsAuthenticated])  # Require valid JWT
@parser_classes([JSONParser, MultiPartParser, FormParser])
def update_profile(request):
    """
    Update user profile:
    - Change username or points (JSON)
    - Update profile photo (multipart/form-data)
    """
    user = request.user
    print("Is authenticated:", request.user.is_authenticated)

    # Handle JSON payload
    if request.content_type.startswith("application/json"):
        username = request.data.get("username")
        points = request.data.get("points")
        updated = False

        # Update username
        if username and username != user.username:
            if User.objects.filter(username=username).exists():
                return Response({"error": "Username already in use!"}, status=status.HTTP_409_CONFLICT)
            user.username = username
            updated = True

        # Update points
        if points is not None:
            user.points += points
            user.update_rank()
            updated = True

        if updated:
            user.save()
            return Response({"status": "success"}, status=status.HTTP_200_OK)

        return Response({"error": "Nothing to update"}, status=status.HTTP_400_BAD_REQUEST)

    # Handle profile photo upload
    elif request.content_type.startswith("multipart/form-data"):
        profile_photo = request.FILES.get("profile_photo")

        if profile_photo:
            user.profile_photo = profile_photo
            user.save()
            return Response({"status": "success"}, status=status.HTTP_200_OK)

        return Response({"error": "No file provided"}, status=status.HTTP_400_BAD_REQUEST)

    return Response({"error": "Unsupported content type"}, status=status.HTTP_400_BAD_REQUEST)



@api_view(["POST"])
@permission_classes([AllowAny])  # Allow any user to hit logout
def logout_view(request):
    """
    Logout by blacklisting the refresh token.
    """
    refresh_token = request.data.get("refresh")

    if not refresh_token:
        return Response({"error": "Refresh token required"}, status=status.HTTP_400_BAD_REQUEST)

    try:
        token = RefreshToken(refresh_token)
        token.blacklist()
        return Response({"status": "success"}, status=status.HTTP_200_OK)
    except Exception as e:
        print("Logout error:", str(e))  # debug log
        return Response({"error": "Invalid or expired refresh token"}, status=status.HTTP_400_BAD_REQUEST)

@api_view(["POST"])
@permission_classes([AllowAny])
def google_login(request):
    try:
        data = json.loads(request.body)
        code = data.get("code")
        if not code:
            return Response({"error": "Missing code"}, status=status.HTTP_400_BAD_REQUEST)

        # Exchange code for tokens
        token_url = "https://oauth2.googleapis.com/token"
        token_data = {
            "code": code,
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "redirect_uri": REDIRECT_URI,
            "grant_type": "authorization_code",
        }

        token_r = requests.post(token_url, data=token_data)
        token_json = token_r.json()
        print("Google token exchange result:", token_json)

        if "id_token" not in token_json:
            return Response({"error": "Failed to obtain id_token"}, status=status.HTTP_400_BAD_REQUEST)

        # Verify id_token
        idinfo = id_token.verify_oauth2_token(
            token_json["id_token"], google_requests.Request(), CLIENT_ID
        )

        email = idinfo.get("email")
        if not email:
            return Response({"error": "Invalid token: no email"}, status=status.HTTP_400_BAD_REQUEST)

        # Check if user exists
        try:
            user = User.objects.get(email=email)
        except User.DoesNotExist:
            # Create new user
            base_username = email.split("@")[0]
            username = base_username
            if User.objects.filter(username=username).exists():
                username = email

            user = User.objects.create_user(
                username=username,
                email=email,
                password=None  # No password needed for Google users
            )

        # Instead of session login, issue JWT tokens
        refresh = RefreshToken.for_user(user)
        access_token = str(refresh.access_token)
        refresh_token = str(refresh)

        profile_photo_url = (
            request.build_absolute_uri(user.profile_photo.url)
            if user.profile_photo else None
        )

        return Response({
            "access": access_token,
            "refresh": refresh_token,
            "user": {
                "username": user.username,
                "email": user.email,
                "rank": getattr(user, "rank", None),
                "points": getattr(user, "points", 0),
                "profile_photo": profile_photo_url,
            }
        }, status=status.HTTP_200_OK)

    except Exception as e:
        return Response({"error": f"Unexpected error: {str(e)}"}, status=status.HTTP_400_BAD_REQUEST)

@csrf_exempt
def get_users(request):
    try:
        users = User.objects.order_by("-points")
        users_list = list(users.values("username", "points"))
        return JsonResponse({"users": users_list}, status=200)
    except Exception as e:
        return JsonResponse({"error": f"Unexpected error: {str(e)}"}, status=400)