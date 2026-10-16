"""Sign-up password validation: a non-text password is a 400 (never a 500), and a password too similar to
the username/email is refused by Django's UserAttributeSimilarityValidator."""
import re

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from django.urls import reverse

User = get_user_model()
TICKED = {"accepted_terms": True, "age_confirmed": True}


class SignupPasswordValidationTests(TestCase):
    def setUp(self):
        cache.clear()

    def post(self, **overrides):
        data = {"username": "Hooper", "email": "h@example.com", "password": "Testpass123!", **TICKED, **overrides}
        return self.client.post(reverse("signup"), data=data, content_type="application/json")

    def test_numeric_password_is_a_400_with_a_message(self):
        resp = self.post(password=12345678)
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertTrue(resp.json()["error"])
        self.assertFalse(User.objects.exists())

    def test_boolean_password_is_a_400_with_a_message(self):
        resp = self.post(password=True)
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertTrue(resp.json()["error"])
        self.assertFalse(User.objects.exists())

    def test_password_equal_to_username_is_refused_and_creates_nothing(self):
        resp = self.post(username="Hooper2024x", password="Hooper2024x")
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertRegex(resp.json()["error"], re.compile(r"too similar to the (username|email)", re.I))
        self.assertFalse(User.objects.filter(email="h@example.com").exists())

    def test_a_normal_password_still_signs_up(self):
        resp = self.post()
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertTrue(User.objects.filter(email="h@example.com").exists())
