# Cloud Engine Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the `nba-minigames` repo a committed Claude Code setup where one named profile switches the model + reasoning effort of all coding subagents, applied across local, web, scheduled routines, and GitHub Actions.

**Architecture:** The committed `.claude/settings.json` `env` block is the single source of truth. A Node switcher writes `CLAUDE_CODE_SUBAGENT_MODEL` + `CLAUDE_CODE_EFFORT_LEVEL` from a chosen profile; those env vars outrank per-agent frontmatter, so the profile governs the whole fleet. Web and routines read the committed file natively; GitHub Actions extracts the same two values in a workflow step.

**Tech Stack:** Claude Code config (`.claude/`), Node.js (stdlib only) for the switcher, GitHub Actions (`anthropics/claude-code-action@v1`), YAML, Markdown. Target repo is React 19 + TS + Vite + Django + Socket.IO.

## Global Constraints

- All new files live inside the `nba-minigames/` git repo (the actual repo; `nba-projects/` is not a repo).
- Surgical edits to existing files only: `.gitignore` (append one line) and `package.json` (add one script). No other existing file is modified.
- Switcher uses Node stdlib only — no new npm dependencies.
- Profile model values are aliases: `haiku`, `sonnet`, `opus`. Effort values: `low`, `high`, `xhigh`, `max`.
- Default profile is `balanced` (sonnet / high). Main orchestrator `model` stays `opus`.
- JSON files: 2-space indent, trailing newline.
- **Commits:** do NOT commit to the default branch and do NOT run `git commit`/`git push` without explicit user approval. When approved, first create branch `feat/cloud-engine-profiles`, then use the commit steps below. Until then, leave changes in the working tree.

---

### Task 1: Profile config foundation (profiles, settings, active marker, gitignore)

**Files:**
- Create: `.claude/profiles.json`
- Create: `.claude/settings.json`
- Create: `.claude/active-profile`
- Modify: `.gitignore` (append one line)

**Interfaces:**
- Produces: `.claude/profiles.json` with shape `{ default: string, profiles: { [name]: { subagentModel: string, effort: string } } }`. Profile names: `fast`, `balanced`, `deep`, `max`. Consumed by Task 2's switcher and Task 5's workflow.
- Produces: `.claude/settings.json` with keys `model` (string), `availableModels` (string[]), `env` ({ CLAUDE_CODE_SUBAGENT_MODEL, CLAUDE_CODE_EFFORT_LEVEL }). Consumed by Task 2 and Task 5.

- [ ] **Step 1: Create `.claude/profiles.json`**

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

- [ ] **Step 2: Create `.claude/settings.json`** (initialized to the `balanced` profile)

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

- [ ] **Step 3: Create `.claude/active-profile`** (single line)

```
balanced
```

- [ ] **Step 4: Append the local-settings ignore to `.gitignore`**

Add these two lines at the end of `.gitignore` (the existing `*.local` pattern does NOT match `settings.local.json`):

```
# Claude Code personal overrides
.claude/settings.local.json
```

- [ ] **Step 5: Verify both JSON files parse and have the expected values**

Run:
```bash
node -e "const s=require('./.claude/settings.json'); if(s.env.CLAUDE_CODE_SUBAGENT_MODEL!=='sonnet'||s.env.CLAUDE_CODE_EFFORT_LEVEL!=='high'||s.model!=='opus') throw new Error('settings values wrong'); console.log('settings OK')"
node -e "const p=require('./.claude/profiles.json'); const n=Object.keys(p.profiles); if(!['fast','balanced','deep','max'].every(x=>n.includes(x))) throw new Error('profiles missing'); console.log('profiles OK:', n.join(','))"
```
Expected output:
```
settings OK
profiles OK: fast,balanced,deep,max
```

- [ ] **Step 6: Verify gitignore entry present**

Run: `grep -n "settings.local.json" .gitignore`
Expected: one match line printing `.claude/settings.local.json`.

- [ ] **Step 7: Commit** (only if commits approved — see Global Constraints)

```bash
git add .claude/profiles.json .claude/settings.json .claude/active-profile .gitignore
git commit -m "feat(claude): add engine profile config foundation"
```

