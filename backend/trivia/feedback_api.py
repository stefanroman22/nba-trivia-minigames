"""Admin-only API behind the panel's Feedback tab (/admin -> Feedback).

Three endpoints, one filter language. `_parse_filters` reads the query string
once and `_queryset` turns it into rows; the list and the stats both go through
that pair, so a chart can never disagree with the table under it - narrowing the
filters narrows both by construction.

Everything here REQUIRES is_staff (IsAdminUser). Feedback rows carry player
email addresses, so this module is the gate, not the frontend's `is_admin` hint.
"""
from datetime import datetime, timedelta, timezone as dt_timezone

from django.db.models import (
    Avg,
    Count,
    F,
    IntegerField,
    OuterRef,
    Q,
    Subquery,
    Value,
)
from django.db.models.functions import Coalesce, TruncDay, TruncMonth, TruncWeek, TruncYear
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response

from trivia.models import Feedback, GameSession

# Trunc function per granularity.
TRUNC = {"day": TruncDay, "week": TruncWeek, "month": TruncMonth, "year": TruncYear}
GRANULARITIES = ("day", "week", "month", "year")
# What "go deeper" means when a bucket is clicked in the panel.
DRILL_INTO = {"year": "month", "month": "day", "week": "day", "day": "day"}

MAX_BUCKETS = 400  # guards against ?granularity=day&period=all over years of data

# Feedback sent from a non-game screen stores game="". An empty string can't be
# a filter value (it is indistinguishable from "no filter"), so the wire uses
# this sentinel and the queryset translates it back.
NO_GAME = "__none__"


def _now():
    return datetime.now(dt_timezone.utc)


def _iso(dt):
    return dt.isoformat() if dt else None


def _parse_dt(raw, end_of_day=False):
    """Accept 'YYYY-MM-DD' or a full ISO timestamp; always return aware UTC."""
    if not raw:
        return None
    text = str(raw).strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    if len(text) == 10 and end_of_day:  # a bare date as `to` means the whole day
        dt = dt + timedelta(days=1) - timedelta(microseconds=1)
    return dt if dt.tzinfo else dt.replace(tzinfo=dt_timezone.utc)


def _auto_granularity(start, end):
    """Pick the bucket size that keeps a chart readable for the span given."""
    days = max((end - start).days, 1)
    if days <= 31:
        return "day"
    if days <= 182:
        return "week"
    if days <= 1095:
        return "month"
    return "year"


def _floor(dt, gran):
    if gran == "year":
        return dt.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
    if gran == "month":
        return dt.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    midnight = dt.replace(hour=0, minute=0, second=0, microsecond=0)
    if gran == "week":  # Django's TruncWeek starts on Monday
        return midnight - timedelta(days=midnight.weekday())
    return midnight


def _step(dt, gran):
    if gran == "year":
        return dt.replace(year=dt.year + 1)
    if gran == "month":
        return dt.replace(year=dt.year + (dt.month == 12), month=dt.month % 12 + 1)
    return dt + timedelta(days=7 if gran == "week" else 1)


def _bucket_starts(start, end, gran):
    """Every bucket in [start, end] - including the empty ones.

    Grouping in the DB only returns buckets that HAVE rows, which would draw a
    time axis that silently skips quiet months and overstates how steady the
    feedback flow has been. The axis is generated here instead, and the counts
    are merged onto it.
    """
    out, cursor = [], _floor(start, gran)
    while cursor <= end and len(out) < MAX_BUCKETS:
        out.append(cursor)
        cursor = _step(cursor, gran)
    return out


def _label(dt, gran):
    if gran == "year":
        return dt.strftime("%Y")
    if gran == "month":
        return dt.strftime("%b %Y")
    if gran == "week":
        return "w/c " + dt.strftime("%d %b %Y")
    return dt.strftime("%d %b %Y")


