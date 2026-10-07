"""Consent at sign-up, account deletion and data export."""
from datetime import date
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from django.urls import reverse
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken

from trivia.models import Feedback, GameSession, GuessLog, WordlePlay
from users import consent
from users.models import BlockedUser, FriendRequest, Friendship, ModerationEvent
from users.tests import GOOGLE_ID, google, login, signup

User = get_user_model()
OK = {"accepted_terms": True, "birth_year": 1990, "birth_month": 6}


class AgeCheckTests(TestCase):
    TODAY = date(2026, 10, 7)

    def old_enough(self, year, month):
        return consent.is_old_enough(year, month, self.TODAY)

    def test_clearly_adult_and_clearly_young(self):
        self.assertTrue(self.old_enough(1990, 6))
        self.assertFalse(self.old_enough(2015, 1))

    def test_the_sixteenth_birthday_month_counts_only_from_its_last_day(self):
        # Born October 2010: turns 16 sometime in October 2026. The day is unknown, so the
        # younger reading applies and they pass only on 31 October.
        self.assertFalse(consent.is_old_enough(2010, 10, date(2026, 10, 30)))
        self.assertTrue(consent.is_old_enough(2010, 10, date(2026, 10, 31)))
        self.assertTrue(consent.is_old_enough(2010, 9, self.TODAY))

    def test_leap_february_and_garbage_input(self):
        self.assertTrue(consent.is_old_enough(2008, 2, date(2024, 2, 29)))
        for bad in ((None, 1), ("x", 1), (2000, 0), (2000, 13), (1800, 6), (2999, 1)):
            self.assertFalse(consent.is_old_enough(*bad, self.TODAY))


class SignupConsentTests(TestCase):
    def setUp(self):
        cache.clear()

    def post(self, **extra):
        data = {"username": "Hooper", "email": "h@example.com", "password": "Testpass123!", **extra}
        return self.client.post(reverse("signup"), data=data, content_type="application/json")

    def test_signup_without_agreeing_is_refused(self):
        resp = self.post(birth_year=1990, birth_month=6)
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()["code"], "consent_required")
        self.assertFalse(User.objects.exists())

    def test_underage_signup_is_refused_without_saying_why(self):
        resp = self.post(accepted_terms=True, birth_year=date.today().year - 10, birth_month=1)
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()["code"], "age_requirement")
        self.assertNotIn("16", resp.json()["error"])
        self.assertFalse(User.objects.exists())

    def test_signup_records_consent_but_not_the_birth_date(self):
        self.assertEqual(self.post(**OK).status_code, 201)
        user = User.objects.get(email="h@example.com")
        self.assertEqual(user.terms_version, consent.TERMS_VERSION)
        self.assertIsNotNone(user.terms_accepted_at)
        self.assertIsNotNone(user.age_confirmed_at)
        self.assertFalse(any("birth" in f.name for f in User._meta.get_fields()))


