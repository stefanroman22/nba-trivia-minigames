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

## Commands that aren't guessable
- Standalone typecheck: `npx next typegen && npx tsc --noEmit` (`npm run build` also type-checks).

## Structure gotcha
- Page-level components live in `src/views/`, not `src/pages/` — Next.js owns the `pages` name.
  Routes are thin wrappers in `src/app/`.

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

## Shipping — dev is the default destination; production is an explicit ask
`dev` is where finished work lands by default. Once a change is verified (build, lint, typecheck,
a real browser pass when the UI changed), the agent carries it to `dev` itself without stopping
for confirmation:
1. Commit and push on a feature branch, open the PR to `dev` (`gh pr create --base dev`), and wait
   for the checks (`gh pr checks <n> --watch`). `gh` must be on the `stefanroman22` account.
2. Merge it yourself (`gh pr merge <n> --merge --delete-branch`; the team pipeline squashes its own).
3. **Stop there and report it's on `dev`.** Do not trigger, run, or wait on the "Promote dev to
   main" workflow, and do not otherwise push/merge into `main` — merging to `dev` is never itself
   a request to ship to production, no matter how small or well-tested the change is.

Promotion to `main`/production only happens when the owner explicitly asks for it in the
conversation (e.g. "promote this", "ship it to prod", "push dev to main") or runs the "Promote dev
to main" workflow themselves. `.github/workflows/dev-ci.yml`'s promote job runs **only** on a
manual `workflow_dispatch` (`gh workflow run dev-ci.yml` or "Run workflow" in the Actions tab) — a
push or PR merge into `dev` no longer auto-promotes for anyone, human, Claude, or the team pipeline.

Once promotion is explicitly requested, follow the `promote-to-prod` skill
(`.claude/skills/promote-to-prod/SKILL.md`) — trigger, watch both deploys, verify production,
fix forward or roll back. Never leave production broken and just report it.

The only stops beyond "wait for an explicit promote ask" are the standing ones: anything that
costs money, a secret you don't have, and deleting data you didn't create. Merge only what
actually works — a known error is a blocker.

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
| `docs/CACHING_SCALING_PLAN.md` | deciding whether friends/leaderboard data needs Redis caching, or touching `users/leaderboard.py`/`users/friends.py`'s query shape |

## Coding engines & profiles
Subagent models/effort follow a named profile: `npm run engine <fast|balanced|deep|max>`. The per-task
model policy (which work goes to fable/opus/sonnet/haiku) is `docs/team/PIPELINE.md` §14. See `.claude/README.md`.

## Autonomous team pipeline
An unattended pipeline turns Notion task cards into commits on `dev`: intake → classify → brief →
[plan] → build → verify → QA → review → ship, run headlessly via the `team-run` skill (a scheduled
cloud routine, plus `npm run team` on demand). The mechanical steps are scripts in `scripts/team/`;
agents work from one generated brief per card (`.team/run/<slug>/brief.md`) and are resumed, not
respawned, when a gate fails. Notion is the control surface — write cards and set `Status = To Do`.
Task worktrees live under `C:\Users\stefa\.team-worktrees`, never in this checkout — never build
pipeline tasks in the main checkout. See `docs/team/PIPELINE.md`.
