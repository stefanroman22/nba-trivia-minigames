"""Everything between a finished game's score and the points that land on the account.

`award()` is the ONLY writer of points, rank, active days and the streak (AUTH-6). Per-game ceilings,
the first-game-of-the-day bonus and the streak live here so `log_session` (solo,
the signed-in browser) and `multiplayer_result` (online, the relay) can't drift apart. Day boundaries
are Europe/Paris, like the daily Wordle. Design: docs/superpowers/specs/2026-10-16-progression-design.md.
"""
import datetime

from django.db import transaction

from trivia.models import GameSession
from trivia.wordle_daily import CET, DAILY_GAMES, cet_today
from users import leaderboard, ranks

# The highest honest score of each game (src/utils/GameUtils.tsx maxPoints): a forged submission is
# clamped to it. Hidden games keep their renderer's maximum.
GAME_MAX_POINTS = {
    "series-winner": 100, "name-logo": 50, "guess-mvps": 100, "starting-five": 300,
    "wordle": 500, "fan-favorites": 200, "career-path": 200, "who-are-ya": 250,
    "tictactoe": 300, "contexto": 350, "who-would-win": 100,
    "heatmap": 300, "connections": 200, "nba-grid": 270, "bingo": 200, "pack-five": 220, "superdraft": 100,
}
# Online rounds that pay less than the solo game: online Wordle has no daily lock, so no daily jackpot.
MATCH_MAX_POINTS = {"wordle": 200}
# A game id in neither table (new or unknown).
DEFAULT_MAX_POINTS = 300

FIRST_GAME_BONUS = 100
# Every game point counts in full (owner decision 2026-10-20: no daily soft cap). Streak milestones are the
# reward for coming back: paid once, automatically, on the day the streak reaches the milestone.
STREAK_MILESTONES = {10: 500, 25: 1_500, 50: 4_000, 100: 10_000, 200: 25_000, 500: 75_000, 1_000: 200_000}
# A held freeze covers one missed day; refilled whenever the streak reaches a multiple of FREEZE_EVERY_DAYS.
MAX_FREEZES = 1
FREEZE_EVERY_DAYS = 7

ACTIVITY_FIELDS = ["points", "rank", "active_days", "last_active_day", "streak_days", "streak_best", "streak_freezes"]


def cap_for(game, mode):
    if mode == "match" and game in MATCH_MAX_POINTS:
        return MATCH_MAX_POINTS[game]
    return GAME_MAX_POINTS.get(game, DEFAULT_MAX_POINTS)


def clamp_score(game, mode, raw):
    try:
        score = int(raw)
    except (TypeError, ValueError):
        return 0
    return min(max(0, score), cap_for(game, mode))


def day_start_utc(day):
    """Paris civil midnight of `day`, as a UTC datetime (what finished_at is compared against)."""
    return datetime.datetime.combine(day, datetime.time.min, tzinfo=CET).astimezone(datetime.timezone.utc)


def week_start_utc(day):
    """Monday 00:00 Paris of the week containing `day`, in UTC (the weekly board's window)."""
    return day_start_utc(day - datetime.timedelta(days=day.weekday()))


def streak_alive(user, today):
    """True while a scoring game today would extend the streak: last active today or yesterday, or two
    days ago with a freeze held to cover the missed day."""
    last = user.last_active_day
    if last is None:
        return False
    gap = (today - last).days
    return 0 <= gap <= 1 or (gap == 2 and user.streak_freezes > 0)


def _touch_activity(user, today):
    """Count `today` once, move the streak. Returns the streak milestone bonus (0 when none)."""
    if user.last_active_day == today:
        return 0
    if streak_alive(user, today):
        if user.last_active_day == today - datetime.timedelta(days=2):
            user.streak_freezes -= 1  # the freeze covers yesterday
        user.streak_days += 1
    else:
        user.streak_days = 1
    user.active_days += 1
    user.last_active_day = today
    user.streak_best = max(user.streak_best, user.streak_days)
    if user.streak_days % FREEZE_EVERY_DAYS == 0:
        user.streak_freezes = min(MAX_FREEZES, user.streak_freezes + 1)
    return STREAK_MILESTONES.get(user.streak_days, 0)


def _promoted(before, after):
    """A move up the ladder. An old-ladder rank the previous backend wrote (same database) can recalculate
    lower; that is no rank-up. A name off the ladder counts as the bottom."""
    names = ranks.RANK_NAMES
    return (names.index(after) if after in names else 0) > (names.index(before) if before in names else 0)


def _repeat_blocked(user, game, mode, todays):
    """Solo Wordle and Contexto are once a day (trivia.wordle_daily): only the day's first scoring play
    counts. Repeated claims were the easiest route onto the weekly board."""
    return game in DAILY_GAMES and mode == "single" and todays.filter(game=game, mode="single", score__gt=0).exists()


def award(user, game, mode, score, duration_ms):
    """Log the play and credit the account. `score` is already clamped (clamp_score). Returns the receipt
    the client applies: awarded, base, first_game_bonus, streak_bonus, points, rank, rank_up, progress, streak."""
    today = cet_today()
    since = day_start_utc(today)
    until = day_start_utc(today + datetime.timedelta(days=1))
    with transaction.atomic():
        user = type(user).objects.select_for_update().get(pk=user.pk)
        rank_before = user.rank
        todays = GameSession.objects.filter(
            user=user, finished_at__gte=since, finished_at__lt=until, mode__in=("single", "match")
        )
        scoring = score > 0 and not _repeat_blocked(user, game, mode, todays)
        base = score if scoring else 0
        first_bonus = FIRST_GAME_BONUS if scoring and not todays.filter(score__gt=0).exists() else 0
        streak_bonus = _touch_activity(user, today) if scoring else 0
        awarded = base + first_bonus + streak_bonus
        GameSession.objects.create(user=user, game=game, mode=mode, score=score, duration_ms=duration_ms, awarded=awarded)
        user.points += awarded
        user.update_rank()
        user.save(update_fields=ACTIVITY_FIELDS)
    leaderboard.record_score(user)
    return {
        "awarded": awarded,
        "base": base,
        "first_game_bonus": first_bonus,
        "streak_bonus": streak_bonus,
        "points": user.points,
        "rank": user.rank,
        "rank_up": {"from": rank_before, "to": user.rank} if _promoted(rank_before, user.rank) else None,
        "progress": ranks.progress(user.points, user.active_days),
        "streak": {"days": user.streak_days, "best": user.streak_best, "freezes": user.streak_freezes},
    }