class GoogleConsentTests(TestCase):
    def setUp(self):
        cache.clear()

    def verify(self):
        return mock.patch("users.views.verify_google_code", return_value=GOOGLE_ID)

    def post_google(self, **data):
        return self.client.post(reverse("google_login"), data=data, content_type="application/json")

    def test_new_google_account_needs_consent_then_completes_with_the_token(self):
        with self.verify():
            first = self.post_google(code="c")
        self.assertEqual(first.status_code, 428)
        body = first.json()
        self.assertEqual(body["code"], "consent_required")
        self.assertFalse(User.objects.exists())

        second = self.post_google(consent_token=body["consent_token"], **OK)
        self.assertEqual(second.status_code, 200)
        self.assertTrue(second.json()["new_account"])
        self.assertEqual(User.objects.get(email=GOOGLE_ID["email"]).terms_version, consent.TERMS_VERSION)

    def test_consent_step_refuses_underage_and_unticked_requests(self):
        with self.verify():
            token = self.post_google(code="c").json()["consent_token"]
        under = self.post_google(consent_token=token, accepted_terms=True, birth_year=date.today().year - 12, birth_month=3)
        self.assertEqual((under.status_code, under.json()["code"]), (400, "age_requirement"))
        unticked = self.post_google(consent_token=token, birth_year=1990, birth_month=6)
        self.assertEqual((unticked.status_code, unticked.json()["code"]), (400, "consent_required"))
        self.assertFalse(User.objects.exists())

    def test_tampered_or_expired_consent_token_is_refused(self):
        resp = self.post_google(consent_token="not-a-real-token", **OK)
        self.assertEqual(resp.status_code, 400)
        with self.verify():
            token = self.post_google(code="c").json()["consent_token"]
        with mock.patch("django.core.signing.time.time", return_value=__import__("time").time() + 3600):
            self.assertEqual(self.post_google(consent_token=token, **OK).status_code, 400)

    def test_returning_google_user_is_never_asked_again(self):
        User.objects.create_user(username="Fan", email=GOOGLE_ID["email"], password=None, google_sub=GOOGLE_ID["sub"])
        with self.verify():
            resp = self.post_google(code="c")
        self.assertEqual(resp.status_code, 200)

    def test_one_step_when_consent_is_sent_with_the_code(self):
        with self.verify():
            resp = google(self.client)
        self.assertEqual(resp.status_code, 200)


class AccountDeletionTests(TestCase):
    def setUp(self):
        cache.clear()
        signup(self.client, username="Ann", email="ann@example.com", password="Testpass123!")
        signup(self.client, username="Bob", email="bob@example.com", password="Testpass123!")
        self.ann = User.objects.get(email="ann@example.com")
        self.bob = User.objects.get(email="bob@example.com")
        self.token = login(self.client, "ann@example.com").json()["access"]

    def auth(self):
        return {"HTTP_AUTHORIZATION": f"Bearer {self.token}"}

    def delete(self, **data):
        return self.client.post(reverse("account_delete"), data=data, content_type="application/json", **self.auth())

    def fill(self):
        low, high = Friendship.ordered_pair(self.ann, self.bob)
        Friendship.objects.create(user_low=low, user_high=high)
        BlockedUser.objects.create(blocker=self.ann, blocked=self.bob)
        FriendRequest.objects.create(sender=self.bob, receiver=self.ann)
        GameSession.objects.create(user=self.ann, game="wordle", score=50)
        GuessLog.objects.create(user=self.ann, game="wordle", answer="lebron")
        WordlePlay.objects.create(user=self.ann, play_date=date.today())
        Feedback.objects.create(user=self.ann, email=self.ann.email, display_name="Ann", public_id=self.ann.public_id, rating=5, message="hi")
        ModerationEvent.objects.create(user=self.ann, public_id=self.ann.public_id, kind="name_change", tier="mild", reason="blocked")

    def test_wrong_password_deletes_nothing(self):
        self.assertEqual(self.delete(password="nope").status_code, 403)
        self.assertTrue(User.objects.filter(pk=self.ann.pk).exists())

    def test_requires_sign_in(self):
        resp = self.client.post(reverse("account_delete"), data={"password": "x"}, content_type="application/json")
        self.assertEqual(resp.status_code, 401)

    def test_deletion_removes_the_account_and_everything_tied_to_it(self):
        self.fill()
        pid = self.ann.public_id
        resp = self.delete(password="Testpass123!")
        self.assertEqual((resp.status_code, resp.json()["status"]), (200, "deleted"))
        self.assertFalse(User.objects.filter(email="ann@example.com").exists())
        self.assertFalse(GameSession.objects.exists() or GuessLog.objects.exists() or WordlePlay.objects.exists())
        self.assertFalse(Feedback.objects.exists())
        self.assertFalse(ModerationEvent.objects.filter(public_id=pid).exists())
        self.assertFalse(Friendship.objects.exists() or BlockedUser.objects.exists() or FriendRequest.objects.exists())
        self.assertTrue(User.objects.filter(pk=self.bob.pk).exists())  # the other player is untouched
        self.assertEqual(login(self.client, "ann@example.com").status_code, 401)

    def test_deletion_signs_the_old_session_out(self):
        refresh = login(self.client, "ann@example.com").json()["refresh"]
        self.delete(password="Testpass123!")
        resp = self.client.post(reverse("token_refresh"), data={"refresh": refresh}, content_type="application/json")
        self.assertEqual(resp.status_code, 401)

    def test_google_only_account_must_type_delete(self):
        user = User.objects.create_user(username="G", email="g@example.com", password=None, google_sub="gs")
        from users.tokens import issue_session_tokens

        self.token = str(issue_session_tokens(user).access_token)
        self.assertEqual(self.delete().status_code, 400)
        self.assertEqual(self.delete(confirm="delete").status_code, 400)
        self.assertEqual(self.delete(confirm="DELETE").status_code, 200)
        self.assertFalse(User.objects.filter(pk=user.pk).exists())

    def test_banned_account_is_anonymised_keeping_only_the_ban_record(self):
        from users import strikes

        self.fill()
        strikes.ban_user(self.ann, "name_severe")
        outcome = __import__("users.account_data", fromlist=["delete_account"]).delete_account(User.objects.get(pk=self.ann.pk))
        self.assertEqual(outcome, "anonymised")
        kept = User.objects.get(pk=self.ann.pk)
        self.assertEqual(kept.username, "Deleted player")
        self.assertTrue(kept.email.endswith("@deleted.invalid"))
        self.assertFalse(kept.has_usable_password())
        self.assertFalse(kept.is_active)
        self.assertIsNone(kept.profile_photo_data)
        self.assertIsNotNone(kept.banned_at)
        self.assertEqual(kept.canonical_email, "ann@example.com")  # still blocks re-registration
        self.assertTrue(strikes.email_is_banned("ann@example.com"))
        self.assertFalse(GameSession.objects.exists() or Feedback.objects.exists() or Friendship.objects.exists())


