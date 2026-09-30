# Design: redis-friends-cache

Task: "Redis-backed caching for slow backend reads, starting with Friends overview" (Category
backend, P1). Classify: hard / backend + auth / risk high / `needsDesignRound: true`. Design round
2026-09-30, planner on fable, branch `team/redis-friends-cache` (cut from `origin/dev` 5bf6ff9).

## Decision summary

**Engine: sonnet** — 9 steps, each with an exact file, exact names and a done-check. Every judgment
call (provider, backend, key scheme, TTL, which endpoints, invalidation sites, failure posture) is
settled below; nothing is left for the build to decide.

**Seats.** This cloud session has no `Agent` tool and no engine teammates, so the single
`backend-engine` proposal seat was filled by the planner from source (`settings.py`, `friends.py`,
`leaderboard.py`, `throttles.py`, `views.py`, `tests.py`, `vercel.json`, `useFriends.ts`,
`FriendsPanel.tsx`). Sign-off is the 5b self-review at the end of this doc. Web access was not
used: provider facts marked **verify on signup** are from memory and must be confirmed by the owner
in the provider console before relying on them.

**D1 — Provider: Upstash Redis, documentation only.** Reasons: (a) free tier that needs no card
(verify on signup); (b) TLS `rediss://` endpoint that Django's built-in
`django.core.cache.backends.redis.RedisCache` + the already-installed `redis` package speak
directly — **no new dependency**; (c) built for serverless: connections are cheap and per-lambda
(unlike Postgres, where the IPv6/pooler problem forced the transaction pooler), so no pooler is
needed; (d) available in `eu-central-1` (Frankfurt), the same region as the backend (`vercel.json`
`regions: ["fra1"]`) and Supabase (`aws-1-eu-central-1`) — verify on signup; (e) it is also what
`docs/DEPLOYMENT.md` already names for Phase 5b (leaderboard ZSET) and the multiplayer server's
Socket.IO adapter, so one instance serves all three uses via the same `REDIS_URL`; (f) a Vercel
Marketplace integration exists that injects env vars into the backend project. Upstash also has a
REST API, but **we do not use the REST path**: Django's cache framework has no REST backend, the
`upstash-redis` Python client is not a Django cache backend, and writing one is out of scope. The
RESP-over-TLS path is the one `settings.py` already wires. Alternatives considered: Redis Cloud
(Redis Inc.) free 30 MB — workable, but no Vercel integration and a smaller quota; "Vercel KV" —
now *is* Upstash via the Marketplace; Railway/Render Redis — usage-billed, excluded by the money
rule. Nothing is created in this task; the owner runs the steps in `docs/DEPLOYMENT.md`.

