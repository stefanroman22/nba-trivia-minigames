# Checks Phase A — UI check on prod code, fixes to prod, Notion cards, pipeline support

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The UI check audits `origin/main` in a worktree (plus a read-only live subset), its findings become deduplicated, grouped Notion cards the team pipeline can fix with `verify.mjs` as its QA gate, and checker fixes ship to `main` with a back-merge to `dev`.

**Architecture:** Shared modules move to `scripts/check-core/` (ui-check re-exports them). A `checkout` helper builds a prod-mode worktree of any ref; the stack takes `repo` and `ports`. `notion-push.mjs` turns validated findings into cards with a `Source` fingerprint property for dedupe and a `findings.json` attachment the pipeline's brief and QA consume. The `ship` skill and `ui-fix` gain a `Target = main` hotfix path.

**Tech Stack:** Node ≥20 ESM `.mjs`, existing `scripts/ui-check` harness (Playwright 1.62.1), `scripts/notion.mjs` (Notion REST), git worktrees, PowerShell Task Scheduler scripts (Phase B).

**Spec:** `docs/superpowers/specs/2026-10-15-checks-prod-logic-design.md` §1–§3 (binding); §4–§8 inform interfaces so Phase B needs no rework.

## Global Constraints

- Plain ESM `.mjs` under `scripts/check-core/` and `scripts/ui-check/`; every existing `scripts/ui-check` import path keeps working (re-export shims), all 15 selftests and `catalog.mjs` stay green after every task.
- Never write to the live site: `--live` runs guest `@live` checks GET-only with no accounts; `mint_tokens.py` keeps refusing non-sqlite databases.
- Money: no paid service, no Railway deploy, no GitHub Actions minutes beyond what already runs. Relay changes are parked for the owner.
- Ports: checker prod stack 8200/4200/5374, dev 8000/4000/5173; pipeline lanes 8100/4100/5273 and 8101/4101/5274 via `--ports django=…,socket=…,web=…`. Never kill a process the helper did not start.
- Worktrees live under `worktreeRoot` from `.claude/team/config.json` (`C:\Users\stefa\.team-worktrees`), named `check-<ref>`; never build checker runs in the main checkout except `--ref .`.
- Notion: token from `.env.team` via `loadEnvTeam()`; new properties `Source` (rich_text) and `Target` (select dev|main) are added by `migrate-v3` only; cards are created with Status `To Do`; dry-run mode (`--dry-run`) prints the cards and touches nothing. Never create a card without a `Source`.
- Commit messages: one short plain line, no `Co-Authored-By` or AI attribution trailer.
- Do not modify `src/`, `backend/`, `multiplayer_server/` in Tasks 1–5.

## Review Focus

1. `ensureCheckout` on a dirty worktree or a ref that moved → re-detaches cleanly and re-runs `npm ci` only when `package-lock.json` changed; a junction that already exists is reused.
2. Two concurrent stacks (pipeline lane + checker) → `stack.json` entries are keyed by ports so `--stop` of one never kills the other.
3. `notion-push` on a run already pushed → zero new cards, at most one "seen again" comment per card per run; a `Source` fingerprint whose card is Done and shipped → a Regression card (one, not per finding).
4. `qa.mjs` with a `verify` assertion when the attachment is missing or the stack can't come up → FAIL with a clear line, never a silent pass.
5. `ship` with `Target = main` when `main` moved since the branch → rebase, re-verify, push; the back-merge PR to `dev` conflicts → stop, report, leave `main` shipped.

---

### Task 1: check-core extraction, checkout helper, stack `repo`/`ports`, `--ref`, `--from`

