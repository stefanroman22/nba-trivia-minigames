# Auth Constraints (identity, tokens, rank, privacy)

**Scope:** the account/identity surface: `backend/users/` (`models.py`, `identity.py`, `tokens.py`,
`views.py`, `friends.py`, `photos.py`, `leaderboard.py`, `admin.py`), `backend/backend/throttles.py`, the
auth blocks of `backend/backend/settings.py`, and the frontend consumers (`src/utils/Api.tsx`,
`src/utils/session.ts`, `src/store/userSlice.tsx`, `src/app/providers.tsx`,
`src/components/LogInSignUp.tsx`, `src/components/UserProfile.tsx`, `src/views/Admin.tsx`).
`BACKEND_CONSTRAINTS.md` already covers the generic Django conventions every `users/` endpoint also
follows (`@api_view` usage, hand-built dict responses, broad `try/except`, trailing-slash URLs under the
`api/` mount, env-var settings, migrations); none of that is restated here.

**Reference implementations** (read these before touching auth code):

| Concern | Reference |
|---|---|
| Custom user model, rank ladder, friend/block models | `backend/users/models.py` |
| Public player ID generation | `backend/users/identity.py` |
| Session/refresh-token lifetime + refresh view | `backend/users/tokens.py` |
| The one DRF auth class (JWT + ban gate) | `backend/users/authentication.py` |
| Strikes, bans, signup IP lock, canonical email | `backend/users/strikes.py` |
| Username moderation (word lists, matcher) | `backend/users/moderation_text.py`, `backend/users/moderation_data/` |
| Relay token verification | `multiplayer_server/src/identity.js` |
| Auth endpoints (login/signup/google/logout/me/update-profile/get-users) | `backend/users/views.py` |
| Friends, requests, blocks, search | `backend/users/friends.py` |
| Profile photo normalization + public photo endpoint | `backend/users/photos.py` |
| Leaderboard (public_id-keyed) | `backend/users/leaderboard.py` |
| Points award (the only writer) | `backend/trivia/views.py` (`log_session`) |
| Admin API gating | `backend/trivia/admin_api.py`, `backend/trivia/feedback_api.py` |
| Throttle scopes and rates | `backend/backend/throttles.py`, `backend/backend/settings.py` (`REST_FRAMEWORK`) |
| JWT + custom-user settings | `backend/backend/settings.py` (`AUTH_USER_MODEL`, `SIMPLE_JWT`) |
| Token storage, refresh-on-401, single-flight refresh | `src/utils/Api.tsx` |
| Cached signed-in user + access-token expiry check | `src/utils/session.ts` |
| Login-state slice | `src/store/userSlice.tsx` |
| Session bootstrap on page load | `src/app/providers.tsx` |
| Login/signup/Google forms | `src/components/LogInSignUp.tsx` |
| Profile screen (username/photo/logout) | `src/components/UserProfile.tsx` |
| Admin page gating | `src/views/Admin.tsx` |

Everything below is measured from the working tree. Where the code is inconsistent, the dominant
pattern is documented and the exception is called out.

---

## Rule AUTH-1: Email is the unique login identity; `username` is a non-unique display name; `public_id` is the cross-system player key

`CustomUser` sets `USERNAME_FIELD = "email"` with `email = models.EmailField(unique=True)`, while `username`
is deliberately non-unique (`models.py` comment: any number of accounts can be called "Baller23"). The
permanent 6-character `public_id` (`identity.py` `generate_public_id()`, alphabet drops `0/O/1/I`,
allocated with up to 8 collision retries in `CustomUser.save()`, `editable=False`) is what every consumer
keys by: `user_payload()`'s `"id": user.public_id` (`views.py`), `leaderboard.py` (`top`/`rank_of`/
`record_score`), the friend endpoints (`_get_target`), and the multiplayer server's `players` Map. Login
email is compared case-insensitively (`CustomUserManager.get_by_natural_key`, `signup_view` lowercases and
`email__iexact`-checks); `admin.py`'s `CustomUserCreationForm.clean_email` applies the same rule. Never use
`username` as a lookup key or stable identity, and never expose or accept a numeric `pk` in place of
`public_id`.

