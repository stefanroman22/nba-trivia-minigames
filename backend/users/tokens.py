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

from rest_framework_simplejwt.exceptions import InvalidToken
from rest_framework_simplejwt.serializers import TokenRefreshSerializer
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenRefreshView

from backend.throttles import RefreshRateThrottle

MAX_SESSION_AGE = timedelta(days=90)
AUTH_TIME_CLAIM = "auth_time"


def issue_session_tokens(user):
    """A fresh refresh/access pair stamped with the session's start time."""
    refresh = RefreshToken.for_user(user)
    refresh[AUTH_TIME_CLAIM] = int(time.time())
    return refresh


class SessionRefreshSerializer(TokenRefreshSerializer):
    def validate(self, attrs):
        refresh = self.token_class(attrs["refresh"])
        auth_time = refresh.payload.get(AUTH_TIME_CLAIM)
        # Tokens minted before this feature carry no claim; their own (shorter)
        # expiry still bounds them.
        if auth_time is not None and time.time() - auth_time > MAX_SESSION_AGE.total_seconds():
            raise InvalidToken("Session expired. Please log in again.")
        return super().validate(attrs)


class SessionRefreshView(TokenRefreshView):
    serializer_class = SessionRefreshSerializer
    # Each refresh rotates the token and writes a blacklist row, so this bounds
    # both credential-stuffing against the refresh endpoint and table churn.
    throttle_classes = [RefreshRateThrottle]
