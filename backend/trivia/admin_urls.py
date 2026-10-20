"""URLs for the admin-panel API — mounted at /api/admin/ (IsAdminUser-gated)."""
from django.urls import path

from trivia import admin_api, feedback_api
from users import admin_users_api

urlpatterns = [
    path("users/", admin_users_api.admin_users_list, name="admin-users"),
    path("users/overview/", admin_users_api.admin_users_overview, name="admin-users-overview"),
    path("users/<str:public_id>/", admin_users_api.admin_user_detail, name="admin-user-detail"),
    path("users/<str:public_id>/ban/", admin_users_api.admin_user_ban, name="admin-user-ban"),
    path("games/", admin_api.admin_games, name="admin-games"),
    path("source-rows/", admin_api.admin_source_rows, name="admin-source-rows"),
    path("feedback/", feedback_api.admin_feedback_list, name="admin-feedback"),
    path("feedback/stats/", feedback_api.admin_feedback_stats, name="admin-feedback-stats"),
    path("feedback/<int:pk>/", feedback_api.admin_feedback_update, name="admin-feedback-update"),
]