```python
❌ WRONG — keying by username as if it were unique
return CustomUser.objects.get(username=username)  # several accounts share a name

✅ RIGHT — backend/users/friends.py, resolved by the permanent public id
def _get_target(public_id):
    if not public_id:
        return None
    return User.objects.filter(public_id__iexact=public_id).first()
```

## Rule AUTH-2: `login_view` accepts three input shapes (email, bare username, `Name#ID`) and a task must preserve all three

The branch is literal shape-sniffing on the submitted `id`: contains `@` is an email lookup; contains `#`
splits on the last `#` into `username__iexact` + `public_id__iexact`; otherwise a bare `username__iexact`
lookup that returns a 401 "Several players use that name" if more than one account matches. This is the
only place the ambiguity is resolved; `LogInSignUp.tsx` forwards whatever the player typed as `id`.
Signup validates the username with `USERNAME_RE` (3-20 of `A-Za-z0-9_`, mirrored client-side in
`LogInSignUp.tsx`'s `pattern` and `UserProfile.tsx`'s `validateUsername`).

```python
❌ WRONG — "simplifying" login to email-only
matches = User.objects.filter(email__iexact=user_id)

✅ RIGHT — backend/users/views.py, all three forms handled
if "@" in user_id:
    matches = User.objects.filter(email__iexact=user_id)
elif "#" in user_id:
    name, _, pid = user_id.rpartition("#")
    matches = User.objects.filter(username__iexact=name, public_id__iexact=pid)
else:
    matches = User.objects.filter(username__iexact=user_id)
```

## Rule AUTH-3: JWT is the only API authentication, and admin-ness is decided server-side from `is_staff`

`REST_FRAMEWORK["DEFAULT_AUTHENTICATION_CLASSES"]` lists exactly
`users.authentication.BanAwareJWTAuthentication` (`settings.py`): simplejwt's `JWTAuthentication` plus the
ban gate of AUTH-13, adding no query; `django.contrib.sessions` exists only for Django admin. Every `users/` endpoint is
`@api_view` plus `permission_classes` (`AllowAny` for login/signup/google/logout, `IsAuthenticated` for
`me/`, `update-profile/` and every friends endpoint; `get_users` reads `request.user.is_authenticated`
itself so guests can view the global board). Admin endpoints (`trivia/admin_api.py`,
`trivia/feedback_api.py`, mounted at `api/admin/` via `trivia/admin_urls.py`) use `IsAdminUser`, i.e.
`is_staff`. `user_payload()` returns `"is_admin": bool(user.is_staff)` purely as a UI hint (its comment says
so); `Admin.tsx` and `Navigation.tsx` read `user.is_admin` to show or hide UI, never to authorize.
`is_staff` is granted only by `users/management/commands/promote_admin.py` or Django admin, never by an API
field a client can send.

```python
❌ WRONG — session-cookie gate, or trusting a client-visible flag
@login_required
def admin_games(request): ...
if request.data.get("is_admin"): ...

✅ RIGHT — backend/trivia/admin_api.py
@permission_classes([IsAdminUser])
def admin_games(request):
```

## Rule AUTH-4: Session lifetime is enforced in two layers; `SIMPLE_JWT` alone is not the cap

`SIMPLE_JWT` gives a 15-minute access token and a 90-day refresh token that rotates and blacklists its
predecessor (`ROTATE_REFRESH_TOKENS` + `BLACKLIST_AFTER_ROTATION`). Rotation alone would keep an active
player signed in forever, so `users/tokens.py` `issue_session_tokens()` stamps the original sign-in time as
`auth_time`, and `SessionRefreshSerializer.validate()` raises `InvalidToken` once it is older than
`MAX_SESSION_AGE` (90 days). `users/urls.py` mounts `token/refresh/` on `SessionRefreshView` (throttled by
`RefreshRateThrottle`), never the stock `TokenRefreshView`. The serializer also returns the `/me/` payload
as `data["user"]` so the frontend can resume in one round trip (see AUTH-5). `logout_view` blacklists the
refresh token. Every place that mints tokens must go through `issue_session_tokens()` (via `auth_response`).

