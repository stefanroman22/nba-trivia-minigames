# Design: faster-logged-in-state

Task: "When I enter the website it takes a long time to see that I am actually logged in. Find a
way to make it faster such that when user return to website and logged in session still active it
will appear much faster that he is logged in" (Category fullstack, P2, Difficulty override `hard`,
title-only spec, no attachments or owner comments).

Classify: hard / frontend + backend + auth / risk high. Design round 2026-09-23, planner on fable.
Branch `team/faster-logged-in-state` (cut from `origin/dev` f0dbb78).

## Decision summary

**Engine: sonnet** — 9 steps, each with an exact file, the exact code and a done-check command; the
judgment calls (cache posture, hydration point, reconcile rules, what the backend returns) are
settled here, not left to the build.

**Seats.** This cloud session has no `Agent` tool and `ListAgents` shows no engine teammates (fourth
cloud design round in a row — see `docs/team/DECISIONS.md` 2026-09-20/09-22/09-23), so the
`backend-engine` and `frontend-engine` proposal seats were filled by the planner from source. The
sign-off pass is the 5b self-review at the end of this doc.

**Root cause, verified in code.** `src/app/providers.tsx` `checkLogin` runs after hydration with
Redux in its logged-out initial state and calls `apiFetch(/me/)`. `SIMPLE_JWT.ACCESS_TOKEN_LIFETIME`
is 15 minutes, so on nearly every return visit that request is a `401 token_not_valid`, which
`apiFetch` answers with `POST token/refresh/` (rotation + blacklist row + the `auth_time` cap check)
and then a second `GET /me/`. Three sequential round trips to a Vercel serverless Django (cold on
the first) and the Supabase pooler — and `Navigation` shows the "Log in" button, `Landpage` the
`GuestPanel`, until the third one resolves. Both key off `state.user.user` being null.

**D1 — Show the last known user immediately, from a display-only localStorage cache.** The last
`/me/` payload is kept under `nba3via-session-user` (the `nba3via-theme` key style). On mount, if a
refresh token exists and the cache parses, `hydrateSession(cached)` puts it in the slice before any
network call; `Navigation`/`Landpage`/`UserProfile`/`MultiplayerPanel` render signed-in at
hydration time instead of after three hops. The read happens in `AppEffects`' `useEffect`, never
during render (SSR markup is the guest UI; a render-time read would be a Next hydration mismatch).
A pre-hydration inline script was rejected: `Navigation`'s guest button and user chip are different
DOM, so a CSS flip can't switch them without duplicating the chip's markup server-side; the residual
guest flash is the JS-load-to-hydration window (~100-400 ms) and is noted as a possible follow-up.

*Security posture (why this is acceptable on the AUTH-9 surface):* the cache holds exactly what
`/me/` returns — `id`, `username`, `email`, `rank`, `points`, the profile-photo data URL and the
`is_admin` UI hint — and it lives in the same localStorage, same origin, as the 90-day refresh
token that already grants everything about the account. Anything that can read the cache can
already read the tokens, so the cache adds no capability. It never holds a token (the two token
keys stay exactly `accessToken`/`refreshToken`, AUTH-5). It is display-only: every admin endpoint
re-checks `is_staff` server-side, `Admin.tsx` keeps gating on `authChecked` (which `hydrateSession`
deliberately does not set), and points/rank are only ever what the server last said. It is
cleared on logout (any `logout` dispatch), on every failed session check, on a corrupt read, and on
a load with no refresh token.