**Files:**
- Create: `scripts/check-core/lib/{home,stack,accounts,findings,checkout,ports}.mjs`, `scripts/check-core/lib/mint_tokens.py` (moved), `scripts/check-core/README.md`
- Modify: `scripts/ui-check/lib/{home,stack,accounts,findings}.mjs` → one-line re-exports; `scripts/ui-check/run.mjs` (`--ref`, `--repo`, `--ports`), `scripts/ui-check/verify.mjs` (`--from <findings.json>`, `--repo`, `--ports`), `scripts/ui-check/lib/verify-core.mjs`, `lib/runner.mjs`, `lib/stack.setup.mjs` (stack options from env), `playwright.config.mjs` (baseURL from `UI_CHECK_BASE`), `CHECKS.md`
- Test: `scripts/ui-check/specs/selftest/checkout.spec.mjs` (`[ST-CHECKOUT]`), extend `[ST-DIGEST]`/`[ST-FINDINGS]` only if signatures change

**Interfaces (Produces):**
```js
// check-core/lib/ports.mjs
export const PORT_SETS = { prod:{django:8200,socket:4200,web:5374}, dev:{django:8000,socket:4000,web:5173} };
export function parsePorts(str)            // "django=8100,socket=4100,web=5273" → {django,socket,web}; throws on a missing key
// check-core/lib/checkout.mjs
export function worktreeRoot()             // from .claude/team/config.json
export async function ensureCheckout(ref, {fetch=true}={})  // ref: 'main'|'dev'|'<sha>'|'.' → {repo, ref, head, created:boolean, reinstalled:boolean}; '.' returns the main checkout untouched
export async function removeCheckout(ref)
// check-core/lib/stack.mjs
export async function ensureStack(mode='prod', {repo=ROOT, ports=PORT_SETS[mode], keepStack=false}={})  // entries in stack.json carry {repo, ports}; build stamp lives in <repo>/.next/UICHECK_STAMP
export async function stopStack({only=null, ports=null}={})    // ports → stop only the entries on those ports
// run.mjs flags: --ref <main|dev|.|sha> (default main unless --mode dev, then '.') · --repo <dir> (overrides) · --ports <str> · existing flags unchanged; run-meta.json gains {ref, head, repo}
// verify.mjs flags: --from <findings.json> (finding objects; no run dir needed; writes verify/ under <home>/adhoc/<ts>/) · --repo · --ports · existing flags
```

- [ ] **Step 1:** Write `[ST-CHECKOUT]`: `ensureCheckout(<current HEAD sha>)` creates `<worktreeRoot>/check-<sha7>` with junctions `backend/.venv` and `multiplayer_server/node_modules` present, `created:true`; a second call returns `created:false, reinstalled:false`; `removeCheckout` deletes it. Run → fails (module missing).
- [ ] **Step 2:** Implement ports/checkout/stack options; move the four modules (git `mv`) and leave re-export shims (`export * from '../../check-core/lib/stack.mjs'`); move `mint_tokens.py` and fix its path in `accounts.mjs`. Thread `repo`/`ports` through `runner.mjs`, `stack.setup.mjs` (env `UI_CHECK_REPO`, `UI_CHECK_PORTS`, `UI_CHECK_BASE`), `playwright.config.mjs` (`baseURL` from `UI_CHECK_BASE`, default by mode), `verify-core.mjs` (`--from`).
- [ ] **Step 3:** Selftests all green; `catalog.mjs` ok; `npx eslint scripts` clean. Prove: `node scripts/ui-check/run.mjs --suite guest --only G-PERM-02 --vp phone-390 --mode prod --ref main` runs from the worktree (log line names the repo path; run-meta has ref/head); `node scripts/ui-check/verify.mjs --from <a 1-finding json copied from run 20261014-1153x> --mode dev --ports django=8100,socket=4100,web=5273` brings up a lane stack and stops only it while a normal dev stack stays up (show `stack.json` before/after).
- [ ] **Step 4:** Commit `check-core: shared stack/accounts/findings, worktree checkout, --ref/--repo/--ports/--from`.

### Task 2: live subset (`--live`) and `where.env`

