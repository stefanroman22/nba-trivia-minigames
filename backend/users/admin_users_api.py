"""Admin-only API behind the panel's Users tab (/admin -> Users).

Four endpoints: an overview of the whole player base for a period (totals, activity, time on the
site, games, multiplayer, ranks, countries, charts), a searchable/sortable list of accounts, one
account's full picture, and ban/unban. Sending a friend request from the admin's own account uses
the ordinary friends endpoints (users.friends): the admin is a player like any other there.

Time on the site and country come from users.activity (DailyActivity); games from GameSession
(mode "single" is logged by the browser, "match"/"friend" by the relay — nothing is counted twice).

Everything here REQUIRES is_staff (IsAdminUser). Rows carry email addresses, so this module is the
gate, not the frontend's `is_admin` hint.
"""
import datetime

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Count, F, IntegerField, Max, Min, OuterRef, Q, Subquery, Sum
from django.db.models.functions import Coalesce, TruncDay, TruncMonth, TruncWeek, TruncYear
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response

from trivia import awarding
from trivia.models import Feedback, GameSession, QuestionReport
from trivia.wordle_daily import CET, cet_today
from users import strikes
from users.friends import _relationship_map
from users.models import RANK_CHOICES, BlockedUser, DailyActivity, FriendRequest, Friendship, ModerationEvent

User = get_user_model()

ONLINE_MODES = ("match", "friend")

PERIOD_DAYS = {"7d": 7, "30d": 30, "90d": 90, "12m": 365}
PERIODS = (*PERIOD_DAYS, "all")
GRANULARITY = {"7d": "day", "30d": "day", "90d": "week", "12m": "month", "all": "month"}
TRUNC = {"day": TruncDay, "week": TruncWeek, "month": TruncMonth, "year": TruncYear}

DEFAULT_PAGE_SIZE = 25
MAX_PAGE_SIZE = 100
DETAIL_ACTIVITY_DAYS = 30
TOP_LIST = 10


def _iso(value):
    return value.isoformat() if value else None


def _int(subquery):
    return Coalesce(Subquery(subquery, output_field=IntegerField()), 0)


# ---------------------------------------------------------------------------
#  Periods and buckets
# ---------------------------------------------------------------------------
def _period(request):
    """-> (period, start_day, start_dt, today, granularity). Days are Paris days, like the ladder."""
    period = str(request.query_params.get("period") or "30d")
    if period not in PERIODS:
        period = "30d"
    today = cet_today()
    if period == "all":
        first = User.objects.order_by("date_joined").values_list("date_joined", flat=True).first()
        start_day = first.astimezone(CET).date() if first else today
    else:
        start_day = today - datetime.timedelta(days=PERIOD_DAYS[period] - 1)
    gran = GRANULARITY[period]
    if period == "all" and (today - start_day).days > 3 * 365:
        gran = "year"
    start_dt = datetime.datetime.combine(start_day, datetime.time.min, tzinfo=CET)
    return period, start_day, start_dt, today, gran


def _floor(day, gran):
    if gran == "week":
        return day - datetime.timedelta(days=day.weekday())
    if gran == "month":
        return day.replace(day=1)
    if gran == "year":
        return day.replace(month=1, day=1)
    return day


def _step(day, gran):
    if gran == "week":
        return day + datetime.timedelta(days=7)
    if gran == "month":
        return (day.replace(day=28) + datetime.timedelta(days=4)).replace(day=1)
    if gran == "year":
        return day.replace(year=day.year + 1)
    return day + datetime.timedelta(days=1)


def _label(day, gran):
    if gran == "week":
        return f"w/c {day.day} {day:%b}"
    if gran == "month":
        return f"{day:%b %Y}"
    if gran == "year":
        return str(day.year)
    return f"{day.day} {day:%b}"


def _as_day(value):
    """A Trunc result (aware datetime for DateTimeFields, date for DateFields) as a Paris date."""
    if isinstance(value, datetime.datetime):
        return value.astimezone(CET).date()
    return value


def _grouped(qs, field, gran, is_date_field=False, **aggregates):
    """{bucket_start_date: {name: value}} for `qs` grouped by `field` truncated to `gran`."""
    if is_date_field and gran == "day":
        bucket = F(field)
    elif is_date_field:
        bucket = TRUNC[gran](field)
    else:
        bucket = TRUNC[gran](field, tzinfo=CET)
    rows = qs.annotate(bucket=bucket).values("bucket").annotate(**aggregates).order_by("bucket")
    return {_as_day(r["bucket"]): r for r in rows}


