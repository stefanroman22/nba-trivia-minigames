"""Session lifetime control.

Refresh tokens rotate on every use (each refresh issues a new token and
blacklists the old one), which would let an active player stay signed in
forever. To bound that, every login stamps the ORIGINAL sign-in time into the
token as `auth_time`; rotation carries the claim forward untouched. Refreshing
is refused once the session is older than MAX_SESSION_AGE — after 3 months the
player has to sign in again, no matter how active they've been.
"""
import time
from datetime import timedelta

from django.contrib.auth import get_user_model

from rest_framework_simplejwt.exceptions import InvalidToken
from rest_framework_simplejwt.serializers import TokenRefreshSerializer
from rest_framework_simplejwt.settings import api_settings
from rest_framework_simplejwt.state import token_backend
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenRefreshView

from backend.throttles import RefreshRateThrottle

MAX_SESSION_AGE = timedelta(days=90)
AUTH_TIME_CLAIM = "auth_time"


def revoke_sessions(user):
    """Blacklist every outstanding refresh token so existing sessions can't be refreshed."""
    from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken

    for outstanding in OutstandingToken.objects.filter(user=user):
        BlacklistedToken.objects.get_or_create(token=outstanding)


def issue_session_tokens(user):
    """A fresh refresh/access pair stamped with the session's start time."""
    refresh = RefreshToken.for_user(user)
    refresh[AUTH_TIME_CLAIM] = int(time.time())
    return refresh


def _banned_owner(raw):
    """The banned account a refresh token belongs to, else None.

    Decodes signature + expiry only (not the blacklist): a ban blacklists every outstanding token,
    so the stock path would answer 401 "blacklisted" and the client would never learn it is banned.
    """
    try:
        payload = token_backend.decode(str(raw), verify=True)
    except Exception:
        return None
    user_id = payload.get(api_settings.USER_ID_CLAIM)
    if user_id is None:
        return None
    return (
        get_user_model()
        .objects.filter(**{api_settings.USER_ID_FIELD: user_id}, banned_at__isnull=False)
        .first()
    )


class SessionRefreshSerializer(TokenRefreshSerializer):
    def validate(self, attrs):
        banned = _banned_owner(attrs.get("refresh"))
        if banned is not None:
            from users.strikes import AccountBanned  # lazy: strikes -> leaderboard -> models

            raise AccountBanned(banned)
        refresh = self.token_class(attrs["refresh"])
        auth_time = refresh.payload.get(AUTH_TIME_CLAIM)
        # Tokens minted before this feature carry no claim; their own (shorter)
        # expiry still bounds them.
        if auth_time is not None and time.time() - auth_time > MAX_SESSION_AGE.total_seconds():
            raise InvalidToken("Session expired. Please log in again.")
        data = super().validate(attrs)

        # A return visit with an expired access token used to cost three round trips
        # (/me/ 401 -> refresh -> /me/). Handing the /me/ payload back with the new
        # tokens lets app/providers.tsx resume the session in one.
        from users.views import user_payload  # lazy: users.views imports this module

        user_id = refresh.payload.get(api_settings.USER_ID_CLAIM)
        user = get_user_model().objects.filter(**{api_settings.USER_ID_FIELD: user_id}).first()
        if user is not None:
            data["user"] = user_payload(self.context.get("request"), user)
        return data


class SessionRefreshView(TokenRefreshView):
    serializer_class = SessionRefreshSerializer
    # Each refresh rotates the token and writes a blacklist row, so this bounds
    # both credential-stuffing against the refresh endpoint and table churn.
    throttle_classes = [RefreshRateThrottle]
