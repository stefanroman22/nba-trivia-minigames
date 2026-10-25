"""Player search for the admin tools.

Admin-only (IsAdminUser, i.e. is_staff checked server-side). The lookup goes through the ORM, so
`q` is always a bound parameter, and rows carry only id + username (never email).
"""
import os

import requests
from django.contrib.auth import get_user_model
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response

User = get_user_model()


@api_view(["GET"])
@permission_classes([IsAdminUser])
def search_users(request):
    q = request.GET.get("q", "")
    rows = User.objects.filter(username__icontains=q).values("id", "username")
    return Response(list(rows))


def fetch_player_stats(player_id):
    # Secret from the environment (BE-14); never hardcoded.
    api_key = os.environ.get("NBA_STATS_API_KEY", "")
    return requests.get(f"https://stats.example.com/players/{player_id}", headers={"x-api-key": api_key}, timeout=10).json()
