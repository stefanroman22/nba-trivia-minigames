---
name: ui-fix
description: Fix open UI-check findings. Clusters them by owner and shared files, has frontend-engine / backend-engine fix and re-verify each cluster (fix, verify, repeat), gates every cluster with code review and a regression run, marks findings fixed, and ships. Findings of a production-code run (`--ref main`) go to production as a hotfix (PR to main, merge, back-merge to dev, verify production) and close their Notion cards; findings of any other run ship to dev. Use when asked to fix UI-check findings or to run ui-fix.
---

# UI fix (orchestrator)

**Input:** a run id (default: the newest run that has a `findings.json`) and optional filters:
severities (default `blocker,major,minor`; `polish` only when named, or `all`), owners, suites,
finding ids. Background: `docs/ui-check/README.md`.

**Token rules.** Read findings only through the plan below and single-finding extracts. Never open
screenshots, `results.json` or the body of `REPORT.md`; from a regression run read only its `## FAIL` sections.

**Every exit path ends with `node scripts/ui-check/run.mjs --stop`** (done, blocked, or failed).

## 0. Preconditions
- `git status --porcelain`: no staged or modified tracked files except `scripts/ui-check/notes/*.md`
  (the judges' appended learnings); untracked scratch outside `src/`, `backend/` and
  `multiplayer_server/` is fine. Anything else: stop and tell the owner (the fix loop shares this
  working tree and must not mix with their changes).
- `gh auth status` shows `stefanroman22` (else `gh auth switch -u stefanroman22`).
- Plan first (section 1 only reads): its first line names `runDir` and `runId`.
- **Target**, from the code the run audited (Bash tool):
  `node -e 'const m=require(process.argv[1]);console.log("ref "+m.ref+" · env "+(m.env||"local"))' "<runDir>/run-meta.json"`.
  `ref main` (the ui-check default; a `--live` run records it too) → target **`main`**: the findings are in
  production code, so the fixes ship to production as a hotfix (project CLAUDE.md "Shipping",
  checker exception). Anything else (`dev`, `.`, a sha, `undefined` for runs made before `--ref`
  existed) → target **`dev`**, unless the owner named the target.
- Cards the pipeline already holds: run the card lookup of section 5 step 3 with every planned id. A
  line whose status is `In progress` or `QA` is a pipeline run's: leave its ids out (re-run section 1
  with the remaining ids as the `ids` argument) and list them for the owner.
- Note the current branch (`git branch --show-current`) as `<start>`.
- `git fetch origin main dev` and `git switch -c fix/ui-check-<runId> origin/<target>`. Git carries
  modified notes files along; if it refuses because a notes file differs on `<target>`, `git stash
  push -- scripts/ui-check/notes`, switch, `git stash pop`, and keep both sides' bullets on a conflict.
- `git diff --quiet @{-1} HEAD -- package-lock.json || npm ci` (the dev server runs this checkout's
  `node_modules`; `main` can pin other versions than `dev`). Remember whether `npm ci` ran.
- Modified notes files → first commit on the branch: `git add scripts/ui-check/notes` and
  `git commit -m "ui-check: notes from <runId>"`.

## 1. Plan the clusters
Arguments: `[runId|-] [severities|all] [owners|all] [suites|all] [ids|all]` (`-` = default). Bash tool,
from the repo root:
```
node scripts/check-core/lib/clusters.mjs <args>
```
It prints `runDir <dir> · runId <id> · <n> open finding(s) · <m> cluster(s)`, then per cluster
`#<i> <engine> [prod]: <ids>` and one line per finding: id, severity, owner, suite, `perf`, route,
`checks=`, `files=`. It is the same clustering `notion-push.mjs` turns into Notion cards, so a card
normally matches one cluster.

Owners map to engines: `frontend` → `frontend-engine`; `backend` and `ci` → `backend-engine`. A
cluster is the findings of one engine that share a file or an acceptance check (a shared check
passes only when all of them are fixed), so it is one engine dispatch. Clusters run **one at a time**
(one working tree, one stack). `[prod]` clusters hold a perf criterion (rule perf / loaf / cls /
slow-action / slow-api, `maxCls` / `maxLoafMs`, or an `@perf` check): budgets are enforced only in
prod, so their verify rebuilds the prod frontend after a change (about 70 s or more). They come last.

