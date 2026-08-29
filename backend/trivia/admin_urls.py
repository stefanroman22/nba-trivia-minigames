"""URLs for the admin-panel API — mounted at /api/admin/ (IsAdminUser-gated)."""
from django.urls import path

from trivia import admin_api

urlpatterns = [
    path("games/", admin_api.admin_games, name="admin-games"),
    path("source-rows/", admin_api.admin_source_rows, name="admin-source-rows"),
]
