"""Sign-up with one 13+/Terms checkbox (owner decision 2026-10-11): email and Google sign-up, Google
display names from the email's local part, the birth-date prompt at photo upload, and unknown age
treated as teen."""
from datetime import date
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse

from users import consent, leaderboard
from users.tests import GOOGLE_ID, login, png_bytes, signup
from users.views import username_from_email

User = get_user_model()
TICKED = {"accepted_terms": True, "age_confirmed": True}
CONFIRM_MESSAGE = "Please confirm you're 13 or older and agree to the Terms and Privacy Policy."


class EmailSignupCheckboxTests(TestCase):
    def setUp(self):
        cache.clear()

    def post(self, **extra):
        data = {"username": "Hooper", "email": "h@example.com", "password": "Testpass123!", **extra}
        return self.client.post(reverse("signup"), data=data, content_type="application/json")

    def test_the_checkbox_alone_creates_an_account_of_unknown_age(self):
        resp = self.post(**TICKED)
        self.assertEqual(resp.status_code, 201, resp.content)
        user = User.objects.get(email="h@example.com")
        self.assertEqual(user.age_group, "")
        self.assertEqual(user.terms_version, consent.TERMS_VERSION)
        self.assertIsNotNone(user.terms_accepted_at)
        self.assertIsNotNone(user.age_confirmed_at)
        self.assertEqual(user.consent_source, "signup_checkbox")

    def test_without_the_age_confirmation_nothing_is_created(self):
        resp = self.post(accepted_terms=True)
        self.assertEqual((resp.status_code, resp.json()["code"]), (400, "consent_required"))
        self.assertEqual(resp.json()["error"], CONFIRM_MESSAGE)
        self.assertFalse(User.objects.exists())

    def test_without_the_terms_nothing_is_created(self):
        resp = self.post(age_confirmed=True)
        self.assertEqual((resp.status_code, resp.json()["code"]), (400, "consent_required"))
        self.assertFalse(User.objects.exists())

    def test_old_clients_birth_fields_under_13_are_still_blocked(self):
        young = {"birth_year": date.today().year - 10, "birth_month": 1}
        for extra in ({"accepted_terms": True, **young}, {**TICKED, **young}):
            resp = self.post(**extra)
            self.assertEqual((resp.status_code, resp.json()["code"]), (400, "age_requirement"))
        self.assertFalse(User.objects.exists())

    def test_old_clients_birth_fields_still_set_the_age_group(self):
        self.assertEqual(self.post(accepted_terms=True, birth_year=1990, birth_month=6).status_code, 201)
        user = User.objects.get(email="h@example.com")
        self.assertEqual(user.age_group, "adult")
        self.assertEqual(user.consent_source, "signup_birth_date")


class UnknownAgeIsTeenTests(TestCase):
    def setUp(self):
        cache.clear()
        signup(self.client, username="Adult", email="adult@example.com")  # legacy birth fields: adult
        self.client.post(
            reverse("signup"),
            data={"username": "Unknown", "email": "u@example.com", "password": "Testpass123!", **TICKED},
            content_type="application/json",
        )
        self.unknown = User.objects.get(email="u@example.com")
        User.objects.filter(email__in=["adult@example.com", "u@example.com"]).update(points=40)

    def me(self, email):
        token = login(self.client, email).json()["access"]
        return self.client.get(reverse("get_user"), HTTP_AUTHORIZATION=f"Bearer {token}").json()["user"]

    def test_unknown_age_is_teen_for_the_relay(self):
        self.assertTrue(self.me("u@example.com")["is_teen"])
        self.assertFalse(self.me("adult@example.com")["is_teen"])

    def test_unknown_age_is_off_the_public_leaderboard_and_name_search(self):
        names = [row["username"] for row in leaderboard.top()]
        self.assertIn("Adult", names)
        self.assertNotIn("Unknown", names)
        token = login(self.client, "adult@example.com").json()["access"]
        auth = {"HTTP_AUTHORIZATION": f"Bearer {token}"}
        self.assertEqual(self.client.get(reverse("search-users"), {"q": "Unknow"}, **auth).json()["results"], [])
        exact = self.client.get(reverse("search-users"), {"q": self.unknown.public_id}, **auth).json()["results"]
        self.assertEqual([r["id"] for r in exact], [self.unknown.public_id])

    def test_the_private_friends_board_still_shows_the_player(self):
        board, rank, count = leaderboard.friends_board(self.unknown)
        self.assertEqual(([row["username"] for row in board], rank, count), (["Unknown"], 1, 1))

    def test_the_export_says_how_the_age_was_confirmed(self):
        from users.account_data import export_account

        self.assertEqual(export_account(self.unknown)["account"]["consent_source"], "signup_checkbox")


