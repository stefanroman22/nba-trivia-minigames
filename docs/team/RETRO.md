# Parked-Task Post-Mortems

Append-only. The planner-architect MUST read this file before classifying any new task.
Format: `## YYYY-MM-DD — <task title> (<Notion page id>)` then What was tried / Why it failed / Suggested next step.
Post-mortems are appended here by the fail procedure of the team pipeline.

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
