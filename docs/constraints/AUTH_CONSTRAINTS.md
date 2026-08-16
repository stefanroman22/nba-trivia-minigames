# Auth Constraints (identity, tokens, rank)

**Scope:** the account/identity surface — `backend/users/` (`CustomUser`, `identity.py`,
`tokens.py`, the auth endpoints in `views.py`) and its frontend consumers (`src/utils/Api.tsx`'s
token helpers, `src/components/LogInSignUp.tsx`, `src/App.tsx`'s login bootstrap,
`src/store/userSlice.tsx`, `src/components/UserProfile.tsx`). `BACKEND_CONSTRAINTS.md` already
covers the *generic* Django conventions every `users/` endpoint also follows — DRF `@api_view`
usage (BE-9), the hand-built-dict response shape (BE-10), broad `try/except` error handling
(BE-12), trailing-slash URLs and the `api/` mount prefix (BE-13), the `os.environ.get`/`env_bool`
settings pattern (BE-14), and the one hand-authored data migration (BE-6, `0003_identity_overhaul.py`)
— none of that is restated here. This doc covers what's specific to *identity*: the custom user
model's shape, how tokens/sessions actually work, the rank system's boundary, and what a task may
not touch without being classified `risk: high`.

**Reference implementations** (read these before touching auth code):

| Concern | Reference |
|---|---|
| Custom user model + rank thresholds | `backend/users/models.py` |
| Public player ID generation | `backend/users/identity.py` |
| Session/refresh-token lifetime | `backend/users/tokens.py` |
| Auth endpoints (login/signup/google/logout/me/update-profile) | `backend/users/views.py` |
| Leaderboard (public_id-keyed reads/writes) | `backend/users/leaderboard.py` |
| URL mounting | `backend/users/urls.py` (mounted at `api/` — see BE-13) |
| JWT + custom-user Django settings | `backend/backend/settings.py` (`AUTH_USER_MODEL`, `SIMPLE_JWT`, `REST_FRAMEWORK`) |
| Token storage + refresh-on-401 | `src/utils/Api.tsx` |
| Login/signup/Google forms | `src/components/LogInSignUp.tsx` |
| Login-state bootstrap on page load | `src/App.tsx` |
| Redux login-state slice | `src/store/userSlice.tsx` |
| Profile screen (username/photo/logout) | `src/components/UserProfile.tsx` |

Everything below is measured from the live codebase (working tree, not just the last commit).
Where the code is inconsistent, the DOMINANT pattern is documented and the exception is called
out explicitly — nothing here is an aspirational convention the code doesn't actually show.

---

## Rule AUTH-1: Email is the unique login identity; `username` is a non-unique display name; `public_id` is the cross-system player key