# ---------------------------------------------------------------------------
#  Filters
# ---------------------------------------------------------------------------
def _csv_ints(raw, valid):
    out = set()
    for part in str(raw or "").split(","):
        part = part.strip()
        if part.isdigit() and int(part) in valid:
            out.add(int(part))
    return out


def _int_or_none(raw):
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def _first_created_at():
    return Feedback.objects.order_by("created_at").values_list("created_at", flat=True).first()


def _parse_filters(request):
    """Read the whole filter language off the query string, once."""
    p = request.query_params
    now = _now()

    start = _parse_dt(p.get("from"))
    end = _parse_dt(p.get("to"), end_of_day=True)
    period = str(p.get("period") or ("custom" if start or end else "all"))

    if not (start or end):
        spans = {"7d": 7, "30d": 30, "90d": 90, "12m": 365, "24m": 730}
        if period in spans:
            start, end = now - timedelta(days=spans[period]), now
        else:  # "all" - anchored on the first row actually held
            period = "all"
            start, end = (_first_created_at() or now - timedelta(days=365)), now
    else:
        start = start or (_first_created_at() or now - timedelta(days=365))
        end = end or now

    if start > end:
        start, end = end, start

    gran = str(p.get("granularity") or "").lower()
    if gran not in GRANULARITIES:
        gran = _auto_granularity(start, end)

    return {
        "start": start,
        "end": end,
        "period": period,
        "granularity": gran,
        "ratings": _csv_ints(p.get("rating"), {1, 2, 3, 4, 5}),
        "has_message": str(p.get("has_message") or "").lower() or None,
        "audience": str(p.get("audience") or "all").lower(),
        "min_sessions": _int_or_none(p.get("min_sessions")),
        "max_sessions": _int_or_none(p.get("max_sessions")),
        "min_points": _int_or_none(p.get("min_points")),
        "game": str(p.get("game") or "").strip(),
        "statuses": {
            s.strip()
            for s in str(p.get("status") or "").split(",")
            if s.strip() in {Feedback.NEW, Feedback.READ, Feedback.RESOLVED}
        },
        "q": str(p.get("q") or "").strip(),
        "sort": str(p.get("sort") or "newest"),
    }


def _annotated():
    """Feedback rows carrying the sender's usage, so "how active is this player?"
    is filterable and sortable rather than something to look up account by
    account. Guests coalesce to 0 - they have no account to have used."""
    sessions = (
        GameSession.objects.filter(user_id=OuterRef("user_id"))
        .order_by()
        .values("user_id")
        .annotate(n=Count("id"))
        .values("n")[:1]
    )
    return Feedback.objects.annotate(
        sessions=Coalesce(Subquery(sessions, output_field=IntegerField()), Value(0)),
        user_points=Coalesce(F("user__points"), Value(0)),
    )


def _queryset(f, start=None, end=None):
    """The filtered rows. `start`/`end` override the window so the same filters
    can be re-run over the preceding period for the deltas."""
    qs = _annotated().filter(
        created_at__gte=start or f["start"], created_at__lte=end or f["end"]
    )

    if f["ratings"]:
        qs = qs.filter(rating__in=f["ratings"])
    if f["has_message"] in ("true", "1", "yes"):
        qs = qs.exclude(message="")
    elif f["has_message"] in ("false", "0", "no"):
        qs = qs.filter(message="")

    if f["audience"] == "registered":
        qs = qs.filter(user__isnull=False)
    elif f["audience"] == "guest":
        qs = qs.filter(user__isnull=True)

    if f["min_sessions"] is not None:
        qs = qs.filter(sessions__gte=f["min_sessions"])
    if f["max_sessions"] is not None:
        qs = qs.filter(sessions__lte=f["max_sessions"])
    if f["min_points"] is not None:
        qs = qs.filter(user_points__gte=f["min_points"])

    if f["game"]:
        qs = qs.filter(game="" if f["game"] == NO_GAME else f["game"])
    if f["statuses"]:
        qs = qs.filter(status__in=f["statuses"])

    if f["q"]:
        needle = f["q"]
        qs = qs.filter(
            Q(message__icontains=needle)
            | Q(email__icontains=needle)
            | Q(display_name__icontains=needle)
            | Q(public_id__icontains=needle)
        )
    return qs


