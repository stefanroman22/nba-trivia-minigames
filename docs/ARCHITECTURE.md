# NBA Minigames — Architecture Overview (in simple words)

This is a web app where people play short NBA trivia minigames, earn points, climb a
leaderboard, and optionally play head-to-head against another person online.

It's built from **three separate programs** that each do one job, plus a database and a
data pipeline that feeds it. This document explains each piece in plain language: what it
does, where it lives, where it's hosted, and how safe it is.

---

## The big picture

```
                 ┌─────────────────────────────────────────────┐
                 │  Your browser (the React frontend)           │
                 │  - shows the games, menus, leaderboard       │
                 │  - caches game content locally               │
                 └───────┬───────────────┬──────────────────────┘
                         │               │
        login / points / │               │ "Play Online"
        leaderboard      │               │ (live match)
                         ▼               ▼
        ┌────────────────────────┐   ┌──────────────────────────┐
        │  Django API (backend)  │   │  Multiplayer server       │
        │  - accounts & login    │◄──┤  (Socket.IO, Node.js)     │
        │  - points & ranks      │   │  - matches 2 players      │
        │  - leaderboard         │   │  - asks Django for the    │
        │  - serves game data    │   │    round's questions      │
        └───────────┬────────────┘   └──────────────────────────┘
                    │
                    ▼
        ┌────────────────────────┐        ┌──────────────────────┐
        │  Supabase (Postgres DB)│        │  Static game data     │
        │  - users, points, ranks│        │  (JSON files on CDN)  │
        │  - all NBA game data   │        │  bundled with the app │
        └────────────────────────┘        └──────────────────────┘
                    ▲
                    │  monthly refresh (runs from a home PC, not the cloud)
        ┌────────────────────────┐
        │  Data pipeline         │
        │  pulls fresh NBA stats │
        └────────────────────────┘
```

---

## 1. The Frontend (what you see in the browser)

**Tech:** React 19 + TypeScript + Vite + Tailwind 4.
**Lives in:** repo root `src/`.
**Hosted on:** **Vercel** (their global CDN). Production API it talks to:
`https://backend-kappa-one-42.vercel.app/api`.

### What it does
- Shows the landing page, the games, the leaderboard, and the login/signup popups.
- Renders each minigame and tracks your score during play.
- Talks to the backend for anything account-related (login, your points, the leaderboard).
- Opens a live connection to the multiplayer server when you click **Play Online** or use
  **Play with a friend** (private 3-player rooms with a share code).

### The games available
18 live games (`src/utils/GameUtils.tsx` is the source of truth — update this table when a game
ships or its blurb changes). Full design/build history: [docs/games/MASTER_PLAN.md](games/MASTER_PLAN.md).

| Game | What you do |
|---|---|
| **Guess the Series Winner** | Pick who won a real NBA playoff series |
| **Name the NBA Club** | Identify a team from its logo |
| **Guess the MVP** | Name the MVP for a specific season |
| **Fill in the Starting 5** | Name the starting lineup of the winning team from a random game |
| **NBA Wordle** | Guess an NBA player using Wordle rules |
| **Fan Favorites** | Guess what 100 fans answered — find every answer on the board |
| **The Heatmap** | Claim hexes by naming players who fit a criterion and its neighbours |
| **NBA Connections** | 16 players hide 4 secret groups of 4 — find every link |
| **Career Path Challenge** | Guess the mystery player from his team-by-team career path |
| **NBA Grid** | Fill a 3×3 grid with players matching both their row and column |
| **Who Are Ya?** | A blurred mystery player — every miss sharpens the photo |
| **NBA Tic-Tac-Toe** | Head-to-head 3×3: claim cells by naming valid players |
| **NBA Bingo** | Dealt player cards, a 16-category board — dab the right cell |
| **LeContexto** | Unlimited guesses — each one shows how close you are to the secret player |
| **Who Would Win?** | Daily hypothetical matchup — one tap, see the community split |
| **Pack 5** | Flip through player cards — pick the stat that beats the hidden next card |
| **SuperDraft Five** | Draft a starting five from randomized pools under today's objective |
| **NBA Imposter** | Party game for friend rooms: find who's bluffing about the mystery player |

### Client-side caching — **yes, the app caches a lot on purpose**
The actual game content (questions, players, teams) is **static** — it's the same for
everyone and only changes about once a month. So the frontend never asks the backend for it
during play. Instead it uses a **two-layer cache** (`src/utils/pool.ts`):

