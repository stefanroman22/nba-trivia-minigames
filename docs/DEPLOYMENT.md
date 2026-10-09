# Deployment & Scaling Runbook

This is the single checklist to take the app from "works locally" to "scales to lots of
users." Everything below is **optional and incremental** — the app runs today with none of
it (sqlite, in-memory cache, static `/data/` pools, single multiplayer instance). Each step
"lights up" a piece of the scalable architecture by adding an account + a few env vars.

Design background: `docs/superpowers/specs/2026-06-21-nba-data-architecture-design.md`.

## Current live state

| Piece | Status | Where |
|---|---|---|
| Django API (auth, leaderboard, game data) | **LIVE** | Vercel serverless — `https://backend-kappa-one-42.vercel.app` |
| User database | **LIVE** | Supabase Postgres (migrated; signup/login/leaderboard verified) |
| Frontend + game content | **LIVE** | Vercel CDN (`/data/` pools) |
| Multiplayer ("Play Online") | **Dead** — old Railway host is gone, nothing currently deployed | needs a persistent Node host (see note) |

**Supabase connection (important):** the project's *direct* host `db.<ref>.supabase.co` is
**IPv6-only and unreachable from Vercel (IPv4)**. You must use the **transaction pooler** (port
`6543`, not the session pooler's `5432` — see `settings.py`'s `conn_max_age=0` /
`DISABLE_SERVER_SIDE_CURSORS` comments for why):
```
DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-1-eu-central-1.pooler.supabase.com:6543/postgres
```
(region `eu-central-1`, `aws-1` prefix, user `postgres.<ref>` — the `.` suffix is how Supavisor
identifies the tenant; without it you get `ENOIDENTIFIER`). Copy it from the Supabase dashboard's
**Connect → Direct → Transaction pooler**, and percent-encode special characters in the password.
This URL is set on the backend Vercel project; `vercel.json`'s `buildCommand` runs `migrate` on
each deploy — so **a database outage fails the build**, and no backend deploy can ship while the
DB is unreachable.

**Reading Supavisor's error codes** (they name the fault precisely, so don't guess):

| Code | Means |
|---|---|
| `ENOIDENTIFIER` | user is missing the `.{project-ref}` suffix |
| `ENOTFOUND` | tenant/project ref doesn't exist |
| `password authentication failed` | right tenant, wrong password |
| `EAUTHQUERY` | pooler can't resolve the role or reach the tenant's database |

**Multiplayer note:** Vercel serverless functions are short-lived and can't hold the persistent
WebSocket connections / in-memory room state Socket.IO needs, so the multiplayer server in
`multiplayer_server/` must run on a small always-on Node host (Railway/Render/Fly). Once deployed,
set `VITE_SOCKET_URL` on the frontend (+ `API_BASE_URL`/`CORS_ORIGINS` on the host) and redeploy.

## The two lanes (why this scales)

- **Game content** — tiny (<1 MB), identical for everyone, changes weekly. Built off-cloud,
  served as static JSON. Scales to millions for ~$0.
- **User data** — accounts, points, leaderboard; per-user, changes constantly. The only part
  that needs a server + database + cache.

## Services

| Service | Runs on | Repo location |
|---|---|---|
| Frontend + game content | **Vercel** (serves the app *and* the game-data JSON at `/data/` from its CDN) | repo root `src/` |
| Django API | **Vercel** (serverless, Django auto-detected) | `backend/` |
| Photo moderation | **Vercel** (separate Python project `nba-minigames-moderation`, called server-to-server by Django) | `moderation_service/` |
| Multiplayer (Socket.IO) | small always-on Node host (Railway/Render/Fly — **not** Vercel) | `multiplayer_server/` |
| Data refresh | **Your home machine** (residential IP) | `backend/` management commands |

> The NBA blocks data-center IPs, so the data **refresh** must run from home. The cloud only
> ever serves pre-built data.

### How each service ships

