# NBA Data Architecture — Design Spec

- **Date:** 2026-06-21
- **Repo:** `nba-minigames` (React 19 + TS + Vite frontend, Django/DRF backend, Socket.IO multiplayer server)
- **Status:** Approved (research-backed); ready for phased implementation

## 1. Problem

The app sources NBA data with the open-source `nba_api` (which calls `stats.nba.com`). It works locally
but breaks when deployed to the public cloud (Render). We need a sourcing + storage + serving
architecture that is fast, refreshes periodically, supports a growing number of games, works for **web
and mobile**, supports **multiplayer with identical data for both players**, and scales to potentially
millions of concurrent users.

### Confirmed constraints
- **Budget:** ~$25/month.
- **Freshness:** Occasional refresh is fine (weekly; data is historical/slowly-changing).
- **Stack:** Open to best-fit changes (managed Postgres + Redis + CDN, keep Django).

## 2. Current state (as found)

The request-serving path already mostly reads pre-built local data — it does **not** call the live NBA
API per request:

| Game | Endpoint | Data source at request time |
|---|---|---|
| Playoff series winner | `playoff-series/` | local `playoff_data.json` (128 KB, 255 series) |
| Name → logo | `name-logo/` | `nba_api` static team list (offline) + `cdn.nba.com` logo URLs (browser-loaded) |
| Guess the MVPs | `guess-mvps/` | local `nba_mvps.csv` (12 KB) |
| All players | `all-players/` | `nba_api` static player list (offline) |
| Starting five | `starting-five/` | local `starting_five_data.json` (452 KB, 578 games) |
| Wordle | `wordle/` | `nba_api` static player list (offline) |

The only live-API code is the two **builder scripts** (`trivia/utils/playoff_games_utils.py`,
`trivia/utils/starting_five_utils.py`). Total game dataset is **< 1 MB**.

Other relevant facts: DB is **SQLite**; cache is per-process **LocMemCache**; backend on **Render**
(`gvt-backend-t09g.onrender.com`); `DEBUG=True`, hardcoded `ALLOWED_HOSTS=[]`, hardcoded localhost CORS,
hardcoded `SECRET_KEY`. User score = `points` (int) on `CustomUser`, with derived `rank`. Frontend already
has `Api.tsx`, per-game renderers, and a `useLeaderboard.ts` hook. Multiplayer runs over a Socket.IO server
(`multiplayer_server/`, port 4000).

### Why it breaks in the cloud (root cause)
`stats.nba.com` blocks (a) data-center IP ranges (Render, AWS, **and GitHub Actions/Azure**) and
(b) non-browser traffic via Akamai TLS fingerprinting. Residential IPs pass both. So the **ingestion**
step fails in the cloud; the **serving** path is fine.

## 3. Core architectural principle — two lanes

Because game content is tiny and barely changes, it is a **file-distribution problem**, not a database
problem. Split the system:

- **Lane A — Game content** (high traffic, identical for everyone, changes weekly): serve as precomputed,
  versioned **static JSON from a CDN**. Never touches Django/Postgres/Redis. Scales to millions for ~$0.
- **Lane B — User data** (accounts, points, leaderboards; per-user, frequently changing): the only part
  that needs a server + database.

## 4. Decisions

