"""The once-per-day gate for the daily solo games (trivia.wordle_daily): Contexto mirrors Wordle.

GET  /trivia/<game>/daily-status/  -> { locked, next_reset_at }
POST /trivia/<game>/daily-play/    -> records the play; 423 once played today (per account OR device)
The day is the Europe/Paris civil day; tests pin the clock instead of reading the wall clock.
"""
import datetime
from io import StringIO
from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.management import call_command
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TestCase, TransactionTestCase
from django.urls import reverse
from rest_framework.test import APIClient

from trivia import wordle_daily
from trivia.models import WordleDailyWord, WordlePlay

User = get_user_model()
DAY = datetime.date(2026, 10, 16)


class _Clock(datetime.datetime):
    """datetime.datetime whose now() is `instant` (an aware UTC datetime)."""

    instant = None

    @classmethod
    def now(cls, tz=None):
        return cls.instant.astimezone(tz)


def _frozen_at(instant):
    """Patch wordle_daily's clock to `instant` (the module reads `datetime.datetime.now`)."""
    _Clock.instant = instant
    fake = SimpleNamespace(
        datetime=_Clock, date=datetime.date, time=datetime.time,
        timedelta=datetime.timedelta, timezone=datetime.timezone,
    )
    return patch("trivia.wordle_daily.datetime", fake)


def _utc(*args):
    return datetime.datetime(*args, tzinfo=datetime.timezone.utc)


class DailyGateTests(TestCase):
    def setUp(self):
        cache.clear()  # throttle counters
        self.api = APIClient()
        self.today = patch("trivia.wordle_daily.cet_today", return_value=DAY)
        self.today.start()

    def tearDown(self):
        self.today.stop()
        cache.clear()

    def status(self, game, device="dev-a", client=None):
        return (client or self.api).get(reverse(f"{game}-daily-status"), {"device_id": device})

    def play(self, game, device="dev-a", client=None):
        return (client or self.api).post(reverse(f"{game}-daily-play"), {"device_id": device}, format="json")

    def signed_in(self):
        user = User.objects.create_user(username="Baller", email="baller@example.com", password="x")
        client = APIClient()
        client.force_authenticate(user)
        return user, client

    def test_contexto_status_is_unlocked_before_the_first_play(self):
        r = self.status("contexto")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), {"locked": False, "next_reset_at": "2026-10-16T22:00:00Z"})  # Paris midnight
        self.assertFalse(WordlePlay.objects.exists())  # read-only

    def test_contexto_play_returns_the_paris_day_and_locks_the_device(self):
        r = self.play("contexto")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), {"day": "2026-10-16", "next_reset_at": "2026-10-16T22:00:00Z"})
        row = WordlePlay.objects.get()
        self.assertEqual((row.game, row.device_id, row.user, row.play_date), ("contexto", "dev-a", None, DAY))
        self.assertTrue(self.status("contexto").json()["locked"])

    def test_a_guest_device_second_play_is_refused(self):
        self.play("contexto")
        r = self.play("contexto")
        self.assertEqual(r.status_code, 423)
        self.assertEqual(r.json()["locked"], True)
        self.assertEqual(r.json()["next_reset_at"], "2026-10-16T22:00:00Z")
        self.assertEqual(WordlePlay.objects.count(), 1)
        # Another device is a different guest.
        self.assertEqual(self.play("contexto", device="dev-b").status_code, 200)

    def test_an_account_second_play_is_refused_from_any_device(self):
        user, client = self.signed_in()
        self.assertEqual(self.play("contexto", client=client).status_code, 200)
        self.assertEqual(WordlePlay.objects.get().user, user)
        # Same account, a new browser.
        self.assertEqual(self.play("contexto", device="dev-new", client=client).status_code, 423)
        self.assertTrue(self.status("contexto", device="dev-new", client=client).json()["locked"])
        # Logged out on the same browser: the device id still holds the lock.
        self.assertEqual(self.play("contexto").status_code, 423)

    def test_the_games_have_separate_gates(self):
        WordleDailyWord.objects.create(date=DAY, word="JAMES")
        self.assertEqual(self.play("contexto").status_code, 200)
        self.assertFalse(self.status("wordle").json()["locked"])
        r = self.play("wordle")
        self.assertEqual((r.status_code, r.json()["series"]), (200, ["JAMES"]))
        self.assertEqual(self.play("wordle").status_code, 423)
        self.assertEqual(sorted(WordlePlay.objects.values_list("game", flat=True)), ["contexto", "wordle"])

    def test_a_play_with_no_identity_is_not_gated(self):
        self.assertEqual(self.play("contexto", device="").status_code, 200)
        self.assertEqual(self.play("contexto", device="").status_code, 200)

    def test_the_next_day_unlocks(self):
        self.play("contexto")
        self.today.stop()
        with patch("trivia.wordle_daily.cet_today", return_value=DAY + datetime.timedelta(days=1)):
            self.assertFalse(self.status("contexto").json()["locked"])
            self.assertEqual(self.play("contexto").json()["day"], "2026-10-17")
        self.today.start()