**D2 — Backend: the existing Django `CACHES` abstraction, unchanged tiers.** `settings.py` keeps
the three-tier `REDIS_URL` → `DatabaseCache` → `LocMemCache` selection. The only settings change
is `OPTIONS` timeouts on the Redis tier (`socket_connect_timeout` / `socket_timeout` = 2 s, passed
by Django's `RedisCacheClient` to `redis.ConnectionPool.from_url`) so an unreachable Redis fails
fast instead of holding a lambda to its timeout. The leaderboard's raw-client pattern stays for
ZSET primitives only (the card's explicit instruction; `CACHING_SCALING_PLAN.md` is revised to
say so).

**D3 — Scope of the audit: `friends_overview` only, this round.** Audit of `users/` and `trivia/`
reads (every view read):
- `friends_overview` (`GET friends-overview/`) — **cache**. Hot (fetched on every Friends-modal
  mount and after every action), 3 queries + 2-3 `select_related` joins, cheap to invalidate (the
  write sites are the 8 friend views in the same file).
- `search_friends` (`GET search-friends/`) — **exclude, follow-up.** Parameterised by
  `limit`/`offset`/`q`, so per-user invalidation needs a generation-key scheme (one extra cache
  read per request) and rows are ordered by points that change on every game; recorded in
  `CACHING_SCALING_PLAN.md` as the next candidate, with the key scheme.
- `search_users` — exclude (varied `q`, ~zero hit rate).
- `get_current_user` (`/me/`) — exclude: JWT auth already loads `request.user` (the only query),
  so caching `user_payload` saves nothing; it would also need invalidation on every points award.
- `get_users` (leaderboard) — exclude: global board is already the Redis ZSET; friends board is
  points-ordered and client-cached 5 min (`useLeaderboard.ts`).
- `wordle_daily_status`, `wordle_daily_play` — exclude: per-device once-per-day gate; correctness
  over speed.
- `trivia` dataset reads (`get_random_*`, `get_mvps`, `get_starting_five`, `get_fan_favorites`,
  `get_manifest`, `get_pool`) — exclude: disk/JSON reads, no DB.
- `profile_photo_view` — exclude: already immutable-cacheable at the HTTP layer.

**D4 — Key scheme and namespacing.** DRF throttles store `throttle_<scope>_<ident>` in the same
default cache. Our keys use a distinct, versioned namespace: `users:friends-overview:v1:<user_pk>`
(integer pk, not public_id — pk never changes). Bump `v1` if the payload shape changes. No global
`KEY_PREFIX` (it would also rename the throttle counters).

**D5 — TTL 60 s plus immediate invalidation.** Relationship changes (send/accept/decline/cancel/
remove/block/unblock) delete the keys of **both** affected users right after the DB write. Rows
also carry the *other* user's `username`/`points`/`rank`/`photo_version`; those can lag up to 60 s
(their writers are `log_session`, `update_profile`, Google/signup — not invalidated here, by
design: that would tie every points award to every requester's cache). 60 s bounds both that lag
and the read-miss/write race (a read that misses, computes, and sets after a concurrent delete).

**D6 — Failure posture.** Cache calls are wrapped in one helper that catches any exception from
the backend, logs a warning, and behaves as a miss / no-op. A Redis outage therefore degrades to
today's uncached behaviour instead of a 500. (Throttles keep their existing exposure; not in
scope.) With no `REDIS_URL` the code path is identical on `DatabaseCache`/`LocMemCache`.

**Expected gain, honestly, per tier.** Redis tier: a hit replaces 3 Postgres round trips through
the Supabase pooler (~5-20 ms each from `fra1`) with one Redis GET (~1-3 ms same-region; plus a
one-time TLS handshake per warm lambda). DatabaseCache tier (today's production, no `REDIS_URL`):
a hit is 1 indexed read of `django_cache_table` + unpickle instead of 3 reads — a small win; a
miss costs today's 3 reads **plus** Django's `set` (a `DELETE expired` cull + SELECT + INSERT),
i.e. roughly 2x today's cost, and every invalidation is a `DELETE`. Net: modest on hits, slightly
negative on misses — the real win needs `REDIS_URL`. Neither tier removes the JWT user lookup,
the Vercel cold start, or the pooler handshake, which likely dominate the "slow every time" the
card describes; the plan records this so the owner sets expectations before provisioning Redis.

## Interfaces

New module `backend/users/friends_cache.py`:

```python
FRIENDS_OVERVIEW_TTL = 60          # seconds
KEY_VERSION = "v1"

def overview_key(user_pk: int) -> str
    # returns f"users:friends-overview:{KEY_VERSION}:{user_pk}"

def get_overview(user_pk: int) -> dict | None
    # cache.get(overview_key(user_pk)); any exception -> log warning, return None

def set_overview(user_pk: int, payload: dict) -> None
    # cache.set(overview_key(user_pk), payload, FRIENDS_OVERVIEW_TTL); exceptions -> warning, no-op

def invalidate_friends(*users) -> None
    # users: CustomUser instances or int pks (either accepted, mixed ok);
    # cache.delete_many([overview_key(pk) for each]); exceptions -> warning, no-op
```

Payload cached = the exact dict `friends_overview` returns today
(`{"incoming_requests": [...], "outgoing_requests": [...], "blocked_users": [...]}`), built from
plain JSON types (ints, strs, None) so it pickles under every tier. Response shape to the client is
unchanged.

`settings.py` Redis tier gains `"OPTIONS": {"socket_connect_timeout": 2, "socket_timeout": 2}`.
Env var read stays exactly `REDIS_URL`.

## File plan

| File | Change |
|---|---|
| `backend/users/friends_cache.py` | new — helpers above |
| `backend/users/friends.py` | `friends_overview` read-through; invalidation in 7 write views |
| `backend/backend/settings.py` | `OPTIONS` timeouts on the Redis tier only |
| `backend/users/tests.py` | new `FriendsOverviewCacheTests` (LocMemCache override) |
| `docs/DEPLOYMENT.md` | new "Redis (Upstash) — setup" section; `REDIS_URL` comment updated |
| `docs/CREDENTIALS.md` | row for the Upstash password (in `REDIS_URL`) |
| `docs/CACHING_SCALING_PLAN.md` | status table + implementation-shape section revised |

No frontend changes. No migrations. No new dependencies.

## Risks

- **Stale cosmetic fields ≤ 60 s** on pending-request/blocked rows (D5). Accepted; documented.
- **Read/write race** sets a stale value after an invalidation; bounded by TTL (D5).
- **DatabaseCache tier can be slightly slower on misses** (see gain analysis); the owner decides
  whether to provision Redis; the code is correct on both.
- **Redis eviction**: if the owner enables eviction on the Upstash DB, the leaderboard ZSET could
  be evicted (`leaderboard.top()` would then return an empty board until `sync_leaderboard`).
  DEPLOYMENT.md says: leave eviction **off**; our cache keys carry TTLs so they never pile up.
- **Throttle keys share the cache** — distinct namespace (D4); `cache.clear()` in tests only.
- Django's `TestCase` runs each test in a transaction; invalidation is called inline (not
  `on_commit`), so tests observe it directly. `ATOMIC_REQUESTS` is not set in `settings.py`
  (verified), so inline-after-write is also correct in production.

## Test plan

`cd backend && .venv/bin/python manage.py test users` (Linux venv; the Windows path in
DEPLOYMENT.md is equivalent). New tests in `backend/users/tests.py`, class
`FriendsOverviewCacheTests(TestCase)` decorated
`@override_settings(CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}})`
(same form `trivia/tests/test_feedback.py` uses), `setUp` calls `cache.clear()`, creates users
`me`, `other` via `signup()`/`login()` helpers already in the file, and keeps both access tokens.

1. `test_overview_is_served_from_cache_until_ttl` — GET overview as `me` (empty lists) → key
   `overview_key(me.pk)` is present in `cache`; create a `FriendRequest(other→me)` via the ORM
   (no view, so no invalidation); GET again → still 0 incoming (cache hit); `cache.clear()`; GET →
   1 incoming.
2. `test_every_friend_action_invalidates_both_users` — for each action, warm both users'
   caches (GET overview as each), perform the action through its view as the right actor with the
   right precondition, then assert `cache.get(overview_key(me.pk)) is None` and
   `cache.get(overview_key(other.pk)) is None`:
   send (other→me), accept (me accepts), send then decline, send then cancel, befriend via ORM
   then remove, block (me blocks other), unblock (me unblocks other), and the reverse-accept path
   (other→me pending, me sends to other).
3. `test_send_request_is_visible_to_receiver_immediately` — warm `me`'s cache, `other` sends
   request, GET overview as `me` → 1 incoming with `other.public_id`; GET as `other` → 1 outgoing.
4. `test_cache_backend_failure_degrades_to_db` — `mock.patch("users.friends_cache.cache")` with
   `get`/`set`/`delete_many` raising `RuntimeError`; GET overview returns 200 with correct data
   from the DB.

Existing `FriendsPhotoTests` must keep passing unchanged (it reads `friends-overview` once per
test, cold cache).

## Implementation plan

Every step is `[sonnet]`. Absolute paths are under `/home/user/nba-trivia-minigames/`. Do not run
the test suite until step 6; the verify stage repeats it anyway.

**Step 1 `[sonnet]` — `backend/users/friends_cache.py` (new).** Module docstring: why this uses
`django.core.cache` (three tiers from `settings.py`, correct with zero Redis) and not the
`leaderboard.py` raw client (ZSET primitives only), and that keys are namespaced away from DRF's
`throttle_<scope>_<ident>`. Implement exactly the interface in "Interfaces": `import logging`,
`from django.core.cache import cache`, `logger = logging.getLogger(__name__)`,
`FRIENDS_OVERVIEW_TTL = 60`, `KEY_VERSION = "v1"`, `overview_key`, `get_overview`, `set_overview`,
`invalidate_friends`. Each cache call sits in `try: ... except Exception as exc:
logger.warning("friends cache unavailable (%s): %s", op, exc)` where `op` is `"get"`, `"set"` or
`"delete"`; `get_overview` returns `None` on failure. `invalidate_friends` normalises each arg with
`pk = u if isinstance(u, int) else u.pk`. Done: `.venv/bin/python -c "import django, os;
os.environ.setdefault('DJANGO_SETTINGS_MODULE','backend.settings'); django.setup(); from users
import friends_cache as f; print(f.overview_key(7))"` run from `backend/` prints
`users:friends-overview:v1:7`.

**Step 2 `[sonnet]` — `backend/users/friends.py`, read-through in `friends_overview`.** Add
`from users import friends_cache`. At the top of `friends_overview` after `me = request.user`:
`cached = friends_cache.get_overview(me.pk)`; `if cached is not None: return Response(cached)`.
Build the existing dict into a local `payload` (same three keys, same `_brief` rows, same order),
call `friends_cache.set_overview(me.pk, payload)`, then `return Response(payload)`. Extend the
docstring with one sentence: cached 60 s under `friends_cache`, invalidated by every write view
below. Done: reading the diff shows the response dict is byte-for-byte the previous one and the
three querysets are untouched.

**Step 3 `[sonnet]` — `backend/users/friends.py`, invalidation at every write.** Insert
`friends_cache.invalidate_friends(a, b)` immediately after the DB write succeeds, on the success
path only (never on the error returns):
- `send_friend_request`: after the `reverse` atomic block → `invalidate_friends(me, target)`;
  after the successful `FriendRequest.objects.create(...)` (inside the `try`, before the 201
  return) → `invalidate_friends(me, target)`.
- `accept_friend_request`: after the atomic block → `invalidate_friends(fr.sender_id, fr.receiver_id)`
  (read `sender_id`/`receiver_id` from `fr` before `fr.delete()`; keep the atomic block as is and
  capture the ids above it).
- `decline_friend_request`: change the delete to first fetch
  `fr = FriendRequest.objects.filter(pk=req_id, receiver=request.user).first()`; `if fr is None:`
  404 as today; `sender_id = fr.sender_id; fr.delete(); invalidate_friends(request.user, sender_id)`.
- `cancel_friend_request`: same shape with `sender=request.user`; capture `receiver_id`;
  `invalidate_friends(request.user, receiver_id)`.
- `remove_friend`: after `deleted` is truthy → `invalidate_friends(me, target)`.
- `block_user`: after the atomic block → `invalidate_friends(me, target)`.
- `unblock_user`: after `deleted` is truthy → `invalidate_friends(request.user, target)`.
Done: `grep -c "friends_cache.invalidate_friends(" backend/users/friends.py` prints `8`
(2 in `send_friend_request`, 1 in each of the other 6 write views).

**Step 4 `[sonnet]` — `backend/backend/settings.py`, Redis tier timeouts.** In the `if _redis_url:`
branch add `"OPTIONS": {"socket_connect_timeout": 2, "socket_timeout": 2},` after `"TIMEOUT"`,
with a one-line comment: Django's `RedisCacheClient` forwards these to
`redis.ConnectionPool.from_url`; an unreachable Redis then fails in ~2 s and `users/friends_cache`
degrades to the DB instead of holding the lambda. Nothing else in the block changes. Done:
`cd backend && .venv/bin/python manage.py check` passes (no `REDIS_URL` locally, so the branch is
not executed — the check is syntax/import only; the option names are documented redis-py kwargs).

**Step 5 `[sonnet]` — `backend/users/tests.py`, `FriendsOverviewCacheTests`.** Add imports
`from unittest import mock`, `from django.core.cache import cache`,
`from django.test import override_settings`, `from users import friends_cache`, and `BlockedUser`
to the existing `users.models` import. Implement the four tests in "Test plan" exactly. Helpers
inside the class: `_get(self, token)` → `self.client.get(reverse("friends-overview"),
HTTP_AUTHORIZATION=f"Bearer {token}")`; `_post(self, name, token, **body)` → JSON POST to
`reverse(name)`. Action table for test 2 as a list of `(label, setup_fn, action_fn)` looped with
`self.subTest(label)`, and `cache.clear()` + re-warm at the start of each iteration. For test 4,
`with mock.patch.object(friends_cache, "cache") as fake:` set `fake.get.side_effect =
RuntimeError("down")`, same for `set` and `delete_many`; assert 200 and the ORM-created incoming
request is present. Done: `cd backend && .venv/bin/python manage.py test users.tests.FriendsOverviewCacheTests`
passes.

**Step 6 `[sonnet]` — run the backend suite.** `cd backend && .venv/bin/python manage.py test users trivia`.
Done: all green, including `FriendsPhotoTests` and `trivia/tests/test_feedback.py` (which also
overrides `CACHES`).

**Step 7 `[sonnet]` — `docs/DEPLOYMENT.md`.** (a) In "Environment variables by service → Django
API", change the `REDIS_URL` comment to: `# Upstash (see "Redis (Upstash) — setup" below). Unset ->
Postgres leaderboard AND DatabaseCache for rate limiting + friends cache`. (b) Add a new section
`## Redis (Upstash) — setup` directly after "Environment variables by service", with this content
(keep the "verify on signup" markers — they are owner-facing, not placeholders):

> **Provider decision (2026-09-30, `docs/team/designs/2026-09-30-redis-friends-cache.md`):**
> Upstash Redis. Free tier, TLS `rediss://` endpoint that Django's built-in `RedisCache` +
> `redis-py` speak with no extra package, per-lambda connections that need no pooler, and the
> same instance serves the leaderboard ZSET (`users/leaderboard.py`), the friends cache
> (`users/friends_cache.py`) and the multiplayer Socket.IO adapter. Its REST API is **not** used —
> Django's cache framework has no REST backend. Alternatives: Redis Cloud free tier (30 MB, no
> Vercel integration), "Vercel KV" (is Upstash via the Marketplace), Railway/Render (usage-billed).
>
> **Steps (owner only — creating the account is a money decision even on the free tier):**
> 1. Sign up at upstash.com (GitHub login is fine) — or, from the Vercel dashboard, *Storage →
>    Create → Upstash Redis* (Marketplace). Either way pick the **Free** plan; no card should be
>    requested — if it is, stop.
> 2. Create a database: type **Regional** (not Global — Global replicates and costs more per
>    command, verify on signup), region **eu-central-1 / Frankfurt** to sit next to the backend
>    (`backend/vercel.json` `regions: ["fra1"]`) and Supabase (`aws-1-eu-central-1`). TLS on
>    (default). **Eviction: off** (default) — with eviction on, the leaderboard ZSET could be
>    evicted and `leaderboard.top()` would return an empty board until `manage.py sync_leaderboard`
>    re-backfills. The friends-cache keys expire on their own (60 s).
> 3. Copy the **Redis (TLS) URL** from the database's *Details* tab. It looks like
>    `rediss://default:<password>@<name>-<id>.upstash.io:6379`. Free-tier limits to note (verify on
>    signup; they change): ~256 MB, ~500K commands/month, ~100 concurrent connections — far above
>    this app's traffic; the cache issues 1-2 commands per Friends-modal open.
> 4. Set `REDIS_URL` to that value on the Vercel **backend** project (Production and Preview) — the
>    Marketplace integration injects its own names (`KV_URL`, `KV_REST_API_URL`, …; verify on
>    signup); `settings.py` and `leaderboard.py` read **only `REDIS_URL`**, so add it explicitly if
>    the integration did not. Then redeploy the backend (`vercel --prod` or push to `main`).
> 5. Backfill the leaderboard once: `cd backend && python manage.py sync_leaderboard` with
>    `REDIS_URL` and `DATABASE_URL` exported locally (Phase 5b).
> 6. Verify: `GET /api/friends-overview/` twice with the same token — the second should be
>    visibly faster in the Vercel function log; `GET /api/get-users/` still returns the board.
> 7. Optional: set the same `REDIS_URL` on the multiplayer host to enable the Socket.IO adapter.
> 8. Record the credential in `docs/CREDENTIALS.md` (a row is pre-filled) — rotation is
>    *Database → Details → Reset password* in the Upstash console, then update `REDIS_URL`.

