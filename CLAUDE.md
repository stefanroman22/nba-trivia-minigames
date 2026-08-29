# nba-minigames — Project Guide for Claude Code

NBA trivia minigames. Frontend: React 19 + TypeScript + Vite + Tailwind 4. Backend: Django + DRF. Realtime: Socket.IO server for multiplayer.

## Services & ports
- Django API — `backend/`, port **8000** (`python manage.py runserver 8000`)
- Socket.IO multiplayer — `multiplayer_server/`, port **4000** (`node src/index.js`)
- Vite + React frontend — repo root `src/`, port **5173** (`npm run dev`)

Single-player needs only the Django API; "Play Online" also needs the socket server.

## Live UI testing in the real browser
`npm run chrome:debug` starts a Chrome with CDP on port 9222 using a dedicated
profile at `~/.chrome-claude-debug` (Chrome 136+ ignores the debug port on the
default profile, hence the separate one). The profile persists, so log in once.

With it running, the `chrome` MCP server (see `../.mcp.json`) drives that exact
window — same tab, same session, visible to you. Prefer its `mcp__chrome__*`
tools over the sandboxed `mcp__plugin_playwright_playwright__*` ones, which get
a blank throwaway profile and cannot see logged-in state.

## Common commands
- Install: `npm install` (frontend); `pip install -r backend/requirements.txt` (backend)
- Lint: `npm run lint`
- Typecheck + build: `npx tsc -b && npm run build`
- Backend tests: `cd backend && python manage.py test`
- Backend check: `cd backend && python manage.py check`

## Structure
- `src/` — components/, pages/, styles/, Game Renderers/, store/ (Redux Toolkit), hooks/, context/, constants/, motion/, utils/, socket.ts
- `backend/` — Django project; apps: users/ (auth, custom user, rank), trivia/ (minigame data + data pipeline)
- `multiplayer_server/` — Node Socket.IO server
- `docs/` — all project documentation; see the map below

## Conventions
- Surgical changes only — match existing style; don't refactor unrelated code.
- TypeScript strict; build must pass `tsc -b`.
- URLs/secrets come from env (`.env`, `backend/.env`); never hardcode or commit them.

## Building or touching any game's UI — read this first
**`docs/GAME_DESIGN_CONSTRAINTS.md` is mandatory reading before writing or reviewing any game
renderer** (`src/Game Renderers/*.tsx`). It defines the shared shell every game must fit into
(idle screen, loading, progress bar, feedback popup, end-of-game), exact spacing/token values, and
numbered rules with ❌/✅ examples and DevTools acceptance tests. Violating it is the single most
common way a new or edited game ends up inconsistent with the rest of the app.

## Documentation map
| Doc | Read it when you're... |
|---|---|
| `docs/GAME_DESIGN_CONSTRAINTS.md` | building or reviewing any game's UI (see above — mandatory) |
| `docs/ARCHITECTURE.md` | changing how the frontend/backend/multiplayer/DB talk to each other |
| `docs/DATA_PIPELINE.md` | touching `trivia/data_pipeline/`, adding a data source, or changing how pools are built |
| `docs/DEPLOYMENT.md` | changing env vars, hosting config, or anything that affects production |
| `docs/games/MASTER_PLAN.md` | adding a new game or checking what's already shipped/planned |
| `.claude/README.md` | changing the coding-agent model/effort profile |
| `docs/team/PIPELINE.md` | operating or debugging the autonomous team pipeline |

## Coding engines & profiles
This repo defines coding subagents in `.claude/agents/` (frontend-engine, backend-engine, code-reviewer, test-qa-engine). Their model + reasoning effort are governed by a named profile. Switch the whole fleet with `npm run engine <fast|balanced|deep|max>`. See `.claude/README.md`.

## Autonomous team pipeline
An unattended pipeline exists that turns Notion task cards into shipped PRs: classify →
design → build → verify → QA → review → ship, run headlessly via the `team-run` skill
(triggered by a Windows scheduled task and `npm run team`). Notion is the control
surface — write cards, set `Status = Ready`, watch for @mentions. Task worktrees live
under `C:\Users\stefa\.team-worktrees`, never in this checkout — never build pipeline
tasks in the main checkout. See `docs/team/PIPELINE.md` for the full operator manual.