class ParisMidnightTests(TestCase):
    """The day flips at Paris midnight (22:00 UTC in summer time), not at UTC midnight."""

    def setUp(self):
        cache.clear()
        self.api = APIClient()

    def tearDown(self):
        cache.clear()

    def play(self):
        return self.api.post(reverse("contexto-daily-play"), {"device_id": "dev-a"}, format="json")

    def status(self):
        return self.api.get(reverse("contexto-daily-status"), {"device_id": "dev-a"}).json()

    def test_flip_at_paris_midnight(self):
        with _frozen_at(_utc(2026, 10, 16, 21, 59)):  # 23:59 Paris on the 16th
            self.assertEqual(self.play().json()["day"], "2026-10-16")
            self.assertTrue(self.status()["locked"])
        with _frozen_at(_utc(2026, 10, 16, 22, 0)):  # 00:00 Paris on the 17th, still the 16th in UTC
            self.assertEqual(self.status(), {"locked": False, "next_reset_at": "2026-10-17T22:00:00Z"})
            self.assertEqual(self.play().json()["day"], "2026-10-17")

    def test_winter_time_flips_an_hour_later_in_utc(self):
        with _frozen_at(_utc(2026, 12, 1, 22, 30)):  # 23:30 Paris (CET = UTC+1)
            self.assertEqual(self.play().json(), {"day": "2026-12-01", "next_reset_at": "2026-12-01T23:00:00Z"})
        with _frozen_at(_utc(2026, 12, 1, 23, 0)):
            self.assertEqual(self.play().json()["day"], "2026-12-02")


class PruneTests(TestCase):
    def test_prune_keeps_only_todays_plays_of_every_game(self):
        yesterday = DAY - datetime.timedelta(days=1)
        for game in ("wordle", "contexto"):
            WordlePlay.objects.create(device_id=f"old-{game}", game=game, play_date=yesterday)
            WordlePlay.objects.create(device_id=f"new-{game}", game=game, play_date=DAY)
        self.assertEqual(wordle_daily.prune_stale_plays(DAY), 2)
        self.assertEqual(
            sorted(WordlePlay.objects.values_list("device_id", flat=True)), ["new-contexto", "new-wordle"]
        )

    def test_the_daily_job_prunes_contexto_plays_too(self):
        WordleDailyWord.objects.create(date=DAY, word="JAMES")
        WordlePlay.objects.create(device_id="old", game="contexto", play_date=DAY - datetime.timedelta(days=1))
        WordlePlay.objects.create(device_id="new", game="contexto", play_date=DAY)
        with patch("trivia.wordle_daily.cet_today", return_value=DAY):
            call_command("pick_daily_wordle", stdout=StringIO())
        self.assertEqual(list(WordlePlay.objects.values_list("device_id", flat=True)), ["new"])


class MigrationTests(TransactionTestCase):
    """0015 adds `game` to the play gate: existing rows become Wordle plays, nothing is lost."""

    before = [("trivia", "0014_seed_smoy_1989_correction")]
    after = [("trivia", "0015_daily_play_game")]

    def tearDown(self):
        executor = MigrationExecutor(connection)
        executor.loader.build_graph()
        executor.migrate(executor.loader.graph.leaf_nodes())

    def test_existing_plays_become_wordle_plays(self):
        executor = MigrationExecutor(connection)
        executor.migrate(self.before)
        old_apps = executor.loader.project_state(self.before).apps
        OldPlay = old_apps.get_model("trivia", "WordlePlay")
        OldPlay.objects.create(device_id="dev-a", play_date=DAY)
        OldPlay.objects.create(device_id="dev-b", play_date=DAY)

        executor = MigrationExecutor(connection)
        executor.loader.build_graph()
        executor.migrate(self.after)
        NewPlay = executor.loader.project_state(self.after).apps.get_model("trivia", "WordlePlay")
        self.assertEqual(
            sorted(NewPlay.objects.values_list("device_id", "game", "play_date")),
            [("dev-a", "wordle", DAY), ("dev-b", "wordle", DAY)],
        )
        # A backend still on the old code inserts without the column: the database fills in "wordle".
        with connection.cursor() as cur:
            cur.execute(
                "INSERT INTO trivia_wordleplay (device_id, play_date, created_at) VALUES (%s, %s, %s)",
                ["dev-c", DAY, _utc(2026, 10, 16, 12, 0)],
            )
        self.assertEqual(NewPlay.objects.get(device_id="dev-c").game, "wordle")
        # The same device may now hold one play per game for the day.
        NewPlay.objects.create(device_id="dev-a", game="contexto", play_date=DAY)
        self.assertEqual(NewPlay.objects.filter(device_id="dev-a").count(), 2)
