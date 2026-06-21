# Cloud Engine Setup

Coding subagents whose **model** and **reasoning effort** are controlled by one named profile,
applied everywhere the agents run.

## Switch the engine profile

```bash
npm run engine            # show current + available profiles
npm run engine fast       # haiku  / low
npm run engine balanced   # sonnet / high   (default)
npm run engine deep       # opus   / xhigh
npm run engine max        # opus   / max    (see caveat)
```

(Equivalent: `node .claude/use-profile.mjs <profile>`.)

This rewrites the `env` block of `.claude/settings.json` and updates `.claude/active-profile`.
**Commit + push** so the cloud surfaces pick it up.

## How one switch reaches every surface

| Surface | Picks up the profile via |
|---|---|
| Local CLI | reads `.claude/settings.json` env on start |
| Claude Code on the web | clones repo, reads committed `.claude/settings.json` env |
| Scheduled routines | clones repo, reads committed `.claude/settings.json` env |
| GitHub Actions | `.github/workflows/claude.yml` extracts the env values from settings.json |

`CLAUDE_CODE_SUBAGENT_MODEL` and `CLAUDE_CODE_EFFORT_LEVEL` override each agent's own frontmatter,
so the active profile governs the whole fleet.

## The engines (`.claude/agents/`)

- `frontend-engine` — React/TS/Tailwind/Vite (`src/`)
- `backend-engine` — Django/DRF (`backend/`) + Socket.IO (`multiplayer_server/`)
- `code-reviewer` — read-only audit
- `test-qa-engine` — lint / typecheck / build / Django tests

The main orchestrator model is `model` in `.claude/settings.json` (default `opus`) — edit it directly if needed.

## Caveat: `max` effort

`npm run engine max` writes `CLAUDE_CODE_EFFORT_LEVEL=max` to `settings.json`. Most surfaces honor it
via the env var, but if a given surface treats `max` as session-only, use `deep` (xhigh) as the
persistent profile and escalate to max at runtime with `/effort max` in that session.

## One-time account setup

1. Push this repo to GitHub (needed for web, routines, and Actions).
2. GitHub Actions: add the `ANTHROPIC_API_KEY` repo secret — easiest via `claude /install-github-app`.
3. Create routines: see `.claude/routines/README.md`.