```python
❌ WRONG — stock minting, no auth_time claim, so rotation never expires
refresh = RefreshToken.for_user(user)

✅ RIGHT — backend/users/views.py
def auth_response(request, user, status_code=status.HTTP_200_OK, **extra):
    refresh = issue_session_tokens(user)
```

## Rule AUTH-5: Tokens live in `localStorage` under `"accessToken"`/`"refreshToken"`, and a return visit shows the cached user then settles in one round trip

**Changed meaning vs the previous doc.** The helpers in `src/utils/Api.tsx` (`getAccessToken`,
`getRefreshToken`, `setTokens`, `clearTokens`) are now the dominant path: `Api.tsx`, `providers.tsx` and
`LogInSignUp.tsx`'s `handleLogin` use them. The remaining direct `localStorage` token access is
`LogInSignUp.tsx` (`handleSignUp` and the Google `onSuccess`) and `UserProfile.tsx` (`handleLogout`); all of
it uses the same two literal keys, and every reader assumes them with no fallback. New code should call the
helpers.

Hydration (`src/app/providers.tsx` `restoreSession`, helpers in `src/utils/session.ts`):
- No refresh token: `clearCachedUser()` + `dispatch(logout())` (guest).
- Otherwise `readCachedUser()` (key `nba3via-session-user`, display-only, never holds a token) is dispatched
  as `hydrateSession`, which leaves `authChecked` false and is a no-op once `authChecked` is true.
- Access token missing/expired (`isAccessTokenExpired`, 30 s skew): `refreshSession()` and use its `user`;
  else (or if `user` absent) `apiFetch(/me/)`. A 200 dispatches `login(user)`.
- Only a server verdict clears tokens and cache and shows guest UI (refresh refused, or `/me/` 401). A
  network error (`SessionNetworkError`), a 5xx or a malformed body changes nothing and leaves `authChecked`
  false for the next load.
- A store subscriber in `providers.tsx` writes every signed-in user change through `writeCachedUser` and
  clears it on a settled logout.

```tsx
❌ WRONG — a different key (invisible to every reader), or clearing the session on a network blip
localStorage.setItem("access_token", data.access);
} catch { clearTokens(); clearCachedUser(); dispatch(logout()); }

✅ RIGHT — src/utils/Api.tsx helper, and providers.tsx's "only a dead session flips to guest"
setTokens(data.access, data.refresh);
if (err instanceof SessionNetworkError || getRefreshToken()) { console.error("Session check failed:", err); }
```

## Rule AUTH-6: `points`/`rank` have exactly one write site, `trivia.views.log_session`, and the client never names its own score

`log_session` records the `GameSession` and awards its points in one step: the score is clamped to
`MAX_SESSION_POINTS` (1000; the highest renderer score is 300), it is throttled by `ScoreSubmitRateThrottle`
(`score-submit`, 60/hour), and it returns `{awarded, points, rank}`, which `MiniGame.tsx`'s `awardPoints`
displays via `updatePoints(data.awarded)`. `users/views.py` `update_profile` rejects any `points` field with
HTTP 400 (username via JSON, photo via multipart only). `CustomUser.update_rank()` maps thresholds
100/200/400/700/1200/2000/3000/5000 to the 9 `RANK_CHOICES` (Rookie below 100, GOAT at 5000+). The
frontend never holds rank labels or thresholds and only displays `user.rank` as the backend returned it.
`userSlice.tsx`'s `updateRank` action is defined but never dispatched (pre-existing dead code; leave it).
Known ceiling: clamp x throttle caps gain at 60 x 1000 per hour per account; per-game caps or server-side
re-scoring are not implemented.

```python
❌ WRONG — trusting a client total, or a second writer that leaves rank stale
user.points += request.data.get("points")

✅ RIGHT — backend/trivia/views.py
if user is not None and mode == 'single' and score > 0:
    awarded = score
    user.points += awarded
    user.update_rank()
    user.save(update_fields=['points', 'rank'])
    leaderboard.record_score(user)
```

## Rule AUTH-7: Guests can play but are awarded nothing, and multiplayer results never touch account points