class GoogleSignupCheckboxTests(TestCase):
    def setUp(self):
        cache.clear()

    def verify(self, email=GOOGLE_ID["email"], sub=GOOGLE_ID["sub"]):
        return mock.patch("users.views.verify_google_code", return_value={"sub": sub, "email": email, "name": ""})

    def post(self, **data):
        return self.client.post(reverse("google_login"), data=data, content_type="application/json")

    def test_a_new_google_user_without_the_confirmation_is_not_created(self):
        with self.verify():
            resp = self.post(code="c")
        self.assertEqual(resp.status_code, 428)
        body = resp.json()
        self.assertEqual(body["code"], "needs_signup_consent")
        self.assertTrue(body["consent_token"])
        self.assertFalse(User.objects.exists())

    def test_with_the_confirmation_the_account_is_created_and_consent_stamped(self):
        with self.verify():
            resp = self.post(code="c", **TICKED)
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertTrue(resp.json()["new_account"])
        user = User.objects.get(email=GOOGLE_ID["email"])
        self.assertEqual(user.consent_source, "google_signup_checkbox")
        self.assertEqual(user.terms_version, consent.TERMS_VERSION)
        self.assertIsNotNone(user.age_confirmed_at)
        self.assertEqual(user.age_group, "")

    def test_the_held_token_plus_the_confirmation_creates_the_account(self):
        with self.verify():
            token = self.post(code="c").json()["consent_token"]
        resp = self.post(consent_token=token, **TICKED)
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(User.objects.get(email=GOOGLE_ID["email"]).consent_source, "google_signup_checkbox")

    def test_the_held_token_without_the_confirmation_is_refused(self):
        with self.verify():
            token = self.post(code="c").json()["consent_token"]
        resp = self.post(consent_token=token, accepted_terms=True)
        self.assertEqual((resp.status_code, resp.json()["code"]), (400, "consent_required"))
        self.assertFalse(User.objects.exists())

    def test_an_existing_google_user_logs_in_without_the_confirmation(self):
        User.objects.create_user(username="Fan", email=GOOGLE_ID["email"], password=None, google_sub=GOOGLE_ID["sub"])
        with self.verify():
            resp = self.post(code="c")
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.json()["new_account"])

    def test_the_new_name_comes_from_the_email(self):
        with self.verify(email="runforfun12@gmail.com"):
            self.post(code="c", **TICKED)
        self.assertEqual(User.objects.get(email="runforfun12@gmail.com").username, "runforfun12")