| Service | Trigger | Notes |
|---|---|---|
| Frontend | push to `main` → production; push to `dev` → dev alias | Vercel git integration; `vercel.json` selects the Next.js preset |
| Django API | **manual CLI only** — `cd backend && vercel deploy --prod` | project is *not* git-connected |
| Multiplayer | Railway | not yet deployed |

The manual deploy uploads the **local working tree**, not a commit — such deployments show
`gitDirty: 1` and can silently pin production to code matching no branch. Production once ran a
weeks-old commit this way while `dev` moved on.

**Why the backend isn't git-connected — read before reconnecting it.** Connecting it is only
safe once the Vercel project's **Root Directory** is set to `backend`. Without that, Vercel
builds from the repo root, applies the root `.vercelignore` (which exists to strip `backend/`
from the *frontend* build), deletes every Django source file, and builds the Next.js frontend
instead — then promotes that onto `backend-kappa-one-42.vercel.app`. **The build succeeds**, so
nothing fails loudly; the API just starts returning HTML. This happened on 2026-08-29.

Verify the Root Directory takes effect before trusting production to it:

1. Set Root Directory to `backend` (Settings → Build and Deployment) and save.
2. `cd backend && vercel git connect https://github.com/stefanroman22/nba-trivia-minigames`
3. Push a throwaway branch (**not** `dev` — `dev` auto-promotes to `main` and would deploy to
   production). A non-`dev` branch produces a preview build only.
4. Read that build's log. It must clone and run `pip`/`manage.py migrate`. If it says
   `Removed N ignored files` listing `/backend/...`, or installs npm packages, the Root
   Directory is not applied — `vercel git disconnect` immediately.
5. Only then push `dev` and let CI promote to `main`.

Preview URLs are SSO-protected, so verify from the **build log**, not by curling the preview.

**`vercel rollback` pins the production domain.** After a rollback, later git deploys build,
go READY, and never serve traffic — the alias keeps pointing at the rolled-back deployment, with
no warning. `latestDeployment` in the API shows the new one, so it looks shipped. Health checks
can't tell you either: the pinned deployment is also healthy Django. Confirm what is actually
serving with

```bash
vercel inspect backend-kappa-one-42.vercel.app   # prints the serving deployment id
```

and clear the pin with `vercel promote <deployment-url>`. On 2026-08-29 this silently held
production on a two-hour-old build across several "successful" deploys.

## One-time accounts (create as you need each phase)

1. **GitHub** — already done (repo pushed).
2. **Vercel** (Phase 2 — hosts the frontend, which also serves the game-data JSON from its CDN;
   the data ships with the build, so **no separate object store is needed**). Cloudflare R2 stays
   an optional alternative for a dedicated data domain — see the R2 note under "Home machine".
3. **Supabase Postgres** (Phase 4 — user DB).
4. **Upstash Redis** (Phase 5 — leaderboard + multiplayer scaling).

## Environment variables by service

