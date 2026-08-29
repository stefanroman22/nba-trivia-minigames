# Auth & Scoring Hardening — Design Spec

**Date:** 2026-08-29
**Status:** Approved, implementing
**Repo:** nba-minigames
**Owner:** Stefan

## 1. Goal

Close four defects found in an audit of the authentication surface, so the account/scoring
architecture is secure, reliable and able to scale to millions of users. **The JWT scheme itself
is not changing** — it is sound, and the `auth_time` absolute-session cap in `users/tokens.py` is
better than most production implementations. Every change below is additive hardening around it.

## 2. What is NOT changing, and why

| Considered | Rejected because |
|---|---|
| Move tokens to `httpOnly` cookies | Frontend and backend are on different origins with no custom domain, so cookies need `SameSite=None; Secure`, which reintroduces CSRF and a token dance for a marginal XSS gain. A CSP is the cheaper mitigation. |
| Replace simplejwt / rewrite the scheme | A bug here locks out every user at once. The design is sound; the gaps are around it. |
| Server-side re-scoring of all 17 games | Scoring rules live per-game in the renderers. Porting them is a large project with high regression risk. §3.1 gets most of the security benefit for a fraction of it, and leaves the door open. |

## 3. The four changes

### 3.1 Scoring integrity — the client must not name its own points

**Defect.** `update_profile` does `user.points += points` with the value taken straight from the
request body — no type check, no range check, no relationship to any game that was played. Any
authenticated user can POST `{"points": 999999999}` and top the leaderboard. Authentication works
correctly here; authorization is what is missing. The account is real, the score is not.

**Notably, the correct pattern already exists in this codebase.** `trivia.views.log_session`
coerces ints, clamps to a maximum, and whitelists `mode`. The auth path simply doesn't follow it.

**Design.** Make the already-existing session log the single award path:

1. `POST /trivia/log-session/` becomes the **only** way points are awarded. It already receives
   exactly the data needed (`game`, `mode`, `score`, `duration_ms`) from the same call site.
2. Awards are clamped to `MAX_SESSION_POINTS` (1000). The largest legitimate score in any renderer
   is `MAX_SCORE = 300`, so this is >3× headroom and cannot affect real play, while turning
   `999999999` into a rounding error.
3. Points are awarded only for `mode="single"` by an authenticated user — preserving AUTH-7
   (multiplayer results never touch account points).
4. `update_profile` **rejects** a `points` field outright. Username and photo updates are unaffected.
5. The response returns the points actually awarded and the new total, so the client reflects the
   server's number rather than its own.

**Why this is the right shape, not just a validation patch:**
- Every award now has a `GameSession` row behind it — an audit trail that did not exist before.
- It preserves AUTH-6's single-writer property for `points`/`rank` (the writer moves, it does not
  multiply).
- The endpoint is the natural place to hang per-game caps and throttles later.

**Deliberately deferred, with reasoning:** a *per-day* cap would need a per-user aggregate query on
every game finish. At millions of users that is a real cost, and §3.3's throttle already bounds
how fast a user can submit sessions — which bounds daily gain by the same order without the query.
Exact per-game caps should replace the single global cap once the `GameSession` table has enough
real data to derive them; that is a follow-up, not a blocker.

**Residual risk, stated plainly:** a determined cheater can still submit legitimate-looking
sessions at the throttle limit. This raises the bar from "trivial one-liner" to "sustained
scripted abuse", which is the honest ceiling without server-side re-scoring.

### 3.2 Reliability — a failed refresh must not hang the app

**Defect.** In `src/utils/Api.tsx`, callers that arrive while a refresh is in flight get a promise
whose executor only ever calls `resolve`. On failure the subscriber callback `throw`s from inside
`onRefreshed`'s `forEach`, so: the throw escapes into the *first* refresher's flow, the remaining
subscribers are never notified, and every queued promise stays pending forever. Those `apiFetch`
calls never settle — spinners that never resolve, on exactly the session-expired path where the
user most needs to be told to sign in again.

**Design.** Give the queued promise a `reject`; notify subscribers with an outcome rather than a
token that must be interpreted; and wrap the notify loop so one subscriber's exception cannot
strand the others. Behaviour on success is unchanged.