SORTS = {
    "newest": ("-created_at", "-id"),
    "oldest": ("created_at", "id"),
    "rating_high": ("-rating", "-created_at"),
    "rating_low": ("rating", "-created_at"),
    "usage_high": ("-sessions", "-created_at"),
}


# ---------------------------------------------------------------------------
#  Serialisation
# ---------------------------------------------------------------------------
def _row(entry):
    """One feedback row, with the sender resolved to something contactable."""
    account = None
    if entry.user_id:
        account = {
            "id": entry.user_id,
            "public_id": entry.user.public_id,
            "username": entry.user.username,
            "email": entry.user.email,
            "points": entry.user.points,
            "rank": entry.user.rank,
        }
    return {
        "id": entry.id,
        "rating": entry.rating,
        "message": entry.message,
        "created_at": _iso(entry.created_at),
        "status": entry.status,
        "admin_note": entry.admin_note,
        "page": entry.page,
        "game": entry.game,
        "sessions": entry.sessions,
        "account": account,
        # The snapshot: still here, and still contactable, once the account is gone.
        "snapshot": {
            "email": entry.email,
            "display_name": entry.display_name,
            "public_id": entry.public_id,
        },
        # Sent while signed in, but the account has since been closed.
        "account_deleted": bool(entry.user_id is None and entry.public_id),
        "is_guest": entry.user_id is None and not entry.public_id,
    }


# ---------------------------------------------------------------------------
#  Views
# ---------------------------------------------------------------------------
@api_view(["GET"])
@permission_classes([IsAdminUser])
def admin_feedback_list(request):
    """Page through filtered feedback: ?period=&rating=&min_sessions=&q=&sort=..."""
    f = _parse_filters(request)
    try:
        limit = min(max(int(request.query_params.get("limit", 25)), 1), 100)
        offset = max(int(request.query_params.get("offset", 0)), 0)
    except ValueError:
        return Response({"error": "limit/offset must be integers"}, status=400)

    qs = _queryset(f).select_related("user").order_by(*SORTS.get(f["sort"], SORTS["newest"]))
    total = qs.count()
    return Response(
        {
            "total": total,
            "offset": offset,
            "limit": limit,
            "rows": [_row(e) for e in qs[offset : offset + limit]],
        }
    )


