"""Consent at sign-up, account deletion and data export."""
from datetime import date
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from django.urls import reverse
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken

from trivia.models import Feedback, GameSession, GuessLog, SeenQuestion, WordlePlay
from users import consent
from users.models import BlockedUser, FriendRequest, Friendship, ModerationEvent
from users.tests import GOOGLE_ID, google, login, signup

User = get_user_model()


class GoogleConsentTests(TestCase):
    def setUp(self):
        cache.clear()

    def test_a_consent_token_from_the_retired_two_step_flow_is_not_an_identity(self):
        # The earlier tick-box flow handed out signed consent tokens; they no longer stand in for a
        # Google code, so a request carrying one alone creates nothing.
        resp = self.client.post(
            reverse("google_login"), data={"consent_token": "anything", "accepted_terms": True}, content_type="application/json"
        )
        self.assertEqual(resp.status_code, 400)
        self.assertFalse(User.objects.exists())

    def test_one_step_with_the_code(self):
        with mock.patch("users.views.verify_google_code", return_value=GOOGLE_ID):
            resp = google(self.client)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(User.objects.get(email=GOOGLE_ID["email"]).terms_version, consent.TERMS_VERSION)


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
        data.setdefault("confirm_username", "Ann")
        data.setdefault("confirm_text", "delete")
        return self.client.post(reverse("account_delete"), data=data, content_type="application/json", **self.auth())

    def fill(self):
        low, high = Friendship.ordered_pair(self.ann, self.bob)
        Friendship.objects.create(user_low=low, user_high=high)
        BlockedUser.objects.create(blocker=self.ann, blocked=self.bob)
        FriendRequest.objects.create(sender=self.bob, receiver=self.ann)
        GameSession.objects.create(user=self.ann, game="wordle", score=50)
        GuessLog.objects.create(user=self.ann, game="wordle", answer="lebron")
        WordlePlay.objects.create(user=self.ann, play_date=date.today())
        SeenQuestion.objects.create(user=self.ann, game="career-path", qid="cp-1")
        Feedback.objects.create(user=self.ann, email=self.ann.email, display_name="Ann", public_id=self.ann.public_id, rating=5, message="hi")
        ModerationEvent.objects.create(user=self.ann, public_id=self.ann.public_id, kind="name_change", tier="mild", reason="blocked")

    def test_wrong_username_deletes_nothing(self):
        for name in ("Bob", "ann", "", "Ann2"):
            resp = self.delete(confirm_username=name)
            self.assertEqual(resp.status_code, 400, name)
            self.assertIn("username", resp.json()["error"])
        self.assertTrue(User.objects.filter(pk=self.ann.pk).exists())

    def test_wrong_word_deletes_nothing(self):
        for word in ("", "DELET", "remove", "delete me"):
            resp = self.delete(confirm_text=word)
            self.assertEqual(resp.status_code, 400, word)
            self.assertIn("delete", resp.json()["error"])
        self.assertTrue(User.objects.filter(pk=self.ann.pk).exists())

    def test_no_password_is_needed_and_the_checks_trim_and_ignore_the_words_case(self):
        resp = self.delete(confirm_username=" Ann ", confirm_text=" DeLeTe ")
        self.assertEqual((resp.status_code, resp.json()["status"]), (200, "deleted"))
        self.assertFalse(User.objects.filter(pk=self.ann.pk).exists())

    def test_requires_sign_in(self):
        resp = self.client.post(reverse("account_delete"), data={"confirm_username": "Ann", "confirm_text": "delete"}, content_type="application/json")
        self.assertEqual(resp.status_code, 401)

    def test_deletion_removes_the_account_and_everything_tied_to_it(self):
        self.fill()
        pid = self.ann.public_id
        resp = self.delete()
        self.assertEqual((resp.status_code, resp.json()["status"]), (200, "deleted"))
        self.assertFalse(User.objects.filter(email="ann@example.com").exists())
        self.assertFalse(GameSession.objects.exists() or GuessLog.objects.exists() or WordlePlay.objects.exists())
        self.assertFalse(SeenQuestion.objects.exists())
        self.assertFalse(Feedback.objects.exists())
        self.assertFalse(ModerationEvent.objects.filter(public_id=pid).exists())
        self.assertFalse(Friendship.objects.exists() or BlockedUser.objects.exists() or FriendRequest.objects.exists())
        self.assertTrue(User.objects.filter(pk=self.bob.pk).exists())  # the other player is untouched
        self.assertEqual(login(self.client, "ann@example.com").status_code, 401)

    def test_deletion_also_removes_guest_feedback_with_the_same_email_and_token_rows(self):
        from rest_framework_simplejwt.token_blacklist.models import OutstandingToken

        Feedback.objects.create(email="ann@example.com", rating=3, message="sent before I had an account")
        self.assertTrue(OutstandingToken.objects.filter(user=self.ann).exists())
        self.delete()
        self.assertFalse(Feedback.objects.exists())
        self.assertFalse(OutstandingToken.objects.filter(user_id=self.ann.pk).exists())
        self.assertFalse(OutstandingToken.objects.filter(user__isnull=True).exists())

    def test_deletion_signs_the_old_session_out(self):
        refresh = login(self.client, "ann@example.com").json()["refresh"]
        self.delete()
        resp = self.client.post(reverse("token_refresh"), data={"refresh": refresh}, content_type="application/json")
        self.assertEqual(resp.status_code, 401)

    def test_google_only_account_confirms_the_same_way(self):
        user = User.objects.create_user(username="G", email="g@example.com", password=None, google_sub="gs")
        from users.tokens import issue_session_tokens

        self.token = str(issue_session_tokens(user).access_token)
        self.assertEqual(self.delete(confirm_username="G", confirm_text="").status_code, 400)
        self.assertEqual(self.delete(confirm_username="Ann").status_code, 400)
        self.assertEqual(self.delete(confirm_username="G").status_code, 200)
        self.assertFalse(User.objects.filter(pk=user.pk).exists())

    def test_banned_account_is_anonymised_keeping_only_the_ban_record(self):
        from users import strikes

        self.fill()
        strikes.ban_user(self.ann, "name_severe")
        User.objects.filter(pk=self.ann.pk).update(active_days=9, last_active_day="2026-10-15", streak_days=4, streak_best=6,
                                                   streak_freezes=0, founding_member=True)
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
        self.assertFalse(SeenQuestion.objects.exists())
        self.assertIsNone(kept.last_login)
        self.assertEqual((kept.terms_version, kept.age_group), ("", ""))
        self.assertEqual(
            (kept.active_days, kept.last_active_day, kept.streak_days, kept.streak_best, kept.streak_freezes, kept.founding_member),
            (0, None, 0, 0, 1, False),
        )


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
        SeenQuestion.objects.create(user=self.ann, game="career-path", qid="cp-1")
        SeenQuestion.objects.create(user=self.bob, game="career-path", qid="cp-2")  # someone else's
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
        self.assertIn("at", data["guesses"][0])
        self.assertEqual([(s["game"], s["qid"]) for s in data["seen_questions"]], [("career-path", "cp-1")])
        self.assertIn("canonical_email", data["account"])
        self.assertIsNone(data["account"]["last_active_day"])
        self.assertEqual(data["account"]["streak_freezes"], 1)
        self.assertNotIn("password", str(data["account"]).lower())
