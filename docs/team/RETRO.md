# Parked-Task Post-Mortems

Append-only. The planner-architect MUST read this file before classifying any new task.
Format: `## YYYY-MM-DD — <task title> (<Notion page id>)` then What was tried / Why it failed / Suggested next step.
Post-mortems are appended here by the fail procedure of the team pipeline.

## ui-check-a-round-that-fails — [ui-check] A round that fails to load leaves both players stuck on the VS intro with no way out (2026-10-25, cloud run)

**What was tried.** Check card, tier hard, engine opus. The engine implemented all three changes of UIC-20261025-0128-001 in the worktree: OnlineMatch.tsx shows the phase's ExitLink under the intro error line (swap variants, one AutoHeight), MultiplayerContext keeps `error` as the intro's signal and ignores a stale roundDataError outside the intro, and the relay's dealRound catches call a new `abandonDeal` (roundDataError, then backToLobby for a friend room / destroyRoom for a 1v1) so resume never lands in a dead intro; 2 relay integration tests added (35/35 pass). Gate 1 (lint, typegen, tsc, build, relay syntax) passed. Gate 2 ran `verify.mjs --from` twice.

**Why it failed.** Both gate-2 failures are the cloud sandbox, not the code. (1) The lane sqlite has no Player rows (the routine's setup script only migrates), so `GET /trivia/wordle/` answered 500 exactly as in the finding; after seeding the lane DB from `players_curated.json` (environment only), `MP-GAME-wordle @ mp@pairA` PASSES on the fixed code. (2) `MP-MATCH-01` on all four pairs completes its flow (searching → match → intro → playing) but the audit records one `console.error` per player: `Failed to load resource: net::ERR_TUNNEL_CONNECTION_FAILED` on /series-winner — the proxy blocks cdn.nba.com (team logos), and the proxy blocks every external host here (cdn.playwright.dev too: setup.sh's chromium install fails; the pre-installed Chromium 1243 was aliased to the pinned 1234). A fix round cannot change that, so the card was failed instead of burning rounds.

**Suggested next step.** The work is committed and pushed on `team/ui-check-a-round-that-fails` (cut from main@c6b464e). Either run the verify locally (`node scripts/ui-check/verify.mjs UIC-20261025-0128-001 --from .team/attachments/4042cfb1-c595-8183-b711-ee1a01d4d6d2/findings.json --mode dev` on that branch) and ship via the hotfix flow (PR to main; the relay change needs `railway up`), or add cdn.nba.com, nba-minigames-data.vercel.app and cdn.playwright.dev to the routine's network allowlist and let the next run retry. Also worth adding a Player seed to `infra/routine/setup.sh` (the design doc planned a QA seed; the script has none).

**Last error.**
FAIL UIC-20261025-0128-001 — check MP-MATCH-01 @ mp@pairA: console `console.error` on /series-winner: Failed to load resource: net::ERR_TUNNEL_CONNECTION_FAILED (expected no console errors)
(same on pairB/C/D; MP-GAME-wordle @ mp@pairA: pass)

---

# Post-mortem: ui-check-who-are-ya-stage (attempt at QA, 2026-10-26 cloud run)

**Tried:** frontend-engine (sonnet) implemented the finding: `.waya-feed` is always mounted at a fixed height (clamp(140px, 30dvh, 280px), scrolls inside) with a muted empty hint faded via the shared fadeIn variant, so the stage no longer changes on a guess. Gate 1 (lint, typegen, tsc, build) passed. The fix is pushed on `team/ui-check-who-are-ya-stage` (2d8c45b) for attempt 2.

**Why it failed:** gate 2's ui-check verify timed out on every GM-who-are-ya check (all 7 viewports of -perfect plus -wrong/-partial) waiting for `.playing-wrap` after Play: the game never starts in the cloud sandbox. Who Are Ya? is a questions-store game with no bundled /data copy, and the sandbox's egress proxy refuses both sources the build reads: nba-minigames-data.vercel.app (VITE_DATA_BASE) and roscfxiuxsbrymdtqmth.supabase.co (VITE_QUESTIONS_BASE) — probe: "[questions] who-are-ya: data host unavailable, using the questions store" then ERR_TUNNEL_CONNECTION_FAILED. Environment, not the fix.