class AccountExportTests(TestCase):
    def setUp(self):
        cache.clear()
        signup(self.client, username="Ann", email="ann@example.com")
        signup(self.client, username="Bob", email="bob@example.com")
        self.ann = User.objects.get(email="ann@example.com")
        self.bob = User.objects.get(email="bob@example.com")
        self.token = login(self.client, "ann@example.com").json()["access"]

    def export(self):
        return self.client.get(reverse("account_export"), HTTP_AUTHORIZATION=f"Bearer {self.token}")

    def test_requires_sign_in(self):
        self.assertEqual(self.client.get(reverse("account_export")).status_code, 401)

    def test_export_holds_the_players_own_data_as_a_download(self):
        low, high = Friendship.ordered_pair(self.ann, self.bob)
        Friendship.objects.create(user_low=low, user_high=high)
        GameSession.objects.create(user=self.ann, game="wordle", score=50)
        GuessLog.objects.create(user=self.ann, game="wordle", answer="lebron", correct=True)
        GameSession.objects.create(user=self.bob, game="wordle", score=99)  # someone else's

        resp = self.export()
        self.assertEqual(resp.status_code, 200)
        self.assertIn("attachment", resp["Content-Disposition"])
        data = resp.json()
        self.assertEqual(data["account"]["email"], "ann@example.com")
        self.assertEqual(data["account"]["terms_version"], consent.TERMS_VERSION)
        self.assertEqual([f["id"] for f in data["friends"]], [self.bob.public_id])
        self.assertEqual([s["score"] for s in data["game_sessions"]], [50])
        self.assertEqual(data["guesses"][0]["answer"], "lebron")
        self.assertNotIn("password", str(data["account"]).lower())
