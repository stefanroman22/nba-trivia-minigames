from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from django.urls import reverse

from users.tests import login, png_bytes, signup

User = get_user_model()


class RemovePhotoTests(TestCase):
    def setUp(self):
        cache.clear()
        signup(self.client, username="Ann", email="ann@example.com")
        self.user = User.objects.get(email="ann@example.com")
        User.objects.filter(pk=self.user.pk).update(profile_photo_data=png_bytes(), profile_photo_version=3)
        self.token = login(self.client, "ann@example.com").json()["access"]

    def test_requires_sign_in(self):
        self.assertEqual(self.client.post(reverse("account_remove_photo")).status_code, 401)

    def test_removing_the_photo_clears_it_everywhere(self):
        resp = self.client.post(reverse("account_remove_photo"), HTTP_AUTHORIZATION=f"Bearer {self.token}")
        self.assertEqual(resp.status_code, 200)
        self.assertIsNone(resp.json()["user"]["profile_photo"])
        self.user.refresh_from_db()
        self.assertFalse(self.user.profile_photo_data)
        self.assertEqual(self.user.profile_photo_version, 0)
        public = self.client.get(reverse("profile-photo", args=[self.user.public_id]) + "?v=3")
        self.assertEqual(public.status_code, 404)
