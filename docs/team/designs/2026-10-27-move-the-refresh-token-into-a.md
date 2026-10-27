# Design — refresh token in an HttpOnly cookie: Phase 1, backend accepts both

Card `4052cfb1-c595-8191-bc7e-ea6d74fc8e0b` · slug `move-the-refresh-token-into-a` · tier hard · risk high · 2026-10-27.
Branch `team/move-the-refresh-token-into-a` (from `origin/dev`). Ships to `dev` only.

## 1. Decision summary

**Engine: opus** (effort high) — every step is explicit, but the three views are auth/CSRF logic on a
`risk: high` surface (AUTH-11: `auth_response`, `settings.REST_FRAMEWORK`, `users/tokens.py` subclass).

- This card builds **Phase 1 of the spec only**: the backend learns the cookie protocol while the
  frontend, the relay and the legacy `/api/token/refresh/` + `/api/logout/` path stay exactly as they are.
  Nothing in `src/` or `multiplayer_server/` changes. No frontend request sends `X-SQ-Session` yet, so
  production behaviour after this card is unchanged until Phase 2.
- Phase 0 (domains: `api.swishquest.com`, `dev.swishquest.com`, relay `CORS_ORIGINS`) is the owner's
  dashboard/env work and is not touched. The Vercel-plan question (Hobby is non-commercial; ads may need
  Pro) stays with the owner; nothing here costs money.
- The spec's unanswered owner questions that Phase 1 touches are decided by the spec's own recommended
  defaults: `SameSite=Strict`; the report endpoint is an own Django endpoint — **but it is not built
  here** (see §7). Phases 2–5 and the CSP are follow-up cards.
- `auth-refresh` stays at `60/hour` in this card. The raise to 120/h exists for per-tab refreshes, which
  arrive with the Phase 2 client; raising it now would only fail LC-AUTH-06, which pins `60/hour`
  (`scripts/logic-check/specs/api/auth.spec.mjs:139`). Phase 2 raises it and updates that check together.
