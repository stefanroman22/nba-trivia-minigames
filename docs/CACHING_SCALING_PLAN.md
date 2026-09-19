# Friends & Leaderboard — Caching and Scaling Plan

A plan, not a to-do list for right now. Nothing here should be built until a
real number (see "When to actually do this") says it's worth it. Written
2026-09-19 alongside the friends-search feature, to record the reasoning
before it's forgotten.

## Where things stand today

| Data | Backed by | Cached? |
|---|---|---|
| Global leaderboard (top 100, rank, total) | `users/leaderboard.py` | **Yes** — Redis ZSET (`leaderboard`, member = public_id, score = points) when `REDIS_URL` is set; falls back to plain Postgres queries otherwise. Already scales to any N via `ZREVRANGE`/`ZREVRANK` (O(log N)). |
| Friends leaderboard (`?scope=friends`) | `leaderboard.friends_board()` | No — always Postgres, deliberately (see below). |
| Friend list / friend search (`search-friends`) | `users/friends.py` | No — always Postgres. |
| Friend requests, blocked list (`friends-overview`) | `users/friends.py` | No — always Postgres. |

The global leaderboard cache exists because **N (total players) is
unbounded** and a top-100/rank query over the whole table gets slower as the
platform grows — a classic case where a sorted-set cache pays for itself.

## Why friends data isn't a scaling problem the same way

Every friends query is bounded by **your own friend count**, not by the
total user base:

- `search-friends` resolves "which users are my friends" via two indexed
  lookups on `Friendship.user_low`/`user_high` (bounded by your friend
  count), *then* filters/paginates that already-small set. It never scans
  the whole `CustomUser` table.
- `friends_board()` does the same thing before sorting by points.
- `friends-overview`'s requests/blocked lists are similarly bounded by
  "requests you're personally involved in."

No realistic friend count (even a very socially active account) approaches
the row counts where an indexed Postgres query over that person's own rows
becomes slow. This is different in kind from the global leaderboard, where
N is "everyone who has ever signed up." **Caching this today would add
invalidation complexity for a problem that doesn't exist yet.**

## Where Redis would actually help, if/when it's needed

In rough order of when they'd become worth doing, cheapest/highest-value
first:

1. **Friend-id set per user** — `SADD friends:{public_id} <friend public ids>`.
   Turns the "which users are my friends" step from an indexed Postgres
   query into an O(1) Redis `SMEMBERS`/`SISMEMBER`. Only worth it if friend
   lookups become a measured hot path (e.g. called on every page load
   somewhere, not just when the Friends modal is open). Invalidate by
   updating both sides' sets on accept/remove/block — mirrors exactly how
   `record_score` already updates the leaderboard ZSET on write.

2. **`friends_board()` result cache**, short TTL (e.g. 30–60s), keyed by
   `friends-board:{public_id}`. Only worth it if the leaderboard modal's
   auto-refresh (every 5 min client-side, see `useLeaderboard.ts`) combined
   with real traffic produces enough repeated identical queries to matter.
   Given the client already caches this for 5 minutes per browser session,
   the *server-side* read volume this would save is probably small until
   there are many concurrent viewers of the same friend group (unlikely
   outside something like a friend-group tournament feature).

3. **Friend-request counts** (for a future "N pending requests" badge, if
   built) — a natural Redis counter (`INCR`/`DECR` on send/accept/decline),
   avoiding a `COUNT(*)` on every page load that shows the badge. This is
   the one item here that's "cache because the access pattern demands it,"
   not "cache because the query is slow" — worth building alongside
   whichever feature first needs a live badge count, not before.

## What NOT to do preemptively

- Don't cache `search-friends` results — search queries are inherently
  varied (different `q` per keystroke), so a cache would mostly store
  entries that are read once and never hit again. Low hit rate, real
  invalidation cost.
- Don't build a generic "friends cache layer" ahead of a specific access
  pattern that needs it. The global leaderboard cache exists because a
  concrete, unbounded-N problem was already there; friends data doesn't
  have that problem yet.

## When to actually do this

Revisit item 1 (friend-id set) if either becomes true:
- Friend-related endpoints show up meaningfully in slow-query logs or
  Vercel function duration percentiles, **or**
- A future feature calls "is X my friend?" or "list my friends" on a
  hot path outside the Friends modal itself (e.g. a friends-only game mode,
  a "friends who are online" indicator) where the check runs far more often
  than a user opens the modal.

Revisit item 2 if the friends leaderboard modal becomes a widely-shared
view (e.g. leaderboards embedded/shared outside the app) rather than each
player mostly looking at their own.

## Implementation shape, when the time comes

Follow the existing pattern in `users/leaderboard.py` exactly — it's
already the right template:
- Lazy `redis.from_url(REDIS_URL)` client, `None` when `REDIS_URL` isn't
  set (local/CI keep working with zero code changes).
- Every cached read has a Postgres fallback path — Redis is an
  accelerator, never a dependency the app can't run without.
- Writes to the cache happen at the same call sites that already mutate
  the underlying rows (`accept_friend_request`, `remove_friend`,
  `block_user`, `unblock_user`), mirroring how `record_score()` is called
  from every place `points` changes today.