**D2 — Settle with the server in one round trip, not three.** The access token's `exp` is decoded
client-side (base64url, no library). Expired or missing → `POST token/refresh/` directly, skipping
the dead `/me/` 401. Still valid (return within 15 min) → `GET /me/`, no refresh, no rotation. The
refresh goes through `Api.tsx`'s existing single-flight queue (renamed `refreshSession`, exported),
never an ad-hoc `fetch`: with rotation + blacklist, two parallel refreshes would blacklist each
other's token and log the player out — `useLeaderboard` fires an `apiFetch` on the same mount and
must share the one refresh. The number of rotations does not change (a refresh happens exactly
where a 401-triggered one happened before), so the `auth-refresh` throttle and blacklist churn are
untouched. `apiFetch` itself keeps its 401-then-refresh behaviour; the proactive check is only in
the bootstrap (scope).

**D3 — `token/refresh/` returns the `/me/` payload alongside the tokens.** `SessionRefreshSerializer.validate`
adds `"user": user_payload(...)` after the stock rotation, so the expired-token return visit is one
request total. The frontend treats `user` as optional (falls back to `/me/` when absent), so the
backend half ships first and an older frontend simply ignores the key. Chosen over leaving the
backend alone because the first return visit after this deploy — tokens present, no cache yet —
would otherwise still be two hops, and the reconcile of a cached user is faster on every visit.

**D4 — Reconcile rules (what the cache does when the server answers).**
| Server outcome | Action |
|---|---|
| `/me/` 200, or refresh 200 with `user` | `login(user)` — replaces the cached user in place (same chip, fresher numbers), rewrites the cache, sets `authChecked` |
| refresh refused (401/any non-2xx — `Api.tsx` clears both tokens and throws), or `/me/` 401 | `clearTokens()`, `clearCachedUser()`, `logout()` — the one legitimate chip→guest transition, only when the session is really dead |
| `/me/` non-401 error (5xx) or fetch threw with tokens still present (offline, backend down) | nothing changes: cached user stays, tokens and cache stay, `authChecked` stays false; the next load checks again |
| no refresh token at all | `clearCachedUser()`, `logout()` |
Today a 5xx from `/me/` deletes the tokens and logs the player out; the new rule keeps the session
across a backend hiccup — deliberate, stated here so review sees it. Never chip→guest→chip.

**D5 — Cache writes ride on the store.** One `store.subscribe` in `AppEffects` writes the cache
whenever `state.user.user` changes (login, `updatePoints`, `updateUsername`, `updateProfilePhoto`)
and clears it on a settled logout. No edits to `LogInSignUp.tsx`/`UserProfile.tsx` — every existing
`login`/`logout` dispatch is covered, and a stale points value can't survive a session.

**Not planned (needs its own card):** a pre-hydration inline script to remove the remaining
JS-load guest flash; a proactive `exp` check inside `apiFetch` for every call (only the bootstrap
gets it here).

## Interfaces

### Backend (built first; the frontend relies only on this section)

```
POST /api/token/refresh/            users/urls.py name="token_refresh", users.tokens.SessionRefreshView (unchanged route/throttle)
  body:   {"refresh": "<refresh token>"}
  200:    {"access": "<jwt>", "refresh": "<rotated jwt>",
           "user": {"id": str, "username": str, "email": str, "rank": str, "points": int,
                    "profile_photo": str|null, "is_admin": bool}}      # == GET /me/ "user" (users.views.user_payload)
  401:    unchanged — {"detail": ..., "code": "token_not_valid"} for a blacklisted/expired/over-cap token
```

### Frontend

```ts
// src/store/userSlice.tsx
export type User = { id: string; username: string; email: string; rank: string; points: number;
                     profile_photo: string | null; is_admin?: boolean };      // now exported, shape unchanged
hydrateSession(user: User)   // new reducer: isLoggedIn=true, user=payload, authChecked untouched; no-op once authChecked

// src/utils/session.ts (new)
export function isSessionUser(value: unknown): value is User
export function readCachedUser(): User | null          // localStorage "nba3via-session-user"; corrupt → cleared → null
export function writeCachedUser(user: User): void
export function clearCachedUser(): void
export function isAccessTokenExpired(token: string): boolean   // exp*1000 <= now + 30 s; unreadable → false

// src/utils/Api.tsx
export type RefreshResult = { access: string; user?: User };
export async function refreshSession(): Promise<RefreshResult>   // was private refreshAccessToken(): Promise<string>
```

