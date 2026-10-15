---
name: ui-check
description: Run the full automated UI audit of nba-minigames (guest, account, games, multiplayer suites on 7 viewports), have the four ui-check judges turn the digest into validated findings, and hand the owner REPORT.md. Use when asked for a UI check, UI audit, or "check the UI".
---

# UI check (orchestrator)

Scripts measure, judges judge, you only orchestrate. Background: `docs/ui-check/README.md`.

**Token rules.** Never open screenshots, contact sheets, `results.json`, digest bodies, judge files
or `findings.json`. You read only: the run's console output tail, the first 8 lines of `digest.md`
(header + suite table), `rejected.json`, and the header, `## Summary` and `## Coverage gaps`
sections of `REPORT.md`.

## 1. Run the suites
Default (full audit):
```
node scripts/ui-check/run.mjs --suite all --mode prod --keep-stack
```
Subsets when asked: `--suite guest,account` · `--vp core` (phone-390, tablet-768, desktop-1366) or
viewport ids / `pairA`… · `--only "G-NAV-01,GM-wordle-*"` · `--skip-slow` (leaves out MP-TIMEOUT-01's
real 30 s waits) · `--mode dev` (no prod build; performance budgets become informational).

- Run it with the Bash tool in the background (`run_in_background: true`). A full run takes 1-3 h
  here. Tell the owner once that it started and the expected time, then wait for the completion
  notification. Do not poll; if the owner asks for progress, read only the last 5 lines of the output.
- The first output line is `ui-check: run <runId> · mode …`; the last is `ui-check: digest <path>`.
  `<runDir>` is the digest's folder (`node scripts/ui-check/run.mjs --where` prints it too). Exit 1
  only means some check failed: that is the normal input for the judges.
- Infra failure (`digest (none written)`, exit 2, or a stack error): read the last 30 output lines,
  run step 4, report the error. Do not dispatch judges.

## 1b. The live subset (when asked, or with a full audit of production code)
```
node scripts/ui-check/run.mjs --live            # https://swishquest.com; or --live <url>
```
Runs only the guest checks tagged `@live` (CHECKS.md `live` column: public routes, idle screens, perf,
a11y, permissions) against the live site on the core viewports, as its own run (own runId). It starts
no stack and uses no accounts, and it never writes: every request other than GET/HEAD to a
non-localhost origin, or a websocket, fails the test as `live-write`. The last lines print
`ui-check: live requests: N GET/HEAD · 0 live-write`; any non-zero live-write count is a harness bug,
so report it to the owner before anything else. `--only`/`--vp` narrow it as usual; `--ref`/`--repo`
only choose the game catalogue (default main's). Its digest header reads `· env live` and its lines
`phone-390 (live)`: judge it like any guest run, and the judge sets `where.env: ["live"]` on its
findings. A finding seen locally and live merges into one with both envs. Never run account, game or
multiplayer checks against the live site (the live leaderboard and the billed relay).

## 2. Dispatch the judges (one message, in parallel)
Read the digest's first 8 lines for the suites that ran. Dispatch one judge per suite that ran, all
in ONE message, each with `model: "sonnet"` and `subagent_type` `ui-check-guest`, `ui-check-account`,
`ui-check-games`, `ui-check-multiplayer`. Prompt:

```
runDir: <absolute runDir>
runId: <runId>
mode: <prod|dev>
Judge the <suite> suite of this run per your agent file. The stack is up (--keep-stack): probe with
--mode <mode> --run <runId> --keep-stack and never stop it. Return ≤ 10 lines.
```
Wait for all of them. A judge that returns nothing usable is re-dispatched once with the same prompt.

## 3. Report and validate
```
node scripts/ui-check/report.mjs --run <runId> --validate
```
It validates in the run's own mode (prod stack still up, so no rebuild) and prints
`rejected: <id|source> … — [kind] reason` lines. Exit 1 = infra failure (nothing written): run it once
more, then report the error.

If anything was rejected, read `<runDir>/rejected.json` and re-dispatch each judge that has entries
(its `source` names `<suite>.json[i]`), all in one message, once:
```
runDir: <absolute runDir>
runId: <runId>
mode: <prod|dev>
Re-dispatch: report.mjs rejected these findings of yours. Fix them per "Re-dispatch" in your agent
file, then return ≤ 10 lines.
<the suite's rejected.json entries, verbatim JSON>
```
Then run `node scripts/ui-check/report.mjs --run <runId> --validate` once more. `validation-error`
entries are re-run by every `--validate`; whatever is still rejected stays in `rejected.json` and is
listed for the owner. No third round.

## 4. Stop the stack
```
node scripts/ui-check/run.mjs --stop
```
Always, also after a failure in steps 1-3.

## 5. Hand over
Give the owner:
- the absolute path of `<runDir>/REPORT.md`;
- the summary table from REPORT.md's header and `## Summary` (findings by severity × owner and
  severity × suite), the rejected count, and the coverage gaps (scenarios no adapter could drive);
- one line per judge from its return (findings count, anything that blocked it);
- the next step: the `ui-fix` skill fixes open findings (`ui-fix <runId>`);
- the judges' notes appends (`git status --short scripts/ui-check/notes`) are left uncommitted: `ui-fix`
  commits them first as `ui-check: notes from <runId>`.
The owner's manual check (Google OAuth round trip) is listed in `docs/ui-check/README.md`.