### Django API (Vercel) — see `backend/.env.example`
```
DJANGO_SECRET_KEY=<long random secret>
DJANGO_DEBUG=False
DJANGO_ALLOWED_HOSTS=<your-backend>.vercel.app         # *.vercel.app + VERCEL_URL are auto-trusted
CORS_ALLOWED_ORIGINS=https://<extra-origin>              # ADDITIVE — merged onto settings.FRONTEND_ORIGINS, never replaces it. Leave unset unless adding a domain.
CSRF_TRUSTED_ORIGINS=https://<extra-origin>              # same; *.vercel.app is auto-trusted for CSRF regardless
DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-1-eu-central-1.pooler.supabase.com:6543/postgres   # MUST be the Supabase POOLER (transaction, 6543), not the IPv6 direct host (unset -> sqlite)
REDIS_URL=rediss://...                                       # Upstash (see "Redis (Upstash) — setup" below). Unset -> Postgres leaderboard AND DatabaseCache for rate limiting + friends cache
CLIENT_ID=...            # Google OAuth (existing)
CLIENT_SECRET=...
IMAGE_MODERATION_URL=https://<moderation-project>.vercel.app/api/classify   # photo moderation, see "Moderation service" below; unset in production = uploads answer 503
MODERATION_SHARED_SECRET=<same random value as the moderation project>
# optional: MODERATION_REQUIRED (default true when DATABASE_URL is set), PHOTO_BLOCK_THRESHOLD (0.85), PHOTO_REVIEW_THRESHOLD (0.50)
```
The `SUPABASE_S3_*` / `SUPABASE_STORAGE_BUCKET` / `QUESTIONS_PUBLIC_BASE` set (see `backend/.env.example`) is for the old questions pipeline only (`maintain_questions`, `upload_dataset`: hidden games + the fallback snapshot) — not needed on Vercel, nor by `publish_game_data_v3`.
`DATA_PUBLIC_BASE` (the static game-data host's public URL) is read only by `manage.py publish_game_data_v3`, which runs in the manual `publish-game-data.yml` workflow (repo variable `vars.DATA_PUBLIC_BASE`) — not needed on Vercel either.

### Multiplayer server (Render / Node host)
```
NODE_ENV=production                                  # REQUIRED: the server refuses to start without CORS_ORIGINS
API_BASE_URL=https://backend-kappa-one-42.vercel.app/api # REQUIRED in prod (else it tries localhost); also where it verifies login tokens (GET /me/)
CORS_ORIGINS=https://swishquest.com,https://www.swishquest.com   # production site origins ONLY — never localhost, that is what keeps local dev off this server
DATA_PUBLIC_BASE=https://nba-minigames-data.vercel.app   # game-data host: pool games + published question games (unset = backend endpoints / questions store)
QUESTIONS_PUBLIC_BASE=https://<project-ref>.supabase.co/storage/v1/object/public/<bucket>   # questions store: hidden games + fallback for the question games
REDIS_URL=rediss://...                               # optional: enables the Socket.IO adapter
PORT=4000
```

### Frontend build (Vercel project env)
```
VITE_BACKEND_URL=https://backend-kappa-one-42.vercel.app/api
VITE_SOCKET_URL=https://<your-multiplayer-host>     # set once the Node host is deployed
# VITE_DATA_BASE is optional — defaults to /data (the build bundles the pools there).
# Set it only to serve pools from an external CDN/domain instead.
# NEXT_PUBLIC_SITE_URL is optional and for local QA only — canonical/OG/sitemap/robots/llms.txt URLs default to https://swishquest.com (src/configurations/site.ts).
```
The `VITE_*` names predate the Next.js migration and are kept on purpose: `next.config.ts`
inlines these three into the browser bundle (Next only exposes `NEXT_PUBLIC_*` by itself).

### Home machine (data refresh) — see [DATA_PIPELINE.md](DATA_PIPELINE.md)
No env vars needed for the default Vercel path — the data ships with the frontend build.
R2 env vars (optional CDN alternative) are documented there, not repeated here.

## Redis (Upstash) — setup

**Provider decision (2026-09-30, `docs/team/designs/2026-09-30-redis-friends-cache.md`):**
Upstash Redis. Free tier, TLS `rediss://` endpoint that Django's built-in `RedisCache` +
`redis-py` speak with no extra package, per-lambda connections that need no pooler, and the
same instance serves the leaderboard ZSET (`users/leaderboard.py`), the friends cache
(`users/friends_cache.py`) and the multiplayer Socket.IO adapter. Its REST API is **not** used —
Django's cache framework has no REST backend. Alternatives: Redis Cloud free tier (30 MB, no
Vercel integration), "Vercel KV" (is Upstash via the Marketplace), Railway/Render (usage-billed).

**Steps (owner only — creating the account is a money decision even on the free tier):**
1. Sign up at upstash.com (GitHub login is fine) — or, from the Vercel dashboard, *Storage →
   Create → Upstash Redis* (Marketplace). Either way pick the **Free** plan; no card should be
   requested — if it is, stop.