# ---------------------------------------------------------------------------
#  Overview
# ---------------------------------------------------------------------------
@api_view(["GET"])
@permission_classes([IsAdminUser])
def admin_users_overview(request):
    """Everything above the Users tab's list for ?period=7d|30d|90d|12m|all (default 30d)."""
    period, start_day, start_dt, today, gran = _period(request)

    users = User.objects.all()
    activity = DailyActivity.objects.all()
    period_activity = activity.filter(day__gte=start_day)
    sessions = GameSession.objects.filter(finished_at__gte=start_dt)
    online = sessions.filter(mode__in=ONLINE_MODES)

    def active_since(days):
        return activity.filter(day__gt=today - datetime.timedelta(days=days)).values("user").distinct().count()

    period_seconds = period_activity.aggregate(s=Sum("seconds"))["s"] or 0
    period_active = period_activity.values("user").distinct().count()
    period_active_days = period_activity.count()
    players_played = sessions.filter(user__isnull=False).values("user").distinct().count()
    players_online = online.filter(user__isnull=False).values("user").distinct().count()

    signups = _grouped(users.filter(date_joined__gte=start_dt), "date_joined", gran, n=Count("id"))
    actives = _grouped(
        period_activity, "day", gran, is_date_field=True, players=Count("user", distinct=True), seconds=Sum("seconds")
    )
    games = _grouped(sessions, "finished_at", gran, n=Count("id"), online=Count("id", filter=Q(mode__in=ONLINE_MODES)))
    buckets = []
    day = _floor(start_day, gran)
    while day <= today:
        buckets.append({
            "start": day.isoformat(),
            "label": _label(day, gran),
            "signups": signups.get(day, {}).get("n", 0),
            "active_players": actives.get(day, {}).get("players", 0),
            "seconds": actives.get(day, {}).get("seconds") or 0,
            "games": games.get(day, {}).get("n", 0),
            "online_games": games.get(day, {}).get("online", 0),
        })
        day = _step(day, gran)

    rank_counts = dict(users.filter(banned_at__isnull=True).values_list("rank").annotate(n=Count("id")))
    countries = list(
        period_activity.values("country")
        .annotate(players=Count("user", distinct=True), seconds=Sum("seconds"))
        .order_by("-players", "-seconds")
    )
    by_game = list(
        sessions.values("game")
        .annotate(
            plays=Count("id"),
            players=Count("user", distinct=True),
            online=Count("id", filter=Q(mode__in=ONLINE_MODES)),
            ms=Sum("duration_ms"),
        )
        .order_by("-plays")
    )
    top_time = list(
        period_activity.values("user__public_id", "user__username")
        .annotate(seconds=Sum("seconds"))
        .order_by("-seconds")[:TOP_LIST]
    )

    return Response({
        "range": {"period": period, "from": start_day.isoformat(), "to": today.isoformat(), "granularity": gran},
        "users": {
            "total": users.count(),
            "new": users.filter(date_joined__gte=start_dt).count(),
            "banned": users.filter(banned_at__isnull=False).count(),
            "admins": users.filter(is_staff=True).count(),
            "google": users.filter(google_sub__isnull=False).count(),
        },
        "active": {
            "today": active_since(1),
            "week": active_since(7),
            "month": active_since(30),
            "period": period_active,
        },
        "time": {
            "period_seconds": period_seconds,
            "all_time_seconds": activity.aggregate(s=Sum("seconds"))["s"] or 0,
            "per_active_player": round(period_seconds / period_active) if period_active else 0,
            "per_active_day": round(period_seconds / period_active_days) if period_active_days else 0,
            "tracked_since": _iso(activity.aggregate(d=Min("day"))["d"]),
        },
        "games": {
            "total": sessions.count(),
            "signed_in": sessions.filter(user__isnull=False).count(),
            "guests": sessions.filter(user__isnull=True).count(),
            "online": online.count(),
            "by_mode": dict(sessions.values_list("mode").annotate(n=Count("id"))),
            "players": players_played,
            "online_players": players_online,
            "game_ms": sessions.aggregate(ms=Sum("duration_ms"))["ms"] or 0,
        },
        "series": {"granularity": gran, "buckets": buckets},
        "ranks": [{"rank": name, "count": rank_counts.get(name, 0)} for name, _ in RANK_CHOICES],
        "countries": [{"country": c["country"], "players": c["players"], "seconds": c["seconds"] or 0} for c in countries],
        "by_game": [
            {"game": g["game"], "plays": g["plays"], "players": g["players"], "online": g["online"], "ms": g["ms"] or 0}
            for g in by_game
        ],
        "top_time": [
            {"public_id": t["user__public_id"], "username": t["user__username"], "seconds": t["seconds"] or 0}
            for t in top_time
        ],
    })