**Suggested next step:** allow those two hosts in the routine environment's network policy (or run attempt 2 locally); then re-run the card as is from the pushed branch. The same blocker applies to every questions-store game (career-path, who-are-ya, tictactoe, contexto): the contexto cluster card was released to To Do untouched for the same reason.

**Last error:** FAIL UIC-20261025-0128-007 — check GM-who-are-ya-perfect @ games@phone-360: TimeoutError: page.waitForSelector: Timeout 30000ms exceeded (waiting for locator('.playing-wrap') to be visible)
## 2026-10-16 — Cloud run: environment gaps found (3 shipped, 0 failed)
- The routine's setup script (`infra/routine/setup.sh`) was not installed: `node_modules`, the venv and Chromium
  were missing, so deps were installed in-run (~2 min) and the global Stop hook fired on every orchestrator turn.
- `cdn.playwright.dev` is not in the network allowlist (setup.sh names the old azureedge hosts), so the Chromium
  revision the installed `playwright-core` wants (1234) could not download. Work-around used: alias the pre-installed
  `/opt/pw-browsers/chromium-1194` and `chromium_headless_shell-1194` under the expected `-1234` directory names.
- The full Django suite (`users trivia`) imports `nba_api`, which lives in `backend/requirements-pipeline.txt`, not
  `requirements.txt`; verify failed with 14 import errors until the pipeline requirements were installed.
  Suggested: setup.sh installs `requirements-pipeline.txt`.