1. **In-memory cache** — once loaded, a game's data stays in memory for the whole session.
2. **localStorage cache** — the data is also saved in your browser under a versioned key
   (`pool:<game>:<version>`), so the next time you play it loads instantly with zero network
   calls. A small `manifest.json` carries a version string; when new data ships, the version
   changes and old cached copies are pruned automatically.

There's also a **leaderboard cache** (`src/hooks/useLeaderboard.ts`): the leaderboard is held
for 5 minutes and quietly refreshed, so opening it repeatedly doesn't hammer the server.

> Note: React Query is installed but **not actually used** — all caching is hand-written.
> There is **no service worker** (so the app is not an offline PWA).

### State management
- **Redux Toolkit** holds your login state and profile (username, email, points, rank, photo).
- **React Context** runs the popups/modals (login, feedback, leaderboard, instructions).

### How it talks to the backend
All authenticated calls go through one wrapper (`src/utils/Api.tsx`) using the browser's
native `fetch`. It attaches your login token, and if the token has expired it automatically
refreshes it and retries — so you stay logged in smoothly.

---

## 2. The Backend (the brain: accounts, points, game data)

**Tech:** Django 5 + Django REST Framework (Python).
**Lives in:** `backend/`.
**Hosted on:** **Vercel** (serverless). Live at `https://backend-kappa-one-42.vercel.app`.

It has two parts ("apps"):

### `users/` — accounts, login, points, leaderboard
### `trivia/` — serves the NBA game data

### Main things it can do (the API)
**Account/leaderboard** (`/api/...`):
- `signup`, `login`, `login/google` — create or sign in (returns login tokens)
- `me` — who am I (used on page load to restore your session)
- `update-profile` — save points / username / photo (recomputes your rank)
- `logout` — invalidates your refresh token
- `get-users` — the top-100 leaderboard plus your own rank
- `token/refresh` — get a fresh token when the old one expires

**Game data** (`/trivia/...`): returns random rounds for each game (playoff series, logos,
MVPs, starting fives, wordle words) and a `manifest` + `pool/<game>` for the frontend cache.

### Player identity (built for millions of accounts)
- Every account gets a **permanent 6-character public ID** (e.g. `#K7F3QD`) generated from
  an unambiguous alphabet (no 0/O or 1/I) — about **1.07 billion** combinations.
- **Usernames don't have to be unique** — any number of players can be called "Baller23";
  the ID is what tells them apart, and it's shown in the leaderboard, the profile, the
  navbar, and every multiplayer screen (VS cards, lobby seats, scoreboards).
