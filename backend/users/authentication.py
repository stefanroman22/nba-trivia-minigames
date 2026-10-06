"""The project's one API authentication class (settings.REST_FRAMEWORK, AUTH-3).

simplejwt's JWTAuthentication plus the ban gate: once simplejwt has loaded the user (the same query it
always made, no extra one), a banned account is refused with 403 and the users.strikes.ban_payload body,
`{"code": "account_banned", ...}`. 403, not 401, because the frontend answers a 401 by refreshing the
token, and a ban must end the session rather than loop on refresh.
"""
from rest_framework_simplejwt.authentication import JWTAuthentication

from users.strikes import AccountBanned


class BanAwareJWTAuthentication(JWTAuthentication):
    def get_user(self, validated_token):
        user = super().get_user(validated_token)
        if getattr(user, "banned_at", None):
            raise AccountBanned(user)
        return user
