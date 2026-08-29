# NBA Trivia Minigames

A web app where people play short NBA trivia minigames, earn points, climb a leaderboard, and
optionally play head-to-head against another person online. 18 games are live today — playoff
series, logos, MVPs, starting fives, Wordle, Connections, a hex-grid heatmap, a 3×3 criteria grid,
a party bluffing game, and more. See [docs/games/MASTER_PLAN.md](docs/games/MASTER_PLAN.md) for
the full roster and what's still planned.

Data comes from [`nba_api`](https://pypi.org/project/nba_api/). Frontend is TypeScript/React,
backend is Django, multiplayer is a Node/Socket.IO server.

---

## Running locally

The app has **three parts**, each in its own terminal — paste each block into a separate shell.
Requires Node.js and Python 3.10+. Make sure ports **8000**, **4000** and **5173** are free first.
Single-player games only need the backend running; **multiplayer needs all three.**

### 1. Backend — Django API (port 8000)
```bash
cd backend
python -m venv venv
venv\Scripts\activate          # Windows  (macOS/Linux: source venv/bin/activate)
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 8000
```

### 2. Multiplayer server — Socket.IO (port 4000)
```bash
cd multiplayer_server
npm install
npm start
```

### 3. Frontend — Vite + React (port 5173)
```bash
npm install
npm run dev
```

Then open **http://localhost:5173**.

The frontend reads the backend URL from `.env` (`VITE_BACKEND_URL=http://localhost:8000/api`) and
the socket URL from `VITE_SOCKET_URL` (defaults to `http://localhost:4000`). Local dev needs no
other env vars — the backend falls back to sqlite when `DATABASE_URL` is unset.

`npm run dev` first runs a probe (`scripts/dev-env.mjs`) that checks whether the local backend
and socket server are actually up, and writes a gitignored `.env.local` that falls back to the
deployed production ones if not — see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) → Environments.

**Everyday commands** (from the repo root unless noted):
| | |
|---|---|
| Frontend lint | `npm run lint` |
| Frontend typecheck + build | `npx tsc -b && npm run build` |
| Backend tests | `cd backend && python manage.py test` |
| Backend sanity check | `cd backend && python manage.py check` |

> **Deploying / scaling to production?** See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the full
> activation runbook (CDN content, Postgres, Redis, env vars) and
> [docs/DATA_PIPELINE.md](docs/DATA_PIPELINE.md) for how game data is refreshed.

---

## Documentation map

| Doc | What's in it |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the three services + database + data pipeline fit together, in plain language |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Runbook for taking this from "works locally" to hosted at scale |
| [docs/DATA_PIPELINE.md](docs/DATA_PIPELINE.md) | How NBA data is gathered, stored, refreshed, and served |
| [docs/GAME_DESIGN_CONSTRAINTS.md](docs/GAME_DESIGN_CONSTRAINTS.md) | The UI/UX rules every game (current and new) must follow |
| [docs/games/MASTER_PLAN.md](docs/games/MASTER_PLAN.md) | Every game the app has, is building, or should build — status tracker |
| [docs/games/DATA_REQUIREMENTS.md](docs/games/DATA_REQUIREMENTS.md), [PLAYERS_DATA.md](docs/games/PLAYERS_DATA.md), [TEAMS_DATA.md](docs/games/TEAMS_DATA.md) | Data-field wishlists the games above draw on |
| [docs/game-research/](docs/game-research/) | Reference screenshots from other trivia games (mechanics only — never copy visual style) |
| [CLAUDE.md](CLAUDE.md) | Instructions for AI coding agents working in this repo |
| [.claude/README.md](.claude/README.md) | How the coding-agent model/effort profile is configured and switched |

---

## Project folder structure

| Path | What's in it |
|---|---|
| `src/` | React + TypeScript frontend — `components/`, `pages/`, `Game Renderers/`, `styles/`, `store/` (Redux Toolkit), `hooks/`, `context/`, `constants/` |
| `backend/` | Django project. Apps: `users/` (auth, custom user, rank), `trivia/` (minigame data + pipeline) |
| `multiplayer_server/` | Node Socket.IO server for "Play Online" and friend rooms |
| `docs/` | All project documentation (see the map above) |
| `.claude/` | Coding-agent configuration (subagent definitions, engine profiles, scheduled routines) |

### Backend — `backend/`
| File/Folder | Description |
|---|---|
| `backend/settings.py` | Django configuration (apps, database, middleware) |
| `backend/urls.py` | Root URL routing |
| `users/` | Accounts: models, login/signup/update-profile views, migrations |
| `trivia/` | Minigame data: models, views, data pipeline, migrations |
| `media/` | Uploaded files (e.g. profile photos) |

---

## Technologies used

**Frontend** — React 19 + TypeScript, Vite, Tailwind CSS 4, Redux Toolkit, framer-motion,
socket.io-client.

**Backend** — Django 5 + Django REST Framework, `djangorestframework-simplejwt` for auth,
Supabase Postgres in production (sqlite locally).

**Multiplayer** — Node.js + Socket.IO.

Full rationale and how the pieces talk to each other: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Contact

If you have questions or want to collaborate, feel free to open an issue or reach out via GitHub.
