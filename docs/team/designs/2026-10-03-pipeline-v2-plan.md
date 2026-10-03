# Pipeline v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the team pipeline into the v2 loop: scripts for every mechanical step, one brief per card, resume-based fix rounds, scoped QA, hard-only design rounds, tiered models, two lanes.

**Architecture:** New `scripts/team/*.mjs` CLIs (intake, brief, verify, qa, review-package) built on small pure libs under `scripts/team/lib/` with `node:test` tests. The `team-run` skill becomes a thin orchestrator that calls those scripts and spawns agents with file pointers; agents are resumed with `SendMessage` on failures. Per-card state lives in `.team/run/<slug>/`.

**Tech Stack:** Node 20 ESM (`.mjs`), `node:test`, Playwright via `scripts/qa-browser.mjs`, existing `scripts/notion.mjs` / `scripts/slack.mjs` / `scripts/ui-audit.mjs`.

**Spec:** `docs/team/designs/2026-10-03-pipeline-v2-loop-architecture.md`

## Global Constraints

- No new npm dependencies (plain Node; tests with `node --test`).
- Scripts run on Windows (local, PowerShell launcher) and Linux (`TEAM_CLOUD=1`); use `path`, `process.platform`, never shell-specific syntax inside Node.
- QA ports: lane 1 = 5273/8100/4100, lane 2 = 5274/8101/4101. Never 5173/8000/4000.
- Verify output and QA failures are capped at 100 lines before they reach an agent.
- Model names in skill/agent text are the rolling aliases `fable|opus|sonnet|haiku`, set explicitly on every spawn.
- Fix loop caps: 3 rounds per gate (round 3 = fresh engine one model up), 1 replan, breaker on zero files changed or same first error twice.
- Budgets: trivial 10, standard 25, hard 45 minutes; `maxRunMinutes` 90 stays.
- Nothing sets a Notion card to Done; ship = fast-forward push to dev; never `--force`.

## Review Focus

1. A spec whose "numbered steps" are a prose list ("1. we want… 2. maybe…") with no file names must NOT be treated as a plan → `detectSteps` requires a backtick path or a `src/`/`backend/` token in ≥ half the steps (test in Task 3).
2. A diff touching only `docs/**` must skip verify's frontend checks, QA entirely, and the motion reviewer (test in Task 5).
3. A rule whose heading is `### RULE 4.2 acceptance test` must not be mistaken for rule `4.2` itself (test in Task 4).
4. `failuresOnly` on a passing `eslint` run (empty output) and on a tsc run with 300 errors must return `""` and ≤100 lines respectively (test in Task 6).
5. `pickNext` must never start a `hard` card with 40 minutes left, and must never run two lanes whose touched areas overlap (test in Task 7).

---

### Task 1: Phase A text changes (settings, agents, skills, cards)

