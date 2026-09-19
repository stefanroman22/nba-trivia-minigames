"""Daily word-of-the-day logic for single-player Wordle (once-per-day gate).

Multiplayer keeps using `get_wordle` in views.py unchanged — a fresh random
word per round, same as every other game's round. This module is only for the
single-player "one play per day" puzzle.

The day boundary is Europe/Paris (CET/CEST) civil midnight, not a fixed UTC
offset, so the flip stays at real local midnight across the DST change.
"""
import datetime
import random
from zoneinfo import ZoneInfo

from django.db import IntegrityError, transaction
from django.db.models import Q
from django.db.models.functions import Length

from trivia.models import Player, WordleDailyWord, WordlePlay
from trivia.utils.text_utils import wordle_word

CET = ZoneInfo("Europe/Paris")

# A repick is skipped once a word has been used within this many days.
NO_REPEAT_DAYS = 180


def cet_today() -> datetime.date:
    return datetime.datetime.now(tz=CET).date()


def next_reset_utc(day: datetime.date) -> datetime.datetime:
    """The instant the *next* day's word becomes active, as a UTC datetime."""
    midnight_cet = datetime.datetime.combine(
        day + datetime.timedelta(days=1), datetime.time.min, tzinfo=CET
    )
    return midnight_cet.astimezone(datetime.timezone.utc)


def candidate_words() -> list[str]:
    """Every distinct clean 5-letter surname currently in the player table."""
    seen = set()
    for last_name in (
        Player.objects.annotate(ln=Length("last_name")).filter(ln=5).values_list("last_name", flat=True)
    ):
        w = wordle_word(last_name)
        if w:
            seen.add(w)
    return sorted(seen)


def _pick_word() -> str:
    pool = candidate_words()
    if not pool:
        raise ValueError("no wordle words available")
    cutoff = cet_today() - datetime.timedelta(days=NO_REPEAT_DAYS)
    recent = set(
        WordleDailyWord.objects.filter(date__gte=cutoff).values_list("word", flat=True)
    )
    # One set-difference instead of pick-then-repick-on-collision — same
    # guarantee (never a word used in the last NO_REPEAT_DAYS days), no retry
    # loop. Falls back to the full pool in the (practically unreachable, given
    # 528 candidates vs. a 180-day window) case that it would exhaust the pool.
    allowed = [w for w in pool if w not in recent] or pool
    return random.choice(allowed)


def get_or_create_daily_word(day: datetime.date) -> WordleDailyWord:
    """The word for `day`, picking and storing it on first request for that day.

    Idempotent per day (WordleDailyWord.date is unique) — whichever request
    (the cron job or the first player of the day) gets there first wins, and
    every later call just returns that same row.
    """
    try:
        return WordleDailyWord.objects.get(date=day)
    except WordleDailyWord.DoesNotExist:
        pass
    try:
        with transaction.atomic():
            return WordleDailyWord.objects.create(date=day, word=_pick_word())
    except IntegrityError:
        # Lost a race to another concurrent request — their row is the word of record.
        return WordleDailyWord.objects.get(date=day)


def resolve_device_id(request) -> str:
    raw = request.data.get("device_id") if request.method == "POST" else request.query_params.get("device_id")
    return str(raw or "")[:64]


def has_played_today(user, device_id: str, day: datetime.date) -> bool:
    if user is not None and user.is_authenticated:
        identity = Q(user=user)
        if device_id:
            identity |= Q(device_id=device_id)
    elif device_id:
        identity = Q(device_id=device_id)
    else:
        # No account and no device id offered — nothing to gate on; treat as unplayed.
        return False
    return WordlePlay.objects.filter(identity, play_date=day).exists()


def record_play(user, device_id: str, day: datetime.date) -> None:
    try:
        with transaction.atomic():
            WordlePlay.objects.create(
                user=user if (user is not None and user.is_authenticated) else None,
                device_id=device_id or None,
                play_date=day,
            )
    except IntegrityError:
        # Two near-simultaneous requests from the same identity — the other
        # one recorded it first, which is exactly the outcome we want.
        pass


def prune_stale_plays(current_day: datetime.date) -> int:
    """Delete every play row that isn't today's — keeps the table bounded to
    the current day's player count instead of accumulating forever."""
    deleted, _ = WordlePlay.objects.exclude(play_date=current_day).delete()
    return deleted