One finding as JSON, when you need it (Bash tool): `node -e 'const [f,id]=process.argv.slice(1);const d=require(f);console.log(JSON.stringify((d.findings||d).find(x=>x.id===id),null,1))' "<runDir>/findings.json" <id>`.

## 2. Each cluster
**a. Fix.** Dispatch the engine with `model: "sonnet"`:
```
Fix these UI-check findings per "Fixing a UI-check finding" in your agent file.
runDir: <runDir>
runId: <runId>
findings: <ids>   (one cluster: they share files or acceptance checks)
Work in the main checkout on branch fix/ui-check-<runId> and verify with --ref . (this checkout; the
run's own checkout is the unfixed code). Do not commit. Return one JSON line per finding.
```
It returns `{"finding", "status": "fixed|blocked|check-bug", "attempts", "touched": [...], "why"}`
per finding; for blocked and check-bug findings it has already reverted its edits unless a fixed
sibling needs them (`why` says which).
- Nothing `fixed` → make sure the tree is clean of the cluster (`git restore -- <touched>`; delete
  files it created, shown as `??` by `git status --porcelain`), record the reasons, next cluster.
- `check-bug` → rule on it (section 3).

**b. Review** the uncommitted diff (`git diff`) before the regression run: `code-reviewer` (model
`sonnet`; `fable` when the diff touches auth/tokens, the multiplayer protocol, settings/CACHES or the
admin API) and, in the same message, `motion-reviewer` (model `opus`) when the diff touches
`src/motion/**` or `src/components/motion/**`, adds or changes a `framer-motion` import, or adds CSS
`transition` / `animation` / `@keyframes`. Prompt: "Review the uncommitted diff (`git diff`). It fixes
UI-check findings <ids> in <runDir>/findings.json; each finding's `fix.rules` lists the constraint
rules that apply. There is no pipeline brief." A blocker or major → resume the engine with it (it
re-verifies), at most 2 review rounds; a blocker left → restore the cluster's files and record
`blocked: review`.

**c. Regression** on all 7 viewports (dev stack from this checkout, kept):
```
node scripts/ui-check/run.mjs --suite <suites of the ids> --only "<ids>" --vp all --mode dev --ref . --keep-stack --skip-slow
```
`<ids>`: every check on the cluster's plan lines (`checks=`), plus the checks of each route:
`/<game>` → `GM-<game>-*,GM-LATENCY-<game>,GM-SHELL-01` (and `MP-GAME-<game>` for an online game);
any other route → the IDs of the rows in the finding's suite section of `scripts/ui-check/CHECKS.md`
that name that route or surface (Grep). When unsure, run that suite without `--only`. Drop
`--skip-slow` when `MP-TIMEOUT-01` is in the set. The run writes a new run directory and moves the
`latest` pointer, so always pass `--run <runId>` to `verify.mjs` and `report.mjs`.
Exit 0 → go on. Exit 1 → read the `## FAIL` sections of the regression digest (its path is on the last
output line):
- A line showing HTTP `429` is a throttle left over from earlier runs, not a regression:
  `node scripts/ui-check/run.mjs --stop` (it resets the counters) and run the regression once more.
- A FAIL line is a regression unless the same check, rule and selector also FAIL in the audited
  `<runDir>/digest.md` (Grep the selector): those belong to other open findings.
- Regressions → resume the engine (SendMessage to its agent id) with those lines, once. Its new
  change goes through review (b) once more, then this regression run again. Still regressing →
  restore the cluster's files and record `blocked: regression`.

