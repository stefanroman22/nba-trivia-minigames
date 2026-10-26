"""Sign-up with no age check (owner decision 2026-10-11, pre-launch; removed from the app 2026-10-26):
the Terms are agreed by the text under the buttons, email sign-up needs only `accepted_terms`, Google
creates a new account in one step, older clients' age fields are ignored, nobody is a teen and there is
no age endpoint. Also the generated Google display names (email name + 2 digits)."""
from datetime import date
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from django.urls import reverse

from users import consent
from users.moderation_text import check_username
from users.tests import GOOGLE_ID, login
from users.tokens import issue_session_tokens
from users.views import GOOGLE_NAME_WORDS, USERNAME_RE, generated_username

User = get_user_model()
TERMS_MESSAGE = "Please agree to the Terms of Service and Privacy Policy."
OLD_CLIENT = {"accepted_terms": True, "age_confirmed": True}


class EmailSignupTests(TestCase):
    def setUp(self):
        cache.clear()

    def post(self, **extra):
        data = {"username": "Hooper", "email": "h@example.com", "password": "Testpass123!", **extra}
        return self.client.post(reverse("signup"), data=data, content_type="application/json")

    def test_agreeing_to_the_terms_alone_creates_the_account(self):
        resp = self.post(accepted_terms=True)
        self.assertEqual(resp.status_code, 201, resp.content)
        user = User.objects.get(email="h@example.com")
        self.assertEqual(user.terms_version, consent.TERMS_VERSION)
        self.assertIsNotNone(user.terms_accepted_at)
        self.assertEqual(user.consent_source, "signup_text")
        # No age is asked, so none is recorded.
        self.assertIsNone(user.age_confirmed_at)
        self.assertEqual((user.age_group, user.birth_month, user.birth_year, user.age_sets), ("", None, None, 0))

    def test_without_the_terms_nothing_is_created(self):
        resp = self.post(age_confirmed=True)
        self.assertEqual((resp.status_code, resp.json()["code"]), (400, "consent_required"))
        self.assertEqual(resp.json()["error"], TERMS_MESSAGE)
        self.assertFalse(User.objects.exists())

    def test_an_old_client_sending_age_confirmed_still_signs_up(self):
        self.assertEqual(self.post(**OLD_CLIENT).status_code, 201)
        user = User.objects.get(email="h@example.com")
        self.assertEqual((user.consent_source, user.age_group), ("signup_text", ""))
        self.assertIsNone(user.age_confirmed_at)

    def test_an_old_clients_birth_fields_are_ignored(self):
        young = {"birth_year": date.today().year - 10, "birth_month": 1}
        self.assertEqual(self.post(accepted_terms=True, **young).status_code, 201)
        user = User.objects.get(email="h@example.com")
        self.assertEqual((user.age_group, user.birth_month, user.birth_year), ("", None, None))

    def test_the_export_says_how_the_terms_were_agreed(self):
        from users.account_data import export_account

        self.post(accepted_terms=True)
        self.assertEqual(export_account(User.objects.get(email="h@example.com"))["account"]["consent_source"], "signup_text")
        self.assertEqual(login(self.client, "h@example.com").status_code, 200)


class GoogleOneStepTests(TestCase):
    def setUp(self):
        cache.clear()

    def verify(self, email=GOOGLE_ID["email"], sub=GOOGLE_ID["sub"]):
        return mock.patch("users.views.verify_google_code", return_value={"sub": sub, "email": email, "name": ""})

    def post(self, **data):
        return self.client.post(reverse("google_login"), data=data, content_type="application/json")

    def test_a_new_google_user_is_created_with_the_code_alone(self):
        with self.verify():
            resp = self.post(code="c")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertTrue(resp.json()["new_account"])
        user = User.objects.get(email=GOOGLE_ID["email"])
        self.assertEqual(user.consent_source, "google_continue")
        self.assertEqual(user.terms_version, consent.TERMS_VERSION)
        self.assertIsNotNone(user.terms_accepted_at)
        self.assertIsNone(user.age_confirmed_at)
        self.assertEqual(user.age_group, "")

    def test_an_old_client_sending_the_tick_box_fields_gets_the_same(self):
        with self.verify():
            resp = self.post(code="c", birth_year=date.today().year - 10, birth_month=1, **OLD_CLIENT)
        self.assertEqual(resp.status_code, 200, resp.content)
        user = User.objects.get(email=GOOGLE_ID["email"])
        self.assertEqual((user.consent_source, user.age_group), ("google_continue", ""))

    def test_an_existing_google_user_logs_in_and_keeps_their_consent_record(self):
        User.objects.create_user(username="Fan", email=GOOGLE_ID["email"], password=None, google_sub=GOOGLE_ID["sub"])
        with self.verify():
            resp = self.post(code="c")
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.json()["new_account"])
        self.assertEqual(User.objects.get(email=GOOGLE_ID["email"]).consent_source, "")

    def test_the_new_name_is_the_email_name_plus_two_digits(self):
        with self.verify(email="runforfun12@gmail.com"):
            resp = self.post(code="c")
        name = User.objects.get(email="runforfun12@gmail.com").username
        self.assertRegex(name, r"^runforfun12\d{2}$")
        self.assertEqual(resp.json()["user"]["username"], name)


