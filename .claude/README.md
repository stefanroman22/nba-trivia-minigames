# Cloud Engine Setup

Coding subagents whose **model** and **reasoning effort** are controlled by one named profile,
applied everywhere the agents run.

## Switch the engine profile

```bash
npm run engine            # show current + available profiles
npm run engine fast       # haiku  / low
npm run engine balanced   # sonnet / high   (default)
npm run engine deep       # fable  / xhigh
npm run engine max        # fable  / max    (see caveat)
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

Precedence for a subagent's model (per the Claude Code sub-agents docs) is: the `model` passed
on the spawn call → the agent file's frontmatter `model:` → `CLAUDE_CODE_SUBAGENT_MODEL` → the
parent session's model. Every fleet agent declares a frontmatter model and the orchestrator
passes one explicitly per spawn, so the profile's `subagentModel` is a fallback that rarely
decides anything — the per-task policy in `docs/team/PIPELINE.md` §14 is what governs.
`planner-architect-opus` pins the full id `claude-opus-4-8` in its frontmatter; it predates the
2026-09-29 policy (below) and is now unused — the `opus` alias is used directly instead.

## The engines (`.claude/agents/`)

- `frontend-engine` — React/TS/Tailwind/Next.js (`src/`)
- `backend-engine` — Django/DRF (`backend/`) + Socket.IO (`multiplayer_server/`)
- `code-reviewer` — read-only audit
- `test-qa-engine` — lint / typecheck / build / Django tests

The main orchestrator model is `model` in `.claude/settings.json` (default `fable`) — edit it directly if needed.
Opus 5 was banned pipeline-wide from 2026-09-06 to 2026-09-29 for cost; as of 2026-09-29 the
`opus` alias (now Opus 5.5) is allowed again, for implementation only — see `docs/team/PIPELINE.md` §14.
`.claude/settings.json`'s `permissions.deny` should no longer list `Agent(model:opus)` /
`Agent(model:claude-opus-5)` and `availableModels` should include `opus` — pending the owner's
approval to edit that file directly (self-modification of pipeline permissions).

## Caveat: `max` effort

`npm run engine max` writes `CLAUDE_CODE_EFFORT_LEVEL=max` to `settings.json`. Most surfaces honor it
via the env var, but if a given surface treats `max` as session-only, use `deep` (xhigh) as the
persistent profile and escalate to max at runtime with `/effort max` in that session.

## One-time account setup

1. Push this repo to GitHub (needed for web, routines, and Actions).
2. GitHub Actions: add the `CLAUDE_CODE_OAUTH_TOKEN` repo secret (run `claude setup-token`, then `gh secret set CLAUDE_CODE_OAUTH_TOKEN`) — subscription usage, no API key.
3. Create routines: see `.claude/routines/README.md`.
