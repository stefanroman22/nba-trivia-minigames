from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from trivia.models import Mvp

User = get_user_model()


class AdminApiTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create_user(
            username="admin", email="admin@test.dev", password="x", is_staff=True
        )
        cls.player = User.objects.create_user(
            username="player", email="player@test.dev", password="x"
        )
        Mvp.objects.create(season="1996-97", mvp="Karl Malone", team="Utah Jazz", team_logo_url="")
        Mvp.objects.create(season="1997-98", mvp="Michael Jordan", team="Chicago Bulls", team_logo_url="")

    def setUp(self):
        self.api = APIClient()

    def test_anonymous_and_non_admin_are_rejected(self):
        for url in ("/api/admin/games/", "/api/admin/source-rows/?key=db:mvp"):
            self.assertIn(self.api.get(url).status_code, (401, 403))
        self.api.force_authenticate(self.player)
        for url in ("/api/admin/games/", "/api/admin/source-rows/?key=db:mvp"):
            self.assertEqual(self.api.get(url).status_code, 403)

    def test_games_overview(self):
        self.api.force_authenticate(self.admin)
        res = self.api.get("/api/admin/games/")
        self.assertEqual(res.status_code, 200)
        body = res.json()
        ids = [g["id"] for g in body["games"]]
        self.assertIn("series-winner", ids)
        self.assertIn("who-would-win", ids)  # backend-only game is surfaced
        self.assertNotIn("coming-soon", ids)
        mvps = next(g for g in body["games"] if g["id"] == "guess-mvps")
        db_source = next(s for s in mvps["sources"] if s["kind"] == "db")
        self.assertEqual(db_source["count"], 2)
        self.assertIn("season", db_source["fields"])
        self.assertTrue(body["shared"])

    def test_source_rows_db_with_search(self):
        self.api.force_authenticate(self.admin)
        res = self.api.get("/api/admin/source-rows/", {"key": "db:mvp", "q": "jordan"})
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["total"], 1)
        self.assertEqual(body["rows"][0]["mvp"], "Michael Jordan")

    def test_source_rows_rejects_bad_keys(self):
        self.api.force_authenticate(self.admin)
        self.assertEqual(self.api.get("/api/admin/source-rows/", {"key": "db:nope"}).status_code, 404)
        self.assertEqual(self.api.get("/api/admin/source-rows/", {"key": "pool:manifest"}).status_code, 400)
        self.assertEqual(self.api.get("/api/admin/source-rows/", {"key": "junk"}).status_code, 400)