- The **email is the unique login identifier**. You can sign in with your email, with your
  username (while it's unambiguous), or with `Name#ID`.
- The leaderboard and the multiplayer server key everything by the ID, so renames are free
  and same-named players never collide.

### How authentication works (in simple terms)
- It uses **JWT tokens** (JSON Web Tokens) — no server-side sessions for the API.
- When you log in, the backend gives the browser **two tokens**: a short-lived **access
  token** (valid 15 minutes) used on every request, and a **refresh token** used to
  silently get a new access token.
- Refresh tokens **rotate** (each refresh issues a new one and **blacklists** the old one),
  so a stolen old token can't be reused. Logging out blacklists your refresh token.
- Sessions last **up to 3 months**: every login stamps its start time into the token, and
  refreshing is refused once that stamp is older than 90 days — so you stay signed in
  seamlessly, but after 3 months you must log in again no matter how active you were.
- **Passwords** are never stored in plain text — Django hashes them with **PBKDF2-SHA256**.
- **Google login**: the browser sends a Google authorization code; the backend exchanges it
  with Google, verifies the identity, then creates/looks-up the user and returns the same
  JWT tokens.

### The rank system
Your points map to an NBA-themed rank, recalculated whenever your points change:
Rookie → Role Player → Sixth Man → Starter → All-Star → All-NBA → MVP → Hall of Famer → GOAT.

### Speed / caching on the backend
- The static game-data JSON files are read once and kept in memory.
- The **leaderboard** can use **Redis** (a fast in-memory sorted list) if a `REDIS_URL` is
  set; otherwise it falls back to plain database queries. (Redis is optional and not required
  to run.)

---

## 3. The Multiplayer Server ("Play Online")

**Tech:** Node.js + Socket.IO (real-time websockets).
**Lives in:** `multiplayer_server/`.
**Hosted on:** **Railway** — intended host. Client connects to
`https://nba-multiplayer-production.up.railway.app` in production.

### Why it's a separate program
Vercel's serverless functions are short-lived and can't keep a live connection open. A live
1-v-1 match needs a connection that stays open the whole game, so it runs on an always-on
Node host instead.

### What it does (in simple terms)
1. **Matchmaking** — when you click Play Online you join a queue. Pairing is
   **fair by skill**: the server matches you with the waiting player whose
   points are closest to yours, only accepting gaps both sides' "fairness
   windows" allow — and those windows widen the longer you wait, so nobody
   queues forever. If no one shows up within 30 seconds, it tells you no
   opponent was found.
2. **Same questions for everyone** — the server fetches the round's data **from the Django
   backend** and sends the *same* questions to every player in the room, so it's fair.
3. **Scoring** — players submit their scores; once everyone's is in, the server sends each
   player the outcome (and, for friend rooms, a ranked scoreboard).
4. **Rematch / switch game** — one player proposes, everyone else must accept, then a fresh
   round starts without re-queuing.
5. **Leaving/disconnecting** — if anyone quits, the others are told immediately.

### "Play with a friend" (private rooms)
Logged-in players can also skip matchmaking and play with a friend:
- The host presses **Generate code** and gets a **6-digit room code** to share (codes are
  crypto-random, so they can't be guessed in order).
- The friend presses **Enter code** and types it in. A room holds **exactly 2 players** —
  the match starts automatically the moment the friend joins.
- While waiting, the host can **change the game** or **cancel the room**. If either player
  leaves or drops out, the room closes for both. On phones the room card can collapse to a
  slim overview so the game stage stays in view.
- Housekeeping keeps the code space healthy at scale: every lookup is O(1) by code,
  unfilled lobbies **expire after 15 minutes** (freeing their code), join attempts are
  **rate-limited per connection** (max 8 tries / 10 s) so codes can't be brute-forced, and
  the 6-digit space caps *concurrent* rooms at ~900k — widening the code is a one-line
  change if the app ever outgrows that.

All match state lives **in memory** on the server. Redis is optional and only used to help
broadcast across multiple instances if the app ever scales out; scaling room state itself
horizontally means moving the `players`/`rooms` maps into Redis (see notes at the top of
`multiplayer_server/src/index.js`).

---

## 4. How data is stored and gathered

There are **two kinds of data**, handled very differently:

### A) Game content (the NBA questions) — static, same for everyone
- Tiny (under ~1 MB), changes about once a month.
- Stored as **JSON files** (`backend/trivia/data/*.json`) that ship with the app and are
  served by Vercel's CDN. This is why it scales to lots of players for almost no cost.
- The authoritative copy also lives in the **Supabase Postgres** database (see tables below);
  the JSON files are generated from it.

### B) User data (accounts, points, leaderboard) — changes constantly, per person
- Stored in **Supabase (Postgres)** — the only part that truly needs a live database.
- Connected via a standard database URL (the Supabase **session pooler**, required because
  Supabase's direct host isn't reachable from Vercel).

### How the NBA data is gathered (the pipeline)
- A command (`sync_nba_data`) pulls fresh stats from the public **NBA API** (`nba_api`):
  teams, players, MVPs, playoff series, and starting fives.
- **It must run from a home computer**, not the cloud. The NBA blocks data-center IP
  addresses (Vercel, Railway, AWS, etc.), so the cloud can only *serve* pre-built data — it
  can't fetch it. A monthly Windows Task Scheduler job runs the refresh from the owner's PC,
  then the new data is committed and deployed.

### Supabase tables
**User side (`users` app):**
| Table | What it holds |
|---|---|
| `users_customuser` | accounts: public id (#K7F3QD), display username, unique email, hashed password, points, rank, profile photo |
| `token_blacklist_*` | revoked/expired refresh tokens (for secure logout) |

**Game-data side (`trivia` app):**
| Table | What it holds | Feeds game |
|---|---|---|
| `trivia_team` | the 30 NBA teams + logos | Name the Club |
| `trivia_player` | ~5,000 all-time players | Wordle, Starting 5 |
| `trivia_playoffseries` | full playoff history | Series Winner |
| `trivia_mvp` | MVP per season | Guess the MVP |
| `trivia_startingfivegame` | real games + their starters | Starting 5 |
| `trivia_syncrun` | a log of each data refresh (audit trail) | — |

> There's no special Supabase SDK — the backend just talks to Supabase as a normal Postgres
> database through Django. (Cloudflare R2 is set up as an optional alternative for serving
> the data files, but the default is Vercel's CDN.)

---

## 5. How secure is the app?

**Generally solid for an app of this size.** The good parts:

- **Passwords** are properly hashed (PBKDF2-SHA256), never stored in plain text.
- **JWT tokens** are short-lived; refresh tokens rotate and old ones are blacklisted, and
  logout actually revokes them.
- **HTTPS everywhere** in production, with security hardening turned on when not in debug
  mode: forced HTTPS redirect, **HSTS** (30 days), secure cookies, and trusting the host's
  TLS termination.
- **CORS** is locked to known frontend origins (localhost for dev + the real domain), so
  random websites can't call the API on your behalf.
- **CSRF** trusted origins are configured for the real domains.
- Game-data endpoints are read-only and public (they only return trivia), so there's nothing
  sensitive to leak there.
- **Secrets** (database URL, Django secret key, Google OAuth keys) come from environment
  variables and are kept out of git (`.env` files are gitignored).
- **Points can only be earned, not claimed.** Finishing a game posts to `/trivia/log-session/`,
  which records what was played *and* awards the points in one step, capped at 1000 per game.
  The browser can no longer tell the backend how many points it deserves, and every award has a
  `GameSession` row behind it. (Until 2026-08-29 it could: the client sent its own total and the
  server added it, so anyone could have topped the leaderboard with a single request.)
- **Rate limits** on the endpoints worth abusing: sign-in 30/hour, sign-up 10/hour, token refresh
  60/hour, score submission 60/hour — counted per account when signed in, per IP when not.
  Password guessing used to be unlimited.
- **Sessions can't be extended forever.** Refresh tokens rotate, but each carries the *original*
  sign-in time, and refreshing is refused 90 days after that first sign-in no matter how active
  the player has been.

**Worth being aware of (normal trade-offs, not bugs):**

- Login **tokens are stored in `localStorage`**, not httpOnly cookies. This is convenient and
  common for single-page apps, but it means a cross-site-scripting (XSS) bug could expose a
  token. Mitigated by short token lifetimes and React escaping output by default.
- The **Google OAuth client ID is hard-coded** in the frontend (`src/main.tsx`). That's fine —
  a client ID is public by design; the secret stays on the backend.
- `DEBUG` defaults to **on** locally, so it's important `DJANGO_DEBUG=False` is set in
  production (it is, per the deployment docs).
- Rate limiting counts requests in Django's **cache**, and the cache backend decides whether it
  actually works: an in-memory cache is per-process, and each serverless function is its own
  process, so limits would quietly stop applying. The app picks Redis when `REDIS_URL` is set and
  a database-backed cache otherwise — never in-memory in production. This is the one setting here
  whose failure mode is invisible, so don't "simplify" it.
- **Score farming is bounded, not eliminated.** The cap and the rate limit together allow at most
  60,000 points/hour on one account (versus unbounded before), and every submission leaves an
  audit row. Closing the gap fully means scoring games on the server rather than trusting a
  finished score — a bigger project, deliberately not done yet.
- Sign-in tells you whether an account exists ("no account matches" vs "incorrect password"),
  which leaks which emails are registered. Kept because the *"Several players use that name"*
  message genuinely needs to say that; the rate limit is what makes it hard to exploit.
- The **multiplayer server does not verify JWTs** — it trusts the identity the browser sends it.
  Today that only affects the name and avatar shown in a match (match results never touch account
  points), but it must be fixed before multiplayer ever awards anything.

---

## Where everything is hosted (quick reference)

| Piece | Tech | Hosted on | Link / address |
|---|---|---|---|
| Frontend | React + Vite | **Vercel CDN** | the public site domain |
| Backend API | Django + DRF | **Vercel (serverless)** | https://backend-kappa-one-42.vercel.app |
| Multiplayer | Node + Socket.IO | **Railway** | https://nba-multiplayer-production.up.railway.app |
| User database | Postgres | **Supabase** | via `DATABASE_URL` (session pooler) |
| Game content | Static JSON | **Vercel CDN** (`/data/`) | bundled with the frontend build |
| Data refresh | Python (`nba_api`) | **Home PC** (monthly) | residential IP required |

For deployment/runbook details see [DEPLOYMENT.md](DEPLOYMENT.md).
For local run commands see [README.md](../README.md#running-locally).
