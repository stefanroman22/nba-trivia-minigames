# Cloud Engine Profiles — Design Spec

- **Date:** 2026-06-20
- **Repo:** `nba-minigames` (React 19 + TS + Vite frontend, Django/DRF backend, Socket.IO multiplayer server)
- **Status:** Approved (pending written-spec review)

## 1. Goal

Give the repo a committed Claude Code "cloud setup" so the owner can change the **model**
and **reasoning effort** used by the internal coding agents ("engines") with a **single switch**,
and have that switch take effect across every surface the agents run on: local CLI,
Claude Code on the web, scheduled cloud agents (routines), and GitHub Actions.

"Engines" = the Claude Code subagents that do the coding work, defined as `.claude/agents/*.md`.

## 2. Decisions (approved)

- **Switch style:** Named profiles (`fast` / `balanced` / `deep` / `max`). One profile governs the
  whole fleet, not per-engine values.
- **Engines defined:** `frontend-engine`, `backend-engine`, `code-reviewer`, `test-qa-engine`.
- **Cloud surfaces:** Claude Code on the web, scheduled routines, GitHub Actions, plus portable
  committed config that also works locally.
- **Main orchestrator model:** stays fixed at `opus` (separately editable). The profile switches the
  **subagent model + effort** only.
- **Convenience:** add an `engine` npm script so switching is `npm run engine <profile>`
  (direct `node .claude/use-profile.mjs <profile>` also works).

## 3. Key mechanism (why this works)

Research against current Claude Code docs established:

- `.claude/settings.json` supports a top-level `model` and an `env` block.
- Subagent model resolves from `CLAUDE_CODE_SUBAGENT_MODEL` (env) **above** each agent's frontmatter `model`.
- Effort resolves from `CLAUDE_CODE_EFFORT_LEVEL` (env) **above** each agent's frontmatter `effort`.
- Both env vars can live in the committed `.claude/settings.json` `env` block.
- Claude Code on the web and routines clone the repo and read committed `.claude/settings.json`
  (including its `env` block), `.claude/agents/*.md`, and `CLAUDE.md`. They do **not** read
  `.claude/settings.local.json` or `~/.claude/`.

Therefore the **single source of truth** is the `env` block of `.claude/settings.json`. Changing the
two env values there changes the whole engine fleet's model + effort, and every surface honors it
(GitHub Actions via an explicit extraction step — see §7.3).

## 4. File layout (all inside the `nba-minigames/` git repo)

```
.claude/
  settings.json          # committed — main model + env block (the switchable values) + availableModels
  profiles.json          # named profile definitions (source of truth for profile -> model/effort)
  use-profile.mjs        # cross-platform Node switcher (no jq dependency; node already in repo toolchain)
  active-profile         # one word (e.g. "balanced") — status marker, read by CI step
  agents/
    frontend-engine.md   # React 19 + TS + Tailwind 4 + Vite + Redux Toolkit + React Query + framer-motion
    backend-engine.md    # Django/DRF (backend/) + Socket.IO multiplayer_server (Node)
    code-reviewer.md     # read-only auditor (disallowedTools: Write, Edit)
    test-qa-engine.md    # npm lint / tsc / build + Django tests
  README.md              # how the setup works, how to switch, per-surface notes
  routines/README.md     # ready-to-paste /schedule prompts (routines are account-side, not committable)
.github/workflows/claude.yml   # @claude on PR/issue comments; reads profile -> model+effort
CLAUDE.md                # repo guide for engines (commands, ports, conventions, structure)
.gitignore               # append: .claude/settings.local.json
package.json             # add script: "engine": "node .claude/use-profile.mjs"
docs/superpowers/specs/2026-06-20-cloud-engine-profiles-design.md  # this file
```

No existing `.claude/`, `.github/`, or `CLAUDE.md` present — all are new. Only existing files touched:
`.gitignore` (append one line) and `package.json` (add one script).

## 5. Profiles

| Profile | Subagent model (`CLAUDE_CODE_SUBAGENT_MODEL`) | Effort (`CLAUDE_CODE_EFFORT_LEVEL`) | Use for |
|---|---|---|---|
| `fast` | `haiku` | `low` | cheap, mechanical edits |
| `balanced` *(default)* | `sonnet` | `high` | day-to-day work |
| `deep` | `opus` | `xhigh` | hard / architectural work |
| `max` | `opus` | `max` | maximum reasoning (see caveat) |

**Caveat to verify at build time:** research flagged `max` effort as possibly session-only (not
persistable via config on some surfaces). Build step will test whether `CLAUDE_CODE_EFFORT_LEVEL=max`
persists. If it does not, the top profile is capped at `xhigh` and `.claude/README.md` documents
`/effort max` as the runtime escalation. No silent downgrade — the behavior will be documented.

`profiles.json` is the editable source for these mappings, so adding/retuning a profile is a one-file edit.

## 6. Config file shapes

### 6.1 `.claude/settings.json` (committed)
```json
{
  "model": "opus",
  "availableModels": ["opus", "sonnet", "haiku"],
  "env": {
    "CLAUDE_CODE_SUBAGENT_MODEL": "sonnet",
    "CLAUDE_CODE_EFFORT_LEVEL": "high"
  }
}
```
The `env` values are owned by the switcher. `model` (main orchestrator) is a manual edit.

