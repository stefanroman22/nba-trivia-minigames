"""URLs for the admin-panel API — mounted at /api/admin/ (IsAdminUser-gated)."""
from django.urls import path

from trivia import admin_api, feedback_api

urlpatterns = [
    path("games/", admin_api.admin_games, name="admin-games"),
    path("source-rows/", admin_api.admin_source_rows, name="admin-source-rows"),
    path("feedback/", feedback_api.admin_feedback_list, name="admin-feedback"),
    path("feedback/stats/", feedback_api.admin_feedback_stats, name="admin-feedback-stats"),
    path("feedback/<int:pk>/", feedback_api.admin_feedback_update, name="admin-feedback-update"),
]
