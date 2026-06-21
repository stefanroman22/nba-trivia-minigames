# nba-minigames — Project Guide for Claude Code

NBA trivia minigames. Frontend: React 19 + TypeScript + Vite + Tailwind 4. Backend: Django + DRF. Realtime: Socket.IO server for multiplayer.

## Services & ports
- Django API — `backend/`, port **8000** (`python manage.py runserver 8000`)
- Socket.IO multiplayer — `multiplayer_server/`, port **4000** (`node src/index.js`)
- Vite + React frontend — repo root `src/`, port **5173** (`npm run dev`)

Single-player needs only the Django API; "Play Online" also needs the socket server.

## Common commands
- Install: `npm install` (frontend); `pip install -r backend/requirements.txt` (backend)
- Lint: `npm run lint`
- Typecheck + build: `npx tsc -b && npm run build`
- Backend tests: `cd backend && python manage.py test`
- Backend check: `cd backend && python manage.py check`

## Structure
- `src/` — components/, pages/, styles/, Game Renderers/, store/ (Redux Toolkit), hooks/, context/, constants/, motion/, utils/, socket.ts
- `backend/` — Django project; apps: users/ (auth, custom user, rank), trivia/ (minigame data)
- `multiplayer_server/` — Node Socket.IO server

## Conventions
- Surgical changes only — match existing style; don't refactor unrelated code.
- TypeScript strict; build must pass `tsc -b`.
- URLs/secrets come from env (`.env`, `backend/.env`); never hardcode or commit them.

## Coding engines & profiles
This repo defines coding subagents in `.claude/agents/` (frontend-engine, backend-engine, code-reviewer, test-qa-engine). Their model + reasoning effort are governed by a named profile. Switch the whole fleet with `npm run engine <fast|balanced|deep|max>`. See `.claude/README.md`.