### 6.2 `.claude/profiles.json`
```json
{
  "default": "balanced",
  "profiles": {
    "fast":     { "subagentModel": "haiku",  "effort": "low" },
    "balanced": { "subagentModel": "sonnet", "effort": "high" },
    "deep":     { "subagentModel": "opus",   "effort": "xhigh" },
    "max":      { "subagentModel": "opus",   "effort": "max" }
  }
}
```

### 6.3 `.claude/use-profile.mjs` behavior
- Usage: `node .claude/use-profile.mjs <profile>` (or `npm run engine <profile>`); no arg prints the
  current profile + the available profile names.
- Steps: validate arg against `profiles.json`; read `settings.json`; set
  `env.CLAUDE_CODE_SUBAGENT_MODEL` and `env.CLAUDE_CODE_EFFORT_LEVEL`; write `settings.json`
  (2-space indent, preserve other keys); write the profile name to `.claude/active-profile`;
  print a confirmation summary.
- Pure Node stdlib (`fs`), no dependencies. Works on Windows, macOS, Linux, web sandbox, and CI.
- Exit non-zero with a helpful message on unknown profile.

## 7. Engines and cloud wiring

### 7.1 Engine subagents (`.claude/agents/*.md`)
Each has a focused system prompt, scoped `tools`, and **documented default** `model`/`effort`
frontmatter (used only if the env profile is ever cleared — the active profile overrides them).

| Engine | Scope | Tools | Default model/effort |
|---|---|---|---|
| `frontend-engine` | `src/` | Read, Write, Edit, Grep, Glob, Bash | sonnet / high |
| `backend-engine` | `backend/`, `multiplayer_server/` | Read, Write, Edit, Grep, Glob, Bash | sonnet / high |
| `code-reviewer` | whole repo (read-only) | Read, Grep, Glob, Bash; `disallowedTools: Write, Edit` | opus / high |
| `test-qa-engine` | whole repo | Read, Write, Edit, Bash, Grep, Glob | sonnet / high |

System prompts reference real project facts: ports (8000 Django, 4000 socket, 5173 Vite), the
three-process run model, `npm run lint` / `tsc -b` / `npm run build`, Django `manage.py test`,
and the `src/` structure (components, pages, Game Renderers, store, hooks).

### 7.2 Claude Code on the web
Works once the repo is on GitHub with `.claude/` committed. The `env` block applies automatically.
No extra files. `.claude/README.md` documents opening the repo at claude.ai/code.

### 7.3 GitHub Actions — `.github/workflows/claude.yml`
- Triggers: `issue_comment` and `pull_request_review_comment`, gated on an `@claude` mention
  (mention-driven; deliberately no run on bare PR pushes — `claude-code-action@v1` no-ops without
  a prompt, so an unconditional `pull_request` trigger would only burn Actions minutes).
- A pre-step reads `CLAUDE_CODE_SUBAGENT_MODEL` and `CLAUDE_CODE_EFFORT_LEVEL` out of
  `.claude/settings.json` (via `node -e`) and exports them to the job `env`, and passes effort to
  `claude_args`. This keeps the workflow on the **same single source of truth** — flip the profile,
  commit, and CI follows.
- Uses `anthropics/claude-code-action@v1` with `anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}`.
- **User account step (documented, not automatable here):** add the `ANTHROPIC_API_KEY` repo secret,
  easiest via `claude /install-github-app`.

### 7.4 Scheduled routines — `.claude/routines/README.md`
Routines are account-side (created via `/schedule` or claude.ai/code/routines), so they can't be
committed as executable config. The README provides ready-to-paste prompts + `/schedule` snippets:
- Nightly: `npm ci && npm run lint && npx tsc -b && npm run build` health check, report failures.
- Weekly: dependency/outdated check.
Each routine clones the repo and inherits the active profile via the committed `settings.json` `env`.

## 8. Propagation summary (one switch → all surfaces)

| Surface | How it picks up the profile |
|---|---|
| Local CLI | reads `.claude/settings.json` `env` on session start |
| Web (claude.ai/code) | clones repo, reads committed `.claude/settings.json` `env` |
| Routines | clones repo, reads committed `.claude/settings.json` `env` |
| GitHub Actions | workflow step extracts the two env values from `settings.json` |

## 9. Verification plan

- `node .claude/use-profile.mjs deep` then confirm `settings.json` `env` shows
  `opus` / `xhigh` and `active-profile` reads `deep`; repeat for `fast` and back to `balanced`.
- `node -e` parse-check every JSON file (`settings.json`, `profiles.json`).
- Confirm each agent file has valid YAML frontmatter and required `name`/`description`.
- Lint the workflow YAML (structure) and dry-read the `node -e` extraction snippet.
- Run `npm run engine` (no arg) to confirm it prints current + available profiles.
- Document (cannot execute here): adding the GitHub secret and creating routines are one-time
  account-side actions the user performs.

## 10. Out of scope

- Dev Containers config (not requested; can be added later from the same `env` source).
- Bedrock/Vertex provider wiring (Anthropic API assumed).
- Any change to app source code, build, or deployment of the NBA app itself.
- Auto-creating routines or committing API keys (account-side, user-performed).

## 11. Account-side steps the user must perform (documented in `.claude/README.md`)

1. Push the repo to GitHub (required for web, routines, GitHub Actions).
2. `claude /install-github-app` (or manually add `ANTHROPIC_API_KEY` repo secret) for GitHub Actions.
3. Create routines via `/schedule` using the prompts in `.claude/routines/README.md`.
