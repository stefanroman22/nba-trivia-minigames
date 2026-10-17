# Weekly checks in the cloud (PC off) — design

Date: 2026-10-17. Owner request: Logic Check, UI check and the Notion card push run on their own, Sundays 02:00
Europe/Paris, with the PC turned off, and the Logic→UI channel (`channel.json`) keeps working in that world.
Extends §7 of `2026-10-15-checks-prod-logic-design.md`.

## 1. Where the run executes: one GitHub Actions job (ubuntu-latest)

| Option | Verdict |
|---|---|
| **GitHub Actions, one job** | **Chosen.** The repo is public, so standard runners are free with no minute cap. A job may run 6 h; the measured weekly run on the PC is ~1h45 (Logic 8 min including a 4 min `next build`, UI 88 min for 803 tests, triage ~4 min, judges ~10-30 min), plus ~8 min of setup on the runner. The job's limit is set to 350 min. Everything the run needs installs in plain steps (the same as `infra/routine/setup.sh`): node, `npm ci` (+ relay), a venv from main's `requirements.txt`, Chromium with OS deps. |
| Anthropic cloud routine | Rejected for the whole run. Its cron is UTC with one expression per routine, it shares the pipeline's sandbox and network allowlist, its run time is bounded per session, and it would need the store credentials and the Playwright CDN hosts. Nothing it offers beats a free 6 h runner. |
| Matrix shards (per suite) | Not needed today (the run uses less than half of the limit). Possible later: shards run on separate VMs, so each has its own checkout, `.next` and ports (the PR #93 rule, one `.next` per checkout, holds automatically); each shard is its own run id with its own judges and push, and the store merges their deferrals (it is built for concurrent writers). The cost is ~8 min of setup per shard. |

The tooling is a checkout of **dev** (where the checker scripts live; the PC's task also runs dev's tooling). The app under
test is **origin/main**, built by `check-core/lib/checkout.mjs` in a worktree next to the checkout (`fetch-depth: 0`), on
the runner's own sqlite: the job gets no `DATABASE_URL`, `DJANGO_SECRET_KEY` or relay key, and `stack.mjs` blanks
`DATABASE_URL` for Django anyway.

The run is `scripts/check-run.mjs`, a cross-platform port of `check-run.ps1` (same steps, same command lines, same
Slack line). `check-run.ps1` is now a wrapper that calls it, so the Task Scheduler task `nba-checks` keeps its command
line and keeps working. Linux portability was mostly there already (the pipeline runs `verify.mjs` on the cloud VM):
`stack.mjs` kills process groups off Windows and finds `backend/.venv/bin/python`, `checkout.mjs` ignores the Windows
`worktreeRoot`, `home.mjs` uses `<repo>/.ui-check` off Windows. The orchestrator spawns `claude` through cmd on Windows
(prompt on stdin, no quoting) and in its own process group elsewhere, and kills the tree after the watchdog.

## 2. Start time: Sunday 02:00 Europe/Paris, DST-correct

GitHub's `schedule` is UTC, often fires a few minutes late (more at the top of the hour, sometimes an hour or more under
load) and can drop a trigger. So three crons fire around the slot and a gate (`check-core/lib/weekly-slot.mjs`) decides:

- a trigger 0-45 min before the slot: install everything, then sleep until 02:00:00 and start;
- a trigger after the slot (late, or a backup cron): start at once, unless the store says this week already ran ok or
  a run holds the lease (then the job is skipped);
- otherwise skip.

| UTC cron | Summer (CEST) | Winter (CET) |
|---|---|---|
| Sat 23:30 | 01:30 → waits, **starts 02:00** | 00:30 → 90 min early, skips |
| Sun 00:30 | 02:30 → backup | 01:30 → waits, **starts 02:00** |
| Sun 01:30 | 03:30 → backup | 02:30 → backup |

The slot is the first instant whose Paris wall clock reads ≥ 02:00 that Sunday (October's double 02:00 → the first;
March's missing 02:00 → 03:00 CEST). Precision: when GitHub fires within ~22 min of the cron (30 min margin minus ~8 min of
setup), the checks start at 02:00:00 Paris time give or take a few seconds. A later trigger starts as soon as it fires; a
dropped primary is covered by the backup 30 min after the slot (and a second one in summer). No free trigger is more
precise: GitHub cron is the only scheduler that needs no credential outside the repo.

## 3. Agents in CI: the Max subscription token, no API key

