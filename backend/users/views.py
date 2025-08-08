from django.contrib.auth import authenticate, login, logout
from django.contrib.auth import get_user_model
from django.http import JsonResponse
import json
from django.views.decorators.csrf import csrf_exempt
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse

User = get_user_model()

@csrf_exempt  # Temporary for testing
def login_view(request):
    if request.method == "POST":
        data = json.loads(request.body)
        user_id = data.get("id")
        password = data.get("password")

        user = None

        # First try username
        try:
            user = User.objects.get(username=user_id)
        except User.DoesNotExist:
            # Try email instead
            try:
                user = User.objects.get(email=user_id)
            except User.DoesNotExist:
                return JsonResponse({"error": "Invalid credentials"}, status=401)

        # Authenticate using the actual username
        user = authenticate(request, username=user.username, password=password)

        if user is not None:
            login(request, user)
            return JsonResponse({
                "message": "Login successfullll",
                "user" : {
                    "username": user.username,
                    "email": user.email,
                    "rank": user.rank,
                }

                })
        else:
            return JsonResponse({"error": "Invalid credentials"}, status=401)

    return JsonResponse({"error": "POST required"}, status=400)

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

            return JsonResponse({"success": "User registered and logged in successfully."}, status=201)

        except json.JSONDecodeError:
            return JsonResponse({"error": "Invalid JSON."}, status=400)
        except Exception as e:
            return JsonResponse({"error": str(e)}, status=500)

    return JsonResponse({"error": "POST required"}, status=400)

@login_required
def get_current_user(request):
    user = request.user
    profile_photo_url = user.profile_photo.url if user.profile_photo else None
    return JsonResponse({
        "username": user.username,
        "email": user.email,
        "rank": user.rank,
        "points": user.points,
        "profile_photo": request.build_absolute_uri(profile_photo_url) if profile_photo_url else None
    })

@csrf_exempt
@login_required
def update_profile(request):
    user = request.user

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

                return JsonResponse({"error": "Nothing to update"}, status=400)

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

@csrf_exempt  # Only for testing!
def logout_view(request):
    if request.method == "POST":
        logout(request)

        # Clear the sessionid cookie manually
        response = JsonResponse({'status': 'success'})
        response.delete_cookie('sessionid')
        return response

    return JsonResponse({"error": "POST required"}, status=400)
