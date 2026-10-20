"""The birth month + year can be given twice in all: the first time and one change (Profile settings)."""
import datetime

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from users.consent import age_sets_left

User = get_user_model()
THIS_YEAR = datetime.date.today().year


class ChangeAgeTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="Fan", email="fan@example.com", password="x")
        self.client = APIClient()

    def post(self, year, month=6):
        # A request loads the account fresh from the database; so does this one (rows are changed with update()).
        self.client.force_authenticate(User.objects.get(pk=self.user.pk))
        return self.client.post("/api/account/age/", {"birth_month": month, "birth_year": year}, format="json")

    def row(self):
        return User.objects.get(pk=self.user.pk)

    def test_the_first_set_is_allowed_and_the_month_and_year_are_kept(self):
        resp = self.post(THIS_YEAR - 30, month=3)
        self.assertEqual(resp.status_code, 200, resp.content)
        user = self.row()
        self.assertEqual((user.age_group, user.birth_month, user.birth_year, user.age_sets), ("adult", 3, THIS_YEAR - 30, 1))
        body = resp.json()["user"]
        self.assertEqual((body["birth_month"], body["birth_year"], body["age_sets_left"]), (3, THIS_YEAR - 30, 1))

    def test_one_change_is_allowed_then_it_is_locked(self):
        self.assertEqual(self.post(THIS_YEAR - 30).status_code, 200)
        resp = self.post(THIS_YEAR - 14)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual((self.row().age_group, self.row().age_sets), ("teen", 2))
        self.assertEqual(resp.json()["user"]["age_sets_left"], 0)
        third = self.post(THIS_YEAR - 40)
        self.assertEqual(third.status_code, 409)
        self.assertIn("twice", third.json()["error"])
        self.assertEqual((self.row().age_group, self.row().birth_year), ("teen", THIS_YEAR - 14))

    def test_an_age_set_before_counting_began_has_one_change_left(self):
        User.objects.filter(pk=self.user.pk).update(age_group="adult")  # no age_sets, no birth month/year stored
        self.assertEqual(age_sets_left(self.row()), 1)
        self.assertEqual(self.post(THIS_YEAR - 14).status_code, 200)
        self.assertEqual(self.post(THIS_YEAR - 40).status_code, 409)

    def test_changing_to_under_16_removes_the_photo(self):
        User.objects.filter(pk=self.user.pk).update(age_group="adult", age_sets=1, profile_photo_data=b"jpeg", profile_photo_version=3)
        self.assertEqual(self.post(THIS_YEAR - 14).status_code, 200)
        user = self.row()
        self.assertEqual((user.profile_photo_version, user.profile_photo_data), (0, None))

    def test_staying_16_plus_keeps_the_photo(self):
        User.objects.filter(pk=self.user.pk).update(age_group="adult", age_sets=1, profile_photo_data=b"jpeg", profile_photo_version=3)
        self.assertEqual(self.post(THIS_YEAR - 40).status_code, 200)
        self.assertEqual(self.row().profile_photo_version, 3)

    def test_a_missing_or_future_date_is_refused_and_does_not_use_a_set(self):
        self.client.force_authenticate(self.user)
        self.assertEqual(self.client.post("/api/account/age/", {}, format="json").status_code, 400)
        self.assertEqual(self.post(THIS_YEAR + 1).status_code, 400)
        user = self.row()
        self.assertEqual((user.age_group, user.age_sets), ("", 0))

    def test_signed_out_is_refused(self):
        self.assertIn(APIClient().post("/api/account/age/", {"birth_month": 1, "birth_year": 1990}, format="json").status_code, (401, 403))
