import tempfile
from io import StringIO

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import TestCase, override_settings
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


class AdminEmailIdentityTests(TestCase):
    """Case-insensitive email is the login identity — the admin paths honour it too."""

    ADD_URL = "/admin/users/customuser/add/"
    # Smallest valid GIF — the admin's add-user form asks for a profile photo.
    GIF = bytes.fromhex(
        "47494638376101000100810000ff00000000000000000000002c0000"
        "00000100010000080400010404003b"
    )

    @classmethod
    def setUpTestData(cls):
        cls.root = User.objects.create_superuser(
            username="root", email="root@test.dev", password="Testpass123!"
        )
        cls.existing = User.objects.create_user(
            username="taken", email="foo@bar.com", password="Testpass123!"
        )

    def _add_user(self, **overrides):
        """POST the admin panel's user-create form as a superuser."""
        data = {
            "username": "newplayer",
            "email": "Foo@Bar.com",
            "password1": "Sup3rSecret!23",
            "password2": "Sup3rSecret!23",
            "points": 0,
            "rank": "Rookie",
            "profile_photo": SimpleUploadedFile("p.gif", self.GIF, content_type="image/gif"),
            "is_active": "on",
            **overrides,
        }
        self.client.force_login(self.root)
        with tempfile.TemporaryDirectory() as media:
            with override_settings(MEDIA_ROOT=media):
                return self.client.post(self.ADD_URL, data)

    def test_add_form_rejects_an_email_differing_only_in_case(self):
        res = self._add_user(email="Foo@Bar.com")
        self.assertEqual(res.status_code, 200)  # form redisplayed, nothing saved
        self.assertIn("email", res.context["adminform"].form.errors)
        self.assertEqual(User.objects.filter(email__iexact="foo@bar.com").count(), 1)

    def test_add_form_stores_the_email_lowercased(self):
        res = self._add_user(username="freshplayer", email="MiXeD@Case.com")
        self.assertEqual(res.status_code, 302)
        self.assertTrue(User.objects.filter(email="mixed@case.com").exists())

    def test_promote_admin_finds_the_account_case_insensitively(self):
        call_command("promote_admin", "FOO@BAR.COM", stdout=StringIO())
        self.existing.refresh_from_db()
        self.assertTrue(self.existing.is_staff)
        self.assertTrue(self.existing.is_superuser)