# ---------------------------------------------------------------------------
#  List
# ---------------------------------------------------------------------------
SORTS = {
    "newest": ("-date_joined",),
    "oldest": ("date_joined",),
    "points": ("-points", "-date_joined"),
    "time": ("-app_seconds", "-date_joined"),
    "games": ("-games", "-date_joined"),
    "online": ("-online_games", "-games"),
    "last_seen": (F("last_seen").desc(nulls_last=True), "-date_joined"),
    "name": ("username", "public_id"),
}

FILTERS = ("all", "active_7d", "inactive_30d", "new_7d", "online", "never_played", "banned", "admins", "google")


def _annotated_users():
    activity = DailyActivity.objects.filter(user=OuterRef("pk"))
    sessions = GameSession.objects.filter(user=OuterRef("pk"))
    month_ago = cet_today() - datetime.timedelta(days=29)
    return User.objects.defer("profile_photo_data").annotate(
        games=_int(sessions.values("user").annotate(n=Count("id")).values("n")),
        online_games=_int(sessions.filter(mode__in=ONLINE_MODES).values("user").annotate(n=Count("id")).values("n")),
        game_ms=_int(sessions.values("user").annotate(ms=Sum("duration_ms")).values("ms")),
        app_seconds=_int(activity.values("user").annotate(s=Sum("seconds")).values("s")),
        seconds_30d=_int(activity.filter(day__gte=month_ago).values("user").annotate(s=Sum("seconds")).values("s")),
        last_seen=Subquery(activity.order_by("-last_seen_at").values("last_seen_at")[:1]),
        country=Subquery(activity.exclude(country="").order_by("-day").values("country")[:1]),
    )


def _row(u):
    return {
        "public_id": u.public_id,
        "username": u.username,
        "email": u.email,
        "rank": u.rank,
        "points": u.points,
        "photo_version": u.profile_photo_version,
        "date_joined": _iso(u.date_joined),
        "last_seen": _iso(u.last_seen),
        "country": u.country or "",
        "games": u.games,
        "online_games": u.online_games,
        "game_ms": u.game_ms,
        "app_seconds": u.app_seconds,
        "seconds_30d": u.seconds_30d,
        "active_days": u.active_days,
        "is_admin": bool(u.is_staff),
        "banned": u.banned_at is not None,
        "google": bool(u.google_sub),
    }


@api_view(["GET"])
@permission_classes([IsAdminUser])
def admin_users_list(request):
    """?q=&filter=&rank=&country=&sort=&limit=&offset= -> {total, offset, rows}."""
    params = request.query_params
    try:
        limit = min(max(int(params.get("limit", DEFAULT_PAGE_SIZE)), 1), MAX_PAGE_SIZE)
        offset = max(int(params.get("offset", 0)), 0)
    except ValueError:
        return Response({"error": "limit/offset must be integers"}, status=400)

    qs = _annotated_users()
    q = str(params.get("q") or "").strip().lstrip("#")
    if q:
        qs = qs.filter(Q(username__icontains=q) | Q(public_id__icontains=q) | Q(email__icontains=q))

    today = cet_today()
    flt = str(params.get("filter") or "all")
    if flt == "active_7d":
        qs = qs.filter(pk__in=DailyActivity.objects.filter(day__gt=today - datetime.timedelta(days=7)).values("user"))
    elif flt == "inactive_30d":
        qs = qs.exclude(pk__in=DailyActivity.objects.filter(day__gt=today - datetime.timedelta(days=30)).values("user"))
    elif flt == "new_7d":
        start = datetime.datetime.combine(today - datetime.timedelta(days=6), datetime.time.min, tzinfo=CET)
        qs = qs.filter(date_joined__gte=start)
    elif flt == "online":
        qs = qs.filter(online_games__gt=0)
    elif flt == "never_played":
        qs = qs.filter(games=0)
    elif flt == "banned":
        qs = qs.filter(banned_at__isnull=False)
    elif flt == "admins":
        qs = qs.filter(is_staff=True)
    elif flt == "google":
        qs = qs.filter(google_sub__isnull=False)

    rank = str(params.get("rank") or "")
    if rank:
        qs = qs.filter(rank=rank)
    country = str(params.get("country") or "").upper()
    if country:
        # Anyone who has played from it (the row's own column shows only their latest country), so a
        # click on a bar of the country chart always lists the players that bar counted.
        qs = qs.filter(pk__in=DailyActivity.objects.filter(country=country).values("user"))

    sort = str(params.get("sort") or "newest")
    qs = qs.order_by(*SORTS.get(sort, SORTS["newest"]))

    total = qs.count()
    return Response({"total": total, "offset": offset, "rows": [_row(u) for u in qs[offset : offset + limit]]})


