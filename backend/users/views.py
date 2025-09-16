from django.contrib.auth import authenticate, login, logout
from django.contrib.auth import get_user_model
from django.http import JsonResponse
import json
import requests
from django.views.decorators.csrf import csrf_exempt
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests
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

    # Password correct, login user
    login(request, authenticated_user)
    profile_photo_url = authenticated_user.profile_photo.url if authenticated_user.profile_photo else None
    return JsonResponse({
        "user": {
            "username": authenticated_user.username,
            "email": authenticated_user.email,
            "rank": authenticated_user.rank,
            "points": authenticated_user.points,
            "profile_photo": request.build_absolute_uri(profile_photo_url) if profile_photo_url else None
        }
    })

@csrf_exempt
def signup_view(request):
    if request.method == "POST":
        try:
            data = json.loads(request.body)
            username = data.get("username")
            email = data.get("email")
            password = data.get("password")

            if not username or not email or not password:
                return JsonResponse({"error": "All fields are required."}, status=400)

            # Check if username already exists
            if User.objects.filter(username=username).exists():
                return JsonResponse({"error": "Username already in use! Please try a different one!"}, status=409)

            # Check if email already exists
            if User.objects.filter(email=email).exists():
                return JsonResponse({"error": "Email already in use! Please use a different email address."}, status=409)

            # Create user
            user = User.objects.create_user(username=username, email=email, password=password)

            # Optionally log them in immediately
            login(request, user)
            profile_photo_url = (
                request.build_absolute_uri(user.profile_photo.url)
                if user.profile_photo else None
            )
            return JsonResponse({
                "user" : {
                    "username": user.username,
                    "email": user.email,
                    "rank": user.rank,
                    "points": getattr(user, "points", 0),
                    "profile_photo": profile_photo_url,
                }
                })

        except json.JSONDecodeError:
            return JsonResponse({"error": "Invalid JSON."}, status=400)
        except Exception as e:
            return JsonResponse({"error": str(e)}, status=500)

    return JsonResponse({"error": "POST required"}, status=400)

@login_required
def get_current_user(request):
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
        

@login_required
@csrf_exempt
def update_profile(request):
    user = request.user
    print("Is authenticated:", request.user.is_authenticated)
    if request.method == "POST":
        content_type = request.META.get('CONTENT_TYPE', '')

        if "application/json" in content_type:
            try:
                data = json.loads(request.body)
                username = data.get("username")
                points = data.get("points")
                updated = False

                if username and username != user.username:
                    if User.objects.filter(username=username).exists():
                        return JsonResponse({"error": "Username already in use!"}, status=409)
                    user.username = username
                    updated = True

                if points is not None:
                    user.points += points
                    user.update_rank()
                    updated = True

                if updated:
                    user.save()
                    return JsonResponse({"status": "success"})

                return JsonResponse({"status": "Nothing to update"}, status=400)

            except json.JSONDecodeError:
                return JsonResponse({"error": "Invalid JSON"}, status=400)

        elif "multipart/form-data" in content_type:
            profile_photo = request.FILES.get("profile_photo")

            if profile_photo:
                user.profile_photo = profile_photo
                user.save()
                return JsonResponse({"status": "success"})

            return JsonResponse({"error": "No file provided"}, status=400)

        return JsonResponse({"error": "Unsupported content type"}, status=400)

    return JsonResponse({"error": "Invalid request"}, status=400)


@login_required
@csrf_exempt  # Only for testing!
def logout_view(request):
    if request.method == "POST":
        logout(request)

        # Clear the sessionid cookie manually
        response = JsonResponse({'status': 'success'})
        response.delete_cookie('sessionid')
        return response

    return JsonResponse({"error": "POST required"}, status=400)

@csrf_exempt
def google_login(request):
    if request.method == "POST":
        try:
            data = json.loads(request.body)
            code = data.get("code")
            if not code:
                return JsonResponse({"error": "Missing code"}, status=400)

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
                return JsonResponse({"error": "Failed to obtain id_token"}, status=400)

            # Verify id_token
            idinfo = id_token.verify_oauth2_token(
                token_json["id_token"], google_requests.Request(), CLIENT_ID
            )

            email = idinfo.get("email")
            if not email:
                return JsonResponse({"error": "Invalid token: no email"}, status=400)

            # Check if email already exists
            try:
                user = User.objects.get(email=email)
                created = False
            except User.DoesNotExist:
                # Create new user
                base_username = email.split("@")[0]
                username = base_username

                # If username already exists, fallback to email
                if User.objects.filter(username=username).exists():
                    username = email

                user = User.objects.create_user(
                    username=username,
                    email=email,
                    password=None  # password not needed for Google users
                )
                

            # Log the user in
            login(request, user)
            print("DEBUG: Logged in user:", request.user)
            print("DEBUG: Session key:", request.session.session_key)
            profile_photo_url = (
                request.build_absolute_uri(user.profile_photo.url)
                if user.profile_photo else None
            )

            return JsonResponse({
                "user": {
                    "username": user.username,
                    "email": user.email,
                    "rank": getattr(user, "rank", None),
                    "points": getattr(user, "points", 0),
                    "profile_photo": profile_photo_url,
                }
            })

        except Exception as e:
            return JsonResponse({"error": f"Unexpected error: {str(e)}"}, status=400)

    return JsonResponse({"error": "POST required"}, status=400)

@csrf_exempt
def get_users(request):
    try:
        users = User.objects.order_by("-points")
        users_list = list(users.values("username", "points"))
        return JsonResponse({"users": users_list}, status=200)
    except Exception as e:
        return JsonResponse({"error": f"Unexpected error: {str(e)}"}, status=400)