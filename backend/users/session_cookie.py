"""Refresh token in a first-party HttpOnly cookie (Phase 1: the backend accepts both).

A login/signup/Google response that carries `X-SQ-Session` from an allow-listed Origin gets its refresh
token as an HttpOnly cookie instead of in the body; `POST /api/auth/refresh/` and `/api/auth/logout/`
read it back. Every other endpoint keeps Bearer auth, and the legacy body path (`/api/token/refresh/`,
`/api/logout/`) is untouched until Phase 4.

Why no Django CSRF token: DRF views are csrf_exempt and there is no SessionAuthentication. The cookie is
read by these two views only, and it is guarded by
  1. `SameSite=Strict`: no cross-site request carries it at all (other *.vercel.app sites included);
  2. the custom `X-SQ-Session` header: it forces a CORS preflight that only CORS_ALLOWED_ORIGINS passes;
  3. an exact Origin match against CORS_ALLOWED_ORIGINS, and Sec-Fetch-Site, when sent, same-site/origin.
A request failing 2-3 gets 403 `csrf_failed` and no Set-Cookie.

This module must not import `users.views` at module level (views imports it).
"""
import time

from django.conf import settings
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.state import token_backend
from rest_framework_simplejwt.tokens import RefreshToken

from users.strikes import AccountBanned
from users.tokens import AUTH_TIME_CLAIM, MAX_SESSION_AGE, SessionRefreshView, revoke_sessions

SESSION_HEADER = "X-SQ-Session"  # request.headers key; any non-empty value counts
CSRF_FAILED = {"code": "csrf_failed", "error": "This request did not come from the site."}
NO_SESSION = {"code": "no_session", "error": "Session expired. Please log in again."}
INVALID_SESSION = {"code": "invalid_session", "error": "Session expired. Please log in again."}
_SAFE_FETCH_SITES = (None, "", "same-site", "same-origin")


def cookie_max_age(raw):
    """Seconds until min(exp, auth_time + MAX_SESSION_AGE), floor 0. Signature/blacklist not checked."""
    try:
        payload = token_backend.decode(str(raw), verify=False)
    except Exception:
        return 0
    ends = [payload.get("exp")]
    auth_time = payload.get(AUTH_TIME_CLAIM)
    if auth_time is not None:
        ends.append(auth_time + MAX_SESSION_AGE.total_seconds())
    ends = [e for e in ends if isinstance(e, (int, float))]
    if not ends:
        return 0
    return max(0, int(min(ends) - time.time()))


def set_refresh_cookie(response, raw):
    """Host-only (no Domain), HttpOnly, SameSite per settings; Secure outside DEBUG."""
    response.set_cookie(
        settings.REFRESH_COOKIE_NAME,
        str(raw),
        max_age=cookie_max_age(raw),
        path="/",
        secure=settings.REFRESH_COOKIE_SECURE,
        httponly=True,
        samesite=settings.REFRESH_COOKIE_SAMESITE,
    )
    response["Cache-Control"] = "no-store"
    return response


def clear_refresh_cookie(response):
    # Django marks the deletion Secure itself for a __Host- / __Secure- name.
    response.delete_cookie(settings.REFRESH_COOKIE_NAME, path="/", samesite=settings.REFRESH_COOKIE_SAMESITE)
    response["Cache-Control"] = "no-store"
    return response


def session_origin_ok(request):
    """The request is a cookie-session call from the site: header present, Origin allow-listed exactly."""
    if not request.headers.get(SESSION_HEADER):
        return False
    if request.headers.get("Origin") not in settings.CORS_ALLOWED_ORIGINS:
        return False
    return request.headers.get("Sec-Fetch-Site") in _SAFE_FETCH_SITES


def require_session_origin(request):
    """None when the CSRF rules pass, else a 403 csrf_failed Response that sets no cookie."""
    if session_origin_ok(request):
        return None
    return Response(CSRF_FAILED, status=status.HTTP_403_FORBIDDEN)


def _body_refresh(request):
    data = request.data if isinstance(request.data, dict) else {}
    return data.get("refresh") or None


class SessionCookieRefreshView(SessionRefreshView):
    """POST /api/auth/refresh/: rotate the cookie's refresh token (or adopt a legacy body token).

    Same serializer as /api/token/refresh/ (ban check, 90-day cap, rotation + blacklist) and the same
    auth-refresh throttle; the new refresh token goes into Set-Cookie and is left out of the body.
    """

    def post(self, request, *args, **kwargs):
        denied = require_session_origin(request)
        if denied is not None:
            return denied
        token = _body_refresh(request) or request.COOKIES.get(settings.REFRESH_COOKIE_NAME)
        if not token:
            return clear_refresh_cookie(Response(NO_SESSION, status=status.HTTP_401_UNAUTHORIZED))
        serializer = self.get_serializer(data={"refresh": token})
        try:
            serializer.is_valid(raise_exception=True)
        except AccountBanned as exc:
            return clear_refresh_cookie(Response(exc.detail, status=status.HTTP_403_FORBIDDEN))
        except (TokenError, InvalidToken):
            return clear_refresh_cookie(Response(INVALID_SESSION, status=status.HTTP_401_UNAUTHORIZED))
        body = dict(serializer.validated_data)
        new_refresh = body.pop("refresh", None) or token
        return set_refresh_cookie(Response(body, status=status.HTTP_200_OK), new_refresh)


@api_view(["POST"])
@permission_classes([AllowAny])
def cookie_logout(request):
    """POST /api/auth/logout/: blacklist the cookie (else body) refresh token; always 200, cookie cleared."""
    denied = require_session_origin(request)
    if denied is not None:
        return denied
    token = request.COOKIES.get(settings.REFRESH_COOKIE_NAME) or _body_refresh(request)
    if token:
        try:
            RefreshToken(token).blacklist()
        except TokenError:
            pass  # already blacklisted, expired or garbage: the session is over either way
    return clear_refresh_cookie(Response({"status": "success"}, status=status.HTTP_200_OK))


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def logout_all(request):
    """POST /api/auth/logout-all/ (Bearer): blacklist every refresh token of the account.

    Access tokens already issued stay valid until they expire (<= 15 min). Bearer is not ambient, so no
    X-SQ-Session/Origin check is needed here.
    """
    revoke_sessions(request.user)
    return clear_refresh_cookie(Response({"status": "success"}, status=status.HTTP_200_OK))