### 4.1 Data sourcing — decouple ingestion (keep `nba_api`)
Run the existing `nba_api` builders on a **residential machine** (the owner's PC) on a **weekly schedule**;
publish the finished dataset to the cloud. Render never calls `stats.nba.com`, so its IP never matters.
$0, reuses existing code, lowest ToS risk, and it preserves the box-score/lineup data that hosted APIs
charge $39.99/mo for. **BallDontLie** (API key, cloud-safe, free tier) is the documented fallback if home
ingestion is ever undesirable. MVP winners have no API → keep the manual list.

### 4.2 Storage — answering "per-game vs one big table vs Redis"
- **Game content → one versioned JSON file per game** in object storage behind a CDN. "Add a game" = add
  a file. Not per-game DB tables (too much code per game), not one giant mixed table, not Redis (Redis is
  for leaderboards, not bulk content).
- **Authoring/registry → one generic `game_content` table** (Postgres) with `game_type` + JSONB payload +
  version. The refresh job renders rows → per-game JSON files. Database for building, files for serving.
- **User data → managed Postgres (Supabase)** replacing SQLite. SQLite fails at scale (single writer;
  per-instance file; Render's ephemeral disk wipes it on deploy).
- **Leaderboards → Redis sorted sets (Upstash)**: `ZADD` on score, `ZREVRANGE` for top-N, `ZREVRANK` for a
  user's rank. Postgres stays the durable source of truth; Redis is the fast, rebuildable index.

### 4.3 Recommended stack
| Layer | Tool | Role |
|---|---|---|
| Content delivery | Cloudflare R2 + custom-domain CDN (free egress) | serve versioned JSON to web + mobile |
| Web hosting | Cloudflare Pages (or keep current host) | React build on the edge |
| User DB | Supabase Postgres | accounts + points (replaces SQLite) |
| Leaderboard / realtime scale | Upstash Redis | sorted sets + Socket.IO adapter |
| API | Django on Render | auth, score writes, leaderboard reads only |
| Refresh | Home scheduled job + small managed cron trigger | weekly rebuild + publish |

### 4.4 Randomization — single-player vs multiplayer
- **Single-player:** the client downloads the whole pool once (cached on-device + at the CDN edge) and
  **picks a random item locally** every play → zero network per play; CDN-cacheable to ~100% hit. This is
  the one behavior change from today's server-side random (approved).
- **Multiplayer (new requirement): server-authoritative selection.** See §5.

## 5. Multiplayer: identical data for both players

Requirement: both players in an online match must get the **same** series/questions.

Design (fits the static-content model):
1. Both clients already hold the **same content pool** (same files from the CDN).
2. On match start, the **Socket.IO server picks the round's items** and broadcasts to both players in the
   room: `{ gameType, dataVersion, itemIds: [...] }`. It sends **IDs, not data** (tiny payload; CDN still
   serves the actual content).
3. Each client renders exactly those items, in that order, by **ID lookup** in its pool. IDs (e.g.
   `game_id`, `series_id`) are stable; if a client is missing an ID (older pool), it fetches the pinned
   `dataVersion` pool from the CDN first.
4. The match **pins `dataVersion`** so a mid-session weekly refresh can't desync the two players.
5. To scale the realtime server horizontally (many concurrent matches), use the **Redis Socket.IO adapter**
   (same Upstash instance) so multiple server copies share rooms/match state.

Net rule: **single-player → client picks; multiplayer → server picks and shares.** The server only needs
the list of item IDs per game (it can read the same published pool/manifest and choose from it).

## 6. Refresh pipeline

A weekly job (run from a residential machine for the pull):
1. **Pull** from `nba_api` (residential IP).
2. **Precompute + validate** the pools (record counts in expected range, schema checks). Validation gates
   publishing — never push a malformed pool.
3. **Write versioned files** to object storage: `/v/<version>/<game>.json` (immutable, hashed names,
   `Cache-Control: immutable`).
4. **Flip `manifest.json`** (the single small mutable pointer; short TTL) to the new version atomically.
5. Clients read `manifest.json` on startup/focus; if `version` changed, fetch the new immutable files.
   On failure, clients keep the last good pool (graceful staleness).

## 7. Settings hardening (folded into the migration)
Move to env-driven config: `DEBUG=False` in prod, `ALLOWED_HOSTS` from env (Render domain + custom),
`SECRET_KEY` from env, real CORS/CSRF origins from env, `DATABASE_URL` (Supabase, pooled), Redis cache via
`django-redis`. These ship with the database/serving phases (coordinated with the owner's env vars), not in
Phase 1, to avoid disturbing the live deploy prematurely.

## 8. Phased rollout (each phase ships independently)

1. **Decouple ingestion + versioning (account-independent, biggest immediate win).** A
   `refresh_game_data` Django management command that runs the builders, validates, writes the data files,
   and emits a `manifest.json` (version + per-file hash). Home scheduler instructions/script. Add an
   additive endpoint to serve a whole pool (for future client-side randomization) without removing the
   current random endpoints. → fixes the blocking problem; lays the versioning foundation.
2. **Publish content to Cloudflare R2 + CDN**; point web/mobile at the CDN + `manifest.json`.
3. **Client-side randomization** in `Api.tsx` + renderers (download pool once, pick locally).
4. **DB migration SQLite → Supabase Postgres** (+ settings hardening) for accounts + points.
5. **Redis leaderboards (Upstash)** backed by Postgres; **multiplayer server selection + Redis adapter**.
6. **Hardening + load-check**; point the mobile app at the same files + API.

## 9. Cost
- Today/launch: **~$0–$8/mo** (free tiers; Supabase Pro $25 only when you outgrow free) — within budget.
- Millions of active users: **~$70–$150/mo**, with **content serving staying ~$0** regardless of audience
  (it's static JSON on a free-egress CDN). The bill scales with the user/leaderboard path, not raw audience.

## 10. Account-side steps the owner performs (cannot be automated here)
- Create Cloudflare R2 + (later) Supabase + Upstash accounts; provide credentials as env vars/secrets.
- Schedule the weekly home job (Windows Task Scheduler) once Phase 1 lands.
- Provision the CDN custom domain.

## 11. Out of scope
- Live/real-time scores (data is historical; not needed).
- Paid hosted NBA API (home ingestion covers it within budget; BallDontLie documented as fallback).
- Changing game rules/UX beyond the randomization-source change.
