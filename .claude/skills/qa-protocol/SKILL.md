---
name: qa-protocol
description: Headless browser QA for a task, via Playwright. Runs in BOTH local and cloud routine runs. Run by browser-qa agent after verify passes. Skip if the diff touches neither src/ nor backend/.
---

# Browser QA Protocol

Playwright-driven and headless, so this runs identically on a local machine and on a cloud
routine VM. Ports come from `.claude/team/config.json` `qaPorts` (defaults: django 8100,
vite 5273, socket 4100) so the user's own dev servers (8000/5173/4000) are never disturbed.

## 1. Bring-up
1. Ensure a browser exists. Local machines have Edge/Chrome already; a cloud VM does not —
   run once per run, it is a no-op if already present:
   `node node_modules/playwright-core/cli.js install --with-deps chromium`
2. Backend (only if the task touches backend or the page needs live data), backgrounded:
   `cd backend && .venv/bin/python manage.py runserver 8100`
   (Windows local: `.venv\Scripts\python`.)
3. Frontend, backgrounded, from the task's working tree:
   - bash: `VITE_BACKEND_URL=http://localhost:8100 npm run dev -- --port 5273`
   - PowerShell (`VAR=x cmd` is a bash-only prefix and is a parse error here — `npm run team`
     runs via `powershell.exe -File scripts/team-run.ps1`, so an agent on Windows needs this
     form): `$env:VITE_BACKEND_URL = 'http://localhost:8100'; npm run dev -- --port 5273`
4. Multiplayer server only if the task touches multiplayer.

Always address servers as `http://localhost:<port>` — never `127.0.0.1`, because Vite may
bind IPv6-only and the literal IPv4 address is then unreachable.

## 2. Test
Write ONE short script at the repo root (e.g. `qa-run.mjs`) that imports the harness —
`scripts/qa-browser.mjs` exports `launchBrowser, waitForServer, openApp, startGame, shot,
writeVerdict`; its header has a worked example. Never hand-roll `chromium.launch()` with a
`channel` — the harness's launcher is what makes this work on a cloud VM.

Cover, in this order:
1. **Game tasks** (diff touches `src/Game Renderers/`): run the deterministic audit instead of
   improvising layout checks — `node scripts/ui-audit.mjs --url http://localhost:5273 --only <game-id> --label qa-<slug>`.
   It measures the GAME_DESIGN_CONSTRAINTS shell contract and exits non-zero with named
   assertion failures. Its failures are QA failures verbatim.
2. **Constraint acceptance checks**: execute the `## Acceptance checks` section of every
   constraint doc the classify JSON listed, as assertions in your script.
3. **The card's own spec**: does the feature do what the card says? Happy path plus one edge
   (empty state, wrong input, or refresh mid-flow — whichever applies).
4. `shot(page, slug, '<state>')` at each key state — evidence or it didn't happen.

Delete `qa-run.mjs` when done; it is scratch, not a deliverable.

## 3. Verdict
- `writeVerdict(slug, pass, failures)` → writes `.team/qa/<slug>/verdict.json` as
  `{"pass": true|false, "failures": [...], "notes": "...", "at": "..."}`.
- ALWAYS kill the servers you started (find pids by port, stop them) — even on failure.
- Failures go back to the build stage and count toward the 2-fix-cycle cap, so each failure
  string must be specific enough to act on: what you did, what you expected, what happened.