**Files:**
- Modify: `.claude/settings.json`
- Modify: `.claude/agents/code-reviewer.md` (method section), `.claude/agents/motion-reviewer.md` (trigger line), `.claude/skills/classify/SKILL.md` (difficulty rubric), `.claude/skills/team-run/SKILL.md` (review/motion lines — superseded by Task 11's rewrite, so only the card updates are durable here)
- Notion: set Difficulty=standard on the 10 detailed UI cards.

- [ ] Step 1: `.claude/settings.json` → add `"subagentPromptCacheTtl": "1h"` next to `model`.
- [ ] Step 2: classify rubric: add under **standard**: "A spec whose body already lists numbered steps naming files (the owner's detailed tickets) is `standard` even when it spans several files, unless it is security/protocol/data-regeneration work. `needsDesignRound` is then `false`; the brief copies the steps." Keep "owner Difficulty override wins".
- [ ] Step 3: code-reviewer: replace "Verify build/lint claims with `npm run lint`…" with "Read `.team/run/<slug>/verify.json` for the check results; never re-run lint/tsc/build/tests yourself — verify already did. Review the diff in `.team/run/<slug>/review-package.md`." Add model line: "Model: `sonnet` for trivial/standard risk-low P1/P2; `fable` for P0, risk high, hard, security, protected paths."
- [ ] Step 4: motion-reviewer: trigger = diff touches `src/motion/**`, adds/changes a `framer-motion` import, or adds CSS `transition`/`animation`/`@keyframes`.
- [ ] Step 5: `node scripts/notion.mjs set-props <id> --difficulty standard` for: Who Would Win, LeContexto result, Found counts, Friends text swap, Wordle card, daily game, hero pill, Tic-Tac-Toe, Feedback animation, Auth modal. Leave hard: ban/text moderation, photo moderation, motion audit, constraints cleanup.
- [ ] Step 6: Commit `pipeline: phase A — cache ttl, reviewer reads verify.json, motion trigger, classify steps rule`.

### Task 2: Routine environment setup script

**Files:**
- Create: `infra/routine/setup.sh`
- Modify: `docs/team/PIPELINE.md` §13 (replace "Routine configuration" paragraph; add "Setup script" paragraph).

**Interfaces:** Produces `backend/.venv`, `node_modules`, Playwright Chromium under `$PLAYWRIGHT_BROWSERS_PATH` (default `/opt/pw-browsers`), `backend/qa.sqlite3` migrated.

- [ ] Step 1: Write `infra/routine/setup.sh`:
```bash
#!/usr/bin/env bash
# Routine environment setup — paste into the routine's "Setup script" at claude.ai/code/routines.
# Cached as a filesystem snapshot when it finishes in ~5 min; keep it lean.
set -euo pipefail
cd "$(dirname "$0")/../.." 2>/dev/null || true
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}"
npm ci --no-audit --no-fund
node node_modules/playwright-core/cli.js install chromium || echo "chromium install failed (QA will skip)"
python3 -m venv backend/.venv
backend/.venv/bin/pip install -q -r backend/requirements-web.txt -r backend/requirements-pipeline.txt 2>/dev/null \
  || backend/.venv/bin/pip install -q -r backend/requirements.txt
( cd backend && NBA_SQLITE_PATH=qa.sqlite3 DATABASE_URL= ../backend/.venv/bin/python manage.py migrate --noinput -v 0 )
# The routine's global Stop hook fires on every orchestrator turn while an engine is mid-edit; silence it for pipeline runs.
if [ -f "$HOME/.claude/stop-hook-git-check.sh" ] && ! grep -q TEAM_CLOUD "$HOME/.claude/stop-hook-git-check.sh"; then
  sed -i '1a [ "${TEAM_CLOUD:-}" = "1" ] && exit 0' "$HOME/.claude/stop-hook-git-check.sh"
fi
echo SETUP_OK
```
  (`NBA_SQLITE_PATH` is honored only if `backend/*/settings.py` reads it — Task 2 Step 2 checks; if not, drop that env and let it migrate the default `db.sqlite3`.)
- [ ] Step 2: `grep -n "db.sqlite3" backend/*/settings.py`; if no env override exists, remove `NBA_SQLITE_PATH=qa.sqlite3` from the script (QA uses the default dev sqlite).
- [ ] Step 3: PIPELINE.md §13: document the script, the Playwright CDN allowlist (`playwright.azureedge.net`, `playwright-akamai.azureedge.net`, `playwright-verizon.azureedge.net`), and that the workspace step no longer installs anything.
- [ ] Step 4: Commit `pipeline: routine setup script (cached deps, chromium, sqlite, stop-hook guard)`.

### Task 3: `lib/steps.mjs` — detect a spec that is already a plan

**Files:**
- Create: `scripts/team/lib/steps.mjs`, `scripts/team/lib/steps.test.mjs`

**Interfaces:** `detectSteps(specText: string) → { hasPlan: boolean, steps: Array<{ n: number, text: string, files: string[] }> }`. `hasPlan` is true when ≥3 numbered steps exist and ≥50% name a file (`` `path` `` with `/` or a token starting `src/`, `backend/`, `scripts/`, `docs/`, `multiplayer_server/`).

- [ ] Step 1: Test:
```js
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { detectSteps } from './steps.mjs';
test('numbered steps naming files are a plan', () => {
  const r = detectSteps('## What to build\n1. Edit `src/views/Friends.tsx`: wrap label in SwapText\n2. In `src/styles/Friends.css` reserve width\n3. Add test in `scripts/lib/x.test.mjs`\n');
  assert.equal(r.hasPlan, true); assert.equal(r.steps.length, 3); assert.deepEqual(r.steps[0].files, ['src/views/Friends.tsx']);
});
test('prose list without files is not a plan', () => {
  assert.equal(detectSteps('1. we want it nicer\n2. maybe animate\n3. ask the owner').hasPlan, false);
});
test('two steps are not a plan', () => { assert.equal(detectSteps('1. `src/a.ts` x\n2. `src/b.ts` y').hasPlan, false); });
```
- [ ] Step 2: Run `node --test scripts/team/lib/steps.test.mjs` → fails (module missing).
- [ ] Step 3: Implement: split lines, match `/^\s*(\d+)[.)]\s+(.*)$/`, collect files via `/`([^`]+\/[^`]+)`/g` and `/\b((?:src|backend|scripts|docs|multiplayer_server)\/[\w./\-\[\] ]+)/g`; multi-line continuation (indented lines) appended to the previous step.
- [ ] Step 4: Tests pass. Commit `pipeline: steps detector`.

### Task 4: `lib/rules.mjs` — extract and select constraint rules

**Files:**
- Create: `scripts/team/lib/rules.mjs`, `scripts/team/lib/rules.test.mjs`

**Interfaces:** `extractRules(docText) → Array<{ id: string, heading: string, body: string }>` where a rule is a `##`/`###` heading matching `/^#{2,3}\s+(?:RULE|Rule)\s+([A-Z]+-\d+|\d+(?:\.\d+)?[a-z]?)\b(?!\s+acceptance)/`; body runs to the next heading of the same or higher level. `selectRules(rules, keywords: string[], { max = 8 }) → rules` whose heading or body contains any keyword (case-insensitive), ranked by hit count, ties by document order. `ruleIndex(rules) → string` one line per rule: `- RULE <id> — <heading text>`.

- [ ] Step 1: Tests: heading `### RULE 4.2 acceptance test` is not a rule; `## Rule UI-4: One CSS file…` yields id `UI-4`; `## RULE 0 — Your root…` yields `0`; selectRules with keywords `['ScorePanel']` returns the rule containing it first; `max` is honored.
- [ ] Step 2: Run → fail. Step 3: implement. Step 4: pass. Commit `pipeline: rules extractor`.

### Task 5: `lib/touched.mjs`, `lib/qa-map.mjs`, `.claude/team/qa-map.json`

**Files:**
- Create: `scripts/team/lib/touched.mjs`, `scripts/team/lib/touched.test.mjs`, `scripts/team/lib/qa-map.mjs`, `scripts/team/lib/qa-map.test.mjs`, `.claude/team/qa-map.json`

**Interfaces:**
- `classifyTouched(files: string[]) → { frontend, backend, multiplayer, docsOnly, motion, protected, games: string[] }` — `games` from `src/Game Renderers/<Name>.tsx` via a name→id map (`CareerPath`→`career-path`, `WhoAreYa`→`who-are-ya`, `StartingFive`→`starting-five`, `FanFavorites`→`fan-favorites`, `TicTacToe`→`tictactoe`, `Contexto`→`contexto`, `BingoGame`→`bingo`, `HeatmapGame`→`heatmap`, `SeriesWinner`→`series-winner`, `NameLogo`→`name-logo`, `Mvps`→`mvps`, `Connections`→`connections`, `WhoWouldWin`→`who-would-win`, `Wordle`→`wordle`); verify the list against `src/utils/GameUtils.tsx` ids during implementation. `motion` = any path under `src/motion/` or `src/components/motion/`, or (when `diffText` is given) a `+` line with `framer-motion`, `transition:`, `animation:`, `@keyframes`. `protected` = paths under `backend/users/`, `backend/*/settings.py`, `backend/trivia/data_pipeline/`, `multiplayer_server/src/`, `src/utils/Api.tsx`, `src/app/providers.tsx`, `.github/workflows/`.
- `touchedFiles(repoDir, baseSha) → string[]` via `git diff --name-only <base>...HEAD` plus uncommitted (`git diff --name-only`, `git ls-files --others --exclude-standard`).
- `resolveQa(files, map) → { games: string[]|'*', routes: string[], backend: boolean }`; map entries are globs (`**` and `*`) → `{ game?, games?: '*', routes?: string[], backend?: boolean }`; shared components expand `games` to `'*'`.

- [ ] Step 1: Tests: docs-only diff → `docsOnly: true`, `frontend: false`; `src/components/ScorePanel.tsx` → `games: '*'`, routes `['/']`; `backend/users/views.py` → `backend: true`, `protected: true`, routes `['/profile','/leaderboard']`; CareerPath diff → games `['career-path']`.
- [ ] Step 2: `qa-map.json` initial content: every renderer → its game + `/<id>` route; `src/components/ui/**`, `src/components/motion/**`, `src/components/GameFrame.tsx`, `src/components/EndSequence.tsx`, `src/components/ScorePanel.tsx`, `src/components/GameResult.tsx`, `src/styles/ui.css`, `src/styles/MiniGame.css` → `games: '*'`, routes `['/']`; `src/views/Leaderboard*` → `/leaderboard`; `src/views/Profile*`, `src/views/Friends*` → `/profile`, `/friends`; `src/views/LandPage*`, `src/app/page.tsx` → `/`; `src/components/modals/**` → `/`; `backend/users/**` → `/profile`,`/leaderboard`, backend; `backend/trivia/**` → `/`, backend. Check real view filenames with `ls src/views` while writing it.
- [ ] Step 3: implement, tests pass. Commit `pipeline: touched-file classifier and QA route map`.

### Task 6: `lib/output.mjs` and `scripts/team/verify.mjs`

**Files:**
- Create: `scripts/team/lib/output.mjs`, `scripts/team/lib/output.test.mjs`, `scripts/team/verify.mjs`

**Interfaces:**
- `failuresOnly(text, max = 100) → string`: keeps lines matching `/error|fail|✖|×|Traceback|AssertionError|ERROR|FAILED|Type error|TS\d{4}/i` plus the 2 lines after each; dedupes; if nothing matches but exit code was non-zero the caller passes `{ fallbackTail: true }` to keep the last 40 lines; hard cap `max` lines with a final `… (+N more lines)`.
- CLI: `node scripts/team/verify.mjs <slug> --base <sha> [--repo <dir>]` → runs, in the repo dir, only what the touched set needs: frontend → `npm run lint`, `npx next typegen && npx tsc --noEmit`, `npm run build`; backend → `<venv python> manage.py check` and `manage.py test users trivia` with `DATABASE_URL=""`; multiplayer → `node --check multiplayer_server/src/index.js`. Writes `.team/run/<slug>/verify.json`: `{ pass, ran: [{cmd, ms, exit}], failures: "<failuresOnly text>", touched, at }`. Exit 0/1. Prints the JSON.
- Venv path: `backend/.venv/Scripts/python.exe` on win32 else `backend/.venv/bin/python`; fall back to `backend/venv/...` (the older name used by test-qa-engine.md), then `python`.

- [ ] Step 1: Tests for `failuresOnly` (empty → `""`; 300 `error TS2322` lines → ≤100 lines and ends with `… (+N more lines)`; context lines kept).
- [ ] Step 2: implement lib + CLI (`child_process.spawnSync` with `shell: true` on win32 for `npm`/`npx`).
- [ ] Step 3: Smoke on the repo itself: `node scripts/team/verify.mjs smoke --base HEAD~0` with a fake `touched` override `--touched docs/x.md` → `pass: true`, `ran: []`. Then `--touched src/x.tsx` → runs the three frontend commands (expect pass on dev). Commit `pipeline: verify script`.

### Task 7: `lib/budget.mjs` and `scripts/team/intake.mjs`

**Files:**
- Create: `scripts/team/lib/budget.mjs`, `scripts/team/lib/budget.test.mjs`, `scripts/team/intake.mjs`

**Interfaces:**
- `tierBudget(tier) → 10|25|45` (unknown → 25).
- `areasOf(card) → Set<string>`: from `card.category` (`frontend`→{frontend}, `backend|CI/CD|AI|pipeline`→{backend}, `fullstack`→{frontend,backend}, `docs`→{docs}) ∪ game id if the title contains a known game name.
- `pickNext(queue, remainingMin, { lanes = 2, running = [] }) → card[]`: queue already sorted (P0 first, oldest first). Returns up to `lanes - running.length` cards: the first card whose `tierBudget(card.difficulty||'standard') <= remainingMin`, then a second whose areas are disjoint from the first's and from `running[*].areas` and whose budget also fits. A `hard` card never shares a run tick with another card.
- CLI `node scripts/team/intake.mjs --remaining <min> [--only <pageId>] [--running <slug,...>]`: runs `check-pause` (exit 3 → prints `{"paused":true}` and exits 3), stale sweep (as team-run §0), `poll-reactions`, `list-todo`, then `pickNext`; for each pick writes `.team/run/<slug>/card.json` = list-todo row + `spec` (get-spec text) + `attachments[]` (parsed `[Image attached: …]`) + `tier` + `budgetMin` + `slug`; prints `{ picks: [...], leftTodo }`. `--only` filters the queue to that page id (smoke runs). `slug` = kebab-case title ≤30 chars, de-duplicated against `.team/run/*`.

- [ ] Step 1: Tests: hard card with 40 min left is skipped and the next standard card is picked; two frontend cards are not paired; frontend+backend are paired; `--running` areas block a pick; `lanes:1` returns one.
- [ ] Step 2: implement; smoke `node scripts/team/intake.mjs --remaining 90 --only 3ee2cfb1-c595-81b9-8301-c4ed85094f10` (Friends text swap) → one pick, `card.json` written, tier `standard`.
- [ ] Step 3: Commit `pipeline: intake script with tier budgets and lane picking`.

### Task 8: `scripts/team/brief.mjs`

**Files:**
- Create: `scripts/team/brief.mjs`, `scripts/team/lib/state.mjs`

**Interfaces:**
- `state.mjs`: `runDir(slug)`, `readJson(path, fallback)`, `writeJson(path, obj)`, `readState(slug)`/`writeState(slug, patch)` on `.team/run/<slug>/state.json` `{ slug, pageId, stage, tier, lane, baseSha, branch, startedAt, fixRounds: {verify:0, qa:0, review:0}, replanned:false, engineAgentIds: {}, lastFirstError: null }`.
- CLI `node scripts/team/brief.mjs <slug>` reads `card.json` and `classify.json` (written by the orchestrator from the classify agent's JSON) and writes `brief.md`:
  1. `# Brief — <title>` + card props line (priority, tier, areas, risk, engine model).
  2. `## Spec` verbatim + `## Attachments` list.
  3. `## Plan` — if `detectSteps(spec).hasPlan`: the steps verbatim, each prefixed `[sonnet]` (or `[opus]` when classify.engineModel is opus); else `_No numbered steps in the spec — orchestrator: ask sonnet to write 5–12 steps into this section before build._` and a `## Plan status: needs-plan` marker; for `hard` cards: `See design doc: <path>` once the orchestrator passes `--design <path>`.
  4. `## Rules that apply` — for each doc in `classify.docs`: `ruleIndex` (all rule ids one line each) then the full text of `selectRules(rules, keywords, {max: 8})` where keywords = CODE_MAP hit basenames + file basenames from the plan + game ids + words from the title ≥5 letters.
  5. `## Reuse (CODE_MAP hits)` verbatim from classify.
  6. `## Files named` — first 40 lines of each existing file the plan names (max 6 files).
  7. `## Test plan` — commands verify will run (from `classifyTouched` of the plan's files) and `## QA assertions` — a fenced JSON array the engine/planner fills: `[{ "route": "/friends", "selector": ".copy-btn", "expect": "text:Copied!" }]` (empty `[]` by default).
  8. Footer: "Read this file first. The constraint docs above are reference; open a section only when a rule here points to it."
  Writes `state.stage = 'build'`. Prints `{ brief, hasPlan, needsPlan, lines }`. Hard cap 400 lines (truncate `## Files named` first).

- [ ] Step 1: Run against the Friends card from Task 7 with a hand-written `classify.json` → brief has Plan from steps, rules UI-4/UI-20/SwapText entries, ≤400 lines.
- [ ] Step 2: Commit `pipeline: brief builder`.

### Task 9: `scripts/team/qa.mjs`

**Files:**
- Create: `scripts/team/qa.mjs`
- Modify: `.claude/team/config.json` → `"qaPorts": { "lanes": [ {"django":8100,"socket":4100,"vite":5273}, {"django":8101,"socket":4101,"vite":5274} ] }` (keep the old flat keys for one release; `team-config.mjs` reads lanes if present).

**Interfaces:** CLI `node scripts/team/qa.mjs <slug> --base <sha> [--lane 1|2] [--repo <dir>]`:
1. `touched = touchedFiles(repo, base)`; `cls = classifyTouched(touched)`; if `cls.docsOnly` → write verdict `{pass:true, skipped:'docs-only'}` and exit 0.
2. `plan = resolveQa(touched, qaMap)`.
3. Start Django on `lane.django` only if `plan.backend` (`DATABASE_URL="" NBA_DEV_ENV_SKIP=1 <python> manage.py runserver <port> --noreload`), start Next dev on `lane.vite` with `NBA_DEV_ENV_SKIP=1 VITE_BACKEND_URL=http://localhost:<django>` (if no backend, point at `devSiteUrl`'s backend? No: use `http://localhost:<django>` only when started; otherwise leave `VITE_BACKEND_URL` unset so the committed `.env` default applies). `waitForServer` 90 s each.
4. If `plan.games.length || plan.games === '*'` → `node scripts/ui-audit.mjs --url http://localhost:<vite> --label qa-<slug> [--only <ids>]` at the three viewports (`npm run ui:audit` shapes). Non-zero exit → failures = its stdout lines containing `✖`/`FAIL`/`assert` (max 40).
5. Route smoke via `qa-browser.mjs`: for each route at 390×844 and 1100×900 — `openApp`, wait `networkidle` ≤15 s, collect `console.error` and `pageerror`, assert `main` or `.page` exists, `shot(page, slug, '<route>-<w>')`.
6. Assertions from `brief.md` `## QA assertions` JSON: `expect` forms `text:<substring>`, `count>=N`, `visible`.
7. `writeVerdict(slug, pass, failures, notes)`; always kill started processes (by pid, and on win32 `taskkill /T /F`); exit 0/1; print the verdict.

- [ ] Step 1: Implement. Smoke locally on dev with `--base HEAD~3` (the Career Path commit) → audit runs `--only career-path`, smoke `/career-path`, verdict written under `.team/qa/<slug>/`.
- [ ] Step 2: Commit `pipeline: deterministic QA runner (scoped audit, route smoke, brief assertions, lanes)`.

### Task 10: `scripts/team/review-package.mjs`

**Files:**
- Create: `scripts/team/review-package.mjs`

**Interfaces:** CLI `node scripts/team/review-package.mjs <slug> --base <sha> [--repo <dir>] [--since <sha>]` writes `.team/run/<slug>/review-package.md`: header (title, tier, risk, engine models), `## Verify` (verify.json summary), `## QA` (verdict summary + screenshot paths), `## Commits` (`git log --oneline base..HEAD`), `## Stat`, `## Diff` (`git diff base...HEAD`, or `since...HEAD` for a scoped re-review), and `## Brief` → path. Prints `{ path, files, insertions, deletions, motion: cls.motion, protected: cls.protected, reviewModel }` where `reviewModel = 'fable'` if `priority==='P0' || risk==='high' || tier==='hard' || cls.protected` else `'sonnet'`.

- [ ] Step 1: Implement; smoke on dev `--base HEAD~3`. Commit `pipeline: review package builder`.

### Task 11: Skills and agents for v2

**Files:**
- Rewrite: `.claude/skills/team-run/SKILL.md`
- Modify: `.claude/skills/design-round/SKILL.md` (hard-only, one pass, no proposals/sign-off, 10-min cap, plan tags, `## QA assertions` block), `.claude/skills/classify/SKILL.md` (model line → sonnet), `.claude/agents/planner-architect.md` (`model: sonnet`; design round spawned with `model: fable` explicitly), `.claude/agents/frontend-engine.md` + `backend-engine.md` ("Required reading" → "Read `.team/run/<slug>/brief.md` first; the brief quotes the rules; open a constraint doc only when the brief points to a section"; end with `build-report.json` `{did, assumed, touched[], testsAdded[]}`), `.claude/agents/browser-qa.md` (flows only; gets verdict-so-far), `.claude/agents/code-reviewer.md` (`model: sonnet` default; Fable condition stated).
- Delete: `.claude/agents/test-qa-engine.md`.

team-run v2 content (the orchestrator's contract):
```
## Model policy  → copy §9.1 table from the design doc, condensed.
## 0. Run start → read cfg; start time; `node scripts/team/intake.mjs --remaining <left>`; paused → stop.
## 1. Lanes → up to 2 picks; each pick = its own worktree (local: cfg.worktreeRoot\<slug>; cloud: ../wt-<slug> with `ln -s $PWD/node_modules`) on branch team/<slug> from origin/dev; record baseSha. Shared node_modules; never npm ci in the worktree.
## 2. Card flow (per lane, in order)
  classify → Agent(model: sonnet, planner-architect) with card.json path → write classify.json → `node scripts/notion.mjs claim`.
  brief → `node scripts/team/brief.mjs <slug>`; if needsPlan → Agent(model: sonnet) "write 5–12 steps into ## Plan of brief.md, each naming files and a done-check; fill ## QA assertions". Hard → Agent(model: fable, design-round) → `brief.mjs <slug> --design <path>`.
  build → one Agent per area with model per plan tags/tier (table), prompt = "Read `.team/run/<slug>/brief.md`. Implement steps N–M. Do not read full constraint docs. Finish by writing build-report.json." Two areas with disjoint files → spawn both in parallel. KEEP the agent ids in state.engineAgentIds.
  gate 1 → `node scripts/team/verify.mjs <slug> --base <sha> --repo <wt>`; fail → fix round (below).
  gate 2 → `node scripts/team/qa.mjs <slug> --base <sha> --lane <n> --repo <wt>`; if brief's QA assertions mention a flow (`"flow":` key) → Agent(model: sonnet, browser-qa) with verdict-so-far; fail → fix round.
  review → `node scripts/team/review-package.mjs …` → Agent(model: <reviewModel>, code-reviewer) + (motion ? Agent(model: opus, motion-reviewer)) in parallel; blocker/major → fix round; minor → commit body.
  ship → ship skill (unchanged contract) with `--repo <wt>`.
## 3. Fix round (gate g)
  state.fixRounds[g] += 1. Round 1–2: SendMessage(to: engineAgentIds[area], failures text ≤100 lines + screenshot paths) → wait → re-run the gate. Round 3: new Agent one model up (sonnet→opus; opus→opus with design doc attached) with brief + all findings. Round 4 → fail procedure.
  Breaker: after a round, `git diff --stat` empty, or verify.json first failure line == state.lastFirstError → fail now (`reason: "no progress"`).
  Two failures at the same gate → one replan (Agent model = plan's model) rewriting ## Plan; reset that gate's counter once (state.replanned=true).
## 4. Fail procedure → unchanged from v1 (post-mortem, fail-card, RETRO, Slack, cleanup).
## 5. End of run → unchanged (run-summary, Slack).
## Hard rules → unchanged list.
```
- [ ] Step 1: Write the skill (≤180 lines) and the agent/skill edits above. Delete `test-qa-engine.md`; grep the repo for `test-qa-engine` and update references (`docs/team/PIPELINE.md`, `.claude/README.md`).
- [ ] Step 2: `node --test scripts/team/lib/` passes; `node scripts/team/intake.mjs --remaining 90 --only <friends id>` still works.
- [ ] Step 3: Commit `pipeline: team-run v2 — thin orchestrator, brief, resume fix loop, lanes; retire test-qa-engine`.

### Task 12: Docs

**Files:**
- Modify: `docs/team/PIPELINE.md` (§1 flow, §7 where things live `.team/run/`, §13 setup script, §14 model policy → point to design §9), `docs/team/DECISIONS.md` (entry "2026-10-03 — Pipeline v2: scripts for mechanical steps, briefs, resume loop, tiered models"), `CLAUDE.md` (pipeline paragraph: one sentence on `.team/run/<slug>/brief.md`).

- [ ] Step 1: Edit; commit `docs(team): pipeline v2`.

### Task 13: Acceptance — local smoke run on one card

- [ ] Step 1: Create a trivial test card: `node scripts/notion.mjs create-card 'Pipeline v2 smoke: add a line to docs/team/RETRO.md header' --category docs --priority P2 --difficulty trivial --body 'Add the sentence "Post-mortems are appended by the fail procedure of the team pipeline." under the first heading of docs/team/RETRO.md. Nothing else.'`
- [ ] Step 2: `TEAM_ONLY=<id> npm run team` (team-run.ps1 passes the env through; intake honors `TEAM_ONLY` as `--only`). Watch `.team/logs/run-*.log`.
- [ ] Step 3: Expect: intake → classify (sonnet) → brief (no plan needed: trivial) → haiku engine → verify skipped (docs-only) → QA skipped (docs-only) → sonnet review → shipped to dev. Record time and token usage per spawn from the log into DECISIONS.md.
- [ ] Step 4: If it fails, fix forward and re-run once; report the result honestly.