- Next 16 Turbopack refuses a `node_modules` symlink that points outside the worktree ("points out of the filesystem
  root"), so the team-run skill's cloud recipe (`ln -s "$PWD/node_modules" ../wt-<slug>/node_modules`) breaks
  `next build`. Work-around used: `cp -al node_modules ../wt-<slug>/node_modules` (hardlink copy, <1 s).
  Suggested: change the recipe in `.claude/skills/team-run/SKILL.md`.
- The brief template's "~369 tests expected" is stale; the suite is ~750 tests.
## ads-legal-rewrite-for-google — 2026-10-27 (blocked at brief, no code written)
- What was tried: classified (standard, fullstack, sonnet), worktree cut from dev a335eb8, brief generated; the spec's own "Before starting" blockers were then checked.
- Why it failed: all three prerequisites are unmet. 0a: `src/configurations/legal.ts` on dev is still version 2026-10-20.2 (the photos-commons branch with 2026-10-26.1 is not on origin). 0b: no Terms-rewrite ticket shipped or coordinated. 0c: the Notion page has no owner answers to Q1–Q4 (which choose between the [OPTION A/B] policy text) or Q6 (launch day D, needed for the version, dates and 14-day notice).
- Suggested next step: owner merges the photos-commons legal bump to dev, answers Q1–Q7 as a comment on the card (Q1, Q2, Q4, Q6 at minimum), and names the Terms ticket to ship in the same version; then the pipeline can plan it. No legal text was invented.
- Last error: blocked by prerequisites 0a/0b/0c (legal.ts on dev = 2026-10-20.2; no owner answers on the card).

## terms-of-service-for-an-ad — 2026-10-27 (blocked at intake/brief, no code written)
- What was tried: intake picked it after the sibling privacy card was parked; its "What needs to be done" and "Open questions" were checked against dev and the Notion comments before classify.
- Why it failed: the spec requires one shared legal version with the ads-Privacy ticket (now in Backlog, blocked), bumps from the photos-commons legal version 2026-10-26.1 (dev is still 2026-10-20.2), and every open question that fixes the text is unanswered on the card: strategy approval, ad-blocker sentence, sensitive-category blocks, personalisation for teens/guests, registration data, and Date A (the launch day that sets version, updated, effective and showUntilIso). No comments on the page.
- Suggested next step: owner answers the six decisions as a comment (Date A at minimum), merges the photos-commons bump to dev, and moves this card and the privacy card to To Do together so the pipeline can ship one version.
- Last error: blocked by prerequisites (shared version with the parked privacy card; legal.ts on dev = 2026-10-20.2; no owner answers on the card).


## ui-check-contexto-stage — 2026-10-28 (cloud run, failed at QA: environment, attempt 1/2)
- What was tried: frontend-engine (sonnet) implemented all 16 UIC findings, then one QA fix round (tap-target boxes, rail name, Starting Five end-sequence snap). verify (lint, typegen, tsc, next build) passed both rounds. The unshipped work is on `origin/team/ui-check-contexto-stage` (wip commit 209cbde).
- Why it failed: the QA gate cannot evaluate this card in the cloud sandbox. GM-contexto-* and GM-tictactoe-* time out on `.playing-wrap` because the QA sqlite has 0 `trivia_question` rows (prepare_sqlite seeds players only); every external host is blocked by the sandbox proxy (upload.wikimedia.org photos, questions store, data host), so `net::ERR_TUNNEL_CONNECTION_FAILED` console errors fail the console rule on /guess-mvps, /series-winner, /starting-five, /who-would-win even where the layout fix passed. `infra/routine/setup.sh` had not run in the container (deps installed in-run; Chromium 1243 aliased as the 1234 Playwright wants; Turbopack needs a real `node_modules` in the worktree, not a symlink; `requirements-pipeline.txt` is needed for the Django suite). One real failure remains after round 2: UIC-008 `.rail-name` 151.5×19.5 px (need ≥169 px). Round 2 passed 013–019 (tap targets) and 006/016 (Starting Five snap).
- Suggested next step: run the card on the PC (`npm run team`) or in a routine environment with setup.sh and a network policy that allows wikimedia and the questions store, starting from the wip branch; consider seeding Contexto/Tic-Tac-Toe questions in `scripts/check-core/lib/prepare_sqlite.py` so the cloud QA can exercise those games.
- Last error: `FAIL UIC-20261025-0128-008 — minSize aside.rail .rail-item:nth-of-type(1) .rail-name: 151.5×19.5px (need ≥ 169×17)`

## ui-check-contexto-stage — 2026-10-28 (failed at QA in the cloud routine; attempt 2; work on `team/ui-check-contexto-stage-r2`)
- What was tried: standard/frontend/sonnet, worktree from dev 4344c80, check-card brief with 16 bundled findings, one build (11 files), verify green, QA gate 2 twice with one fix round for the six code-side failures (tap targets ≥ 24×24 via a real 24 px link box; rail widened 240→260 px).
- Why it failed: the routine environment's network policy blocks `nba-minigames-data.vercel.app` and the Supabase questions store, so the questions-store games (contexto, tictactoe, career-path, who-are-ya) never start and other game pages log tunnel console errors: 003, 004, 005, 006, 011, 012, 013, 017 cannot be verified here (same blocker as 2026-10-16). Real gaps left: 008 rail name 157.3 px (needs ≥ 169), 006/016 `.playing-wrap` on /starting-five snaps ~80 px in one frame, 2 ui-audit assertions per viewport after the rework. Passing: 014, 015, 018, 020, 021.
- Suggested next step: allow the two hosts in the cloud environment or run the card locally from `team/ui-check-contexto-stage-r2`; the stale wip `team/ui-check-contexto-stage` (209cbde, cut from main) is superseded and can be deleted by hand. Environment gaps from 2026-10-16 are still open (setup.sh not installed; Chromium 1243 aliased as 1234; `npm ci` in the worktree instead of the node_modules symlink, because Turbopack rejects it).
- Last error: FAIL UIC-20261025-0128-003 — GM-contexto-perfect @ phone-360: waitForSelector('.playing-wrap') timed out after 30 s.

## landing-tiles-guess-the — 2026-10-28 (shipped 110d10d to dev)
- 340 px step in LandPage.css (tile titles 13.5 px); measured at 320/340 px: all 12 titles on ≤ 2 lines. No fix rounds. Lane-2 QA ran the route smoke only after the Chromium alias; the first QA pass was a browser-less skip.