## File plan

| File | Change |
|---|---|
| `backend/users/tokens.py` | `SessionRefreshSerializer.validate` returns `user` (B1). |
| `backend/users/tests.py` | `SessionLifetimeTests`: extend the round-trip test, add one payload-equality test (B2). |
| `docs/ARCHITECTURE.md` | `token/refresh` bullet mentions the user payload (B3). |
| `src/store/userSlice.tsx` | export `User`; `hydrateSession` reducer (F1). |
| `src/utils/session.ts` | New: cache helpers + `isAccessTokenExpired` (F2). |
| `src/utils/Api.tsx` | `refreshAccessToken` → exported `refreshSession` returning `RefreshResult` (F3). |
| `src/app/providers.tsx` | New bootstrap + cache subscriber (F4). |
| Everything else | untouched — explicitly `LogInSignUp.tsx`, `UserProfile.tsx`, `Navigation.tsx`, `Landpage.tsx`, `Admin.tsx`, `MultiplayerContext.tsx`, `users/views.py`, `settings.py`, `urls.py`, `throttles.py`. |

## Risks

- **Client-side cache of profile data (the `risk: high` reason).** Bounded per D1: display-only,
  same storage/origin as the refresh token, no token inside, cleared on logout/failed check/corrupt
  read. Reviewer checks: `session.ts` never touches `accessToken`/`refreshToken`; `hydrateSession`
  never sets `authChecked`; the subscriber clears on `logout`.
- **Optimistic `is_admin`.** The Admin nav link can show from cache for the reconcile window; the
  Admin page keeps its `authChecked` loader, and every admin endpoint 401/403s a non-staff token.
  A revoked admin sees the link for under a second, then it disappears.
- **Two refreshes in flight.** All refreshes go through the single-flight queue in `Api.tsx`
  (AUTH-11 invariant kept: every waiter settles on every path — the waiter type changes shape,
  not behaviour). The pre-existing two-tabs-opened-at-once race (both rotate the same token) is
  unchanged: the proactive refresh fires at the same moment the 401-triggered one did.
- **Clock skew.** A client clock ahead of the server refreshes a still-valid token early (one
  extra rotation, harmless); a clock behind sends an expired token to `/me/` and lands on the
  existing 401 → refresh path. Unreadable tokens take the `/me/` path too.
- **Refresh throttle (60/h per account/IP).** Unchanged count: a bootstrap refresh happens only
  when the access token is expired, at most once per 15 minutes per device; reloads inside that
  window go to `/me/` with the still-valid token.
- **5xx no longer logs out (D4).** A cached user stays shown through a backend outage;
  `authChecked` stays false so the Admin page keeps its loader. This is the intended change.
- **`localStorage` unavailable / quota.** Every read and write is wrapped; the page degrades to
  today's network path. The photo data URL is ≤ ~35 KB (256 px JPEG), far under the quota.
- **Deploy order.** Backend first (pipeline split). The old frontend ignores the new `user` key;
  the new frontend falls back to `/me/` when `user` is missing. No migration, no settings change.
- **Extra query per refresh.** simplejwt's stock `validate` already loads the user for the
  `is_active` rule; B1 adds one more indexed `pk` lookup. Trivial next to the round trip it removes.

## Test plan

Baseline on this branch: `cd backend && .venv/bin/python manage.py test users` → `Ran 57 tests … OK`.

After the backend steps:
1. `cd backend && .venv/bin/python manage.py check` → `System check identified no issues`.
2. `cd backend && .venv/bin/python manage.py test users` → `Ran 58 tests … OK` (57 + 1 new; one extended).
3. `cd backend && .venv/bin/python manage.py test users trivia` → `OK`.