- Proof is `backend/users/test_session_cookie.py` (every bullet of the spec's test list) plus the existing
  `users`/`trivia` suites staying green (legacy path untouched).

## 2. Interfaces

### Settings (`backend/backend/settings.py`)
| Name | Value | Note |
|---|---|---|
| `ALLOWED_HOSTS` | append `"api.swishquest.com"` if absent (after the `.vercel.app` append) | inert until Phase 0 assigns the domain; the final tightening is Phase 3 |
| `FRONTEND_ORIGINS` | add `"https://dev.swishquest.com"` after the `git-dev` origin | spec Phase 1 |
| `CORS_ALLOW_HEADERS` | `(*corsheaders.defaults.default_headers, "x-sq-session")` | makes the custom header preflight-able |
| `REFRESH_COOKIE_NAME` | `"sq_refresh" if DEBUG else "__Host-sq_refresh"` | `__Host-` needs Secure + Path=/ + no Domain |
| `REFRESH_COOKIE_SECURE` | `not DEBUG` | |
| `REFRESH_COOKIE_SAMESITE` | `"Strict"` | owner question 4 → the recommended default |

### Module `backend/users/session_cookie.py` (new)
```python
SESSION_HEADER = "X-SQ-Session"          # request.headers key; any non-empty value counts
CSRF_FAILED = {"code": "csrf_failed", "error": "This request did not come from the site."}
NO_SESSION  = {"code": "no_session",  "error": "Session expired. Please log in again."}

def cookie_max_age(raw: str) -> int
    # seconds until min(payload["exp"], payload["auth_time"] + MAX_SESSION_AGE), floor 0;
    # decoded with token_backend.decode(raw, verify=False) — no blacklist query.
def set_refresh_cookie(response, raw: str) -> response
    # response.set_cookie(settings.REFRESH_COOKIE_NAME, raw, max_age=cookie_max_age(raw), path="/",
    #   secure=settings.REFRESH_COOKIE_SECURE, httponly=True, samesite=settings.REFRESH_COOKIE_SAMESITE)
    # no domain=; response["Cache-Control"] = "no-store"
def clear_refresh_cookie(response) -> response
    # response.delete_cookie(settings.REFRESH_COOKIE_NAME, path="/", samesite=settings.REFRESH_COOKIE_SAMESITE)
    # (Django sets Secure itself for a __Host- name); response["Cache-Control"] = "no-store"
def session_origin_ok(request) -> bool
    # True only when: request.headers.get(SESSION_HEADER) is truthy
    #   AND request.headers.get("Origin") is in settings.CORS_ALLOWED_ORIGINS (exact string match)
    #   AND request.headers.get("Sec-Fetch-Site") in (None, "", "same-site", "same-origin")
def require_session_origin(request) -> Response | None
    # None when ok, else Response(CSRF_FAILED, status=403) with NO cookie header at all

class SessionCookieRefreshView(SessionRefreshView):   # inherits RefreshRateThrottle (auth-refresh)
    def post(self, request, *args, **kwargs) -> Response
cookie_logout    = @api_view(["POST"]) @permission_classes([AllowAny])
logout_all       = @api_view(["POST"]) @permission_classes([IsAuthenticated])
```

### Endpoints (routed in `backend/users/urls.py`, under the `/api/` include)
| Route | Name | Auth | Behaviour |
|---|---|---|---|
| `POST /api/auth/refresh/` | `session_refresh` | cookie or body | 1. `require_session_origin` → 403 `csrf_failed`, no Set-Cookie. 2. token = `request.data.get("refresh")` (adoption of a legacy body token) else `request.COOKIES.get(REFRESH_COOKIE_NAME)`; none → 401 `NO_SESSION` + `clear_refresh_cookie`. 3. `self.get_serializer(data={"refresh": token}).is_valid(raise_exception=True)` inside `try`: `AccountBanned` → 403 with `exc.detail` (= `ban_payload`) + cookie cleared; `TokenError`/`InvalidToken` → 401 `{"code": "invalid_session", "error": "Session expired. Please log in again."}` + cookie cleared. 4. 200 body = `validated_data` minus `refresh` (so `{access, user}`), `set_refresh_cookie(resp, new_refresh)`. Throttle 429 unchanged (DRF, before the view body). |
| `POST /api/auth/logout/` | `session_logout` | cookie or body | `require_session_origin` → 403 as above. Token = cookie, else body `refresh`. If present, `RefreshToken(token).blacklist()` inside `try/except TokenError: pass`. Always 200 `{"status": "success"}` with the cookie cleared — a second call is also 200. |
| `POST /api/auth/logout-all/` | `session_logout_all` | Bearer (`IsAuthenticated`) | `revoke_sessions(request.user)` (every outstanding refresh token blacklisted; the caller's access token stays valid ≤ 15 min, which is the spec's "other devices finish within 15 minutes"), then 200 `{"status": "success"}` with the cookie cleared. No `X-SQ-Session`/Origin check: Bearer is not ambient, so there is no CSRF surface. |

### Existing views (`backend/users/views.py`)
- `auth_response(request, user, ...)`: after building the body, `if session_origin_ok(request):`
  `body.pop("refresh")` and `set_refresh_cookie(response, str(refresh))`. Otherwise the legacy body
  (`access`, `refresh`, `user`) is returned unchanged. A header with a failing Origin falls back to the
  legacy body (login/signup/google are credential-authenticated, so they are not a CSRF surface; the cookie
  is simply not granted). Applies to `login_view`, `signup_view`, `google_login` through the shared helper.
- `delete_my_account`: `clear_refresh_cookie` on the 200 response (`delete_account` already revokes sessions).

### Cookie, as the browser sees it (production)
`Set-Cookie: __Host-sq_refresh=<jwt>; Path=/; Max-Age=<≤ 7776000>; HttpOnly; Secure; SameSite=Strict`
Local (`DEBUG`): `sq_refresh=…; Path=/; Max-Age=…; HttpOnly; SameSite=Strict` (no Secure).

## 3. File plan
- `backend/backend/settings.py` — hosts/origins additions, `CORS_ALLOW_HEADERS`, three `REFRESH_COOKIE_*` settings.
- `backend/users/session_cookie.py` — new: helpers + `SessionCookieRefreshView`, `cookie_logout`, `logout_all`.
- `backend/users/urls.py` — three `auth/...` routes.
- `backend/users/views.py` — `auth_response` opt-in, `delete_my_account` cookie clear (imports from `users.session_cookie`).
- `backend/users/test_session_cookie.py` — new test module.
- `docs/team/DECISIONS.md` — this card's entry (planner).
No `src/`, no `multiplayer_server/`, no migrations, no `scripts/` changes.

## 4. Risks
- **Circular import**: `users/views.py` imports `users.tokens`, and `tokens.py` lazily imports `users.views`.
  `session_cookie.py` imports `SessionRefreshView` from `users.tokens` and `AccountBanned` from
  `users.strikes` at module level, and `views.py` imports only the three helpers from `session_cookie`.
  `session_cookie.py` must not import `users.views` at module level (step 2 done-check: `manage.py check`).
- **`__Host-` cookie rejected locally**: avoided by the `DEBUG`-dependent name/Secure; tests pin the
  production attributes with `override_settings(REFRESH_COOKIE_NAME="__Host-sq_refresh", REFRESH_COOKIE_SECURE=True)`.
- **Legacy regression** (AUTH-5, LC-AUTH-04/05): `auth_response` only diverges when `X-SQ-Session` is present and
  the Origin is allow-listed; the Django test client sends neither by default, so every existing test exercises
  the legacy path, and one new test asserts it explicitly.
- **csrf_failed must not emit Set-Cookie** (LC-AUTH-10): `require_session_origin` builds its own Response and the
  views return it before touching cookies; a test asserts `"Set-Cookie" not in resp.headers` / `resp.cookies == {}`.
- **A banned account learns it is banned** (AUTH-13): `SessionRefreshSerializer` still raises `AccountBanned`
  first; the cookie view catches it to add the cookie clear, keeping the 403 `account_banned` body.
- **`TokenError` vs `InvalidToken`**: `TokenRefreshSerializer.validate` raises the plain `TokenError` (the stock
  view converts it); the override catches both and never lets a 500 through — tested with a garbage token.
- **Throttle keying**: `UserRateThrottle` keys the anonymous cookie refresh by IP, as the legacy view does
  (AUTH-9); the rate is unchanged in this card.
- **Multi-tab rotation races**: unchanged from today (no client uses the cookie yet); the Web Lock /
  BroadcastChannel mitigation is Phase 2.

## 5. Test plan
Gate 1 (as the brief states): `npm run lint`, `npx next typegen && npx tsc --noEmit`, `npm run build`,
`DATABASE_URL="" python manage.py check && python manage.py test users trivia`. The engine runs only the
focused module while building: `cd backend && DJANGO_DEBUG=True python manage.py test users.test_session_cookie users.tests`.

New tests, `backend/users/test_session_cookie.py` (helpers: `login_cookie(client)` = POST `login` with
`HTTP_ORIGIN="https://swishquest.com", HTTP_X_SQ_SESSION="1"`; `SITE = dict(HTTP_ORIGIN=..., HTTP_X_SQ_SESSION="1")`):
1. `test_login_with_header_sets_cookie_and_omits_refresh` — 200; `"refresh" not in body`; `"access"` and
   `"user"` present; cookie present with `httponly`, `samesite == "Strict"`, `path == "/"`, `domain == ""`,
   `0 < max-age <= 90*86400`; `resp["Cache-Control"] == "no-store"`.
2. `test_production_cookie_name_and_secure` — under `override_settings(REFRESH_COOKIE_NAME="__Host-sq_refresh", REFRESH_COOKIE_SECURE=True)` the cookie is `__Host-sq_refresh` with `secure`.
3. `test_login_without_header_keeps_legacy_body` — plain login: `refresh` in body, no cookie (AUTH-5 untouched).
4. `test_cookie_refresh_rotates_and_blacklists` — after cookie login, POST `session_refresh` with `SITE` and no body → 200 `{access, user}` without `refresh`, new cookie value ≠ old; re-sending the old value (set `client.cookies[name] = old`) → 401 and the response's cookie has `max-age == 0`.
5. `test_adoption_of_body_token` — plain login (legacy body); POST `session_refresh` with `SITE` and `{"refresh": legacy}` → 200 + cookie; the legacy token on `token_refresh` → 401.
6. `test_csrf_rules` — four cases on `session_refresh` with a valid cookie: no header; header + `HTTP_ORIGIN="https://evil.example"`; header + no Origin; header + good Origin + `HTTP_SEC_FETCH_SITE="cross-site"` → each 403 `{"code": "csrf_failed"}` and no `Set-Cookie`.
7. `test_no_cookie_no_body_is_401` — `SITE` headers, fresh client → 401 `no_session`; garbage cookie → 401 `invalid_session` (never 500).
8. `test_logout_clears_and_blacklists` — `session_logout` with `SITE` → 200, cookie `max-age == 0`; the old cookie value on `session_refresh` → 401; a second logout → 200.
9. `test_logout_all_revokes_other_sessions` — two cookie logins (two clients); client A calls `session_logout_all` with `HTTP_AUTHORIZATION=Bearer <A.access>` → 200 + cleared cookie; client B's `session_refresh` → 401.
10. `test_banned_account_gets_403_and_cookie_cleared` — cookie login, then `strikes.ban_user(user, "test")` (blacklists every outstanding token, so `_banned_owner` must answer before the blacklist does) → `session_refresh` → 403 `code == "account_banned"` and cookie `max-age == 0`.
11. `test_delete_account_clears_cookie` — cookie login, POST `account_delete` with Bearer + `{confirm_username, confirm_text: "delete"}` → 200 and cookie `max-age == 0`.
12. `test_legacy_refresh_and_logout_unchanged` — `token_refresh` and `logout` with the body token behave as `users.tests.SessionLifetimeTests` expects (200 with `refresh` in body; logout 200 then 401).

Gate 2 (QA assertions, copied into the brief): backend-only diff, so one route smoke proves the unchanged
frontend still boots against the changed backend (the bootstrap hits `/api/`):
```json
[{"route": "/", "selector": "main", "expect": "visible"}]
```
No `flow` (no UI changed). The LC-AUTH-09..12 checker specs are a follow-up with Phase 2 (§7).

## 6. Implementation plan
1. **[sonnet] Settings.** `backend/backend/settings.py`: after the `.vercel.app` append add
   `if "api.swishquest.com" not in ALLOWED_HOSTS: ALLOWED_HOSTS.append("api.swishquest.com")`; add
   `"https://dev.swishquest.com"` to `FRONTEND_ORIGINS` after the `git-dev` entry; add
   `from corsheaders.defaults import default_headers` + `CORS_ALLOW_HEADERS = (*default_headers, "x-sq-session")`
   next to `CORS_ALLOW_CREDENTIALS`; add the three `REFRESH_COOKIE_*` settings (§2 table, with a 3-line comment
   naming `users/session_cookie.py`). Done: `DATABASE_URL="" python manage.py check` passes;
   `python -c` printing `settings.CORS_ALLOW_HEADERS` shows `x-sq-session`.
2. **[opus] Cookie helpers.** Create `backend/users/session_cookie.py` with `SESSION_HEADER`, `CSRF_FAILED`,
   `NO_SESSION`, `cookie_max_age`, `set_refresh_cookie`, `clear_refresh_cookie`, `session_origin_ok`,
   `require_session_origin` exactly as §2 (module docstring: why Strict + custom header replace Django CSRF
   for these two views; no `users.views` import at module level). Done: `manage.py check` passes; a shell
   `cookie_max_age(str(issue_session_tokens(u)))` is within 5 s of `90*86400`.
3. **[opus] Views.** Same file: `SessionCookieRefreshView.post`, `cookie_logout`, `logout_all` per the §2
   endpoint table (catch `AccountBanned`, `TokenError`, `InvalidToken`; csrf_failed before any cookie work).
   Done: step 7's tests 4–10 pass.
4. **[sonnet] Routes.** `backend/users/urls.py`: import the three and add `path('auth/refresh/', SessionCookieRefreshView.as_view(), name='session_refresh')`,
   `path('auth/logout/', cookie_logout, name='session_logout')`, `path('auth/logout-all/', logout_all, name='session_logout_all')`
   under a comment "Cookie session (Phase 1 of the HttpOnly refresh move; see users.session_cookie)". Done:
   `reverse("session_refresh") == "/api/auth/refresh/"`.
5. **[opus] `auth_response` opt-in.** `backend/users/views.py`: import `session_origin_ok, set_refresh_cookie, clear_refresh_cookie`
   from `users.session_cookie`; in `auth_response` build the body dict, and when `session_origin_ok(request)` pop
   `refresh` and set the cookie on the Response; docstring gains two lines on the opt-in. Done: tests 1–3.
6. **[sonnet] Delete clears the cookie.** `delete_my_account`: `return clear_refresh_cookie(Response({"status": outcome}))`.
   Done: test 11.
7. **[opus] Tests.** Create `backend/users/test_session_cookie.py` with the 12 tests of §5 (mirror
   `users/tests.py` style: `TestCase`, `reverse`, `User.objects.create_user`, `login` helper). Done:
   `cd backend && DJANGO_DEBUG=True python manage.py test users.test_session_cookie users.tests` is green.
8. **[sonnet] Report.** Write `.team/run/move-the-refresh-token-into-a/build-report.json` (`did`, `assumed`: "Phase 1 only;
   CSP report endpoint, throttle raise and Phases 2–5 are follow-up cards per the design §7", `touched`, `testsAdded`:
   `["backend/users/test_session_cookie.py"]`). Done: file is valid JSON.

## 7. Deferred (named follow-up cards, not half-built here)
- **`POST /api/csp-report/`** (custom DRF parser for `application/csp-report` + `application/reports+json`, a
  model + migration, dedupe per day, 30-day retention hook, `GET /api/admin/csp-reports/`). It needs a migration
  (AUTH-11 risk surface) and has no consumer until the Phase 2 CSP Report-Only header exists; it does not fit the
  card's remaining budget. Card: "CSP report endpoint (Phase 1.5)".
- **Phase 2** (frontend switch: memory access token, Web Lock refresh, adoption, session hint, `credentials: "include"`,
  check-harness cookie seeding, `auth-refresh` 120/h + LC-AUTH-06 update, LC-AUTH-09..12 and AC-LOGIN-03/04/02b specs,
  CSP Report-Only v1). Needs Phase 0 domains and owner answers 2, 5, 6.
- **Phase 3** (DEBUG default, hosts/CSRF/CORS tightening, X-Frame-Options + backend CSP), **Phase 4** (legacy removal,
  90 days after Phase 2), **Phase 5** (enforced CSP), **C2** (ads CSP; owner question 3).
- **Owner, no code**: Phase 0 domains; Vercel plan for ads (money — owner only); Safari 7-day-cap manual test.
