"""Admin player search (users.player_search): admin-only, parameterised, never returns email."""
from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

User = get_user_model()

INJECTION = "%' UNION SELECT id, username, password FROM users_customuser--"


class PlayerSearchTests(TestCase):
    def setUp(self):
        self.api = APIClient()
        self.alice = User.objects.create_user(email="alice@example.com", username="alice", password="pw-12345")
        self.bob = User.objects.create_user(email="bob@example.com", username="bob", password="pw-12345")
        self.admin = User.objects.create_user(
            email="admin@example.com", username="boss", password="pw-12345", is_staff=True
        )
        self.player = User.objects.create_user(email="p@example.com", username="player", password="pw-12345")

    def _get(self, q=None):
        params = {} if q is None else {"q": q}
        return self.api.get(reverse("player_search"), params)

    def test_anonymous_is_rejected(self):
        self.assertIn(self._get().status_code, (401, 403))
        self.assertIn(self._get("ali").status_code, (401, 403))

    def test_non_admin_is_rejected(self):
        self.api.force_authenticate(self.player)
        self.assertEqual(self._get("ali").status_code, 403)

    def test_admin_search_filters_by_username(self):
        self.api.force_authenticate(self.admin)
        res = self._get("ali")
        self.assertEqual(res.status_code, 200)
        self.assertEqual([r["username"] for r in res.json()], ["alice"])

    def test_response_has_no_email(self):
        self.api.force_authenticate(self.admin)
        res = self._get()
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.json()), User.objects.count())
        body = res.content.decode()
        for row in res.json():
            self.assertNotIn("email", row)
        for u in User.objects.all():
            self.assertNotIn(u.email, body)

    def test_injection_is_a_literal_search_string(self):
        self.api.force_authenticate(self.admin)
        res = self._get(INJECTION)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), [])
        body = res.content.decode()
        for u in User.objects.all():
            self.assertNotIn(u.password, body)