(c) In "Recommended activation order" item 5, append: "also enables the friends-overview cache
(`users/friends_cache.py`)". Done: `grep -n "Redis (Upstash) — setup" docs/DEPLOYMENT.md` finds
the heading and the anchor text in (a).

**Step 8 `[sonnet]` — `docs/CREDENTIALS.md`.** Add one row to the numbered credential table
(next free `#`): credential **Upstash Redis password** (inside `REDIS_URL`); lives in: Vercel
backend project env `REDIS_URL` (+ multiplayer host if set); used by: Django cache tiers
(`settings.py` CACHES → throttles + friends cache), `users/leaderboard.py` ZSET, Socket.IO adapter;
expires: never (rotate manually); if it leaks/expires: reset in Upstash console → update
`REDIS_URL` → redeploy; blast radius: cache contents + leaderboard ZSET (rebuildable via
`sync_leaderboard`), no user data. Mark status "not yet provisioned (2026-09-30)". Done: the row
renders in the same column count as the existing rows.

**Step 9 `[sonnet]` — `docs/CACHING_SCALING_PLAN.md`.** (a) Status table: `friends-overview` row
becomes "**Yes** — Django `CACHES` (`users/friends_cache.py`), 60 s TTL, invalidated by every
friend/request/block view for both users; Redis when `REDIS_URL`, else DatabaseCache/LocMem".
(b) Replace the "Implementation shape, when the time comes" section: cached *reads* go through
`django.core.cache` (three tiers already in `settings.py`, correct with zero Redis, keys namespaced
`users:<thing>:v1:<pk>` away from DRF throttle keys, failure = miss); the raw `leaderboard.py`
client is only for Redis primitives Django's cache API lacks (ZSET). Invalidate at the write sites,
both users, right after the write. (c) Add `search-friends` as the next candidate with the scheme:
per-user generation key `users:friends-gen:v1:<pk>` bumped on friendship changes, page key
`users:friends-list:v1:<pk>:g<gen>:<limit>:<offset>` for `q == ""` only; cost = one extra cache
read per request; not built until `search-friends` shows in function-duration percentiles.
(d) Add a short "What the cache does not fix" note: the cold start, JWT user lookup and pooler
handshake dominate a single slow request; the cache removes 3 queries per Friends-modal open.
Done: the doc no longer tells a reader to copy the raw-client pattern for read caching.

