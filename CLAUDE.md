# nba-minigames — Project Guide for Claude Code

NBA trivia minigames. Frontend: React 19 + TypeScript + Next.js 16 (App Router, every page server-rendered) + Tailwind 4. Backend: Django + DRF. Realtime: Socket.IO server for multiplayer.

## Services & ports
- Django API — `backend/`, port **8000** (`python manage.py runserver 8000`)
- Socket.IO multiplayer — `multiplayer_server/`, port **4000** (`node src/index.js`)
- Next.js + React frontend — repo root `src/` (routes in `src/app/`), port **5173** (`npm run dev`)

Single-player needs only the Django API; "Play Online" also needs the socket server.

`npm run dev` probes :8000/:4000 first and falls back to the deployed backend when they're down — see `docs/DEPLOYMENT.md` → Environments.

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
- Typecheck + build: `npm run build` (Next type-checks as part of the build); standalone typecheck: `npx next typegen && npx tsc --noEmit`
- Backend tests: `cd backend && python manage.py test`
- Backend check: `cd backend && python manage.py check`

## Structure
- `src/` — app/ (Next.js routes + root layout/providers), views/ (page-level components — Next.js owns the `pages` name), components/, styles/, Game Renderers/, store/ (Redux Toolkit), hooks/, context/, constants/, motion/, utils/, socket.ts
- `backend/` — Django project; apps: users/ (auth, custom user, rank), trivia/ (minigame data + data pipeline)
- `multiplayer_server/` — Node Socket.IO server
- `docs/` — all project documentation; see the map below

## Conventions
- **Money is always a human decision.** Never take an action that implies the owner pays —
  paid services or plan upgrades, enabling billing, domains, add-ons, exceeding a free
  tier, payment details. Stop and ask (pipeline agents: park with a note naming the cost).
- Surgical changes only — match existing style; don't refactor unrelated code.
- TypeScript strict; build must pass `next build`.
- Next.js 16 differs from older releases (Turbopack, async `params`, no `next lint`) — check the bundled
  docs in `node_modules/next/dist/docs/` before writing routing, config or metadata code.
- URLs/secrets come from env (`.env`, `backend/.env`); never hardcode or commit them.
- **Don't run lint/typecheck/build/tests routinely.** They cost time and context, and for a
  small or obvious edit they tell you nothing you didn't already know. Run them when it
  actually matters: before committing, when explicitly asked, or when the change is one you
  can't verify by reading (tricky types, models/migrations, build or settings config). In the
  autonomous pipeline the verify stage runs them on the diff anyway, so an engine repeating
  them is pure duplication.

## Shipping — the agent owns delivery end to end
Once a change is verified (build, lint, typecheck, a real browser pass when the UI changed), the
agent carries it the rest of the way itself. Do not stop to ask for confirmation between steps,
and do not hand the owner a list of commands to run:
1. Commit and push on a feature branch, open the PR to `dev` (`gh pr create --base dev`), and wait
   for the checks (`gh pr checks <n> --watch`). `gh` must be on the `stefanroman22` account.
2. Merge it yourself (`gh pr merge <n> --merge --delete-branch`; the team pipeline squashes its own).
3. Watch the promotion: the push to `dev` runs `.github/workflows/dev-ci.yml`, whose promote job
   pushes `main` (`gh run list --workflow dev-ci.yml`, `gh run watch <id>`). `main` deploys the
   frontend AND the backend Vercel projects.
4. Watch both production deployments to READY (Vercel MCP `list_deployments` / `get_deployment`,
   `get_deployment_build_logs` on failure). The backend build runs `manage.py migrate` — read it.
5. Verify production, not just the build: fetch https://nba-minigames.vercel.app and the routes
   you touched (real content, right status codes), hit the API for JSON (e.g.
   https://backend-kappa-one-42.vercel.app/api/get-users/), and run a browser pass when the UI changed.
6. Anything broken is yours to fix forward on `dev` immediately — never leave production broken
   and just report it. If the fix will take more than a few minutes, roll back first (`vercel
   rollback` pins the domain until `vercel promote`; see docs/DEPLOYMENT.md).
The only stops are the standing ones: anything that costs money, a secret you don't have, and
deleting data you didn't create. Merge only what actually works — a known error is a blocker.

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
| `docs/CREDENTIALS.md` | creating/rotating any token — expiry dates, blast radius, rotation steps (update it in the same commit) |
| `docs/games/MASTER_PLAN.md` | adding a new game or checking what's already shipped/planned |
| `.claude/README.md` | changing the coding-agent model/effort profile |
| `docs/team/PIPELINE.md` | operating or debugging the autonomous team pipeline |

## Coding engines & profiles
This repo defines coding subagents in `.claude/agents/` (frontend-engine, backend-engine, code-reviewer, test-qa-engine, planner-architect, browser-qa). Their model + reasoning effort are governed by a named profile. Switch the whole fleet with `npm run engine <fast|balanced|deep|max>`. See `.claude/README.md`.

## Autonomous team pipeline
An unattended pipeline exists that turns Notion task cards into shipped PRs: classify →
design → build → verify → QA → review → ship, run headlessly via the `team-run` skill
(triggered by a Windows scheduled task and `npm run team`). Notion is the control
surface — write cards, set `Status = Ready`, watch for @mentions. Task worktrees live
under `C:\Users\stefa\.team-worktrees`, never in this checkout — never build pipeline
tasks in the main checkout. See `docs/team/PIPELINE.md` for the full operator manual.