**d. Mark.** `node scripts/ui-check/verify.mjs <ids the engine fixed> --run <runId> --ref . --mark --keep-stack`.
`--ref .` is required: without it verify runs the run's own checkout (for a `--ref main` run the
unfixed `check-main` worktree) and every finding FAILs. No `--mode`: verify uses each finding's
`validatedMode`, the single final gate per cluster (prod for findings validated in prod: a prod build
of this checkout). Only PASS findings are marked fixed (findings.json and REPORT.md of the run are
rewritten). A FAIL → resume the engine once; still failing → that finding is `blocked`. If no
finding of the cluster passes, restore its files.

**e. Commit** the cluster: `git add <touched files>`, then
`git commit -m "ui-fix: <short summary> (<ids>)"`: one plain line, no trailer or AI attribution.

## 3. check-bug: you rule, engines never edit `scripts/ui-check/**`
- **The check or detector is wrong** (a spec or `lib/` under `scripts/ui-check`): fix it with a
  selftest that shows the bug first (`npm run ui:selftest`), run `node scripts/ui-check/catalog.mjs`,
  commit it on its own (`ui-check: <what>`), then re-dispatch the engine for that finding once.
- **The finding is wrong** (the app follows the rules; the judge misread): add
  `{ "fingerprint": "<its fingerprint>", "reason": "false positive (ui-fix <date>): <why>" }` to
  `scripts/ui-check/accepted.json`, a bullet to `scripts/ui-check/notes/<suite>.md`, run
  `node scripts/ui-check/report.mjs --run <runId>` (no `--validate`) so findings.json and REPORT.md
  drop it, commit `accepted.json` and the notes file, and list it for the owner.
- **The defect is real but its acceptance is wrong:** leave it open and list it for the owner as
  "needs re-judging" (the next ui-check run finds it again).

## 4. Stack
The first verify starts the dev stack (a `[prod]` cluster also starts the prod stack); every call
passes `--keep-stack` and `--ref .`. A prod stack kept by the audit serves the `check-main` worktree,
so the first prod verify restarts it from this checkout and rebuilds. The one exception:
`backend-engine` stops it after editing `backend/` or `multiplayer_server/` (Django and the relay run
without autoreload), and the next call starts it again.

## 5. Ship
Only when at least one cluster was committed. Nothing committed → `node scripts/ui-check/run.mjs
--stop`, `git switch <start>` (and `npm ci` again if section 0 ran it), report.
1. Once: `npm run lint` and `npx next typegen && npx tsc --noEmit`; when `backend/` changed, from
   `backend/`: `venv/Scripts/python manage.py test users trivia` (Windows). A failure → resume the
   engine that touched the file, re-verify its findings (`--run <runId> --ref .`), commit.
2. `node scripts/ui-check/run.mjs --stop`: no step after this one needs the local stack.
3. Card lookup (Bash tool, from the repo root; `<ids>` = the findings marked fixed, comma-joined):
   ```
   node --input-type=module -e '
   import { execFileSync } from "node:child_process";
   import { readFindingsDoc } from "./scripts/check-core/lib/findings.mjs";
   import { findingKeys } from "./scripts/check-core/lib/card-body.mjs";
   const [run, ids] = process.argv.slice(1);
   const mine = new Set(ids.split(","));
   const all = readFindingsDoc(run).findings;
   const byKey = new Map(all.flatMap((f) => findingKeys(f).map((k) => [k, f])));
   const keys = all.filter((f) => mine.has(f.id)).flatMap(findingKeys);
   const cards = keys.length ? JSON.parse(execFileSync(process.execPath, ["scripts/notion.mjs", "find-cards", ...keys.flatMap((k) => ["--source-fp", k])], { encoding: "utf8" }) || "[]") : [];
   const of = (ck, s) => [...new Set(ck.map((k) => byKey.get(k)).filter((f) => f && (mine.has(f.id) || f.status === "fixed" ? "fixed" : "open") === s).map((f) => f.id))].join(",") || "-";
   for (const c of cards) {
     const ck = ((String(c.source).match(/fp:(\S+)/) || [])[1] || "").split(",").filter(Boolean);
     const open = of(ck, "open");
     console.log(`${c.status === "Done" ? "done" : open === "-" ? "complete" : "partial"} ${c.id} · ${c.status} · target ${c.target || "-"} · fixed ${of(ck, "fixed")} · open ${open} · unseen ${ck.filter((k) => !byKey.has(k)).length} · ${c.title}`);
   }
   if (!cards.length) console.log("no Notion card holds these findings");
   ' <runId> <ids>
   ```
   A card is `complete` when none of the findings its `Source` names is still open in this run
   (`unseen` keys were not reported by this run). A Notion error (no `.env.team` token, API down) →
   ship without card updates and tell the owner which findings' cards were not updated.

