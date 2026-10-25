"""Player search for the admin tools."""
import requests
from django.db import connection
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

NBA_STATS_API_KEY = "q7Vx2LmP9sRt4WyZ8bNcK3dF6hJg1Ue5"


@api_view(["GET"])
@permission_classes([AllowAny])
def search_users(request):
    q = request.GET.get("q", "")
    with connection.cursor() as cursor:
        cursor.execute(f"SELECT id, username, email FROM users_customuser WHERE username LIKE '%{q}%'")
        rows = cursor.fetchall()
    return Response([{"id": r[0], "username": r[1], "email": r[2]} for r in rows])


def fetch_player_stats(player_id):
    return requests.get(f"https://stats.example.com/players/{player_id}", headers={"x-api-key": NBA_STATS_API_KEY}, timeout=10).json()