---

### Task 2: The profile switcher + npm script

**Files:**
- Create: `.claude/use-profile.mjs`
- Modify: `package.json` (add one script under `"scripts"`)

**Interfaces:**
- Consumes: `.claude/profiles.json` and `.claude/settings.json` from Task 1.
- Produces: CLI `node .claude/use-profile.mjs <profile>` and `npm run engine <profile>` that rewrite `settings.json.env` and `.claude/active-profile`. With no arg, prints the active profile and available names.

- [ ] **Step 1: Create `.claude/use-profile.mjs`**

```js
#!/usr/bin/env node
// .claude/use-profile.mjs
// Switch the coding-engine profile (model + reasoning effort) for the whole subagent fleet.
// Usage: node .claude/use-profile.mjs <profile>   (or: npm run engine <profile>)
//        node .claude/use-profile.mjs              (prints current + available profiles)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const profilesPath = join(here, 'profiles.json');
const settingsPath = join(here, 'settings.json');
const activePath = join(here, 'active-profile');

const profilesDoc = JSON.parse(readFileSync(profilesPath, 'utf8'));
const profiles = profilesDoc.profiles ?? {};
const names = Object.keys(profiles);
const requested = process.argv[2];

function readActive() {
  try { return readFileSync(activePath, 'utf8').trim(); } catch { return '(unknown)'; }
}

if (!requested) {
  console.log(`Active profile: ${readActive()}`);
  console.log(`Available profiles: ${names.join(', ')}`);
  console.log('Usage: npm run engine <profile>');
  process.exit(0);
}

if (!profiles[requested]) {
  console.error(`Unknown profile "${requested}". Available: ${names.join(', ')}`);
  process.exit(1);
}

const { subagentModel, effort } = profiles[requested];
const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
settings.env = settings.env ?? {};
settings.env.CLAUDE_CODE_SUBAGENT_MODEL = subagentModel;
settings.env.CLAUDE_CODE_EFFORT_LEVEL = effort;
writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
writeFileSync(activePath, requested + '\n');

console.log(`Engine profile -> ${requested}`);
console.log(`  CLAUDE_CODE_SUBAGENT_MODEL = ${subagentModel}`);
console.log(`  CLAUDE_CODE_EFFORT_LEVEL   = ${effort}`);
console.log('Updated .claude/settings.json. Commit + push so web/routines/CI pick it up.');
```

- [ ] **Step 2: Add the `engine` script to `package.json`**

In `package.json`, inside the existing `"scripts"` object, add the `engine` entry (keep the other scripts unchanged):

```json
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "lint": "eslint .",
    "preview": "vite preview",
    "engine": "node .claude/use-profile.mjs"
  },
```

- [ ] **Step 3: Verify the no-arg form prints status**

Run: `npm run engine --silent`
Expected output includes:
```
Active profile: balanced
Available profiles: fast, balanced, deep, max
```

- [ ] **Step 4: Verify switching to `deep` rewrites settings + marker**

Run:
```bash
node .claude/use-profile.mjs deep
node -e "const s=require('./.claude/settings.json'); if(s.env.CLAUDE_CODE_SUBAGENT_MODEL!=='opus'||s.env.CLAUDE_CODE_EFFORT_LEVEL!=='xhigh') throw new Error('deep not applied'); console.log('deep applied')"
cat .claude/active-profile
```
Expected output:
```
Engine profile -> deep
  CLAUDE_CODE_SUBAGENT_MODEL = opus
  CLAUDE_CODE_EFFORT_LEVEL   = xhigh
Updated .claude/settings.json. Commit + push so web/routines/CI pick it up.
deep applied
deep
```

- [ ] **Step 5: Verify unknown profile fails loudly (non-zero exit)**

Run: `node .claude/use-profile.mjs bogus; echo "exit=$?"`
Expected output:
```
Unknown profile "bogus". Available: fast, balanced, deep, max
exit=1
```

- [ ] **Step 6: Verify `max` is written verbatim, then reset to `balanced`**

