---
name: logic-check
description: Run Logic Check on production code (API, socket protocol and page-status checks of nba-minigames, plus the read-only live suite), have the logic-check-triage agent turn failures into validated findings, push them as Notion cards, block the broken services for UI check, and hand the owner REPORT.md. Use when asked for a logic check, an API/backend check, or "check that the actions work".
---

# Logic check (orchestrator)

Scripts measure, one triage agent judges (only when something failed), you only orchestrate. Background:
`docs/logic-check/README.md`; catalogue `scripts/logic-check/CHECKS.md`.

**Token rules** (as the ui-check skill). Never open `results.json`, digest bodies, `findings/logic.json` or
`findings.json`. You read only: the run's console output tail, the count of `## FAIL` headers in `digest.md`, the
first 8 lines of `digest.md`, `rejected.json`, the result lines of notion-push and channel.mjs, and the header,
`## Summary` and `## Coverage gaps` sections of `REPORT.md`. Logic Check has no images.

## 1. Run the suites
```
node scripts/logic-check/run.mjs --suite all --ref main --keep-stack --live
```
`--ref main` tests `origin/main` (what swishquest.com runs) in `<worktreeRoot>/check-main` on the checker ports with a
local sqlite; `--suite all` is every local suite plus the live suite (`--live`: https://swishquest.com, GET/HEAD
only; `--live <url>` for another site). Subsets when asked: `--suite auth,signup` · `--only LC-AUTH-01,LC-ROOMS-*` ·
`--ports django=8400,socket=4400,web=5574` when the prod ports (8200/4200/5374) are another session's.
- Run it with the Bash tool in the background (`run_in_background: true`; about 10-15 min, more on a fresh checkout's
  `npm ci`). Tell the owner once, then wait for the notification. Do not poll.
- The first line is `logic-check: run <runId> · mode …` (`<runId>` ends in `-logic`); the last is
  `logic-check: digest <path>`, `<runDir>` is its folder. Exit 0 = all passed: go to step 6; 1 = a check failed (the triage's input); 2 = infra (bad arguments,
  checkout, stack, nothing ran): read the last 30 lines, run step 6, report the error.
- The `live requests: N GET/HEAD · 0 refused write(s)` line must show 0 writes; anything else is a harness bug: report
  it to the owner before anything else.

## 2. Triage (only when the digest has FAIL sections)
Count them (Bash tool): `grep -c '^## FAIL ' "<runDir>/digest.md"`. 0 → skip to step 6 (nothing to push).
Otherwise dispatch ONE agent, `subagent_type: "logic-check-triage"`, `model: "sonnet"`:
```
runDir: <absolute runDir>
runId: <runId>
mode: prod
Triage this Logic run per your agent file (it also files the owner advisories once). The stack is up
(--keep-stack): probe with --run <runId> --keep-stack and never stop it. Return ≤ 10 lines.
```
Wait for it. A triage that returns nothing usable is re-dispatched once with the same prompt.

## 3. Report and validate
```
node scripts/ui-check/report.mjs --run <runId> --validate
```
It validates in the run's mode on the run's checkout and ports (stack still up). It prints `rejected: …` lines. Exit 1 =
infra (nothing written): run it once more, then report the error. Anything rejected: read `<runDir>/rejected.json` and
re-dispatch the triage once (same prompt plus `Re-dispatch: report.mjs rejected these findings of yours. Fix them per
"Re-dispatch" in your agent file.` and the entries, verbatim JSON), then run the validate command once more. No third round.

## 4. Notion cards
```
node scripts/check-core/notion-push.mjs --run <runId> --checker logic --target main
```
`--dry-run` when the owner asked for a preview (it reads Notion and writes nothing; then skip step 5). Read only its
result lines: `card <id> <title> findings=<ids>`, `skip <keys> <why> card <id>`, `regression <old> → <new>`,
`error <keys> <message>` and `notion-push done: N new · N regression · N skipped · N error(s)`. An `error` line or
exit 1 → run it once more (it skips what it already made).

## 5. Blocks for UI check
```
node scripts/check-core/lib/channel.mjs block-run --run <runId>
```
For each finding pushed in step 4 it calls the channel's `block` for every service of the finding's failing `lc`
checks (the `services` column of `scripts/logic-check/CHECKS.md`; a violation note `service games.<id>` from
`LC-LIVE-03` / `LC-GAMEDATA-01` blocks that game instead of all of `game-data`), with the finding id and its card. It
never re-blocks a service whose card was closed by hand (notion-push printed `done without commit (closed by hand)`:
a won't-fix). It prints `block <service> by <LC-id> card <card> finding <id> (new|kept)`, `skip … (no block)` and
`block-run: N new · M kept · K skipped`. One block by hand, when the owner asks:
`node scripts/check-core/lib/channel.mjs block --service <service> --by <LC-id> --finding <findingId> --card <cardId> --run <runId>`.
The nightly UI check then defers every check tagged with a blocked service (`node scripts/check-core/lib/channel.mjs show`).

## 6. Stop the stack
```
node scripts/logic-check/run.mjs --stop
```
A bare `--stop` touches only the checker port sets, prod (8200/4200/5374) and dev (8000/4000/5173); a stack on a lane
or agent port set (step 1's `--ports`) needs `node scripts/logic-check/run.mjs --stop --ports <the same set>`. Always,
also after a failure in steps 1-5.

## 7. Hand over
Give the owner:
- the absolute path of `<runDir>/REPORT.md`, its summary table and the rejected count;
- the triage's return (findings, advisories line, dropped lines, any `check-bug`);
- the cards from step 4 (created, regressions, skipped with reason, errors) and the blocks from step 5 (service ←
  LC id, card), and the services that were not blocked because their card was closed by hand;
- the next step: the cards are in To Do for the team pipeline (engines follow "Fixing a Logic-check finding"), or
  `ui-fix <runId>` fixes them now (it ships a `--ref main` run's fixes to production);
- `git status --short scripts/logic-check/notes`: the triage's notes appends stay uncommitted (tooling, next tooling PR).

## Nightly
`scripts/check-run.ps1` (Task Scheduler `nba-checks`, Sundays 02:00 CET) runs steps 1, 3-6 itself and calls only step 2 through
`claude -p`; see `docs/logic-check/README.md`.
