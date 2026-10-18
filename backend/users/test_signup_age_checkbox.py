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
from users.moderation_text import check_username
from users.views import GOOGLE_NAME_WORDS, USERNAME_RE, generated_username

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

    def test_unknown_age_is_on_the_public_leaderboard_and_in_name_search(self):
        names = [row["username"] for row in leaderboard.top()]
        self.assertIn("Adult", names)
        self.assertIn("Unknown", names)
        token = login(self.client, "adult@example.com").json()["access"]
        auth = {"HTTP_AUTHORIZATION": f"Bearer {token}"}
        found = self.client.get(reverse("search-users"), {"q": "Unknow"}, **auth).json()["results"]
        self.assertEqual([r["id"] for r in found], [self.unknown.public_id])

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

    def test_the_new_name_is_generated_and_never_from_the_email(self):
        with self.verify(email="runforfun12@gmail.com"):
            resp = self.post(code="c", **TICKED)
        name = User.objects.get(email="runforfun12@gmail.com").username
        self.assertRegex(name, GENERATED)
        self.assertNotIn("runforfun", name.lower())
        self.assertEqual(resp.json()["user"]["username"], name)


GENERATED = r"^(%s)\d{4}$" % "|".join(GOOGLE_NAME_WORDS)


class GeneratedUsernameTests(TestCase):
    def test_every_word_makes_a_valid_name_that_passes_moderation(self):
        for word in GOOGLE_NAME_WORDS:
            for digits in ("0000", "1234", "9999"):
                name = f"{word}{digits}"
                self.assertRegex(name, USERNAME_RE)
                self.assertEqual(check_username(name).tier, "ok", name)
        self.assertRegex("Player000000", USERNAME_RE)
        self.assertEqual(check_username("Player000000").tier, "ok")

    def test_a_generated_name_is_valid_and_free(self):
        name = generated_username()
        self.assertRegex(name, GENERATED)
        self.assertFalse(User.objects.filter(username__iexact=name).exists())

    def test_a_taken_candidate_is_retried(self):
        with mock.patch("users.views._username_taken", side_effect=[True, False]) as taken:
            self.assertRegex(generated_username(), GENERATED)
        self.assertEqual(taken.call_count, 2)

    def test_retries_are_bounded_then_fall_back_to_player(self):
        with mock.patch("users.views._username_taken", return_value=True):
            self.assertRegex(generated_username(), r"^Player\d{6}$")


class RenameEmailDerivedNamesTests(TestCase):
    def google_user(self, username, email, sub):
        return User.objects.create_user(username=username, email=email, password=None, google_sub=sub)

    def test_email_derived_names_are_renamed_to_generated_ones(self):
        from django.core.management import call_command

        derived = [
            self.google_user("runforfun12", "runforfun12@gmail.com", "s1"),  # the local part
            self.google_user("hooper", "hooper+nba@gmail.com", "s2"),  # local part before a +tag
            self.google_user("jose_luis", "josé_luis@gmail.com", "s3"),  # accents stripped
            self.google_user("dunkmaster4821", "dunkmaster@gmail.com", "s4"),  # local part + 4 digits
        ]
        kept = [
            self.google_user("Baller1234", "someone@gmail.com", "s5"),
            User.objects.create_user(username="hooper", email="hooper@example.com", password="x"),  # not Google
        ]
        call_command("rename_email_derived_names", "--yes", stdout=__import__("io").StringIO())
        for user in derived:
            user.refresh_from_db()
            self.assertRegex(user.username, GENERATED)
        for user in kept:
            before = user.username
            user.refresh_from_db()
            self.assertEqual(user.username, before)