# ---------------------------------------------------------------------------
#  One account
# ---------------------------------------------------------------------------
def _target(public_id):
    return User.objects.defer("profile_photo_data").filter(public_id__iexact=str(public_id).lstrip("#")).first()


def _relationship(me, user):
    """The admin's own friend relationship to `user`, as the friends UI would see it."""
    if me.pk == user.pk:
        return {"status": "self", "request_id": None}
    if BlockedUser.objects.filter(Q(blocker=me, blocked=user) | Q(blocker=user, blocked=me)).exists():
        return {"status": "blocked", "request_id": None}
    relationships, _ = _relationship_map(me, [user.pk])
    status_, request_id = relationships[user.pk]
    return {"status": status_, "request_id": request_id}


def _account(user):
    return {
        "public_id": user.public_id,
        "username": user.username,
        "email": user.email,
        "rank": user.rank,
        "points": user.points,
        "photo_version": user.profile_photo_version,
        "date_joined": _iso(user.date_joined),
        "last_login": _iso(user.last_login),
        "google": bool(user.google_sub),
        "has_password": user.has_usable_password(),
        "is_admin": bool(user.is_staff),
        "is_active": user.is_active,
        "banned_at": _iso(user.banned_at),
        "ban_reason": user.ban_reason,
        "strike_count": user.strike_count,
        "active_days": user.active_days,
        "streak_days": user.streak_days if awarding.streak_alive(user, cet_today()) else 0,
        "streak_best": user.streak_best,
        "streak_freezes": user.streak_freezes,
        "founding_member": user.founding_member,
        "terms_version": user.terms_version,
        "terms_accepted_at": _iso(user.terms_accepted_at),
    }


