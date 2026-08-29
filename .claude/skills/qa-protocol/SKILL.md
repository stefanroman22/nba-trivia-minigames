---
name: qa-protocol
description: Browser QA for a task worktree using the real Chrome CDP session. Run by browser-qa agent after verify passes. Skip if the diff touches neither src/ nor backend/.
---

# Browser QA Protocol

Ports come from `.claude/team/config.json` `qaPorts` (defaults: django 8100, vite 5273,
socket 4100) so the user's own dev servers (8000/5173/4000) are never disturbed.

## Bring-up (inside the task worktree)
1. Backend (if the task touches backend or the page needs data):
   `cd backend && .venv\Scripts\python manage.py runserver 8100` (background).
2. Frontend: `$env:VITE_BACKEND_URL="http://localhost:8100"; npm run dev -- --port 5273` (background).
3. Multiplayer server only if the task touches multiplayer.
4. Confirm Chrome CDP is up (`npm run chrome:debug` in the MAIN repo if not already running).

## Test
1. Navigate the real Chrome (mcp__chrome__* tools) to `http://localhost:5273`.
2. Execute the `## Acceptance checks` section of every constraint doc the classify JSON listed.
   For game tasks, run the GAME_DESIGN_CONSTRAINTS DevTools acceptance tests verbatim.
3. Exercise the task's own spec: does the feature do what the card says? Test the happy path
   plus one edge (empty state, wrong input, or refresh mid-flow — whichever applies).
4. Screenshot evidence at each key state → `.team/qa/<slug>/`.

## Verdict
- Write `.team/qa/<slug>/verdict.json`: `{"pass": true|false, "failures": ["..."]}`.
- ALWAYS kill the servers you started (find pids by port, stop them) — even on failure.
- Failures go back to the build stage (they count toward the 2-fix-cycle cap).