2. Create a database: type **Regional** (not Global — Global replicates and costs more per
   command, verify on signup), region **eu-central-1 / Frankfurt** to sit next to the backend
   (`backend/vercel.json` `regions: ["fra1"]`) and Supabase (`aws-1-eu-central-1`). TLS on
   (default). **Eviction: off** (default) — with eviction on, the leaderboard ZSET could be
   evicted and `leaderboard.top()` would return an empty board until `manage.py sync_leaderboard`
   re-backfills. The friends-cache keys expire on their own (60 s).
3. Copy the **Redis (TLS) URL** from the database's *Details* tab. It looks like
   `rediss://default:<password>@<name>-<id>.upstash.io:6379`. Free-tier limits to note (verify on
   signup; they change): ~256 MB, ~500K commands/month, ~100 concurrent connections — far above
   this app's traffic; the cache issues 1-2 commands per Friends-modal open.
4. Set `REDIS_URL` to that value on the Vercel **backend** project (Production and Preview) — the
   Marketplace integration injects its own names (`KV_URL`, `KV_REST_API_URL`, …; verify on
   signup); `settings.py` and `leaderboard.py` read **only `REDIS_URL`**, so add it explicitly if
   the integration did not. Then redeploy the backend (`vercel --prod` or push to `main`).
5. Backfill the leaderboard once: `cd backend && python manage.py sync_leaderboard` with
   `REDIS_URL` and `DATABASE_URL` exported locally (Phase 5b).
6. Verify: `GET /api/friends-overview/` twice with the same token — the second should be
   visibly faster in the Vercel function log; `GET /api/get-users/` still returns the board.
7. Optional: set the same `REDIS_URL` on the multiplayer host to enable the Socket.IO adapter.
8. Record the credential in `docs/CREDENTIALS.md` (a row is pre-filled) — rotation is
   *Database → Details → Reset password* in the Upstash console, then update `REDIS_URL`.

## Data workflow (home machine)