**Files:** Modify `scripts/ui-check/run.mjs`, `lib/runner.mjs`, `lib/fixtures.mjs` (audit records `env`), `lib/digest-reporter.mjs` (env in lines when not local), `check-core/lib/findings.mjs` (merge unions `where.env`), `findings.schema.json` (`where.env: ["local","live"]` optional), `specs/guest/*.spec.mjs` (tag `@live` on: G-LAYOUT-01 route/idle parts, G-LAYOUT-02, G-NAV-02, G-PERF-01, G-PERM-02, G-A11Y-01 — anything that only loads public routes and opens nothing that POSTs), `CHECKS.md` (column `live`), `.claude/skills/ui-check/SKILL.md` (step 1b `--live`).

- [ ] Steps: `run.mjs --live [url=https://swishquest.com]` → guest suite, `--grep @live`, core viewports, no stack-setup dependency (project `guest-live@<vp>` with `baseURL=url`), `UI_CHECK_ENV=live`; audit attaches `env`; results/digest/findings carry it; `[ST-DIGEST]` case with mixed envs. Prove with `node scripts/ui-check/run.mjs --live --only G-PERM-02,G-A11Y-01` (GET-only; confirm no POST in the captured requests — assert it in the live project via a request listener that fails the test on any non-GET to the live origin). Commit `ui-check: --live read-only subset against the live site`.

### Task 3: Notion properties, `create-card` attachments, `find-cards`, `notion-push.mjs`

**Files:**
- Modify: `scripts/notion.mjs` (`migrate-v3`, `create-card --source --target --attach <file>…`, `find-cards --source-fp <fp> [--status …]`, `row()` + `set-props` with `Source`/`Target`), `scripts/lib/notion-blocks.mjs` (file attachment block via file_uploads, reuse the image path), `scripts/lib/notion-blocks.test.mjs`
- Create: `scripts/check-core/lib/clusters.mjs` (the clustering now inlined in `.claude/skills/ui-fix/SKILL.md` §1, exported as `planClusters(findings, {checksMd})` → `[{engine, prod, items, keys}]`), `scripts/check-core/notion-push.mjs`, `scripts/check-core/lib/card-body.mjs` (renders the markdown-lite body from a cluster), `scripts/check-core/lib/cards-ledger.mjs` (`<home>/notion-cards.json`), `scripts/check-core/notion-push.test.mjs` (node --test, Notion client mocked)
- Modify: `.claude/skills/ui-fix/SKILL.md` (§1 calls `node scripts/check-core/lib/clusters.mjs <run> …` instead of the inline script), `.claude/skills/ui-check/SKILL.md` (step 3b: `node scripts/check-core/notion-push.mjs --run <id> --checker ui [--dry-run]`)

**Interfaces:**
```
node scripts/check-core/notion-push.mjs --run <id> --checker ui|logic [--target main|dev] [--dry-run] [--severities blocker,major,minor]
  → one card per cluster of OPEN findings; prints `card <id|DRY> <title> findings=<ids>` / `skip <fp…> already open card <id>` / `regression <old card> → <new card>`
Card: Name "[<checker>-check] <title of the highest-severity finding> (+<n-1>)"; Category frontend|backend|CI/CD; Priority P0 blocker/P1 major/P2 else; Difficulty hard|standard; Status To Do; Source "<checker>-check fp:<fp,…> ids:<id,…> run:<runId>"; Target; body per spec §3.4; attachment findings.json (cluster findings, full objects)
Dedupe: for each cluster fingerprint → find-cards; any non-Done hit → skip cluster (comment once per run: "seen again in run <id>"); all hits Done and Commit ∈ origin/main → Regression card; ledger mirrors.
```
- [ ] Steps: tests first (card body rendering snapshot; dedupe decisions with a mocked `find-cards`; clusters parity with the skill's script on run 20261014-1153x's findings.json); implement; `node scripts/notion.mjs migrate-v3` (real DB, additive); real dry run on 20261014-1153x; then ONE real push of a single cluster (`--severities blocker`) to prove end to end and a second push proving dedupe (0 new cards) — leave that card in To Do with Target main (it is the real teen-masking blocker; the owner wants it fixed in prod). Commit `check-core: Notion cards from findings with Source dedupe and findings.json attachment`.

### Task 4: pipeline support for check cards