`CustomUser` sets `USERNAME_FIELD = "email"` with `email = models.EmailField(unique=True)`, while
`username` is deliberately non-unique (`models.py`'s own comment: "any number of accounts can be
called Baller23"). The permanent, unambiguous 6-character `public_id`
(`identity.py`'s `generate_public_id()`, alphabet drops `0/O`/`1/I`, collision-retried up to 8x in
`CustomUser.save()`) is what every consumer actually keys by: `user_payload()`'s `"id":
user.public_id` (`views.py`), `backend/users/leaderboard.py`'s `top()`/`rank_of()`/`record_score()`
(all keyed by `public_id`), and the multiplayer server's `players` Map (`user.id`, which is the frontend's
`public_id` — see `MULTIPLAYER_CONSTRAINTS.md` MP-1). A task must never treat `username` as a
unique lookup key or a stable identity.

```python
❌ WRONG — a new feature querying/keying by username as if it were unique
def get_profile(request, username):
    return CustomUser.objects.get(username=username)  # multiple accounts can share this name

✅ RIGHT — backend/users/leaderboard.py, keyed by the permanent public_id everywhere
names = dict(User.objects.filter(public_id__in=ids).values_list("public_id", "username"))
```

## Rule AUTH-2: `login_view` accepts three input shapes — email, bare username, or `Name#ID` — and a task must preserve all three

The branching is literal string-shape sniffing on the submitted `id` field: contains `"@"` →
email lookup; contains `"#"` → `username__iexact` + `public_id__iexact` split on the last `#`;
otherwise a bare `username__iexact` lookup that errors ("Several players use that name...") if
more than one account matches. This is the only place that ambiguity is resolved — the frontend
(`LogInSignUp.tsx`) just forwards whatever the player typed as `id`.

```python
❌ WRONG — "simplifying" login to email-only, dropping username/Name#ID support
matches = User.objects.filter(email__iexact=user_id)

✅ RIGHT — users/views.py, all three forms handled
if "@" in user_id:
    matches = User.objects.filter(email__iexact=user_id)
elif "#" in user_id:
    name, _, pid = user_id.rpartition("#")
    matches = User.objects.filter(username__iexact=name, public_id__iexact=pid)
else:
    matches = User.objects.filter(username__iexact=user_id)
```

## Rule AUTH-3: JWT (`djangorestframework-simplejwt`) is the only API authentication mechanism — no session-based API auth

`REST_FRAMEWORK["DEFAULT_AUTHENTICATION_CLASSES"]` lists exactly
`rest_framework_simplejwt.authentication.JWTAuthentication`. `django.contrib.sessions` is
installed only for Django admin, not for the API. Every `users/` view already uses
`@api_view`/`permission_classes` (see `BACKEND_CONSTRAINTS.md` BE-9 for the general
plain-view-vs-`@api_view` boundary — `users/` endpoints are 100% on the `@api_view` side of that
line already, nothing new to decide here). A task must not add a session-cookie or
`@login_required` check to an API view — it would authenticate against a mechanism the frontend
never establishes.

```python
❌ WRONG — gating a new endpoint with Django's session-based decorator
@login_required
def get_notifications(request):
    ...

✅ RIGHT — matching every existing users/ endpoint
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_notifications(request):
    ...
```

## Rule AUTH-4: Session lifetime is enforced in two layers — `SIMPLE_JWT` alone is not the cap

`SIMPLE_JWT` (`settings.py`) gives a 15-minute access token and a 90-day refresh token that
rotates and blacklists its predecessor on every use (`ROTATE_REFRESH_TOKENS` +
`BLACKLIST_AFTER_ROTATION`) — but rotation alone would let an active player stay signed in
forever. `users/tokens.py` closes that gap: `issue_session_tokens()` stamps every fresh refresh
token with the *original* sign-in time (`auth_time`), and `SessionRefreshSerializer.validate()`
raises `InvalidToken` once `time.time() - auth_time > MAX_SESSION_AGE` (90 days), regardless of
how recently the token was rotated. `users/urls.py` wires `token/refresh/` to
`SessionRefreshView`, not DRF-simplejwt's stock `TokenRefreshView`. Any code that mints or
refreshes tokens outside `issue_session_tokens()`/`SessionRefreshView` bypasses the absolute cap.

```python
❌ WRONG — a new endpoint minting tokens with the stock call, skipping the auth_time stamp
from rest_framework_simplejwt.tokens import RefreshToken
refresh = RefreshToken.for_user(user)  # no auth_time claim -> rotation never expires

✅ RIGHT — users/views.py's auth_response, via the one issuing function
def auth_response(request, user, status_code=status.HTTP_200_OK, **extra):
    refresh = issue_session_tokens(user)
    ...
```

## Rule AUTH-5: Tokens live in `localStorage` under the literal keys `"accessToken"`/`"refreshToken"` — direct access is actually more common than the helper module

A helper module exists (`src/utils/Api.tsx`: `getAccessToken`/`getRefreshToken`/`setTokens`/
`clearTokens`) and is used by `apiFetch`'s own 401-refresh cycle and by `LogInSignUp.tsx`'s
`handleLogin`. But it is **not** the dominant pattern: `App.tsx`'s login-bootstrap
(`checkLogin`), `LogInSignUp.tsx`'s `handleSignUp` and Google-login success handler, and
`UserProfile.tsx`'s `handleLogout` all read/write `localStorage.getItem/setItem/removeItem`
directly with the same two literal strings instead of calling the helper. Whichever way a task
touches tokens, it must keep using exactly `"accessToken"`/`"refreshToken"` — every read site
(`getAccessToken`, `App.tsx`'s bootstrap check, `apiFetch`) assumes those literal keys with no
fallback.

```tsx
❌ WRONG — a new write path inventing a different key (silently invisible to every reader)
localStorage.setItem("access_token", data.access); // getAccessToken() reads "accessToken"

✅ RIGHT — either the helper (LogInSignUp.tsx's handleLogin)...
setTokens(data.access, data.refresh);
// ...or matching the literal keys directly (LogInSignUp.tsx's handleSignUp, App.tsx, UserProfile.tsx)
localStorage.setItem("accessToken", data.access);
localStorage.setItem("refreshToken", data.refresh);
```

## Rule AUTH-6: `points`/`rank` have exactly one write site in the whole backend — and rank's thresholds are never duplicated on the frontend

`user.points += points; user.update_rank(); user.save()` inside `update_profile`'s JSON branch
(`views.py`) is the **only** place in `backend/` that mutates `points` or calls `update_rank()` —
confirmed by grepping the whole backend for both. `update_rank()` maps 9 fixed point thresholds
(100/200/400/700/1200/2000/3000/5000) to `RANK_CHOICES` in ascending order. The frontend never
recomputes or duplicates this ladder — no rank label/threshold string appears anywhere under
`src/`, `user.rank` is only ever displayed verbatim from whatever the backend last returned, and
`userSlice.tsx`'s `updateRank` action is defined but never dispatched anywhere in the app (dead
code, confirming there is no client-side rank path to accidentally diverge from the server).

```python
❌ WRONG — a second endpoint incrementing points without going through update_rank()
def award_bonus(request):
    request.user.points += 50
    request.user.save()  # rank now stale until the next update_profile call

✅ RIGHT — users/views.py's update_profile, the one existing writer
if points is not None:
    user.points += points
    user.update_rank()
    updated = True
```

## Rule AUTH-7: Multiplayer match results never touch `points`/`rank` — a win/loss is settled entirely on the Node server

`OnlineMatch.tsx`, `MultiplayerContext.tsx`, and `FriendPlay.tsx` contain no `apiFetch`/
`update-profile` call anywhere — a multiplayer `matchResult` only updates the in-memory Socket.IO
room and the client's local `mp.yourScore`/`standings`. Only single-player's `MiniGame.tsx`
`awardPoints()` flow (called from the in-place/result-overview paths) ever POSTs to
`/api/update-profile/`. This means an online win or loss currently does not change a player's
account points or rank at all. A task that wires multiplayer results into account points would be
adding a second caller to the one points-mutation site (AUTH-6) and touching the identity surface
— classify it `risk: high`.

```tsx
❌ ASSUMING (incorrectly) that multiplayer already awards points, and "fixing a bug" that awards double
// OnlineMatch.tsx already has no award-points call — there's nothing to double here today

✅ RIGHT — confirmed absence, so a genuinely new task is required and must be risk: high
// grep -n "update-profile\|updatePoints" src/components/MultiPlayer src/context/MultiplayerContext.tsx
// -> no matches (verified below)
```

## Rule AUTH-8: The multiplayer server trusts the client-submitted `identify` payload unverified — it never checks the JWT

`multiplayer_server/src/index.js`'s `identify` handler takes `uid = user?.id || user?.username`
and the entire `user` object straight from whatever the socket emits — there is no `jwt`,
`verify`, or `Authorization` handling anywhere in `multiplayer_server/src/*.js` (confirmed by
grep, see Acceptance checks). The Node server has no way to confirm the identity it's told is the
one Django actually authenticated. A task must not add anything privilege-sensitive (moderation,
payouts, account mutation) that trusts data arriving over this channel — and any change to what
flows through `identify` is identity-adjacent, so classify it `risk: high`.

```js
❌ WRONG — trusting the identify payload for something privilege-sensitive
socket.on("identify", ({ user } = {}) => {
  if (user?.isAdmin) grantModTools(socket); // client fully controls this field

✅ RIGHT — identify is only ever used for realtime display/matchmaking (index.js, unchanged)
const uid = user?.id || user?.username;
socket.uid = uid;
players.set(uid, { socketId: socket.id, user, roomCode: prev?.roomCode ?? null });
```

## Rule AUTH-9: `risk: high` surfaces — the exact file list a task must not touch without that classification

Per the pipeline's `classify` skill (`.superpowers/sdd/.../task-10-brief.md`: "risk: high if it
touches auth..."), the auth surface is every file where a bug breaks or locks out *every*
account, not just one game — each of these is a single, unforked source of truth with no fallback
path:

- `backend/users/models.py` (`CustomUser`, `RANK_CHOICES`, `update_rank`)
- `backend/users/identity.py` (public ID generation/alphabet)
- `backend/users/tokens.py` (session lifetime enforcement)
- `backend/users/views.py`'s auth endpoints — `login_view`, `signup_view`, `google_login`,
  `logout_view`, `get_current_user`, `update_profile` (not `get_users`, which only *reads*
  identity data for the public leaderboard)
- `backend/backend/settings.py`'s `AUTH_USER_MODEL`, `SIMPLE_JWT`, `REST_FRAMEWORK` blocks
- `src/utils/Api.tsx` (token storage/refresh)
- `src/store/userSlice.tsx` (client login-state shape)
- `src/App.tsx`'s `checkLogin` bootstrap
- `multiplayer_server/src/index.js`'s `identify` handler and `players`/`publicUser` (AUTH-8)

```text
❌ WRONG — a "standard" task quietly editing backend/users/tokens.py's MAX_SESSION_AGE
  because a spec mentioned "make sessions last longer" — classified difficulty: standard

✅ RIGHT — the same change classified risk: high per this list, routed for extra review
  before merge (per the classify skill's "CTO gets a Risk: high PR label and extra scrutiny")
```

---

## Acceptance checks

Concrete commands (run from the repo root unless noted) an automated reviewer can run against a
diff. All outputs below were captured directly against the current working tree.

**1. The `users` app's test suite passes.**
```bash
cd backend && python manage.py test users
```
Observed: `Found 30 test(s).` ... `OK` (30/30 passing; see `BACKEND_CONSTRAINTS.md` BE-18 for why
`users` alone, not a bare `manage.py test`, is the right invocation to isolate this app).

**2. `points`/`rank` are mutated in exactly one place in the backend (Rule AUTH-6).**
```bash
grep -rn "\.points\s*[+]=\|update_rank(" backend/users backend/trivia
```
Observed:
```
backend/users/models.py:66:    def update_rank(self):
backend/users/views.py:186:            user.points += points
backend/users/views.py:187:            user.update_rank()
```
Exactly one call site (`views.py`'s `update_profile`) plus the method definition itself — no
other file appears.

**3. No rank label/threshold is duplicated on the frontend (Rule AUTH-6).**
```bash
grep -rn "Hall of Famer\|All-NBA\|GOAT\|Sixth Man" src
```
Observed: no output (no matches) — the frontend never hardcodes a rank name.

**4. Multiplayer components never call the points-awarding endpoint (Rule AUTH-7).**
```bash
grep -rn "update-profile\|updatePoints" src/components/MultiPlayer src/context/MultiplayerContext.tsx
```
Observed: no output (no matches) — confirmed absent.

**5. No JWT verification exists anywhere in the multiplayer server (Rule AUTH-8).**
```bash
grep -rn "jwt\|verify\|Authorization" multiplayer_server/src/*.js
```
Observed: no output (no matches).

**6. `AUTH_USER_MODEL` and the JWT config are declared exactly once, in `settings.py` (Rule AUTH-3, AUTH-9).**
```bash
grep -n "AUTH_USER_MODEL\|DEFAULT_AUTHENTICATION_CLASSES" backend/backend/settings.py
```
Observed:
```
111:    "DEFAULT_AUTHENTICATION_CLASSES": (
240:AUTH_USER_MODEL = 'users.CustomUser'
```

**7. Token-key literal count across the frontend (Rule AUTH-5) — direct access outnumbers the helper.**
```bash
grep -rn "localStorage.*ccessToken\|localStorage.*efreshToken" src --include=*.tsx --include=*.ts
```
Observed: 16 matches across `src/App.tsx`, `src/components/LogInSignUp.tsx`,
`src/components/UserProfile.tsx`, and `src/utils/Api.tsx` — all using the same two literal key
strings.