Run:
```bash
node .claude/use-profile.mjs max
node -e "const s=require('./.claude/settings.json'); if(s.env.CLAUDE_CODE_EFFORT_LEVEL!=='max') throw new Error('max not written'); console.log('max written verbatim')"
node .claude/use-profile.mjs balanced
```
Expected: prints `max written verbatim`, then `Engine profile -> balanced`. (Note: whether a surface honors `max` from the env var at runtime is documented as a caveat in `.claude/README.md` — Task 6; the switcher's job is only to write it correctly.)

- [ ] **Step 7: Commit** (only if commits approved)

```bash
git add .claude/use-profile.mjs package.json .claude/settings.json .claude/active-profile
git commit -m "feat(claude): add engine profile switcher and npm run engine"
```

---

### Task 3: The four engine subagents

**Files:**
- Create: `.claude/agents/frontend-engine.md`
- Create: `.claude/agents/backend-engine.md`
- Create: `.claude/agents/code-reviewer.md`
- Create: `.claude/agents/test-qa-engine.md`

**Interfaces:**
- Produces: four subagent definitions discoverable by Claude Code. Their `model`/`effort` frontmatter are documented defaults; the active profile's env vars override them at runtime.

- [ ] **Step 1: Create `.claude/agents/frontend-engine.md`**

```markdown
---
name: frontend-engine
description: React 19 + TypeScript + Tailwind + Vite specialist for the src/ frontend of nba-minigames. Use for UI components, pages, state (Redux Toolkit / React Query), routing, and framer-motion animations.
model: sonnet
effort: high
tools: Read, Write, Edit, Grep, Glob, Bash
color: cyan
---

You are the frontend engine for the nba-minigames app.

Stack: React 19, TypeScript (~5.8), Vite 7, Tailwind CSS 4, Redux Toolkit + react-redux, @tanstack/react-query, react-router-dom 7, framer-motion, styled-components, sweetalert2, socket.io-client.

Scope: work inside `src/`. Key folders: `components/` (reusable UI), `pages/` (page-level .tsx), `styles/` (CSS per page), `Game Renderers/`, `store/` (Redux), `hooks/`, `context/`, `constants/`, `motion/`, `utils/`, `socket.ts`.

Rules:
- Match existing patterns and file layout. Keep changes surgical — touch only what the task needs.
- TypeScript stays strict; no `any` unless the surrounding code already does it. Build must pass `tsc -b`.
- Verify with `npm run lint` and `npm run build` before declaring done. Dev server: `npm run dev` (port 5173).
- The frontend reads `VITE_BACKEND_URL` and `VITE_SOCKET_URL` from `.env`. Don't hardcode URLs.
- Multiplayer uses socket.io-client against the server on port 4000; single-player needs only the Django API on port 8000.
```

- [ ] **Step 2: Create `.claude/agents/backend-engine.md`**

```markdown
---
name: backend-engine
description: Django + DRF (Python) and Socket.IO multiplayer specialist for nba-minigames. Use for API endpoints, models, auth, migrations in backend/, and the Node Socket.IO server in multiplayer_server/.
model: sonnet
effort: high
tools: Read, Write, Edit, Grep, Glob, Bash
color: green
---

You are the backend engine for the nba-minigames app.

Two services:
- `backend/` — Django + Django REST Framework. Apps: `users/` (auth, login/signup, profile, custom user + rank) and `trivia/` (minigame data + views). Entry: `manage.py`. DB: sqlite (`db.sqlite3`) in dev.
- `multiplayer_server/` — Node Socket.IO server (`src/index.js`), port 4000, for "Play Online".

Rules:
- Match existing patterns. Keep changes surgical.
- Use the venv at `backend/venv`. Run the API with `python manage.py runserver 8000`.
- After model changes: `python manage.py makemigrations` then `migrate`. Never edit applied migrations by hand.
- Verify with `python manage.py test` and `python manage.py check` before declaring done.
- Secrets come from env (`backend/.env`); never commit keys. Keep CORS/URLs working for the frontend (port 5173).
```

- [ ] **Step 3: Create `.claude/agents/code-reviewer.md`**

```markdown
---
name: code-reviewer
description: Read-only reviewer for nba-minigames. Use after code changes to audit diffs for correctness bugs, type errors, security issues, and style drift. Does not modify files.
model: opus
effort: high
tools: Read, Grep, Glob, Bash
disallowedTools: Write, Edit
color: purple
---

You are the code reviewer for nba-minigames. You never modify files — you report findings.

Review focus, in priority order:
1. Correctness bugs and broken logic.
2. TypeScript/type-safety issues; Django model/migration mistakes.
3. Security: auth, input validation, leaked secrets, unsafe socket events.
4. Reuse / simplification / dead code.
5. Style drift from the surrounding code.

Method:
- Inspect the diff first: `git --no-pager diff` and `git --no-pager diff --staged`.
- For each finding give: file:line, severity (blocker/major/minor/nit), what's wrong, and a concrete fix.
- Verify build/lint claims with `npm run lint`, `npx tsc -b`, and `python manage.py check` where relevant.
- Be specific and terse. No praise padding. If something is fine, say nothing.
```

- [ ] **Step 4: Create `.claude/agents/test-qa-engine.md`**

```markdown
---
name: test-qa-engine
description: Test and QA engine for nba-minigames. Use to write/run tests, lint, typecheck, and verify builds before changes land across frontend and backend.
model: sonnet
effort: high
tools: Read, Write, Edit, Bash, Grep, Glob
color: yellow
---

You are the test/QA engine for nba-minigames.

Verification commands:
- Frontend lint: `npm run lint`
- Frontend typecheck + build: `npx tsc -b` then `npm run build`
- Backend tests: `cd backend && python manage.py test`
- Backend sanity: `cd backend && python manage.py check`

Rules:
- Prefer adding tests next to existing ones; match the project's current test style. If a layer has no tests yet, scaffold the minimal idiomatic setup rather than introducing a heavy new framework.
- Always run the relevant commands and paste real output — never claim green without evidence.
- Keep changes surgical; don't refactor app code just to make testing easier unless the task asks.
- Report a short pass/fail summary with the exact commands run.
```

- [ ] **Step 5: Verify all four agent files have valid frontmatter with required fields**

Run:
```bash
for f in frontend-engine backend-engine code-reviewer test-qa-engine; do
  head -1 ".claude/agents/$f.md" | grep -q '^---$' && \
  grep -q '^name: ' ".claude/agents/$f.md" && \
  grep -q '^description: ' ".claude/agents/$f.md" && \
  echo "$f OK" || echo "$f FAIL";
done
```
Expected output:
```
frontend-engine OK
backend-engine OK
code-reviewer OK
test-qa-engine OK
```

- [ ] **Step 6: Verify the reviewer is read-only**

Run: `grep -n "disallowedTools: Write, Edit" .claude/agents/code-reviewer.md`
Expected: one match.

- [ ] **Step 7: Commit** (only if commits approved)

```bash
git add .claude/agents/
git commit -m "feat(claude): add frontend/backend/reviewer/test-qa engines"
```

---

### Task 4: Project guide (CLAUDE.md)

**Files:**
- Create: `CLAUDE.md` (repo root)

**Interfaces:**
- Produces: repo context loaded by every Claude Code surface (local/web/routines/CI) when it opens the repo.

- [ ] **Step 1: Create `CLAUDE.md`**

```markdown
# nba-minigames — Project Guide for Claude Code

NBA trivia minigames. Frontend: React 19 + TypeScript + Vite + Tailwind 4. Backend: Django + DRF. Realtime: Socket.IO server for multiplayer.

## Services & ports
- Django API — `backend/`, port **8000** (`python manage.py runserver 8000`)
- Socket.IO multiplayer — `multiplayer_server/`, port **4000** (`node src/index.js`)
- Vite + React frontend — repo root `src/`, port **5173** (`npm run dev`)

Single-player needs only the Django API; "Play Online" also needs the socket server.

## Common commands
- Install: `npm install` (frontend); `pip install -r backend/requirements.txt` (backend)
- Lint: `npm run lint`
- Typecheck + build: `npx tsc -b && npm run build`
- Backend tests: `cd backend && python manage.py test`
- Backend check: `cd backend && python manage.py check`

## Structure
- `src/` — components/, pages/, styles/, Game Renderers/, store/ (Redux Toolkit), hooks/, context/, constants/, motion/, utils/, socket.ts
- `backend/` — Django project; apps: users/ (auth, custom user, rank), trivia/ (minigame data)
- `multiplayer_server/` — Node Socket.IO server

## Conventions
- Surgical changes only — match existing style; don't refactor unrelated code.
- TypeScript strict; build must pass `tsc -b`.
- URLs/secrets come from env (`.env`, `backend/.env`); never hardcode or commit them.

## Coding engines & profiles
This repo defines coding subagents in `.claude/agents/` (frontend-engine, backend-engine, code-reviewer, test-qa-engine). Their model + reasoning effort are governed by a named profile. Switch the whole fleet with `npm run engine <fast|balanced|deep|max>`. See `.claude/README.md`.
```

- [ ] **Step 2: Verify it mentions the three ports and the engine command**

Run:
```bash
grep -Eq "8000" CLAUDE.md && grep -Eq "4000" CLAUDE.md && grep -Eq "5173" CLAUDE.md && grep -q "npm run engine" CLAUDE.md && echo "CLAUDE.md OK"
```
Expected output: `CLAUDE.md OK`

- [ ] **Step 3: Commit** (only if commits approved)

```bash
git add CLAUDE.md
git commit -m "docs(claude): add project guide for coding engines"
```

---

### Task 5: GitHub Actions workflow

**Files:**
- Create: `.github/workflows/claude.yml`

**Interfaces:**
- Consumes: `.claude/settings.json` (`env.CLAUDE_CODE_SUBAGENT_MODEL`, `env.CLAUDE_CODE_EFFORT_LEVEL`, `model`) from Tasks 1–2.
- Produces: a CI job that runs `anthropics/claude-code-action@v1` on `@claude` PR/issue comments and PR events, using the active profile's model + effort.

- [ ] **Step 1: Create `.github/workflows/claude.yml`**

```yaml
name: Claude Code

on:
  issue_comment:
    types: [created]
  pull_request_review_comment:
    types: [created]
  pull_request:
    types: [opened, synchronize]

jobs:
  claude:
    if: |
      github.event_name == 'pull_request' ||
      (github.event_name == 'issue_comment' && contains(github.event.comment.body, '@claude')) ||
      (github.event_name == 'pull_request_review_comment' && contains(github.event.comment.body, '@claude'))
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      issues: write
    steps:
      - uses: actions/checkout@v4

      - name: Resolve engine profile from .claude/settings.json
        id: profile
        run: |
          MAIN=$(node -e "console.log(JSON.parse(require('fs').readFileSync('.claude/settings.json','utf8')).model || 'opus')")
          MODEL=$(node -e "console.log(JSON.parse(require('fs').readFileSync('.claude/settings.json','utf8')).env.CLAUDE_CODE_SUBAGENT_MODEL || 'sonnet')")
          EFFORT=$(node -e "console.log(JSON.parse(require('fs').readFileSync('.claude/settings.json','utf8')).env.CLAUDE_CODE_EFFORT_LEVEL || 'high')")
          echo "main_model=$MAIN" >> "$GITHUB_OUTPUT"
          echo "subagent_model=$MODEL" >> "$GITHUB_OUTPUT"
          echo "effort=$EFFORT" >> "$GITHUB_OUTPUT"
          echo "Active engine: main=$MAIN subagent=$MODEL effort=$EFFORT"

      - uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          claude_args: --model ${{ steps.profile.outputs.main_model }} --effort ${{ steps.profile.outputs.effort }}
        env:
          CLAUDE_CODE_SUBAGENT_MODEL: ${{ steps.profile.outputs.subagent_model }}
          CLAUDE_CODE_EFFORT_LEVEL: ${{ steps.profile.outputs.effort }}
```

- [ ] **Step 2: Verify the workflow is valid YAML and the extraction snippet works**

Run (YAML parse via Node, then prove the extraction logic against the committed settings):
```bash
node -e "const fs=require('fs');const y=fs.readFileSync('.github/workflows/claude.yml','utf8');if(!y.includes('anthropics/claude-code-action@v1'))throw new Error('action missing');if(!y.includes('CLAUDE_CODE_SUBAGENT_MODEL'))throw new Error('subagent env missing');console.log('workflow refs OK')"
node -e "const s=require('./.claude/settings.json');console.log('extract:',s.model,s.env.CLAUDE_CODE_SUBAGENT_MODEL,s.env.CLAUDE_CODE_EFFORT_LEVEL)"
```
Expected output:
```
workflow refs OK
extract: opus sonnet high
```

- [ ] **Step 3: Commit** (only if commits approved)

```bash
git add .github/workflows/claude.yml
git commit -m "ci(claude): add GitHub Actions workflow honoring the engine profile"
```

---

### Task 6: Operator docs (.claude/README.md + routines guide)

**Files:**
- Create: `.claude/README.md`
- Create: `.claude/routines/README.md`

**Interfaces:**
- Produces: the human-facing operating manual: how to switch profiles, how each surface picks it up, the `max`-effort caveat, and the one-time account steps (GitHub secret, routine creation).

- [ ] **Step 1: Create `.claude/README.md`**

````markdown
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
````

- [ ] **Step 2: Create `.claude/routines/README.md`**

````markdown
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
````

- [ ] **Step 3: Verify both docs exist and reference the switch command + account steps**

Run:
```bash
grep -q "npm run engine" .claude/README.md && \
grep -q "ANTHROPIC_API_KEY" .claude/README.md && \
grep -q "Nightly health check" .claude/routines/README.md && \
echo "docs OK"
```
Expected output: `docs OK`

- [ ] **Step 4: Final full verification sweep**

Run:
```bash
node .claude/use-profile.mjs            # status
node -e "['profiles.json','settings.json'].forEach(f=>JSON.parse(require('fs').readFileSync('.claude/'+f,'utf8')));console.log('json OK')"
ls .claude/agents/*.md | wc -l          # expect 4
test -f .github/workflows/claude.yml && echo "workflow present"
test -f CLAUDE.md && echo "guide present"
```
Expected: status prints `Active profile: balanced`; `json OK`; `4`; `workflow present`; `guide present`.

- [ ] **Step 5: Commit** (only if commits approved)

```bash
git add .claude/README.md .claude/routines/README.md
git commit -m "docs(claude): add engine operating manual and routines guide"
```

---

## Self-Review (completed by plan author)

**Spec coverage:**
- §4 file layout → Tasks 1–6 create every listed file. ✅
- §5 profiles (fast/balanced/deep/max) → Task 1 Step 1. ✅
- §6.1 settings.json → Task 1 Step 2. ✅ §6.2 profiles.json → Task 1 Step 1. ✅ §6.3 switcher → Task 2. ✅
- §7.1 four engines → Task 3. ✅ §7.2 web (no extra files, documented) → Task 6 README table. ✅
- §7.3 GitHub Actions extraction → Task 5. ✅ §7.4 routines doc → Task 6. ✅
- §8 propagation table → Task 6 README. ✅
- §9 verification → verification steps in every task + Task 6 Step 4 sweep. ✅
- §5 `max` caveat (no silent downgrade) → Task 2 Step 6 + Task 6 README caveat section. ✅
- §11 account-side steps → Task 6 README + routines guide. ✅
- gitignore `.claude/settings.local.json` → Task 1 Step 4. ✅
- package.json `engine` script → Task 2 Step 2. ✅

**Placeholder scan:** No TBD/TODO; every file's full content is inline; every verification step has an exact command + expected output. ✅

**Type/name consistency:** `profiles.json` keys `subagentModel`/`effort` are read identically in `use-profile.mjs` (Task 2) and the workflow reads `env.CLAUDE_CODE_SUBAGENT_MODEL`/`env.CLAUDE_CODE_EFFORT_LEVEL`/`model` (Task 5) exactly as written by Tasks 1–2. Profile name set `fast/balanced/deep/max` is identical across Tasks 1, 2, 6. ✅