class NobodyIsATeenTests(TestCase):
    """Accounts an earlier sign-up flagged "teen" or "adult", or of unknown age, are all the same."""

    def auth(self, user):
        return {"HTTP_AUTHORIZATION": f"Bearer {issue_session_tokens(user).access_token}"}

    def test_me_says_nobody_is_a_teen_and_sends_no_age(self):
        for i, group in enumerate(("adult", "teen", "")):
            user = User.objects.create_user(username=f"P{i}", email=f"p{i}@example.com", password="x", age_group=group)
            me = self.client.get(reverse("get_user"), **self.auth(user)).json()["user"]
            self.assertIs(me["is_teen"], False)
            self.assertFalse({"age_group", "birth_month", "birth_year", "age_sets_left"} & set(me))

    def test_the_age_endpoint_is_gone(self):
        user = User.objects.create_user(username="Fan", email="fan@example.com", password="x")
        resp = self.client.post("/api/account/age/", {"birth_month": 1, "birth_year": 1990}, content_type="application/json", **self.auth(user))
        self.assertEqual(resp.status_code, 404)
        user.refresh_from_db()
        self.assertEqual((user.age_group, user.birth_month, user.birth_year, user.age_sets), ("", None, None, 0))


GENERATED = r"^(%s)\d{2}$" % "|".join(GOOGLE_NAME_WORDS)


class GeneratedUsernameTests(TestCase):
    def test_every_word_makes_a_valid_name_that_passes_moderation(self):
        for word in GOOGLE_NAME_WORDS:
            for digits in ("00", "42", "99"):
                name = f"{word}{digits}"
                self.assertRegex(name, USERNAME_RE)
                self.assertEqual(check_username(name).tier, "ok", name)
        self.assertRegex("Player000000", USERNAME_RE)
        self.assertEqual(check_username("Player000000").tier, "ok")

    def test_a_generated_name_without_an_email_is_a_word_plus_two_digits_and_free(self):
        name = generated_username()
        self.assertRegex(name, GENERATED)
        self.assertFalse(User.objects.filter(username__iexact=name).exists())

    def test_the_email_name_gets_two_digits_before_a_plus_tag_and_without_accents(self):
        self.assertRegex(generated_username("josé_luis+nba@gmail.com"), r"^jose_luis\d{2}$")

    def test_a_long_email_name_is_cut_to_leave_room_for_two_digits(self):
        name = generated_username("a" * 30 + "@gmail.com")
        self.assertRegex(name, r"^a{18}\d{2}$")
        self.assertRegex(name, USERNAME_RE)

    def test_a_taken_email_name_gets_another_number(self):
        for n in range(100):  # every number but 57 is taken
            if n != 57:
                User.objects.create_user(username=f"hooper{n:02d}", email=f"h{n}@example.com", password="x")
        self.assertEqual(generated_username("hooper@gmail.com"), "hooper57")

    def test_taken_is_case_insensitive(self):
        for n in range(100):
            if n != 3:
                User.objects.create_user(username=f"HOOPER{n:02d}", email=f"h{n}@example.com", password="x")
        self.assertEqual(generated_username("hooper@gmail.com"), "hooper03")

    def test_all_hundred_numbers_taken_falls_back_to_a_word(self):
        for n in range(100):
            User.objects.create_user(username=f"hooper{n:02d}", email=f"h{n}@example.com", password="x")
        self.assertRegex(generated_username("hooper@gmail.com"), GENERATED)

    def test_an_unusable_email_name_falls_back_to_a_word(self):
        for email in ("ab@gmail.com", "1234567@gmail.com", "@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@", "", "...@gmail.com"):
            self.assertRegex(generated_username(email), GENERATED, email)

    def test_an_email_name_that_fails_moderation_falls_back_to_a_word(self):
        with mock.patch("users.views.check_username", return_value=mock.Mock(tier="blocked")):
            self.assertRegex(generated_username("someone@gmail.com"), r"^Player\d{4}$")

    def test_retries_are_bounded_then_fall_back_to_player(self):
        with mock.patch("users.views._username_usable", return_value=False), mock.patch(
            "users.views._username_taken", return_value=True
        ):
            self.assertRegex(generated_username("someone@gmail.com"), r"^Player\d{6}$")


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