class UsernameFromEmailTests(TestCase):
    def test_a_free_valid_local_part_is_used_as_is_without_digits(self):
        self.assertEqual(username_from_email("hooper@example.com"), "hooper")

    def test_characters_the_rules_forbid_are_dropped(self):
        self.assertEqual(username_from_email("jo.hn-doe@example.com"), "johndoe")
        self.assertEqual(username_from_email("josé_luis@example.com"), "jose_luis")

    def test_a_plus_tag_is_not_part_of_the_name(self):
        self.assertEqual(username_from_email("hooper+nba@example.com"), "hooper")

    def test_a_long_local_part_is_cut_to_twenty(self):
        self.assertEqual(username_from_email("a" * 30 + "@example.com"), "a" * 20)

    def test_a_taken_name_gets_digits(self):
        User.objects.create_user(username="Hooper", email="other@example.com", password="x")
        name = username_from_email("hooper@example.com")
        self.assertRegex(name, r"^hooper\d{4}$")

    def test_a_taken_twenty_character_name_stays_within_the_limit(self):
        User.objects.create_user(username="b" * 20, email="other@example.com", password="x")
        name = username_from_email("b" * 20 + "@example.com")
        self.assertRegex(name, r"^b{16}\d{4}$")

    def test_a_too_short_name_gets_digits(self):
        self.assertRegex(username_from_email("ab@example.com"), r"^ab\d{4}$")

    def test_nothing_usable_falls_back_to_player(self):
        self.assertRegex(username_from_email("...@example.com"), r"^Player\d{4}$")

    def test_a_reserved_or_blocked_name_falls_back_to_player(self):
        self.assertRegex(username_from_email("admin@example.com"), r"^Player\d{4}$")
        self.assertRegex(username_from_email("swishquest@example.com"), r"^Player\d{4}$")

    def test_retries_are_bounded_when_every_candidate_is_taken(self):
        with mock.patch("users.views._username_taken", return_value=True):
            self.assertRegex(username_from_email("hooper@example.com"), r"^Player\d{6}$")


@override_settings(MODERATION_REQUIRED=False, IMAGE_MODERATION_URL=None)
class PhotoAgePromptTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client.post(
            reverse("signup"),
            data={"username": "Hooper", "email": "h@example.com", "password": "Testpass123!", **TICKED},
            content_type="application/json",
        )
        self.auth = {"HTTP_AUTHORIZATION": f"Bearer {login(self.client, 'h@example.com').json()['access']}"}

    def upload(self):
        photo = SimpleUploadedFile("p.png", png_bytes(), content_type="image/png")
        return self.client.post(reverse("update"), data={"profile_photo": photo}, **self.auth)

    def give_age(self, **data):
        return self.client.post(reverse("account_age"), data=data, content_type="application/json", **self.auth)

    def test_an_upload_of_unknown_age_asks_for_the_birth_date(self):
        resp = self.upload()
        self.assertEqual((resp.status_code, resp.json()["code"]), (428, "age_required"))
        self.assertIsNone(User.objects.get(email="h@example.com").profile_photo_data)

    def test_sixteen_or_over_unlocks_the_upload(self):
        resp = self.give_age(birth_year=1990, birth_month=6)
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertFalse(resp.json()["user"]["is_teen"])
        self.assertEqual(User.objects.get(email="h@example.com").age_group, "adult")
        with self.assertLogs("users.photo_moderation", level="WARNING"):
            self.assertEqual(self.upload().status_code, 200)

    def test_under_sixteen_gets_the_existing_photo_message(self):
        resp = self.give_age(birth_year=date.today().year - 14, birth_month=1)
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()["user"]["is_teen"])
        upload = self.upload()
        self.assertEqual(upload.status_code, 403)
        self.assertEqual(upload.json()["error"], f"Profile photos are available from age {consent.PHOTO_MIN_AGE}.")

    def test_the_age_can_only_be_given_once(self):
        self.give_age(birth_year=date.today().year - 14, birth_month=1)
        again = self.give_age(birth_year=1990, birth_month=6)
        self.assertEqual(again.status_code, 409)
        self.assertEqual(User.objects.get(email="h@example.com").age_group, "teen")

    def test_a_missing_or_impossible_date_is_refused(self):
        for bad in ({}, {"birth_year": 1990}, {"birth_year": "x", "birth_month": 6}, {"birth_year": 1990, "birth_month": 13}):
            self.assertEqual(self.give_age(**bad).status_code, 400)
        self.assertEqual(User.objects.get(email="h@example.com").age_group, "")

    def test_the_birth_date_itself_is_not_stored(self):
        self.give_age(birth_year=1990, birth_month=6)
        self.assertFalse(any("birth" in f.name for f in User._meta.get_fields()))

    def test_an_account_with_a_known_age_uploads_unchanged(self):
        User.objects.filter(email="h@example.com").update(age_group="adult")
        with self.assertLogs("users.photo_moderation", level="WARNING"):
            self.assertEqual(self.upload().status_code, 200)