The triage and the judges run as before through `claude -p --model sonnet`, authenticated by the repo secret
**`CLAUDE_CODE_OAUTH_TOKEN`** (already there since 2026-08-22, used by `claude.yml`; a `claude setup-token` token of the
owner's Max plan, valid one year). No API key, nothing billed per token: the calls count against the same Max usage the
PC run used, and only when a suite failed (one triage, up to two judge passes per week). A preflight step checks the
token; when it fails the run continues without agents and the Slack line says "triage needed" / "judges needed".

## 4. The state store: orphan branch `checks-state`

The runner is ephemeral, so the channel, the cards ledger, the live probes' failure state and the agents' notes live on
an orphan branch `checks-state` (never merged anywhere), shared by every writer: the cloud weekly run, the PC's weekly
run, the live-probe workflow every 6 h, and a skill run (`node scripts/check-core/state.mjs sync`).

```
channel.json  notion-cards.json  logic-live-state.json  weekly.json  notes/<checker>/…  notes-base/<checker>/…
```

**Read/write cycle.** A writer pulls the store into its home (`<home>/channel.json` …, plus the store copy it merged in
`<home>/state-base/<branch>/`), works, and syncs again after each step: its changes since that base are merged onto the
store as it is now (3-way per key: blocks by service+LC id, deferrals by check+block+since, resolutions, ledger entries
per fingerprint; modify beats delete so a block is never lost), committed with the fetched commit as parent and pushed
without force. Git refuses a non-fast-forward push, so a concurrent writer can never be clobbered: the loser fetches,
re-applies its own change and retries (12 attempts). Only git plumbing is used (hash-object, a temporary index,
commit-tree, push): no checkout or working tree is touched, so it is safe from any clone, the owner's included.

**One weekly run.** `weekly.json` holds a lease (`holder`, `until` = start + 7 h) and the run history. A run takes the
lease first; another holder's live lease → exit 0; a run that finished ok since Sunday 00:00 Paris time → exit 0 unless
`--force`. That is also what makes the cloud run and the PC task safe to have both enabled during the switch: whichever
starts first runs, the other exits.

**`resolve` keeps its meaning.** It still asks Notion (card Done) and git (`merge-base --is-ancestor <Commit>
origin/main`, the runner has full history); only where channel.json lives changed.

**Notes.** The store holds the canonical notes. A run on a tooling checkout (the runner, or the PC's `checks-nightly`
worktree) overlays them into `scripts/{ui,logic}-check/notes/`, the agents append, and the end of the run merges the
edits back (`git merge-file --union`) and restores the checkout's own notes. A notes change on dev flows in by the same
3-way merge (`notes-base/` remembers origin/dev's version). `state.mjs notes-export` writes the store's notes into a
checkout so they can be PR'd to dev. The PC no longer commits notes on `checks-nightly`.

**Public repo.** The branch is world-readable. It holds service names, check ids, finding ids, Notion card ids, dates
and the notes (already public on dev); the ledger is stored without card titles and URLs (a Notion URL is its title as a
slug). The Actions log and the 14-day artifact are public too, so the run writes digests and agent transcripts to its
log file and uploads no screenshots.

## 5. Code access and permissions

| What | Where |
|---|---|
| Tooling | `actions/checkout` of `dev` (`fetch-depth: 0`, `persist-credentials: false`) |
| App under test | `origin/main` in a worktree (`checkout.mjs`), `npm ci` there, venv and relay `node_modules` symlinked from the tooling checkout |
| Commits | the `checks-state` branch only, by `state-store.mjs`; never dev or main, no PR |
| Token | `GITHUB_TOKEN` with `contents: write`, given to the orchestrator as `CHECKS_STATE_TOKEN`, passed to git as an http header through `GIT_CONFIG_*` env and deleted from the env before any child (agent) starts |
| Secrets | `NOTION_TOKEN`, `SLACK_BOT_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN` — all already exist; nothing new is needed |

## 6. Pipeline fit

Cards come from the same `notion-push.mjs` (Source fingerprints, Target `main`, the `findings.json` attachment, images
uploaded at push time), so the pipeline (`intake.mjs` → `brief.mjs` `## Check findings` → `qa.mjs` `verify.mjs --from`)
picks them up exactly as before; it never reads a run dir. `main-sync.yml` flips QA cards Done when their Commit
reaches main, and the next weekly `resolve` releases the blocks. The live-probe workflow now also writes its blocks
(`channel.mjs block-run` after its push) through the store.

## 7. Safety

Live runs stay GET/HEAD-only (the suites' request guard); the local suites run on the runner's sqlite with local test
accounts; no account, room or relay credit is touched on prod. The store only accepts fast-forward pushes and the
orchestrator refuses `main`/`dev` as a store branch.

## 8. Money

None. Public repo → free standard runners (the repo used ~560 runner-minutes in the week to 2026-10-17; the weekly run
adds ~110-150 min a week). Agents use the existing Max subscription token. No new service, plan, key or runner size.

## 9. Activation (after dev → main)

1. Promote dev → main (GitHub runs `schedule` only from the default branch). `checks-weekly.yml` and the new
   `logic-live.yml` become active at once; secrets already exist.
2. On the PC, once: `node scripts/check-core/state.mjs sync --notes --release-notes` from `<worktreeRoot>\checks-nightly` with
   `UI_CHECK_HOME=%LOCALAPPDATA%\nba-ui-check` (or just let Sunday's PC run do it): seeds the store with the PC's
   channel, ledger and notes. Then `state.mjs show`.
3. Optional: Actions → "Weekly checks" → Run workflow, scope `smoke`, store `checks-state-test`, Notion `dry`.
4. After the first cloud Sunday run shows up in Slack: `scripts\unregister-check-cron.ps1` on the PC. Until then both are
   safe together (the lease).