After the frontend steps:
4. `npx next typegen && npx tsc --noEmit` → exit 0.
5. `npm run lint` → no errors.
6. Browser QA (browser-qa stage, local Django from this worktree, DevTools Network + Application
   panels; throttle Network to "Slow 3G" to make timing observable):
   a. Sign in. Application → Local Storage shows `nba3via-session-user` holding the `/me/` JSON
      next to `accessToken`/`refreshToken`.
   b. Reload within 15 minutes: the user chip (avatar + name + `#id`) and the profile card are
      visible on first paint after hydration, before any request completes; Network shows exactly
      one auth request, `GET /api/me/` → 200, and no `token/refresh/`.
   c. Simulate an expired access token: in the console run
      `localStorage.setItem("accessToken", "x." + btoa('{"exp":1}') + ".y")`, then reload. Chip
      visible immediately; Network shows exactly one auth request, `POST /api/token/refresh/` →
      200 whose body has `user`, and **no** `/api/me/`. `accessToken`/`refreshToken` are new values.
   d. Dead session: run `localStorage.setItem("refreshToken", "dead")` and the step-c line, reload.
      The chip shows briefly, then the guest UI ("Log in" button, `GuestPanel`) once
      `token/refresh/` returns 401; `nba3via-session-user`, `accessToken` and `refreshToken` are
      all gone. No second flip back.
   e. Log out from the profile card: `nba3via-session-user` is removed; reload shows the guest UI
      with no auth requests except none (no refresh token → no call).
   f. Play one single-player game to the end while signed in: after the points award,
      `nba3via-session-user`'s `points` equals the chip's value (subscriber write-through).

## Implementation plan

Work in the task worktree on branch `team/faster-logged-in-state`. Do not touch any file outside
the File plan. Backend steps run first (backend build → verify), frontend steps after; the frontend
steps use only the Interfaces section above.

### Backend

#### Step B1 — `backend/users/tokens.py`: refresh returns the user payload

1a. Imports: add `from django.contrib.auth import get_user_model` after `from datetime import
timedelta` (blank line between stdlib and third-party groups as the file already has), and add
`from rest_framework_simplejwt.settings import api_settings` between the `serializers` and
`tokens` imports.

1b. Replace the `SessionRefreshSerializer` class (lines 31-39) with:

```python
class SessionRefreshSerializer(TokenRefreshSerializer):
    def validate(self, attrs):
        refresh = self.token_class(attrs["refresh"])
        auth_time = refresh.payload.get(AUTH_TIME_CLAIM)
        # Tokens minted before this feature carry no claim; their own (shorter)
        # expiry still bounds them.
        if auth_time is not None and time.time() - auth_time > MAX_SESSION_AGE.total_seconds():
            raise InvalidToken("Session expired. Please log in again.")
        data = super().validate(attrs)

        # A return visit with an expired access token used to cost three round trips
        # (/me/ 401 -> refresh -> /me/). Handing the /me/ payload back with the new
        # tokens lets app/providers.tsx resume the session in one.
        from users.views import user_payload  # lazy: users.views imports this module

        user_id = refresh.payload.get(api_settings.USER_ID_CLAIM)
        user = get_user_model().objects.filter(**{api_settings.USER_ID_FIELD: user_id}).first()
        if user is not None:
            data["user"] = user_payload(self.context.get("request"), user)
        return data
```

Nothing else in the file changes (`issue_session_tokens`, `SessionRefreshView`, the throttle, the
module docstring all stay). Do not move `user_payload` out of `users/views.py` — the lazy import
is the surgical way around the `views → tokens` import (a module-level import would be circular).

Done-check: `cd backend && .venv/bin/python manage.py check` → no issues; `cd backend &&
.venv/bin/python manage.py shell -c "from users.tokens import SessionRefreshSerializer; import users.views; print('ok')"` → `ok`.

#### Step B2 — `backend/users/tests.py`: the payload rides along and equals `/me/`