def _detail(request, user):
    today = cet_today()
    activity = DailyActivity.objects.filter(user=user)
    totals = activity.aggregate(
        seconds=Sum("seconds"), days=Count("id"), first=Min("day"), last_seen=Max("last_seen_at")
    )
    total_seconds = totals["seconds"] or 0

    def seconds_since(days):
        return activity.filter(day__gt=today - datetime.timedelta(days=days)).aggregate(s=Sum("seconds"))["s"] or 0

    window_start = today - datetime.timedelta(days=DETAIL_ACTIVITY_DAYS - 1)
    per_day = dict(activity.filter(day__gte=window_start).values_list("day", "seconds"))
    daily = []
    for i in range(DETAIL_ACTIVITY_DAYS):
        day = window_start + datetime.timedelta(days=i)
        daily.append({"day": day.isoformat(), "label": _label(day, "day"), "seconds": per_day.get(day, 0)})

    countries = list(
        activity.exclude(country="").values("country").annotate(days=Count("id"), seconds=Sum("seconds")).order_by("-days")
    )
    latest_country = activity.exclude(country="").order_by("-day").values_list("country", flat=True).first() or ""

    sessions = GameSession.objects.filter(user=user)
    game_totals = sessions.aggregate(
        total=Count("id"),
        online=Count("id", filter=Q(mode__in=ONLINE_MODES)),
        ms=Sum("duration_ms"),
        awarded=Sum("awarded"),
        first=Min("finished_at"),
        last=Max("finished_at"),
    )
    by_game = list(
        sessions.values("game")
        .annotate(
            plays=Count("id"),
            online=Count("id", filter=Q(mode__in=ONLINE_MODES)),
            best=Max("score"),
            total_score=Sum("score"),
            ms=Sum("duration_ms"),
            last=Max("finished_at"),
        )
        .order_by("-plays")
    )
    recent = sessions.order_by("-finished_at")[:10]

    friends = Friendship.objects.filter(Q(user_low=user) | Q(user_high=user)).count()

    return {
        "account": _account(user),
        "relationship": _relationship(request.user, user),
        "usage": {
            "total_seconds": total_seconds,
            "seconds_today": seconds_since(1),
            "seconds_7d": seconds_since(7),
            "seconds_30d": seconds_since(30),
            "days_active": totals["days"],
            "per_active_day": round(total_seconds / totals["days"]) if totals["days"] else 0,
            "first_seen_day": _iso(totals["first"]),
            "last_seen": _iso(totals["last_seen"]),
            "country": latest_country,
            "countries": [{"country": c["country"], "days": c["days"], "seconds": c["seconds"] or 0} for c in countries],
            "daily": daily,
        },
        "games": {
            "total": game_totals["total"],
            "online": game_totals["online"],
            "by_mode": dict(sessions.values_list("mode").annotate(n=Count("id"))),
            "game_ms": game_totals["ms"] or 0,
            "points_awarded": game_totals["awarded"] or 0,
            "first_at": _iso(game_totals["first"]),
            "last_at": _iso(game_totals["last"]),
            "by_game": [
                {
                    "game": g["game"],
                    "plays": g["plays"],
                    "online": g["online"],
                    "best": g["best"],
                    "avg": round(g["total_score"] / g["plays"]) if g["plays"] else 0,
                    "ms": g["ms"] or 0,
                    "last": _iso(g["last"]),
                }
                for g in by_game
            ],
            "recent": [
                {"game": s.game, "mode": s.mode, "score": s.score, "awarded": s.awarded, "ms": s.duration_ms, "at": _iso(s.finished_at)}
                for s in recent
            ],
        },
        "social": {
            "friends": friends,
            "requests_in": FriendRequest.objects.filter(receiver=user).count(),
            "requests_out": FriendRequest.objects.filter(sender=user).count(),
            "blocking": BlockedUser.objects.filter(blocker=user).count(),
            "blocked_by": BlockedUser.objects.filter(blocked=user).count(),
        },
        "feedback": Feedback.objects.filter(user=user).count(),
        "question_reports": QuestionReport.objects.filter(user=user).count(),
        "moderation": [
            {"kind": e.kind, "tier": e.tier, "reason": e.reason, "at": _iso(e.created_at)}
            for e in ModerationEvent.objects.filter(user=user).order_by("-created_at")[:10]
        ],
    }


@api_view(["GET"])
@permission_classes([IsAdminUser])
def admin_user_detail(request, public_id):
    user = _target(public_id)
    if user is None:
        return Response({"error": "No player with that ID."}, status=404)
    return Response(_detail(request, user))


@api_view(["POST"])
@permission_classes([IsAdminUser])
def admin_user_ban(request, public_id):
    """POST {action: "ban" | "unban"}. An admin ban is reason "admin" (not automated, DSA Art 17)."""
    body = request.data if isinstance(request.data, dict) else {}
    action = str(body.get("action", ""))
    if action not in ("ban", "unban"):
        return Response({"error": "action must be ban or unban"}, status=400)
    target = _target(public_id)
    if target is None:
        return Response({"error": "No player with that ID."}, status=404)
    if target.pk == request.user.pk:
        return Response({"error": "You can't ban your own account."}, status=400)
    with transaction.atomic():
        # Locked so a double-click can't ban (and log) twice.
        user = User.objects.select_for_update().defer("profile_photo_data").get(pk=target.pk)
        if action == "ban":
            if user.is_staff:
                return Response({"error": "Admin accounts can't be banned here."}, status=403)
            if user.banned_at is not None:
                return Response({"error": "This account is already banned."}, status=409)
            strikes.ban_user(user, strikes.BAN_REASON_ADMIN, kind="admin")
        else:
            if user.banned_at is None:
                return Response({"error": "This account isn't banned."}, status=409)
            strikes.unban_user(user)
    user.refresh_from_db()
    return Response({"account": _account(user)})
