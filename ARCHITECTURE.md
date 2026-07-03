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
| Game | What you do |
|---|---|
| **Guess the Series Winner** | Pick who won a playoff series |
| **Name the NBA Club** | Identify a team from its logo |
| **Guess the MVP** | Name the MVP for a season |
| **Fill in the Starting 5** | Name the 5 starters of a real game |
| **NBA Wordle** | Guess a 5-letter player surname |

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

### How authentication works (in simple terms)
- It uses **JWT tokens** (JSON Web Tokens) — no server-side sessions for the API.
- When you log in, the backend gives the browser **two tokens**: a short-lived **access
  token** (valid 15 minutes) used on every request, and a longer **refresh token** (valid
  7 days) used to silently get a new access token.
- Refresh tokens **rotate** (each refresh issues a new one and **blacklists** the old one),
  so a stolen old token can't be reused. Logging out blacklists your refresh token.
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
1. **Matchmaking** — when you click Play Online you join a queue. The server pairs you with
   the next waiting player and puts you both in a private "room". If no one shows up within
   30 seconds, it tells you no opponent was found.
2. **Same questions for everyone** — the server fetches the round's data **from the Django
   backend** and sends the *same* questions to every player in the room, so it's fair.
3. **Scoring** — players submit their scores; once everyone's is in, the server sends each
   player the outcome (and, for friend rooms, a ranked scoreboard).
4. **Rematch / switch game** — one player proposes, everyone else must accept, then a fresh
   round starts without re-queuing.
5. **Leaving/disconnecting** — if anyone quits, the others are told immediately.

### "Play with a friend" (private rooms)
Logged-in players can also skip matchmaking and play with friends:
- The host presses **Generate code** and gets a **6-digit room code** to share (codes are
  crypto-random, so they can't be guessed in order).
- Friends press **Enter code** and type it in. A room holds **exactly 3 players** — the
  match starts automatically the moment the third one joins.
- While waiting, the host can **change the game** (everyone's lobby follows) or **cancel
  the room**. If any member leaves or drops out, the room closes for everyone.
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
| `users_customuser` | accounts: username, email, hashed password, points, rank, profile photo |
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

**Worth being aware of (normal trade-offs, not bugs):**

- Login **tokens are stored in `localStorage`**, not httpOnly cookies. This is convenient and
  common for single-page apps, but it means a cross-site-scripting (XSS) bug could expose a
  token. Mitigated by short token lifetimes and React escaping output by default.
- The **Google OAuth client ID is hard-coded** in the frontend (`src/main.tsx`). That's fine —
  a client ID is public by design; the secret stays on the backend.
- `DEBUG` defaults to **on** locally, so it's important `DJANGO_DEBUG=False` is set in
  production (it is, per the deployment docs).
- There's no rate limiting on the API endpoints — fine at current scale, something to add if
  abuse becomes a concern.

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

For deployment/runbook details see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
For local run commands see [RUN.md](RUN.md).