**Files:**
- Modify: `scripts/team/intake.mjs` (card.json gains `source`, `target`, `findingsFile`), `scripts/team/brief.mjs` (`## Check findings` + QA `verify` assertion when `findingsFile`), `scripts/team/qa.mjs` (`verify` assertion → `verify.mjs --from … --mode dev --repo <worktree> --ports <lane>`; merges PASS/FAIL lines), `.claude/skills/classify/SKILL.md` (check cards: pre-classified, no plan writer/design round, docs from `fix.rules`), `.claude/skills/ship/SKILL.md` (Target main path: rebase on `origin/main`, ff push `HEAD:main`, back-merge PR `main→dev` merged, backend deploy rule, relay parked; `ship-card` unchanged), `.claude/skills/team-run/SKILL.md` (mention), `docs/team/PIPELINE.md` (§ "Check cards"), `infra/routine/setup.sh` (`--with-deps`, `npm ci --prefix multiplayer_server`), `docs/DEPLOYMENT.md` + `.claude/skills/promote-to-prod/SKILL.md` (fix the backend-deploy contradiction with what Vercel actually says)
- Test: `scripts/team/lib/*.test.mjs` for brief section + assertion parsing; a local dry run of intake→brief→qa on the Task 3 card (`node scripts/team/intake.mjs` style, lane 2) without the agents.

- [ ] Step 0 (read-only fact): check in Vercel (MCP `get_project` / `vercel project ls` + git settings) whether the `backend` project is git-connected to `main`; write the truth into `DEPLOYMENT.md` and the ship skill (if not connected: `cd backend && vercel deploy --prod` when `backend/` changed).
- [ ] Steps: tests, implement, dry run on the real card (brief shows the findings section and the verify assertion; qa.mjs on lane 2 runs verify and FAILS on the unfixed blocker — expected), commit `pipeline: check cards — brief findings section, verify QA gate, Target=main ship, cloud deps`.

### Task 5: `ui-fix` hotfix flow + CLAUDE.md exception

**Files:** `.claude/skills/ui-fix/SKILL.md` (§0 branch from `origin/main` as `fix/ui-check-<runId>`; verify with `--ref .`; §5 PR to `main`, merge, back-merge PR to `dev`, deploy rule, relay parked; Target main on the cards it closes), `.claude/skills/ui-check/SKILL.md` (default `--ref main`, `--live`, push step), `CLAUDE.md` (Shipping: "Checker findings (ui-check / logic-check) are the one standing exception: they ship to `main` via the hotfix flow and back-merge to `dev`"), `docs/ui-check/README.md` (prod/live/cards sections), `.claude/agents/frontend-engine.md` + `backend-engine.md` ("Fixing a UI-check finding": the finding may come from a card attachment: `verify.mjs --from`).
- [ ] Steps: edit; validate every command against `--help`; commit `ui-fix: hotfix flow to main with back-merge; CLAUDE.md exception`.

### Task 6: end to end (controller)
- [ ] `ui-check` on `--ref main` for `--suite guest --vp core` + `--live`; push cards (`--dry-run` then real for blocker/major); second push shows 0 new cards.
- [ ] Prove the pipeline path on the Task 3 card: `npm run team` is NOT run (it would pull every To Do card); instead run intake→brief→qa scripts on that card in lane 2 and show the brief + verdict.
- [ ] Prove the hotfix flow with `ui-fix` on the password-toggle finding against `main` (the fix exists on `dev` only): branch from main, apply, verify (`--ref .`), PR → main, merge, back-merge to dev, confirm production shows the 24 px toggle (`--live` run of G-MODAL-01/AC-… not possible for accounts — use the live guest probe of the login modal via `probe.mjs --live`).
- [ ] Final whole-branch review; PR `feat/checks-prod` → `dev`; merge; back-merge not needed (dev-only tooling) — but `main` needs the tooling too for the pipeline's ship step? No: the pipeline runs from `dev`'s scripts in its worktree; `main` gets them at the next promotion. Note it in the report.