The scheduled refresh (`sync_nba_data` → `upload_dataset` → `gh workflow run publish-game-data.yml`)
is fully documented in [DATA_PIPELINE.md](DATA_PIPELINE.md) — that's the single source of truth
for how, how often, and how it's monitored. It no longer commits pools or runs `vercel deploy`
(that redeployed the website from the PC's working tree).

## Data publishing (game-data host)

Pool games, and (from the first question publish on) the question games, read manifest-v3
files from the data host `vars.DATA_PUBLIC_BASE` (`https://nba-minigames-data.vercel.app`,
Vercel project `nba-minigames-data`), published independently of the website and backend.
Design: `docs/team/designs/2026-10-02-independent-game-data-publishing.md`.

One button publishes all nine file-based games: playoff, name-logo, mvps, starting-five,
fan-favorites (+ the all-players `names` list) and career-path, who-are-ya, tictactoe,
contexto (+ their `question_names` list). For the question games the run first does the
question maintenance (re-materialize, retire, top up, minimum gate; formerly
`maintain-questions.yml`) against the committed `players_curated.json`, in the same DB
transaction as the build, so a failed gate publishes nothing and rolls the maintenance back.
Each question is its own content-addressed file (`<game>/<qid>.<sha12>.json`), listed by a
content-addressed index, so an unchanged question is never re-uploaded or re-downloaded.
A dry run rolls every DB write back (`--no-commit`). `manage.py publish_game_data_v3
--skip-maintain` publishes the current questions without maintenance.

The site (`src/utils/questions.ts`) and the relay (`multiplayer_server/src/questions.js`,
also behind `turnGames.js`) read a question game from the data host when its manifest has it
(`"kind": "questions"`), else from the old Supabase Storage questions store, logged once per
game. The hidden games (superdraft, imposter) stay on the store until they return. The store
is retired 30 days after the switch (steps in the design doc, phase 6).

| What | Where | When |
|---|---|---|
| **Publish button** | Actions → **Publish game data** (`publish-game-data.yml`): `games` empty = all (or e.g. `career-path,contexto`), `target` vercel, untick `dry_run` | manually, or triggered by the PC refresh |
| **Question maintenance (hidden games only)** | `maintain-questions.yml`, manual only: refreshes the Supabase snapshot superdraft/imposter and the fallback read | only when the hidden games need new questions |
| **Freshness alert** | `game-data-freshness.yml` runs `manage.py publish_game_data_v3 --check-only` (no DB writes; question games are materialized from their current rows, no maintenance) and posts one message to Slack `#agent-backend` naming games whose DB data isn't published yet, with a link to the button | daily 06:30 UTC + manual; silent when everything is fresh |
| **Usage report** | `game-data-usage.yml` runs `backend/scripts/vercel_usage_report.py` and posts to `#agent-backend`: live data version, size of the published set (raw and gzip'd), data deployments this week, link to the Vercel usage dashboard | Mondays 07:00 UTC + manual |
| **PC refresh** | `backend/scripts/refresh_nba_data.cmd` (Task Scheduler): `sync_nba_data` → `upload_dataset` → `gh workflow run publish-game-data.yml --ref main -f games= -f target=vercel -f dry_run=false` | monthly; needs `gh` logged in as `stefanroman22` |

The usage report **cannot show bandwidth served or a % of the free allowance**: Vercel's only
usage endpoint (`GET /v1/billing/charges`) needs the `billing` scope, "only available to Pro and
Enterprise teams", and this team is on Hobby (100 GB Fast Data Transfer/month, shared with the
website). Check that number on the Vercel usage dashboard; Vercel also emails when a Hobby limit
is near.

Rollback = republish an older manifest from `manifest-history.json`; never `vercel rollback` the
data project (it pins the domain, see above).

## Moderation service (profile photos)

Every profile photo upload is classified before it is saved. The classifier is a small open-source
ONNX model (`OwenElliott/image-safety-classifier-xs`, MIT, classes NSFW / NSFL / SFW) that runs in its
own tiny Vercel Python project, `nba-minigames-moderation` (`moderation_service/`), not inside the
main Django function: `backend/requirements.txt` is unchanged and `onnxruntime` never loads at Django
startup (`trivia/tests/test_startup.py` guards it). Django calls `POST /api/classify` with the 256x256
JPEG from `normalize_profile_photo` (`users/photo_moderation.py`, 4 s timeout, one retry). Design:
`docs/team/designs/2026-10-07-photo-moderation-with-a-small.md`; why: `docs/team/DECISIONS.md`.

Policy: `score = max(nsfw, nsfl)`. At or above `PHOTO_BLOCK_THRESHOLD` the upload is refused (422
`photo_rejected`), nothing is saved, and it counts as a strike through `users.strikes.record_strike`
(the 3rd bans, 403 `account_banned`). Between `PHOTO_REVIEW_THRESHOLD` and block it is allowed and
logged as a `ModerationEvent` (`kind=photo`, `tier=mild`, `reason=uncertain`) for owner review. If the
service is down, times out or is misconfigured the upload answers 503 `moderation_unavailable` and
nothing is saved (fail closed). Only when `MODERATION_REQUIRED` is false (default: false without
`DATABASE_URL`, i.e. local sqlite) and `IMAGE_MODERATION_URL` is unset is the check skipped, with a
warning in the log.

### Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `MODERATION_SHARED_SECRET` | **both** Vercel projects (`backend` and `nba-minigames-moderation`), same value | sent by Django as `X-Moderation-Key`, compared in constant time; unset on the service = every request 401 |
| `IMAGE_MODERATION_URL` | `backend` | full URL of the service's `/api/classify` |
| `MODERATION_REQUIRED` | `backend` (optional) | default true when `DATABASE_URL` is set; true + no URL = 503 on every upload |
| `PHOTO_BLOCK_THRESHOLD` | `backend` (optional) | default `0.85` (placeholder) |
| `PHOTO_REVIEW_THRESHOLD` | `backend` (optional) | default `0.50` (placeholder) |
| `MODERATION_MODEL_PATH` | moderation project (optional) | default `model/image-safety-classifier-xs.onnx` |
| `MODERATION_MODEL_SHA256` | moderation project (optional) | overrides `model/model.sha256` |
| `MODERATION_CLASS_ORDER` | moderation project (optional) | default `nsfw,nsfl,sfw` |
| `MODERATION_SECOND_MODEL_PATH` | moderation project (optional) | second-opinion hook, read and logged only, never loaded |

GitHub repository secrets for the deploy workflow: `VERCEL_TOKEN` and `VERCEL_ORG_ID` (reused),
`VERCEL_MODERATION_PROJECT_ID` and `MODERATION_SHARED_SECRET` (new; the smoke test sends the shared secret
as `X-Moderation-Key`, so it must also be a repository secret, same value as on the two Vercel projects).
The workflow is manual only (`workflow_dispatch`, boolean input `deploy`; unticked = evaluation-only run).

### Owner steps (the pipeline cannot do these)

0. **Pin the model checksum.** The model file is not committed. Run Actions -> **Deploy moderation
   service** once with `deploy` unticked: it downloads the model, prints its SHA-256 and fails because
   `moderation_service/model/model.sha256` is `UNPINNED`. Commit the printed hash there (an unpinned
   model can never deploy or load) and confirm the MIT licence text in `moderation_service/model/README.md`.
1. Create the project (free Hobby): `vercel project add nba-minigames-moderation --scope stefanromanpers-5412s-projects`.
2. Add the GitHub secrets `VERCEL_MODERATION_PROJECT_ID` and `MODERATION_SHARED_SECRET` (the same random value as in step 3).
3. Set `MODERATION_SHARED_SECRET` (the same random value) on the moderation project and on `backend`,
   and `IMAGE_MODERATION_URL` on `backend`.
4. Run the workflow with `deploy` ticked (it ends with a smoke test), then run the private recall check
   locally and confirm the thresholds: put real benign photos in `moderation_service/eval/private/benign/`
   and your own NSFW samples in `moderation_service/eval/private/nsfw/` (gitignored, never commit explicit
   imagery), then `python moderation_service/eval/run_eval.py --dir moderation_service/eval/private`.
   Thresholds are env-tunable on `backend` without a redeploy of the service.

The committed benign set (`moderation_service/eval/benign/`, 60 generated images) is synthetic: it catches
gross failures (wrong class order, broken preprocessing) but is not production accuracy. CI runs only the
false-block check on it (`--max-false-block 0`).

### Measured numbers

Thresholds `0.85` (block) and `0.50` (review) are **placeholders** until owner step 4. The model could not
be fetched from the build sandbox, so nothing below is measured yet; the first workflow run prints these in
its job summary.

| Measurement | Value |
|---|---|
| False-block rate on the committed benign set at 0.50 / 0.70 / 0.85 / 0.95 | pending first workflow run |
| Precision / recall on the owner's private NSFW set | pending owner step 4 |
| Classifier latency p50 / p95, cold | pending first workflow run |
| Classifier latency p50 / p95, warm | pending first workflow run |
| Moderation service bundle size | pending first workflow run |
| Main Django bundle size before / after | `backend/requirements.txt` unchanged, so no change expected |

## Recommended activation order

1. **Now / no accounts:** app serves pools as static `/data/` files (bundled at build) + samples
   client-side; single multiplayer instance; sqlite; Postgres leaderboard. Fully working.
2. **CDN content (Phase 2 + 3):** deploy the frontend to **Vercel** — the build bundles the game
   data into `/data/` and `pool.ts` reads it from there, so content is served by Vercel's CDN
   automatically. No object store or extra account. (Superseded by the game-data host, see
   "Data publishing" above; R2 is that publisher's second target.)
3. **Harden prod (Phase 4) — DONE:** Supabase `DATABASE_URL` (pooler) + `DJANGO_*` / CORS vars are
   set on the Vercel backend project; `migrate` runs in the build. Auth + leaderboard verified live.
4. **Fix prod multiplayer (Phase 5a) — PENDING host:** deploy `multiplayer_server/` to an always-on
   Node host, then set `API_BASE_URL` + `CORS_ORIGINS` on it and `VITE_SOCKET_URL` on the frontend.
5. **Scale the leaderboard + realtime (Phase 5b):** set `REDIS_URL` (Upstash) on Django + the
   multiplayer host; run `manage.py sync_leaderboard` once to backfill. Also enables the friends-overview
   cache (`users/friends_cache.py`).

## Verification

- Backend tests: `cd backend && venv/Scripts/python.exe manage.py test trivia users`
- Frontend: `npm run lint && npm run build`
- Multiplayer syntax: `node --check multiplayer_server/src/index.js`
- After setting prod env: `manage.py check --deploy` should report no security warnings.
- Load behavior: content reads hit the CDN/edge (≈unbounded); the origin only handles
  writes/leaderboard/auth, which scale with active engagement, not raw audience.

## Known follow-ups (documented in the phase plans under `docs/superpowers/plans/`)

- Real verification of R2 upload / Postgres connection / Redis requires the live accounts.
- Full multi-instance multiplayer matchmaking needs the in-memory match state moved into Redis.
- Mobile app: point it at the same CDN pools + API; not yet in this repo.

## Environments (local / dev / production)

Design background: `docs/superpowers/specs/2026-08-29-three-environment-strategy-design.md`.

| | Frontend | Backend | Socket | Database |
|---|---|---|---|---|
| **local** | Next `:5173` | local `:8000`, else **prod fallback** | **always local `:4000`** (started by `npm run dev`; never the deployed one) | sqlite (default) or local Postgres |
| **dev** | dev-branch Vercel URL (`https://nba-minigames-git-dev-stefanromanpers-5412s-projects.vercel.app`) | production backend | production socket | production Supabase |
| **production** | `https://swishquest.com` (the old `nba-minigames.vercel.app` 301-redirects here) | `https://backend-kappa-one-42.vercel.app/api` | production socket | production Supabase |

`dev` and `production` differ only in which frontend build is served — deliberately: there is no
separate deployed dev backend, because a deployed backend needs a hosted database and that
reintroduces the cost/pause problem below. "Isolated backend work" happens locally.

**Note on the socket row:** there is currently no production multiplayer server deployed (the old
Railway host is dead), so both `dev` and `production` actually get no socket today, and
"Play Online" is broken in both. Redeploying it is a separate, owner-gated task (hosting costs
money). Set `VITE_SOCKET_URL` in `.env.production` once it exists.

`npm run dev` runs `scripts/dev-env.mjs` first (via the `predev` hook), which TCP-probes
`localhost:8000` and writes the result to a gitignored `.env.local` — local backend if it answers,
the deployed production one otherwise. The terminal prints a banner naming the mode; whenever the
*backend* resolves to the deployed one, a `PROD DATA` badge also appears in the running app (dev-only).

**Multiplayer never leaves your machine in local runs.** The socket is billed by usage, so
`.env.local` always sets `VITE_SOCKET_URL=http://localhost:4000`, and `scripts/dev.mjs` (the `dev`
script) starts `multiplayer_server/` there unless something already listens, then stops it with the
dev server. Three layers keep it that way: `src/socket.ts` ignores any non-local `VITE_SOCKET_URL`
outside production builds; a production build has no localhost fallback; and the deployed server
refuses browsers whose origin is not in its `CORS_ORIGINS` (localhost is never listed). The local
server verifies players against whichever backend the site uses, so sign in works either way.
`NBA_DEV_ENV_SKIP=1` (pipeline QA) runs plain `next dev` and starts nothing extra.

**Why dev and production intentionally share one backend and one Supabase project:** there is no
second Supabase project. Decision, not oversight — an extra free-tier project can auto-pause
itself or start costing money, and this design adds no such surface. Local writes made against
the production fallback can reach real production data; the badge and banner exist to make that
impossible to miss, not to block it.

**Local Postgres (optional, parity only):** sqlite remains the default and nothing requires
Docker. To use Postgres instead, for parity when a task touches models or migrations:
```bash
docker compose up -d db
```
then set in `backend/.env`:
```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres
```
and run `python manage.py migrate`. Unset `DATABASE_URL` to return to sqlite.