`log_session` is `AllowAny`: a guest's request has no JWT, `user` is `None`, a `GameSession` row is still
written, and the response is `awarded: 0, points: 0, rank: None`. `MiniGame.tsx` says so ("guests log
anonymously and are simply awarded nothing") and `GuestPanel.tsx` prompts sign-in. Only `mode == 'single'`
awards; `match`/`friend` modes log a session but award 0. Online and friend play are signed-in only in the UI
(`isLoggedIn` gates in `MultiPlayer/MultiplayerPanel.tsx` and `MultiPlayer/FriendPlay.tsx`), and
`OnlineMatch.tsx`, `FriendPlay.tsx` and `MultiplayerContext.tsx` contain no `log-session`/`update-profile`
call. Wiring multiplayer results into account points adds a second caller to AUTH-6's single writer:
`risk: high`.

```python
❌ WRONG — awarding regardless of mode/identity
user.points += score   # user may be None (guest), mode may be 'match'

✅ RIGHT — backend/trivia/views.py
awarded = 0
if user is not None and mode == 'single' and score > 0:
```

## Rule AUTH-8: The multiplayer relay identifies a socket by its verified access token, never by the client's claim

`identify` carries `{ user, token }`, and only the token counts. `multiplayer_server/src/identity.js`
`verifyToken` sends it as `Authorization: Bearer` to Django's `GET /api/me/` (so the same
`BanAwareJWTAuthentication` gate applies) and caches the verdict per token for `VERIFY_TTL_MS` (60 s). The
relay keys the player by the **server's** payload (`uid = /me/ user.id`, email stripped), never by
`user.id` from the socket. 403 `account_banned` → `identifyError { code, message }` and
`socket.disconnect(true)`; 401/other 4xx → `invalid_token`; network error/5xx → `auth_unavailable` (fails
closed, not cached). `findMatch`, `createFriendRoom` and `joinFriendRoom` `await socket.identifying` and
re-check the token before acting. A token-less (old) client is not identified — supporting it would keep
the id-spoofing hole. The client (`MultiplayerContext.tsx` `identifyNow`) refreshes an expired access
token before emitting. `identity.js` is the only `Authorization` user in `multiplayer_server/src/`. Scores
and `game` objects sent over the socket are still client-claimed (MP-2): nothing privilege-sensitive
(awards, account mutation) may trust this channel, and any change to `identify` is `risk: high`.

```js
❌ WRONG — keying by the client's own claim (anyone can be anyone, banned accounts included)
socket.on("identify", ({ user } = {}) => { socket.uid = user?.id; });

✅ RIGHT — multiplayer_server/src/index.js
socket.identifying = identity.verifyToken(token).then((verdict) => {
  if (!verdict.ok) return refuseIdentity(verdict);
  socket.token = token;
  onIdentified(verdict.user);   // uid = the server's user.id
});
```

## Rule AUTH-9: Sensitive endpoints are throttled per view, and the cache backend is what makes that real

`backend/backend/throttles.py` defines `UserRateThrottle` subclasses (account-keyed when authenticated,
IP-keyed otherwise), applied per view with `@throttle_classes`; rates live in
`REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]`. Auth-relevant scopes: `auth-login` 30/h (`login_view`,
`google_login`), `auth-signup` 10/h (`signup_view`), `auth-refresh` 60/h (`SessionRefreshView`),
`score-submit` 60/h (`log_session`), `user-search` 120/h (`search_users`, `search_friends`),
`friend-action` 60/h (`send_friend_request`, `block_user`). There is deliberately no
`DEFAULT_THROTTLE_CLASSES`. Exceptions by design: `logout_view` and `profile_photo_view` are unthrottled.
Counters live in Django's cache, so `settings.py` tiers `CACHES`: `REDIS_URL` uses `RedisCache`, else
`DATABASE_URL` uses `DatabaseCache` (table `django_cache_table`), else `LocMemCache` (local only, since it
is per-process and every Vercel lambda is its own). Do not collapse this to LocMemCache;
`backend/vercel.json`'s build command must keep `python manage.py createcachetable`.

