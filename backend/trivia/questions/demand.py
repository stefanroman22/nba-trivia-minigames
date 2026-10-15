"""Demand-driven refill targets (question factory §4.4, phase 3).

    daily_use = plays in the last 14 days (GameDailyStats, all modes) / 14 x rounds per play
    target    = clamp(ceil(daily_use x runway_days), MINIMUM, capacity)

A game with no stats in the window keeps its spec's static target (TARGET), so the
refill is unchanged until roll-ups exist. Contexto's target is days scheduled ahead,
not a pool, and the hidden games keep their static targets too. capacity(dataset) is an
optional game module function (None or absent = unbounded).

Second trigger (saturation): when 20% of the window's signed-in players have seen 70% of
the active pool, the target is at least 1.5 x the active pool, still capped by capacity.
"""
import datetime
import math

from django.db.models import Count, Sum

from trivia.models import GameDailyStats, GameSession, Question, SeenQuestion
from trivia.questions import specs

WINDOW_DAYS = 14
DEFAULT_RUNWAY_DAYS = 90
ROUNDS_PER_PLAY = {
    "career-path": 1, "who-are-ya": 1, "tictactoe": 1, "contexto": 1,
    "fan-favorites": 1, "who-would-win": 10, "connections": 1,
}
DAYS_AHEAD = ("contexto",)  # daily games: the target is days scheduled ahead (spec runway)
SEEN_SHARE = 0.7          # a player has "seen the pool" at 70% of its active questions
SATURATION_SHARE = 0.2    # ... and the trigger fires when 20% of players have
SATURATION_GROWTH = 1.5


def _runway_days(slug):
    try:
        return specs.load(slug)["refill"]["runway_days"]
    except specs.SpecError:  # editorial games without a spec yet
        return DEFAULT_RUNWAY_DAYS


def _capacity(mod, dataset):
    fn = getattr(mod, "capacity", None)
    return fn(dataset) if fn is not None and dataset is not None else None


def saturation(slug, now):
    """Share of users with a GameSession of `slug` in the last 14 days who have seen
    (SeenQuestion) at least 70% of its active qids. One grouped count, no per-user loop."""
    active = Question.objects.filter(game=slug, status=Question.STATUS_ACTIVE)
    n_active = active.count()
    players = (GameSession.objects.filter(game=slug, user__isnull=False,
                                          finished_at__gte=now - datetime.timedelta(days=WINDOW_DAYS))
               .values("user_id").distinct())
    n_players = players.count() if n_active else 0
    if not n_players:
        return 0.0
    need = math.ceil(n_active * SEEN_SHARE)
    saturated = (SeenQuestion.objects.filter(game=slug, user_id__in=players, qid__in=active.values("qid"))
                 .values("user_id").annotate(n=Count("id")).filter(n__gte=need).count())
    return saturated / n_players


def target_for(slug, mod, now, dataset=None):
    """(target, detail) for `slug`; target None means unbounded (every eligible question).
    detail carries the numbers behind it for the runner's refill_decision."""
    if slug in DAYS_AHEAD:
        return mod.TARGET, {"mode": "days_ahead"}
    if slug not in ROUNDS_PER_PLAY:  # hidden / legacy games
        return mod.TARGET, {"mode": "static"}
    today = now.date()
    plays = GameDailyStats.objects.filter(
        game=slug, day__gte=today - datetime.timedelta(days=WINDOW_DAYS), day__lt=today,
    ).aggregate(n=Sum("plays"))["n"]
    capacity = _capacity(mod, dataset)
    if plays is None:
        want, detail = mod.TARGET, {"mode": "static"}
    else:
        runway = _runway_days(slug)
        daily_use = plays / WINDOW_DAYS * ROUNDS_PER_PLAY[slug]
        demand = math.ceil(daily_use * runway)
        want = max(demand, mod.MINIMUM)
        detail = {"mode": "demand", "plays_14d": plays, "daily_use": round(daily_use, 3),
                  "runway_days": runway, "demand": demand, "minimum": mod.MINIMUM, "capacity": capacity}
    share = saturation(slug, now)
    detail["saturation"] = round(share, 3)
    if share >= SATURATION_SHARE and want is not None:
        active = Question.objects.filter(game=slug, status=Question.STATUS_ACTIVE).count()
        want = max(want, math.ceil(active * SATURATION_GROWTH))
        detail.update(saturated=True, capacity=capacity)
    # A static target stays as it is (today's behaviour) unless saturation raised it.
    if want is None or capacity is None or (detail["mode"] == "static" and not detail.get("saturated")):
        return want, detail
    target = min(want, capacity)
    if target < want:
        detail.update(capacity_bound=True, want=want)
    return target, detail