2a. In `SessionLifetimeTests.test_refresh_endpoint_round_trip`, after the line
`self.assertIn("refresh", body)  # rotation returns a new refresh token` append:

```python
        # The /me/ payload rides along so a return visit resumes in one round trip.
        self.assertEqual(body["user"]["id"], self.user.public_id)
```

2b. Append this method to `SessionLifetimeTests` (end of the class, end of the file):

```python
    def test_refresh_user_payload_matches_me(self):
        tokens = login(self.client, "s@example.com").json()
        refreshed = self.client.post(
            reverse("token_refresh"),
            data={"refresh": tokens["refresh"]},
            content_type="application/json",
        ).json()
        me = self.client.get(reverse("get_user"), HTTP_AUTHORIZATION=f"Bearer {refreshed['access']}").json()
        self.assertEqual(refreshed["user"], me["user"])
```

Done-check: `cd backend && .venv/bin/python manage.py test users` → `Ran 58 tests … OK`.

#### Step B3 — `docs/ARCHITECTURE.md`: document the response

Replace the line
```
- `token/refresh` — get a fresh token when the old one expires
```
with
```
- `token/refresh` — get a fresh token when the old one expires (also returns your `me` payload,
  so a return visit restores the session in one round trip)
```

Done-check: `grep -n "restores the session in one round trip" docs/ARCHITECTURE.md` → one hit.

#### Step B4 — backend green and committed

Done-checks, from `backend/`: `.venv/bin/python manage.py check` → no issues;
`.venv/bin/python manage.py test users trivia` → `OK`. Commit B1-B3 as
`feat(users): token/refresh returns the /me/ payload so a return visit resumes in one hop`.
`git diff --stat HEAD~1` lists exactly `backend/users/tokens.py`, `backend/users/tests.py`,
`docs/ARCHITECTURE.md`.

### Frontend

Relies only on the Interfaces section: `POST token/refresh/` → `{access, refresh, user?}` where
`user` is the `/me/` shape and may be absent.

#### Step F1 — `src/store/userSlice.tsx`: export `User`, add `hydrateSession`

1a. Change `type User = {` (line 4) to `export type User = {`.

1b. Insert directly after the `logout` reducer (after its closing `},` on line 42):

```ts
    /** Optimistic restore from the cached /me/ payload (utils/session.ts) while the real
     *  check runs. Leaves `authChecked` false: only the server's answer settles it, and a
     *  check that has already resolved is never overwritten with cached data. */
    hydrateSession: (state, action: PayloadAction<User>) => {
      if (state.authChecked) return;
      state.isLoggedIn = true;
      state.user = action.payload;
    },
```

1c. Change the export line to
`export const { login, logout, hydrateSession, updatePoints, updateRank, updateUsername, updateProfilePhoto } = userSlice.actions;`

Done-check: `grep -n "export type User\|hydrateSession" src/store/userSlice.tsx` → 3 hits (type,
reducer, export).

#### Step F2 — `src/utils/session.ts`: the cache and the expiry check (new file)

Create with exactly:

```ts
// Session bootstrap helpers for app/providers.tsx: the cached /me/ payload that lets a
// return visit render as signed-in before the network answers, and the access-token
// expiry check that skips the dead /me/ -> 401 hop once it has expired.
//
// Security: the cache is display-only. It holds exactly what /me/ returns (id, username,
// email, rank, points, photo data URL, is_admin hint) and lives next to the refresh token
// that already grants everything about the account, so it adds no capability. It never
// holds a token. It is cleared on logout, on any failed session check and on a corrupt
// read; everything sensitive re-checks the server (admin endpoints re-check is_staff).
import type { User } from "../store/userSlice";

const SESSION_USER_KEY = "nba3via-session-user";

/** Treat a token as expired this long before `exp`, so one that dies in flight doesn't cost a 401. */
const ACCESS_EXPIRY_SKEW_MS = 30_000;

export function isSessionUser(value: unknown): value is User {
  if (!value || typeof value !== "object") return false;
  const u = value as Record<string, unknown>;
  return typeof u.id === "string" && typeof u.username === "string" && typeof u.points === "number";
}

export function readCachedUser(): User | null {
  try {
    const raw = localStorage.getItem(SESSION_USER_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (isSessionUser(parsed)) return parsed;
  } catch {
    /* unavailable or corrupt — drop it below */
  }
  clearCachedUser();
  return null;
}

export function writeCachedUser(user: User): void {
  try {
    localStorage.setItem(SESSION_USER_KEY, JSON.stringify(user));
  } catch {
    /* quota exceeded / private mode — the next visit just takes the network path */
  }
}

export function clearCachedUser(): void {
  try {
    localStorage.removeItem(SESSION_USER_KEY);
  } catch {
    /* ignore */
  }
}

/** True when the JWT's `exp` is past (or within the skew). An unreadable token counts as not
 *  expired: the request goes out as before and apiFetch's 401 path still covers it. */
export function isAccessTokenExpired(token: string): boolean {
  try {
    const payload = token.split(".")[1] ?? "";
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const exp: unknown = JSON.parse(atob(padded)).exp;
    return typeof exp === "number" && exp * 1000 <= Date.now() + ACCESS_EXPIRY_SKEW_MS;
  } catch {
    return false;
  }
}
```

No `"use client"` (it is a plain module; every caller runs in effects/callbacks). Do not read
`accessToken`/`refreshToken` here — token access stays in `Api.tsx` (AUTH-5).

Done-check: `grep -c "accessToken\|refreshToken" src/utils/session.ts` → `0`;
`grep -n "^export function" src/utils/session.ts` → 5 lines.

#### Step F3 — `src/utils/Api.tsx`: `refreshAccessToken` becomes the exported `refreshSession`

3a. Imports: after `import { BACKEND_URL } from "../configurations/backend";` add

```ts
import type { User } from "../store/userSlice";
import { isSessionUser } from "./session";
```

3b. Replace lines 11-13 (`let isRefreshing = false;` … `let refreshSubscribers …`) with:

```ts
/** What token/refresh/ hands back: the new access token plus, when the backend includes it
 *  (users.tokens.SessionRefreshSerializer), the signed-in user's /me/ payload — so a return
 *  visit can resume the session in one round trip (app/providers.tsx). */
export type RefreshResult = { access: string; user?: User };

let isRefreshing = false;
type RefreshWaiter = { resolve: (result: RefreshResult) => void; reject: (err: Error) => void };
let refreshSubscribers: RefreshWaiter[] = [];
```

3c. In `onRefreshed`, change the signature to `function onRefreshed(result: RefreshResult | null)`
and the settle line to `if (result) waiter.resolve(result);` (the `else waiter.reject(...)` line
is unchanged).

3d. Replace `async function refreshAccessToken() {` and its body (lines 53-100) with:

```ts
/** Rotate the refresh token. One refresh runs at a time — concurrent callers share its
 *  outcome. Resolves with the new access token (+ the user when the backend sends it); on
 *  any failure the tokens are cleared and every waiter is rejected (AUTH-11). */
export async function refreshSession(): Promise<RefreshResult> {
  // A refresh is already in flight — wait for its outcome rather than starting
  // a second one. Tokens are cleared by the refresher itself on failure.
  if (isRefreshing) {
    return new Promise<RefreshResult>((resolve, reject) => {
      subscribeTokenRefresh({ resolve, reject });
    });
  }

  isRefreshing = true;
  const refresh = getRefreshToken();
  
  if (!refresh) {
    isRefreshing = false;
    onRefreshed(null);
    throw new Error("No refresh token available");
  }

  try {
    const res = await fetch(`${BACKEND_URL}/token/refresh/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh }),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      console.error("Refresh failed:", errorData);
      
      // Clear tokens on any refresh failure
      clearTokens();
      isRefreshing = false;
      onRefreshed(null);
      throw new Error("Refresh token expired or invalid");
    }

    const data = await res.json();
    setTokens(data.access, data.refresh);
    const result: RefreshResult = isSessionUser(data.user)
      ? { access: data.access, user: data.user }
      : { access: data.access };
    isRefreshing = false;
    onRefreshed(result);
    return result;
  } catch (error) {
    isRefreshing = false;
    onRefreshed(null);
    clearTokens();
    throw error;
  }
}
```

(The body is the existing one; the only differences are the name, the return type, the `result`
construction and `onRefreshed(result)`.)

3e. In `apiFetch`, replace `const newAccessToken = await refreshAccessToken();` with
`const { access: newAccessToken } = await refreshSession();`.

Done-check: `grep -c "refreshAccessToken" src/utils/Api.tsx` → `0`; `grep -n "refreshSession\|RefreshResult" src/utils/Api.tsx` → 7 hits; `npx next typegen && npx tsc --noEmit` → exit 0.

#### Step F4 — `src/app/providers.tsx`: cached hydrate, one-hop settle, write-through

4a. Replace the import block lines 5-8 with:

```ts
import { store } from "../store";
import { hydrateSession, login, logout, type User } from "../store/userSlice";
import { apiFetch, clearTokens, getAccessToken, getRefreshToken, refreshSession } from "../utils/Api";
import { clearCachedUser, isAccessTokenExpired, readCachedUser, writeCachedUser } from "../utils/session";
import { BACKEND_URL } from "../configurations/backend";
```

4b. Replace the `checkLogin` effect (lines 25-49, from `useEffect(() => {` through `}, [dispatch]);`)
with these two effects:

```ts
  // Keep the cached /me/ payload (utils/session.ts) in step with the slice: every signed-in
  // user change (login, points, username, photo) is written through, a settled logout clears
  // it. Nothing is written while the initial check is still pending and signed out.
  useEffect(() => {
    let prev = store.getState().user;
    return store.subscribe(() => {
      const next = store.getState().user;
      if (next === prev) return;
      prev = next;
      if (next.user) writeCachedUser(next.user);
      else if (next.authChecked) clearCachedUser();
    });
  }, []);

  useEffect(() => {
    // Return-visit bootstrap. Show the cached user first, then settle with the server in as
    // few round trips as the token state allows:
    //   access token still valid  -> GET /me/                      (one hop)
    //   access token expired/gone -> POST token/refresh/ (+ user)  (one hop; /me/ only if the
    //                                backend didn't include `user`)
    // Reconcile: a 200 replaces the cached user in place (no flash); a dead session (refresh
    // refused, or /me/ 401) clears tokens + cache and shows the guest UI; a network error or
    // 5xx changes nothing and leaves `authChecked` false for the next load to settle.
    const restoreSession = async () => {
      if (!getRefreshToken()) {
        // Nothing to resume. Also drops a cache left behind by a logout in another tab.
        clearCachedUser();
        dispatch(logout());
        return;
      }

      const cached = readCachedUser();
      if (cached) dispatch(hydrateSession(cached));

      try {
        const accessToken = getAccessToken();
        let user: User | null = null;
        if (!accessToken || isAccessTokenExpired(accessToken)) {
          user = (await refreshSession()).user ?? null;
        }
        if (!user) {
          const response = await apiFetch(`${BACKEND_URL}/me/`);
          if (response.status === 401) {
            // apiFetch already tried a refresh behind this 401: the session is dead.
            clearTokens();
            clearCachedUser();
            dispatch(logout());
            return;
          }
          if (!response.ok) return; // backend hiccup: keep what's shown, check again next load
          const data = await response.json();
          user = data.user;
        }
        if (user) dispatch(login(user));
      } catch (err) {
        // refreshSession/apiFetch clear the tokens before throwing "Session expired";
        // a network error (fetch itself threw) leaves them in place.
        if (getRefreshToken()) {
          console.error("Session check failed:", err);
        } else {
          clearCachedUser();
          dispatch(logout());
        }
      }
    };

    restoreSession();
  }, [dispatch]);