## Self-review (step 5b)

- **Coverage.** Spec (1) provider research + exact setup steps in DEPLOYMENT.md, no account, no
  spend → D1, step 7 (steps are owner-run; every "verify on signup" is a fact the owner confirms,
  not work left undone). Env var read: `REDIS_URL` only (D2, step 7b.4). REST vs django-redis:
  D1 — REST not used, built-in `RedisCache`, no new package. Spec (2) `CACHES` abstraction, not
  the raw client → D2, steps 1-2; audit of other reads → D3 (one qualifies, each exclusion has a
  reason); correct immediate invalidation for both users on every action → D5, step 3 (8 call
  sites incl. the reverse-accept path). Spec (3) works with zero Redis → D2/D6, tests on LocMem,
  helper is tier-agnostic. Classify findings: throttle-key namespacing → D4; revise
  CACHING_SCALING_PLAN.md → step 9; honest per-tier gain → Decision summary; bounded audit list →
  D3; Django tests for hit + invalidation with LocMem override → step 5; CREDENTIALS.md updated
  in the same change → step 8.
- **No placeholders.** Every step names files, function names, key format, TTL, option values and
  a done-check. The "verify on signup" markers are deliberate owner-facing caveats (web access was
  unavailable), not TBDs for the engine. Step 3's done-check is stated as 8 call sites.
- **Consistency.** `friends_cache` module name, `overview_key`/`get_overview`/`set_overview`/
  `invalidate_friends`, `FRIENDS_OVERVIEW_TTL = 60`, key `users:friends-overview:v1:<pk>` are
  identical across Interfaces, steps 1-3, 5, 7 and 9. Step 3 fixed to say "8 call sites".
- **Scope.** No `search_friends` cache, no `/me/` cache, no `KEY_PREFIX`, no throttle changes, no
  frontend change, no dependency, no account creation. The `OPTIONS` timeout is the one addition
  beyond the letter of the card; it exists so D6's degrade-to-DB is fast, which the card's "must
  work correctly" implies.
- **Ambiguity resolved.** "Best-fit provider" = Upstash for the stated reasons, not the cheapest.
  "Audit other reads" = the named list with one inclusion. "Invalidate immediately" = inline after
  the write, both users, including remove/unblock even though the overview payload does not change
  for both (the card's rule is simpler to trust than per-view reasoning). "Falls back to
  DatabaseCache" = unchanged settings tiers; the helper never touches Redis directly.
