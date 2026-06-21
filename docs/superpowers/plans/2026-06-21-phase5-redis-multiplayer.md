# Phase 5 — Redis leaderboard + multiplayer prod fix + scaling adapter

**Goal:** Make the leaderboard scale to millions (Redis ZSET, O(log N) rank) without changing current behavior; fix deployed multiplayer; and lay the Socket.IO horizontal-scaling foundation. Everything Redis is behind `REDIS_URL` with a Postgres/in-memory fallback.

## Multiplayer "same questions for both players" — already satisfied
The Socket.IO server already does server-authoritative selection: on `requestGameData` (and rematch) the **server** fetches one round and broadcasts the **same** payload to the whole room (`io.to(code).emit("gameData", …)`). Both players get identical data. No selection change needed; the spec's "send IDs" form is a future bandwidth optimization, not a correctness fix.

## Delivered

**Backend leaderboard (account-independent, tested):**
- `users/leaderboard.py` — `top(n)`, `rank_of(user)`, `total()`, `record_score(user)`, `rename(old, user)`. Uses a Redis ZSET (`ZADD`/`ZREVRANGE`/`ZREVRANK`/`ZCARD`) when `REDIS_URL` is set; otherwise the **exact original Postgres queries**. `redis` is lazy-imported.
- `users/views.py` — `get_users` delegates to the service; `update_profile` syncs the ZSET after `save()` (`record_score`, or `rename` on username change); **new accounts** (`signup_view` + `google_login`) call `record_score` on creation so the ZSET is complete and `total()`/ranks never diverge from Postgres. `total()` is ZSET-authoritative (no Postgres fallback that would hide drift). No behavior change without Redis.
- `users/management/commands/sync_leaderboard.py` — one-shot backfill of the ZSET from Postgres.
- `requirements.txt` — `redis` (used only when `REDIS_URL` set).

**Multiplayer server:**
- `gameEndpoints.js` — **bug fix:** Django base URL from `API_BASE_URL` env (was hardcoded `localhost:8000`, so deployed multiplayer couldn't reach the API).
- `index.js` — CORS origins from `CORS_ORIGINS` env; a **lazy Redis adapter** (`@socket.io/redis-adapter`) enabled by `REDIS_URL` so multiple instances share rooms/broadcasts. Deps lazy-required → without `REDIS_URL` the server runs single-instance exactly as before.
- `package.json` — `@socket.io/redis-adapter`, `redis`.

## Verification
`node --check` on both JS files; backend suite **30 passing** (9 new leaderboard tests covering the Postgres fallback AND the Redis path via an injected fake client); `manage.py check` clean. With no `REDIS_URL`, leaderboard results are byte-identical to before.

## Account step (you)
Create an Upstash Redis DB; set `REDIS_URL` on both the Django service and the multiplayer server; set `API_BASE_URL` (deployed backend) + `CORS_ORIGINS` on the multiplayer server; run `manage.py sync_leaderboard` once to backfill.

## Deferred
- Full multi-instance matchmaking requires moving the in-memory `rooms`/`waitingPlayers`/`rematchRequests` into Redis (the adapter alone shares broadcasts, not custom matchmaking state) — a focused follow-up.
- Optimizing the multiplayer payload from full data to item-IDs (clients resolve from their cached pool) — bandwidth nicety.
- Real Redis verification needs the Upstash instance.