### Target `main` (hotfix)
4. **Relay split.** `git log --format=%H --reverse origin/main..HEAD -- multiplayer_server` lists the
   relay commits. The relay (Railway, billed) is deployed only by the owner, so its code must not
   reach production before that deploy (the `ship` skill's Relay PR rule). None → `<head>` =
   `fix/ui-check-<runId>`, go to step 5. Otherwise:
   ```
   git switch -c fix/ui-check-<runId>-main origin/main
   git cherry-pick <every other commit of origin/main..fix/ui-check-<runId>, oldest first>
   git switch -c fix/ui-check-<runId>-relay origin/main
   git cherry-pick <the relay commits>
   git push -u origin fix/ui-check-<runId>-relay
   gh pr create --base main --head fix/ui-check-<runId>-relay --title "ui-fix: <runId> relay (<ids>)" --body "<finding · title lines>. Relay change: merge this PR with a merge commit (not squash/rebase), then run \`cd multiplayer_server && railway up\` in the same window, then back-merge main into dev."
   git switch fix/ui-check-<runId>-main
   ```
   Never merge the relay PR. `<head>` = `fix/ui-check-<runId>-main` (skip steps 5-11 when it has no
   commits). A cherry-pick conflict (the commits share a file) → `git cherry-pick --abort`, delete the
   new local branches, and open the relay PR from `fix/ui-check-<runId>` itself: every card is then a
   relay card and steps 5, 6 and 8-10 are skipped. A card is a relay card when one of its fixed
   findings is in a relay commit (the ids are in the commit subject).
5. `git push -u origin <head>`, then `gh pr create --base main --head <head>` with a title
   `ui-fix: <runId> (<n> findings)` and a body listing finding · title · status and the cards, plus
   "Checker hotfix (CLAUDE.md Shipping exception); a back-merge PR main → dev follows." (no AI
   attribution).
6. `gh pr checks <n> --watch`. A failing check → fix, push, watch again, at most 2 times; still
   failing → leave the PR open and report it as open with the failing check. `gh pr view <n> --json
   mergeable` shows `CONFLICTING` (main moved) → `git fetch origin main`, `git rebase origin/main`,
   resolve, step 1 again, re-verify the fixed ids (`verify.mjs <ids> --run <runId> --ref . --keep-stack`,
   no `--mark`), `node scripts/ui-check/run.mjs --stop`, `git push --force-with-lease`, watch again.
7. Cards, **before the merge** (`main-sync.yml` runs on the push to `main` and marks Done only the
   cards already in QA whose Commit is on `main`). `SHA=$(git rev-parse <head>)`. Per lookup line:
   - `complete`, status `To Do`/`Backlog`, not a relay card: when its target is not `main`,
     `node scripts/notion.mjs set-props <cardId> --target main`; then
     `node scripts/notion.mjs ship-card <cardId> --commit <SHA> --branch <head> --target main`
     (QA + Commit; its comment says "on main") and
     `node scripts/notion.mjs comment <cardId> "fixed by ui-fix <runId>: PR #<n> to main, back-merged to dev"`.
   - a relay card: `node scripts/notion.mjs ship-card <cardId> --commit <relay PR head SHA> --branch fix/ui-check-<runId>-relay --target main --pr <relay PR url>`
     and `node scripts/notion.mjs set-props <cardId> --target main --needs-human` (main-sync marks it
     Done once the owner merges the relay PR with a merge commit).
   - `partial`: `node scripts/notion.mjs comment <cardId> "ui-fix <runId> fixed <fixed ids> (PR #<n> to main, <SHA7>); still open: <open ids>"`.
   - status `In progress` or `QA` (a pipeline run took it meanwhile): comment the same way and list
     it for the owner (the pipeline's change may duplicate this one). `done`: nothing.
8. `gh pr merge <n> --merge --delete-branch`. It fails → `node scripts/notion.mjs set-status <cardId> "To Do"`
   for every non-relay card step 7 ship-carded, leave the PR open, report.
9. **Back-merge** `main → dev` (merge commit, merged PR):
   ```
   git fetch origin main dev
   git switch -c backmerge/ui-fix-<runId> origin/dev
   git merge --no-ff origin/main -m "chore: back-merge main into dev (ui-fix <runId>)"
   git push -u origin backmerge/ui-fix-<runId>
   gh pr create --base dev --head backmerge/ui-fix-<runId> --title "chore: back-merge main into dev (ui-fix <runId>)" --body "Back-merge after ui-fix <runId> shipped PR #<n> to main."
   gh pr checks <m> --watch
   gh pr merge <m> --merge --delete-branch
   ```
   A merge conflict → `git merge --abort`; `main` stays shipped; report "back-merge conflicted in
   <files>: merge main into dev by hand". A failing check → leave that PR open and report it.
10. **Verify production** (`promote-to-prod` steps 2–4): a push to `main` deploys the frontend AND
    the backend Vercel projects; watch both production deployments of the merge commit to READY, then
    fetch https://swishquest.com, the touched routes and the API (real content, right status). Then the
    live subset for the fixed findings that can be seen live:
    `node scripts/ui-check/run.mjs --live --only "<ids>"`, `<ids>` = the `@live` guest checks (the
    `live` column of `scripts/ui-check/CHECKS.md`) among the clusters' `checks=` and the touched
    routes' checks. From its digest read only the `## FAIL` sections: a FAIL on a fixed finding's check
    and selector → production does not have the fix: fix forward or roll back per `promote-to-prod`
    step 4, never leave it; other FAIL lines that also FAIL in the audited `<runDir>/digest.md` are
    other open findings. Account, game and multiplayer findings cannot be checked live (no accounts,
    games or rooms on the live site): say so; their proof is the prod-mode `--mark` gate (2d).
11. `git switch <start>` (and `npm ci` again if section 0 ran it); `git branch -D` whichever of
    `fix/ui-check-<runId>`, `fix/ui-check-<runId>-main`, `fix/ui-check-<runId>-relay` and
    `backmerge/ui-fix-<runId>` still exists locally (the remote relay branch stays for its PR).

### Target `dev`
4. `git push -u origin fix/ui-check-<runId>`, then `gh pr create --base dev` with a title
   `ui-fix: <runId> (<n> findings)` and a body listing finding · title · status (no AI attribution).
5. `gh pr checks <n> --watch`. A failing check → fix, push, watch again, at most 2 times; still
   failing → leave the PR open and report it as open with the failing check.
6. `gh pr merge <n> --merge --delete-branch`. Then, per `complete` card of step 3:
   `node scripts/notion.mjs ship-card <cardId> --commit <SHA> --branch fix/ui-check-<runId>` (`SHA`
   = the branch head that was merged; `main-sync` marks it Done at the next promote); `partial` cards
   get the comment of the main path. **Stop at dev.** Never promote to `main` unless the owner
   explicitly asks in this conversation.
7. `git switch <start>` (and `npm ci` again if section 0 ran it).

## 6. Report to the owner
A table finding · title · status (fixed, or blocked / check-bug / false positive / needs re-judging
with the reason) · commit; the PR links (to `main` or `dev`, the back-merge PR, the relay PR) and
whether each is merged or left open; the cards updated (id · shipped / relay PR / partial comment)
and the findings left out because the pipeline holds their card; for target `main`, the production
check (both deployments READY, the live checks that passed, which findings could not be checked
live) and, for a relay PR, "needs owner: merge with a merge commit + `railway up` in the same
window, then back-merge"; the absolute path of the run's `REPORT.md`; confirmation that the stack
is stopped.
