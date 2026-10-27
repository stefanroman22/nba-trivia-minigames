"""Phase 1 of the HttpOnly refresh-cookie move (users.session_cookie): the cookie protocol works next to
the unchanged legacy body path."""
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import Client, TestCase, override_settings
from django.urls import reverse

from backend.throttles import RefreshRateThrottle
from users import strikes
from users.session_cookie import SessionCookieRefreshView

User = get_user_model()

EMAIL = "cookie@example.com"
PASSWORD = "Testpass123!"
SITE = dict(HTTP_ORIGIN="https://swishquest.com", HTTP_X_SQ_SESSION="1")
NINETY_DAYS = 90 * 86400


def login(client, email=EMAIL, **headers):
    return client.post(
        reverse("login"),
        data={"id": email, "password": PASSWORD},
        content_type="application/json",
        **headers,
    )


def login_cookie(client, email=EMAIL):
    return login(client, email, **SITE)


def post(client, name, data=None, **headers):
    return client.post(reverse(name), data=data or {}, content_type="application/json", **headers)


def cookie_name():
    return settings.REFRESH_COOKIE_NAME


class SessionCookieTests(TestCase):
    def setUp(self):
        cache.clear()  # throttle counters
        self.user = User.objects.create_user(username="Cookie1", email=EMAIL, password=PASSWORD)

    def assertCleared(self, resp):
        morsel = resp.cookies.get(cookie_name())
        self.assertIsNotNone(morsel, "expected the refresh cookie to be cleared")
        self.assertEqual(morsel.value, "")
        self.assertEqual(int(morsel["max-age"]), 0)
        self.assertEqual(resp["Cache-Control"], "no-store")

    def assertNoCookie(self, resp):
        self.assertEqual(len(resp.cookies), 0)

    def test_login_with_header_sets_cookie_and_omits_refresh(self):
        resp = login_cookie(self.client)
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertNotIn("refresh", body)
        self.assertIn("access", body)
        self.assertIn("user", body)
        morsel = resp.cookies[cookie_name()]
        self.assertTrue(morsel.value)
        self.assertTrue(morsel["httponly"])
        self.assertEqual(morsel["samesite"], "Strict")
        self.assertEqual(morsel["path"], "/")
        self.assertEqual(morsel["domain"], "")
        self.assertGreater(int(morsel["max-age"]), 0)
        self.assertLessEqual(int(morsel["max-age"]), NINETY_DAYS)
        self.assertAlmostEqual(int(morsel["max-age"]), NINETY_DAYS, delta=5)
        self.assertEqual(resp["Cache-Control"], "no-store")

    @override_settings(REFRESH_COOKIE_NAME="__Host-sq_refresh", REFRESH_COOKIE_SECURE=True)
    def test_production_cookie_name_and_secure(self):
        resp = login_cookie(self.client)
        self.assertEqual(resp.status_code, 200)
        morsel = resp.cookies["__Host-sq_refresh"]
        self.assertTrue(morsel["secure"])
        self.assertEqual(morsel["path"], "/")
        self.assertEqual(morsel["domain"], "")

    def test_login_without_header_keeps_legacy_body(self):
        resp = login(self.client)
        self.assertEqual(resp.status_code, 200)
        self.assertIn("refresh", resp.json())
        self.assertNoCookie(resp)
        # A header from a foreign Origin is not granted the cookie either: legacy body.
        resp = login(Client(), HTTP_ORIGIN="https://evil.example", HTTP_X_SQ_SESSION="1")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("refresh", resp.json())
        self.assertNoCookie(resp)

    def test_cookie_refresh_rotates_and_blacklists(self):
        old = login_cookie(self.client).cookies[cookie_name()].value
        resp = post(self.client, "session_refresh", **SITE)
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(set(body), {"access", "user"})
        self.assertEqual(body["user"]["id"], self.user.public_id)
        new = resp.cookies[cookie_name()].value
        self.assertTrue(new)
        self.assertNotEqual(new, old)
        self.assertEqual(resp["Cache-Control"], "no-store")

        self.client.cookies[cookie_name()] = old
        resp = post(self.client, "session_refresh", **SITE)
        self.assertEqual(resp.status_code, 401)
        self.assertEqual(resp.json()["code"], "invalid_session")
        self.assertCleared(resp)

        # The rotated token still works.
        self.client.cookies[cookie_name()] = new
        self.assertEqual(post(self.client, "session_refresh", **SITE).status_code, 200)

    def test_adoption_of_body_token(self):
        legacy = login(self.client).json()["refresh"]
        resp = post(self.client, "session_refresh", {"refresh": legacy}, **SITE)
        self.assertEqual(resp.status_code, 200)
        self.assertNotIn("refresh", resp.json())
        self.assertTrue(resp.cookies[cookie_name()].value)
        # The adopted legacy token was rotated away.
        resp = post(Client(), "token_refresh", {"refresh": legacy})
        self.assertEqual(resp.status_code, 401)
        # The cookie now carries the session.
        self.assertEqual(post(self.client, "session_refresh", **SITE).status_code, 200)

    def test_csrf_rules(self):
        login_cookie(self.client)
        cases = {
            "no header": dict(HTTP_ORIGIN="https://swishquest.com"),
            "foreign origin": dict(HTTP_ORIGIN="https://evil.example", HTTP_X_SQ_SESSION="1"),
            "no origin": dict(HTTP_X_SQ_SESSION="1"),
            "cross-site fetch": dict(SITE, HTTP_SEC_FETCH_SITE="cross-site"),
        }
        for label, headers in cases.items():
            for name in ("session_refresh", "session_logout"):
                with self.subTest(label=label, view=name):
                    resp = post(self.client, name, **headers)
                    self.assertEqual(resp.status_code, 403)
                    self.assertEqual(resp.json()["code"], "csrf_failed")
                    self.assertNoCookie(resp)
        # The cookie survived every refused call.
        self.assertEqual(post(self.client, "session_refresh", **SITE).status_code, 200)
        # Same-site / same-origin fetches pass.
        for fetch_site in ("same-site", "same-origin"):
            with self.subTest(sec_fetch_site=fetch_site):
                resp = post(self.client, "session_refresh", **dict(SITE, HTTP_SEC_FETCH_SITE=fetch_site))
                self.assertEqual(resp.status_code, 200)

    def test_cookie_refresh_keeps_refresh_throttle(self):
        self.assertEqual(SessionCookieRefreshView.throttle_classes, [RefreshRateThrottle])

    def test_no_cookie_no_body_is_401(self):
        resp = post(Client(), "session_refresh", **SITE)
        self.assertEqual(resp.status_code, 401)
        self.assertEqual(resp.json()["code"], "no_session")
        self.assertCleared(resp)

        garbage = Client()
        garbage.cookies[cookie_name()] = "not-a-jwt"
        resp = post(garbage, "session_refresh", **SITE)
        self.assertEqual(resp.status_code, 401)
        self.assertEqual(resp.json()["code"], "invalid_session")
        self.assertCleared(resp)

    def test_logout_clears_and_blacklists(self):
        old = login_cookie(self.client).cookies[cookie_name()].value
        resp = post(self.client, "session_logout", **SITE)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), {"status": "success"})
        self.assertCleared(resp)

        self.client.cookies[cookie_name()] = old
        self.assertEqual(post(self.client, "session_refresh", **SITE).status_code, 401)
        # A second logout (already blacklisted, or no cookie at all) is still 200.
        self.client.cookies[cookie_name()] = old
        self.assertEqual(post(self.client, "session_logout", **SITE).status_code, 200)
        self.assertEqual(post(Client(), "session_logout", **SITE).status_code, 200)

    def test_logout_all_revokes_other_sessions(self):
        a, b = Client(), Client()
        access_a = login_cookie(a).json()["access"]
        login_cookie(b)
        resp = post(a, "session_logout_all", HTTP_AUTHORIZATION=f"Bearer {access_a}")
        self.assertEqual(resp.status_code, 200)
        self.assertCleared(resp)
        self.assertEqual(post(b, "session_refresh", **SITE).status_code, 401)
        # Bearer is required.
        self.assertEqual(post(Client(), "session_logout_all").status_code, 401)

    def test_banned_account_gets_403_and_cookie_cleared(self):
        login_cookie(self.client)
        strikes.ban_user(self.user, "test")
        resp = post(self.client, "session_refresh", **SITE)
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.json()["code"], "account_banned")
        self.assertCleared(resp)

    def test_delete_account_clears_cookie(self):
        access = login_cookie(self.client).json()["access"]
        resp = post(
            self.client,
            "account_delete",
            {"confirm_username": self.user.username, "confirm_text": "delete"},
            HTTP_AUTHORIZATION=f"Bearer {access}",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertCleared(resp)

    def test_legacy_refresh_and_logout_unchanged(self):
        refresh = login(self.client).json()["refresh"]
        resp = post(self.client, "token_refresh", {"refresh": refresh})
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertIn("access", body)
        self.assertIn("refresh", body)
        self.assertNoCookie(resp)

        rotated = body["refresh"]
        resp = post(self.client, "logout", {"refresh": rotated})
        self.assertEqual(resp.status_code, 200)
        self.assertNoCookie(resp)
        self.assertEqual(post(self.client, "token_refresh", {"refresh": rotated}).status_code, 401)