Also replace the `isTokenError` heuristic. It currently string-matches `"token"`/`"expired"`/
`"invalid"` anywhere in the response body, which is wrong in both directions: it refreshes
needlessly on an unrelated 401 containing the word "invalid", and skips refreshing on a token
error phrased differently. simplejwt returns a stable machine-readable `code` field
(`token_not_valid`) — key off that, and treat a missing/unparseable body as a token error so the
refresh path still runs when the server returns a bare 401.

### 3.3 Rate limiting — login is currently unbounded

**Defect.** No `DEFAULT_THROTTLE_CLASSES`, no `django-axes`, no `django-ratelimit` anywhere in the
backend (verified by repo-wide grep). `/api/login/` accepts unlimited password attempts. This
compounds with §3.4: login distinguishes "no account matches" from "incorrect password", so an
attacker can enumerate valid emails and then brute-force them unthrottled.

**Design.** DRF `ScopedRateThrottle` on the sensitive endpoints:

| Scope | Endpoint | Limit |
|---|---|---|
| `auth-login` | `login/`, `login/google/` | 10/min, 60/hour |
| `auth-signup` | `signup/` | 5/hour |
| `auth-refresh` | `token/refresh/` | 30/hour |
| `score-submit` | `log-session/` | 60/hour |

**The cache backend is the load-bearing decision.** DRF throttling stores counters in Django's
cache. The default `LocMemCache` is per-process, and on Vercel each lambda is its own process — so
throttling would be silently near-useless, with each cold start resetting the count. That failure
is invisible, which makes it worse than no throttle.

This repo already has the pattern to follow: `REDIS_URL` set → Redis, unset → Postgres fallback
(as `users/leaderboard.py` already does). Cache config mirrors it:
- `REDIS_URL` set → `django.core.cache.backends.redis.RedisCache` (shared, fast, the production path)
- unset → `django.core.cache.backends.db.DatabaseCache` (shared and correct, just slower)
- local dev with neither → `LocMemCache` is fine; correctness there doesn't matter

`DatabaseCache` needs its table created (`createcachetable`), which is idempotent and belongs in
the build command next to `migrate`.

### 3.4 Blacklist growth — rotation writes rows nothing ever deletes

**Defect.** `ROTATE_REFRESH_TOKENS` + `BLACKLIST_AFTER_ROTATION` with 15-minute access tokens
writes one blacklisted row per user per 15 minutes of activity. Nothing anywhere runs
`flushexpiredtokens` — verified across `.py`, `.yml`, `.ps1` and `.md`. The table grows without
bound on a free-tier Postgres.

**Design.** Append `flushexpiredtokens` to the Vercel build command, which already runs `migrate`
on every deploy. Now that the backend is git-connected (deploys on every `main` push), this runs
often enough to bound the table.

It must be **non-fatal** (`|| true`): cleanup failing is not a reason to fail a deploy and block
shipping. This is a deliberate trade — it means a silently failing cleanup would go unnoticed —
accepted because the failure mode is slow table growth, which is exactly what we already have.

**Honest limitation:** tying cleanup to deploy cadence is pragmatic, not principled. If deploys
become infrequent, this needs a real scheduled job.

## 4. Ordering

`3.1 → 3.2 → 3.3 → 3.4`. Each is independently shippable and independently verifiable. 3.3's
throttle scopes reference the `log-session` endpoint that 3.1 reshapes, so 3.1 goes first.

## 5. Verification

Every change is proved against the running system, not asserted:

- **3.1** — `curl` the old attack (`{"points": 999999999}`) and confirm it is rejected; confirm a
  legitimate score still awards and the leaderboard still moves; confirm the full backend suite passes.
- **3.2** — unit-level reasoning plus a forced concurrent-refresh-failure check that the queued
  promise rejects rather than hangs.
- **3.3** — hammer `login/` past the limit and confirm HTTP 429; confirm a normal login is unaffected.
- **3.4** — confirm the command exists and runs in a real build log.

## 6. Documentation

The reasoning must outlive this session, so:
- `docs/constraints/AUTH_CONSTRAINTS.md` — AUTH-6 is rewritten (the points writer moves), and new
  rules are added for the award path and throttling.
- `docs/ARCHITECTURE.md` §5 ("How secure is the app?") — updated to describe the real posture.
- `docs/DEPLOYMENT.md` — the `REDIS_URL` cache decision and its silent-failure mode.
