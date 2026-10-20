"""Time on the site and country, per signed-in player per day — the admin Users tab's usage data.

The browser (src/hooks/useActivityTracker.ts) counts the seconds the tab is visible and the player
has interacted in the last few minutes, and reports them in batches here. Each report is clamped,
and a day can never exceed 24 hours, so a forged or replayed report can only inflate one player's
own admin statistics, never points or anything another player sees.

The country is the ISO 3166-1 alpha-2 code our host derives from the connection (Vercel sets
x-vercel-ip-country on every request); the IP address itself is never read or stored here.
Disclosed in the Privacy Policy (src/app/privacy/page.tsx); kept users.retention.ACTIVITY_DAYS.
"""
import re

from django.db.models import F
from django.db.models.functions import Least
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from backend.throttles import ActivityRateThrottle
from trivia.wordle_daily import cet_today
from users.models import DailyActivity

# The client flushes every few minutes and when the tab is hidden; one report never covers more.
MAX_REPORT_SECONDS = 15 * 60
MAX_DAY_SECONDS = 24 * 3600

# Geo headers set by the hosts we run behind. Vercel's is the one production uses.
COUNTRY_HEADERS = ("HTTP_X_VERCEL_IP_COUNTRY", "HTTP_CF_IPCOUNTRY")
_COUNTRY_RE = re.compile(r"^[A-Z]{2}$")
# "XX" (unknown) and "T1" (Tor) are placeholders, not countries.
_NOT_COUNTRIES = {"XX", "T1"}


def country_from_request(request):
    """The caller's 2-letter country code from the host's geo header, or "" when unknown."""
    for header in COUNTRY_HEADERS:
        code = str(request.META.get(header, "")).strip().upper()
        if _COUNTRY_RE.match(code) and code not in _NOT_COUNTRIES:
            return code
    return ""


def record_activity(user, seconds, country=""):
    """Add `seconds` (clamped) to the player's row for today; keep the latest known country."""
    seconds = max(0, min(int(seconds), MAX_REPORT_SECONDS))
    now = timezone.now()
    day = cet_today()
    row, created = DailyActivity.objects.get_or_create(
        user=user,
        day=day,
        defaults={"seconds": min(seconds, MAX_DAY_SECONDS), "country": country, "last_seen_at": now},
    )
    if created:
        return
    update = {"seconds": Least(F("seconds") + seconds, MAX_DAY_SECONDS), "last_seen_at": now}
    if country:
        update["country"] = country
    DailyActivity.objects.filter(pk=row.pk).update(**update)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([ActivityRateThrottle])
def report_activity(request):
    """POST {seconds}: active seconds since the browser's last report. 204, no body."""
    body = request.data if isinstance(request.data, dict) else {}
    try:
        seconds = int(body.get("seconds", 0))
    except (TypeError, ValueError, OverflowError):
        return Response({"error": "seconds must be a whole number"}, status=400)
    record_activity(request.user, seconds, country_from_request(request))
    return Response(status=204)
