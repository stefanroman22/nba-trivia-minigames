# Phase 3 — Client-side randomization (frontend)

**Goal:** Each single-player game downloads its whole pool **once** (cached in memory + localStorage, keyed by data version) and picks the round items **locally**, instead of hitting a per-request random API endpoint. This makes the pool CDN/edge-cacheable and means plays need no network round-trip — exactly the "don't call the API every time" requirement.

**Delivered:**
- `src/utils/pool.ts`
  - `fetchGamePool(gameKey, rounds): Promise<FetchResult>` — loads the pool via `/trivia/manifest/` (version) + `/trivia/pool/<gameKey>/` (whole pool), caches it under `pool:<gameKey>:<version>` in localStorage (+ in-memory), prunes old versions, and returns `rounds` locally-sampled items in the existing `FetchResult` shape.
  - `sampleN(pool, n)` — distinct random picks (Fisher–Yates for the whole-pool case).
- `src/utils/GameUtils.tsx` — the 5 games now call `fetchGamePool(...)`: `playoff`/`name-logo`/`mvps` → 5 rounds, `starting-five`/`wordle` → 1. Removed the now-orphaned `BACKEND_ORIGIN` import. `fetchGameData` retained (coming-soon).

**Why it's safe / isolated:**
- The `/trivia/pool/<key>/` items are byte-identical in shape to the old random-endpoint items (verified per game, incl. the MVP CSV: `season`/`mvp` are strings either way, so pandas vs DictReader makes no difference). Renderers consume `FetchResult.data` unchanged — no renderer edits.
- `fetchData` is called only by single-player `MiniGame.tsx`. Multiplayer uses a separate `.series` socket path and is untouched (server-authoritative selection comes in Phase 5).
- The `all-players` autocomplete fetches in `GuessMvps`/`StartingFive` are already whole-list (not randomized) and were left as-is.

**Verification:** `npm run build` (tsc -b + vite) green; `npx eslint src/utils/pool.ts src/utils/GameUtils.tsx` clean. (Project has no JS test runner; `npm run lint` over the whole tree is pre-existingly noisy because eslint isn't ignoring `backend/venv` — unrelated.)

**Deferred:** switching the pool source from the Django `/trivia/pool/` endpoints to the CDN manifest URLs (once Phase 2's R2 bucket is live) is a localized change in `pool.ts`. Graceful-staleness (serve last-good cached pool if the manifest fetch fails) is a Phase 6 nicety.