```python
❌ WRONG — a new credential/abuse-prone endpoint with no throttle, or a global default throttle
@api_view(["POST"])
@permission_classes([AllowAny])
def reset_password(request): ...

✅ RIGHT — backend/users/views.py
@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([LoginRateThrottle])
def login_view(request):
```

## Rule AUTH-10: A failed token refresh must settle every queued caller

`src/utils/Api.tsx` runs one refresh at a time (`isRefreshing`); concurrent callers park a `{resolve,
reject}` waiter and `onRefreshed` settles all of them inside a per-waiter `try/catch`. Every waiter must
settle on every path. Distinguish outcomes: a server-rejected refresh clears tokens and rejects; a network
failure throws `SessionNetworkError` and leaves tokens in place; a malformed 200 body rejects and leaves
tokens. `apiFetch` decides "is this 401 about the token?" from simplejwt's `code === "token_not_valid"`
(or a `messages[].message` containing "token"), never by scanning free text, and retries once with a token
rotated by a concurrent request before starting a refresh.

```tsx
❌ WRONG — a waiter that can only ever succeed
return new Promise<string>((resolve) => subscribeTokenRefresh((t) => { if (t) resolve(t); else throw new Error("x"); }));

✅ RIGHT — src/utils/Api.tsx
return new Promise<RefreshResult>((resolve, reject) => {
  subscribeTokenRefresh({ resolve, reject });
});
```

## Rule AUTH-11: `risk: high` surfaces: the auth files a task may not touch without that classification

A bug in these breaks or locks out every account, and each is a single unforked source of truth. Any task
touching them must be classified `risk: high`:

- `backend/users/models.py` (`CustomUser`, `RANK_CHOICES`, `update_rank`, `Friendship`/`FriendRequest`/`BlockedUser`) and any `backend/users/migrations/`
- `backend/users/identity.py`, `backend/users/tokens.py`
- `backend/users/views.py` auth endpoints: `login_view`, `signup_view`, `google_login`, `logout_view`, `get_current_user`, `update_profile`, `user_payload`, `auth_response`
- `backend/users/friends.py` block/request enforcement and `backend/users/photos.py` (privacy, AUTH-12)
- `backend/trivia/views.py` `log_session` (the points writer) and `backend/trivia/admin_api.py` / `feedback_api.py` permission decorators
- `backend/backend/settings.py` `AUTH_USER_MODEL`, `SIMPLE_JWT`, `REST_FRAMEWORK`, `CACHES`; `backend/backend/throttles.py`
- `src/utils/Api.tsx`, `src/utils/session.ts`, `src/store/userSlice.tsx`, `src/app/providers.tsx` (`restoreSession`)
- `multiplayer_server/src/index.js` `identify` handler and `multiplayer_server/src/identity.js` (AUTH-8)
- `backend/users/authentication.py`, `backend/users/strikes.py` (AUTH-13)

Not on the list: `get_users` (read-only leaderboard), `LogInSignUp.tsx` and `UserProfile.tsx` UI-only
edits that leave token keys, endpoints and payload shapes unchanged.

```text
❌ WRONG — a "standard" task editing tokens.py MAX_SESSION_AGE because a spec said "sessions should last longer"
✅ RIGHT — the same change classified risk: high and routed for extra review before merge
```

## Rule AUTH-12: Friend, block and photo endpoints enforce privacy on the server, with `request.user` as the only actor