```

The theme effect (lines 19-23) and everything from `// GoogleOAuthProvider lives in …` down are
unchanged. `localStorage.removeItem("accessToken"/"refreshToken")` no longer appears in this
file — `clearTokens()` is the same two keys (AUTH-5).

Done-check: `grep -c "localStorage" src/app/providers.tsx` → `1` (the theme line);
`grep -c "clearCachedUser(" src/app/providers.tsx` → `4` (the four call sites; the import has no paren);
`grep -c "hydrateSession" src/app/providers.tsx` → `2` (import + dispatch);
`npx next typegen && npx tsc --noEmit` → exit 0; `npm run lint` → no errors.

#### Step F5 — frontend green and committed

Done-checks: `npx next typegen && npx tsc --noEmit` → exit 0; `npm run lint` → no errors. Commit
`userSlice.tsx`, `session.ts`, `Api.tsx`, `providers.tsx` as
`feat(auth): show the cached signed-in user at hydration and settle the session in one round trip`.
`git diff --stat HEAD~1` lists exactly those four files. Browser QA per Test plan item 6 runs in
the QA stage.

## Self-review (5b)

- **Coverage.** "takes a long time to see that I am logged in" → F1/F2/F4 render the cached user
  at hydration (D1); B1/F3/F4 cut the settle from three round trips to one (D2/D3). "when the
  session is still active it appears much faster" → the cached chip shows before any request;
  a live session is confirmed in one hop. Launcher constraints: security implications of the
  cache stated (D1, Risks); no token is ever cached beyond the two existing keys (F2 done-check);
  the cache is display-only and cleared on logout and failed reconcile (D4, D5, F4); the dead-
  session rule is exact (D4 table); backend steps first with the contract in Interfaces; the
  frontend tolerates a backend without `user` (F3 `isSessionUser` guard, F4 `/me/` fallback).
- **No placeholders.** Every step carries the exact code, the exact lines it replaces and a
  command with its expected output. The storage key, skew, reducer name, function names and the
  response key are literal everywhere.
- **Consistency.** `User` (exported type) is the one shape across slice, `session.ts`, `Api.tsx`
  and `providers.tsx`; `hydrateSession` (reducer) vs `restoreSession` (local async fn in
  providers) are distinct on purpose; `refreshSession`/`RefreshResult` names match between F3 and
  F4; `"user"` is the key in B1, B2, F3 and Interfaces; test count 57 → 58 (one extended, one new).
- **Scope.** No `apiFetch`-wide proactive refresh, no pre-hydration script, no `LogInSignUp`/
  `UserProfile`/`Navigation`/`Landpage`/`Admin` edits, no settings/urls/throttle/migration change,
  no new dependency (JWT `exp` is decoded with `atob`). The one doc touch is the bullet the new
  response warrants. The 5xx-keeps-session change is inside the reconcile rule the task requires
  and is called out (D4, Risks).
- **Ambiguity resolved.** (a) "Faster" = perceived: signed-in at hydration, settle in one hop.
  (b) Hydration point: mount effect, not render, not inline script (D1). (c) Where the cache is
  written: store subscriber, not per call site (D5). (d) `authChecked` semantics: unchanged —
  server-confirmed only; `hydrateSession` never sets it. (e) Session dead: one chip→guest flip,
  tokens + cache cleared (D4). (f) Backend hiccup: keep the session (D4). (g) Refresh path: only
  through the single-flight queue (D2). (h) Backend returns `user` on refresh; frontend treats it
  as optional (D3).