@api_view(["GET"])
@permission_classes([IsAdminUser])
def admin_feedback_stats(request):
    """Every aggregate the Feedback tab draws, over the SAME filtered set."""
    f = _parse_filters(request)
    qs = _queryset(f)
    gran = f["granularity"]

    agg = qs.aggregate(
        count=Count("id"),
        avg=Avg("rating"),
        with_message=Count("id", filter=~Q(message="")),
        registered=Count("id", filter=Q(user__isnull=False)),
        promoters=Count("id", filter=Q(rating__gte=4)),
        passives=Count("id", filter=Q(rating=3)),
        detractors=Count("id", filter=Q(rating__lte=2)),
        unresolved=Count("id", filter=Q(status=Feedback.NEW)),
    )
    count = agg["count"]

    # Same-length window immediately before this one, so a delta compares like
    # with like rather than against all of history. Both bounds are inclusive,
    # so the previous window stops one tick short of `start` — sharing the
    # boundary would count a row sitting exactly on it in both windows.
    span = f["end"] - f["start"]
    prev = _queryset(
        f, start=f["start"] - span, end=f["start"] - timedelta(microseconds=1)
    ).aggregate(count=Count("id"), avg=Avg("rating"))

    dist = {r: 0 for r in range(1, 6)}
    for row in qs.values("rating").order_by().annotate(n=Count("id")):
        dist[row["rating"]] = row["n"]

    # Time series, merged onto a gap-free axis.
    grouped = {}
    for row in (
        qs.annotate(bucket=TRUNC[gran]("created_at", tzinfo=dt_timezone.utc))
        .values("bucket")
        .order_by()
        .annotate(
            n=Count("id"),
            avg=Avg("rating"),
            promoters=Count("id", filter=Q(rating__gte=4)),
            detractors=Count("id", filter=Q(rating__lte=2)),
        )
    ):
        grouped[_floor(row["bucket"], gran)] = row

    buckets = []
    for start in _bucket_starts(f["start"], f["end"], gran):
        row = grouped.get(start)
        buckets.append(
            {
                "start": _iso(start),
                "end": _iso(_step(start, gran)),
                "label": _label(start, gran),
                "count": row["n"] if row else 0,
                "avg_rating": round(row["avg"], 2) if row and row["avg"] else None,
                "promoters": row["promoters"] if row else 0,
                "detractors": row["detractors"] if row else 0,
            }
        )

    by_game = [
        {
            # `game` is what the panel sends back as a filter; `label` is what it draws.
            "game": r["game"] or NO_GAME,
            "label": r["game"] or "(no game)",
            "count": r["n"],
            "avg_rating": round(r["avg"], 2) if r["avg"] else None,
        }
        for r in qs.values("game")
        .order_by()
        .annotate(n=Count("id"), avg=Avg("rating"))
        .order_by("-n")[:12]
    ]

    # Unfiltered - the tab badge is a standing "needs a reply" count, not a
    # property of whatever the admin happens to be looking at.
    overall = Feedback.objects.aggregate(
        total=Count("id"), new=Count("id", filter=Q(status=Feedback.NEW))
    )

    return Response(
        {
            "totals": {
                "count": count,
                "avg_rating": round(agg["avg"], 2) if agg["avg"] else None,
                "with_message": agg["with_message"],
                "registered": agg["registered"],
                "guests": count - agg["registered"],
                "promoters": agg["promoters"],
                "passives": agg["passives"],
                "detractors": agg["detractors"],
                "unresolved": agg["unresolved"],
            },
            "previous": {
                "count": prev["count"],
                "avg_rating": round(prev["avg"], 2) if prev["avg"] else None,
            },
            "distribution": [{"rating": r, "count": dist[r]} for r in range(1, 6)],
            "series": {"granularity": gran, "drill_into": DRILL_INTO[gran], "buckets": buckets},
            "by_game": by_game,
            "range": {
                "from": _iso(f["start"]),
                "to": _iso(f["end"]),
                "period": f["period"],
                "granularity": gran,
            },
            "all_time": {
                "count": overall["total"],
                "new": overall["new"],
                "first_at": _iso(_first_created_at()),
            },
        }
    )


@api_view(["PATCH"])
@permission_classes([IsAdminUser])
def admin_feedback_update(request, pk):
    """Triage one entry: mark it read/resolved, or leave a note on it."""
    try:
        entry = Feedback.objects.get(pk=pk)
    except Feedback.DoesNotExist:
        return Response({"error": "No such feedback"}, status=404)

    body = request.data or {}
    fields = []
    if "status" in body:
        status = str(body.get("status"))
        if status not in dict(Feedback.STATUS_CHOICES):
            return Response({"error": "status must be new, read or resolved"}, status=400)
        entry.status = status
        fields.append("status")
    if "admin_note" in body:
        entry.admin_note = str(body.get("admin_note") or "")[:2000]
        fields.append("admin_note")

    if not fields:
        return Response({"error": "nothing to update"}, status=400)
    entry.save(update_fields=fields)

    # Re-read through the annotated manager so the reply carries `sessions` too
    # and the panel can swap the row in without a refetch.
    refreshed = _annotated().select_related("user").get(pk=pk)
    return Response({"ok": True, "row": _row(refreshed)})
