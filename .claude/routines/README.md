# Scheduled Cloud Agents (Routines)

Routines are created on your account (via `/schedule` in the CLI or https://claude.ai/code/routines),
not committed to the repo. Each routine clones this repo and inherits the active engine profile from
`.claude/settings.json`. Paste these prompts when creating routines.

## Nightly health check
Schedule: daily. Prompt:

> Run the project health check for nba-minigames and report failures only.
> Steps: `npm ci`; `npm run lint`; `npx tsc -b`; `npm run build`;
> then in `backend/`: create/activate the venv, `pip install -r requirements.txt`,
> `python manage.py check`, `python manage.py test`.
> If anything fails, summarize the failure and the smallest fix. Do not push changes.

## Weekly dependency check
Schedule: weekly. Prompt:

> For nba-minigames, list outdated/insecure dependencies: run `npm outdated` and (in backend/venv)
> `pip list --outdated`. Summarize risky upgrades and propose a safe upgrade order. Do not modify files.

## Effort/model for routines
Routines inherit `CLAUDE_CODE_SUBAGENT_MODEL` + `CLAUDE_CODE_EFFORT_LEVEL` from the committed
`.claude/settings.json`. To run a routine at a different effort, set those as environment variables
in the routine's Environment tab.