`users/friends.py` never trusts a "who am I" claim: `me = request.user` and the other party arrives as a
`public_id` resolved by `_get_target`. Every friends endpoint is `IsAuthenticated`. Blocks are symmetric in
effect: `send_friend_request` returns 403 if a `BlockedUser` exists in either direction, and
`_relationship_map` omits blocked-either-way players from `search_users`. `block_user` deletes any
friendship and pending requests in one `transaction.atomic()`. Accept/decline act only on requests where
`receiver=request.user`, cancel only where `sender=request.user`. A `Friendship` is stored once, ordered by
pk (`Friendship.ordered_pair`), so both directions map to one row. List rows use `_brief()`: id, username,
points, rank, `photo_version`, and `profile_photo: None`. No email is ever in a list row (`email` appears
only in the signed-in user's own `user_payload`). Photo bytes never travel in a list row: the inline data
URL is only in the caller's own `user_payload`; everyone else's photo is the public, cacheable
`/api/users/<public_id>/photo/?v=<profile_photo_version>` (`photos.profile_photo_view`, unauthenticated by
design because an `<img>` cannot send a JWT; unknown id and no-photo both return the same 404). Uploads go
through `normalize_profile_photo` (4 MB cap, 40M-pixel cap, 256x256 JPEG) and bump `profile_photo_version`.

```python
❌ WRONG — acting on a client-claimed identity, or returning email/photo bytes in a list row
me = User.objects.get(public_id=request.data["my_id"])
return {"id": u.public_id, "email": u.email, "profile_photo": data_url}

✅ RIGHT — backend/users/friends.py
if BlockedUser.objects.filter(Q(blocker=me, blocked=target) | Q(blocker=target, blocked=me)).exists():
    return Response({"error": "You can't send a request to this player."}, status=403)
```

## Rule AUTH-13: Bans — `banned_at` is the switch, the auth class the gate, 403 `account_banned` the contract

`CustomUser.banned_at` set = banned; nothing else (not `is_active`) means "banned". Strikes come only from
`users.strikes.record_strike` (atomic, `select_for_update`); a severe username on `update-profile` is a
strike, the `MAX_STRIKES` (3) th bans in the same transaction, and strikes never expire. `ban_user` sets
`banned_at`/`ban_reason` (a code: `name_severe`, `photo`, `admin`) and `canonical_email`, blacklists every
`OutstandingToken` and calls `leaderboard.remove`. Every refusal answers **403** (never 401, which the
frontend treats as "refresh") with exactly `strikes.ban_payload(user)`:
`{"code": "account_banned", "error", "public_id", "strikes", "reason", "banned_at"}` — from the auth class
(every authenticated endpoint, raised as `strikes.AccountBanned` so DRF keeps the JSON types), `login_view`
(checked **after** the password, so ban status can't be probed by email; never "Incorrect password"),
`google_login`, and `SessionRefreshSerializer` (which decodes the token before the blacklist check, since a
ban blacklists it). Banned accounts are hidden, not deleted: leaderboard Postgres paths, `record_score`,
`sync_leaderboard`, `search_users` and the public photo endpoint (same 404) skip them; `unban_user` (the
admin "Unban (reset strikes)" action) restores everything. Signup attempts can't strike (no account): a
severe signup name counts per salted IP hash in the shared cache and the 3rd locks sign-ups from that IP
for 24 h (403 `signup_locked`); a new account whose canonical email (lowercase, `+tag` and Gmail dots
dropped) matches a banned one is refused — on `signup/` with exactly the taken-email 409, so the anonymous
endpoint is no ban oracle (the reason is only in the event log), on Google sign-up (address ownership
already proven) with 403 `signup_blocked`. That anti-evasion is weak by design (new address,
new IP) and is not a security boundary. `ModerationEvent` stores tier and reason codes only — never the
matched text or a raw IP. Word lists stay server-side: `check-name/` and every message are generic.

```python
❌ WRONG — a second ban flag, a 401, or a ban that only hides the UI
if user.is_banned: return Response({"detail": "banned"}, status=401)

✅ RIGHT — backend/users/authentication.py
user = super().get_user(validated_token)
if getattr(user, "banned_at", None):
    raise AccountBanned(user)   # 403 ban_payload(user)
```

---

## Acceptance checks

Run from the repo root. Expected outputs are from the current working tree.

1. **Users and score-award tests pass (AUTH-1..7, 9, 12).**
   ```bash
   cd backend && python manage.py test users trivia.tests.test_score_award
   ```
   Expect exit code 0 and `OK`.

2. **Points/rank have one write site (AUTH-6).**
   ```bash
   grep -rnE "\.points\s*\+=|\.update_rank\(" backend --include=*.py
   ```
   Expect only `backend/trivia/views.py` (`user.points += awarded`, `user.update_rank()`), plus the
   `def update_rank` definition in `backend/users/models.py` if the pattern is widened to `def `.

3. **`update_profile` still rejects client points (AUTH-6).**
   ```bash
   grep -n "Points are awarded from finished games" backend/users/views.py
   ```
   Expect one match.

4. **No rank label on the frontend (AUTH-6).**
   ```bash
   grep -rnE "Hall of Famer|All-NBA|GOAT|Sixth Man|Role Player" src
   ```
   Expect no output.

5. **Multiplayer components never call the award/profile endpoints (AUTH-7).**
   ```bash
   grep -rnE "update-profile|log-session" src/components/MultiPlayer src/context/MultiplayerContext.tsx
   ```
   Expect no output.

6. **Guests are not awarded (AUTH-7).**
   ```bash
   grep -n "user is not None and mode == 'single'" backend/trivia/views.py
   ```
   Expect one match (the award guard).

7. **The relay verifies tokens in exactly one place (AUTH-8).**
   ```bash
   grep -rnlE "Authorization" multiplayer_server/src
   cd multiplayer_server && npm test
   ```
   Expect only `multiplayer_server/src/identity.js`, and the `node --test` run passing (banned socket
   dropped, spoofed id ignored, token-less identify refused).

8. **The ban-aware JWT class is the only DRF auth class; user model declared once (AUTH-3, AUTH-13).**
   ```bash
   grep -nE "AUTH_USER_MODEL|BanAwareJWTAuthentication|IsAdminUser" backend/backend/settings.py
   ```
   Expect `users.authentication.BanAwareJWTAuthentication` and `AUTH_USER_MODEL = 'users.CustomUser'` once
   each, no session/basic auth class.

9. **Every admin view is `IsAdminUser`-gated (AUTH-3).**
   ```bash
   grep -c "permission_classes(\[IsAdminUser\])" backend/trivia/admin_api.py backend/trivia/feedback_api.py
   ```
   Expect the counts to equal the number of `@api_view` functions in each (2 and 3 today); a new admin view
   without `IsAdminUser` fails the check.

10. **`is_admin` is never sent from the client to authorize (AUTH-3).**
    ```bash
    grep -rn "is_admin" src --include=*.ts --include=*.tsx
    ```
    Expect only reads (`user?.is_admin`) and the type field in `userSlice.tsx`; no request body carrying it.

11. **Tokens minted only through `issue_session_tokens` (AUTH-4).**
    ```bash
    grep -rn "RefreshToken.for_user" backend --include=*.py
    ```
    Expect one match, in `backend/users/tokens.py`.

12. **Token keys are the literal pair everywhere (AUTH-5).**
    ```bash
    grep -rnE "localStorage\.(get|set|remove)Item\(['\"](access|refresh)" src
    ```
    Expect only `accessToken`/`refreshToken` literals, in `src/utils/Api.tsx`, `src/components/LogInSignUp.tsx`
    and `src/components/UserProfile.tsx`; no other key spelling, and no new file.

13. **Throttles present on the sensitive views (AUTH-9).**
    ```bash
    grep -rn "throttle_classes" backend/users backend/trivia/views.py
    ```
    Expect `LoginRateThrottle` (x2), `SignupRateThrottle`, `RefreshRateThrottle`, `ScoreSubmitRateThrottle`,
    `UserSearchRateThrottle` (x2), `FriendActionRateThrottle` (x2). Also
    `grep -n createcachetable backend/vercel.json` returns one match.

14. **Refresh waiters carry `reject` (AUTH-10).**
    ```bash
    grep -n "reject" src/utils/Api.tsx
    ```
    Expect the `RefreshWaiter` type and `subscribeTokenRefresh({ resolve, reject })`.

15. **Blocks are enforced in both directions (AUTH-12).**
    ```bash
    grep -n "blocker=target, blocked=me" backend/users/friends.py
    ```
    Expect a match in `send_friend_request`; and `grep -n "email" backend/users/friends.py` returns no
    output (no email in friend payloads).

16. **Bans answer 403 `account_banned` everywhere and hide the player (AUTH-13).**
    ```bash
    cd backend && python manage.py test users.test_strikes users.test_moderation
    ```
    Expect `OK` (three severe renames ban; `/me/`, login, Google login and refresh each 403; signup IP lock;
    hidden from boards/search/photo; unban restores; 0 severe hits on the 5208 player names).
