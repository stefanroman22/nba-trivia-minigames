"""Points may only be earned by finishing a game — never claimed by the client.

These lock in AUTH-6 and AUTH-10. Until 2026-08-29 the browser told the backend how
many points it deserved and the backend added them, so a single request could top
the leaderboard. Each test below fails if that door reopens.
"""
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import Client, TestCase

from trivia.models import GameSession
from trivia.views import MAX_SESSION_POINTS

User = get_user_model()


class ScoreAwardTests(TestCase):
    def setUp(self):
        # Throttle counters live in the cache and would leak between tests.
        cache.clear()
        self.user = User.objects.create_user(
            username="Baller", email="baller@example.com", password="Str0ng!Passw0rd"
        )
        self.client = Client()
        tokens = self.client.post(
            "/api/login/",
            {"id": "baller@example.com", "password": "Str0ng!Passw0rd"},
            content_type="application/json",
        ).json()
        self.auth = {"HTTP_AUTHORIZATION": f"Bearer {tokens['access']}"}

    def tearDown(self):
        cache.clear()

    def _finish(self, **overrides):
        body = {"game": "wordle", "mode": "single", "score": 250, "duration_ms": 5000}
        body.update(overrides)
        return self.client.post(
            "/trivia/log-session/", body, content_type="application/json", **self.auth
        )

    def points(self):
        return User.objects.get(pk=self.user.pk).points

    def test_update_profile_refuses_client_supplied_points(self):
        """The original vulnerability: naming your own total."""
        res = self.client.post(
            "/api/update-profile/",
            {"points": 999_999_999},
            content_type="application/json",
            **self.auth,
        )
        self.assertEqual(res.status_code, 400)
        self.assertEqual(self.points(), 0)

    def test_update_profile_still_updates_username(self):
        res = self.client.post(
            "/api/update-profile/",
            {"username": "NewName"},
            content_type="application/json",
            **self.auth,
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(User.objects.get(pk=self.user.pk).username, "NewName")

    def test_finishing_a_game_awards_its_score(self):
        res = self._finish(score=250)
        self.assertEqual(res.json()["awarded"], 250)
        self.assertEqual(self.points(), 250)
        # The award is backed by an audit row.
        self.assertEqual(GameSession.objects.filter(user=self.user, score=250).count(), 1)

    def test_inflated_score_is_clamped(self):
        res = self._finish(score=999_999_999)
        self.assertEqual(res.json()["awarded"], MAX_SESSION_POINTS)
        self.assertEqual(self.points(), MAX_SESSION_POINTS)

    def test_multiplayer_results_award_nothing(self):
        """AUTH-7: a win or loss online never touches account points."""
        res = self._finish(mode="match", score=300)
        self.assertEqual(res.json()["awarded"], 0)
        self.assertEqual(self.points(), 0)

    def test_guests_are_awarded_nothing_but_still_logged(self):
        res = Client().post(
            "/trivia/log-session/",
            {"game": "wordle", "mode": "single", "score": 100, "duration_ms": 900},
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["awarded"], 0)
        self.assertEqual(GameSession.objects.filter(user=None, score=100).count(), 1)

    def test_non_numeric_score_does_not_error(self):
        res = self._finish(score="lots")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["awarded"], 0)

    def test_score_submission_is_rate_limited(self):
        """AUTH-10: bounds how fast a forged score can be replayed."""
        codes = [self._finish(score=1).status_code for _ in range(62)]
        self.assertIn(429, codes, "score submission must be throttled")
        self.assertEqual(codes.count(200), 60)


class LoginThrottleTests(TestCase):
    def setUp(self):
        cache.clear()
        User.objects.create_user(
            username="Victim", email="victim@example.com", password="Str0ng!Passw0rd"
        )

    def tearDown(self):
        cache.clear()

    def test_password_guessing_is_throttled(self):
        client = Client()
        codes = [
            client.post(
                "/api/login/",
                {"id": "victim@example.com", "password": f"guess{i}"},
                content_type="application/json",
            ).status_code
            for i in range(33)
        ]
        self.assertEqual(codes.count(401), 30)
        self.assertIn(429, codes)

    def test_a_normal_login_is_unaffected(self):
        res = Client().post(
            "/api/login/",
            {"id": "victim@example.com", "password": "Str0ng!Passw0rd"},
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 200)
