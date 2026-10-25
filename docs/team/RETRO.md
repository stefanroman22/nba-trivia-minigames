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
