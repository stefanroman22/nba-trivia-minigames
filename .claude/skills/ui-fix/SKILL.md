---
name: ui-fix
description: Fix open UI-check findings. Clusters them by owner and shared files, has frontend-engine / backend-engine fix and re-verify each cluster (fix, verify, repeat), gates every cluster with a regression run and code review, marks findings fixed, and ships to dev. Use when asked to fix UI-check findings or to run ui-fix.
---

# UI fix (orchestrator)

**Input:** a run id (default: the newest run that has a `findings.json`) and optional filters:
severities (default `blocker,major,minor`; `polish` only when named, or `all`), owners, suites,
finding ids. Background: `docs/ui-check/README.md`.

**Token rules.** Read findings only through the plan below and single-finding extracts. Never open
screenshots, `results.json` or the body of `REPORT.md`; from a regression run read only its `## FAIL` sections.

## 0. Preconditions
- No staged or modified tracked files (`git status --porcelain`; untracked scratch outside `src/`,
  `backend/` and `multiplayer_server/` is fine). Otherwise stop and tell the owner: the fix loop
  shares this working tree and must not mix with their changes.
- `gh auth status` shows `stefanroman22` (else `gh auth switch -u stefanroman22`).
- `git fetch origin dev` and `git switch -c fix/ui-check-<runId> origin/dev`.

## 1. Plan the clusters
Arguments: `[runId|-] [severities|all] [owners|all] [suites|all] [ids|all]` (`-` = default). Bash tool:
```
node --input-type=module -e '
import { listRuns, readFindingsDoc, runPath } from "./scripts/ui-check/lib/findings.mjs";
const a = process.argv.slice(1);
const run = a[0] && a[0] !== "-" ? a[0] : listRuns().find((r) => /^\d{8}-\d{4}$/.test(r) && readFindingsDoc(r));
if (!run || !readFindingsDoc(run)) { console.log(`no findings.json for run ${run || "(none)"}: run the ui-check skill first`); process.exit(0); }
const pick = (i, d) => { const v = a[i] && a[i] !== "-" ? a[i] : d; return v === "all" ? null : v.split(","); };
const [sev, own, suite, ids] = [pick(1, "blocker,major,minor"), pick(2, "all"), pick(3, "all"), pick(4, "all")];
const ok = (list, v) => !list || list.includes(v);
const open = readFindingsDoc(run).findings.filter((f) => f.status !== "fixed" && ok(sev, f.severity) && ok(own, f.owner) && ok(suite, f.suite) && ok(ids, f.id));
const engine = (f) => (f.owner === "frontend" ? "frontend-engine" : "backend-engine");
const keys = (f) => [...f.files.map((x) => "f:" + x.path), ...(f.acceptance.checks || []).map((c) => "c:" + c.id)];
const clusters = [];
for (const f of open) {
  const hit = clusters.filter((c) => c.engine === engine(f) && keys(f).some((k) => c.keys.has(k)));
  const c = hit.shift() || (clusters.push({ engine: engine(f), keys: new Set(), items: [] }), clusters.at(-1));
  for (const o of hit) { c.items.push(...o.items); o.keys.forEach((k) => c.keys.add(k)); clusters.splice(clusters.indexOf(o), 1); }
  c.items.push(f); keys(f).forEach((k) => c.keys.add(k));
}
const prod = (c) => c.items.some((f) => f.validatedMode === "prod");
clusters.sort((x, y) => prod(x) - prod(y));
console.log(`runDir ${runPath(run)} · ${open.length} open finding(s) · ${clusters.length} cluster(s)`);
clusters.forEach((c, i) => {
  console.log(`#${i + 1} ${c.engine}${prod(c) ? " [prod]" : ""}: ${c.items.map((f) => f.id).join(" ")}`);
  for (const f of c.items) console.log(`   ${f.id} ${f.severity} ${f.owner} ${f.suite} ${f.where.route} checks=${[...new Set([f.evidence.checkId, ...(f.acceptance.checks || []).map((x) => x.id)].filter(Boolean))].join(",") || "-"} files=${[...new Set(f.files.map((x) => x.path))].join(",")}`);
});
' <args>
```
Owners map to engines: `frontend` → `frontend-engine`; `backend` and `ci` → `backend-engine`. A
cluster is the findings of one engine that share a file or an acceptance check (a shared check
passes only when all of them are fixed), so it is one engine dispatch. Clusters run **one at a time**
(one working tree, one stack). `[prod]` clusters (validated in prod mode) come last: their verify
rebuilds the prod frontend after every change (about 70 s or more).

One finding as JSON, when you need it (Bash tool): `node -e 'const [f,id]=process.argv.slice(1);const d=require(f);console.log(JSON.stringify((d.findings||d).find(x=>x.id===id),null,1))' "<runDir>/findings.json" <id>`.

## 2. Each cluster
**a. Fix.** Dispatch the engine with `model: "sonnet"`:
```
Fix these UI-check findings per "Fixing a UI-check finding" in your agent file.
runDir: <runDir>
runId: <runId>
findings: <ids>   (one cluster: they share files or acceptance checks)
Work in the main checkout on branch fix/ui-check-<runId>. Do not commit. Return one JSON line per finding.
```
It returns `{"finding", "status": "fixed|blocked|check-bug", "attempts", "touched": [...], "why"}` per finding.
- Nothing `fixed` → restore its files (`git restore -- <touched>`; delete files it created, shown as
  `??` by `git status --porcelain`), record the reasons, next cluster.
- `check-bug` → rule on it (section 3).

**b. Regression** on all 7 viewports (dev stack, kept):
```
node scripts/ui-check/run.mjs --suite <suites of the ids> --only "<ids>" --vp all --mode dev --keep-stack --skip-slow
```
`<ids>`: every check on the cluster's plan lines (`checks=`), plus the checks of each route:
`/<game>` → `GM-<game>-*,GM-LATENCY-<game>,GM-SHELL-01` (and `MP-GAME-<game>` for an online game);
any other route → the IDs of the rows in the finding's suite section of `scripts/ui-check/CHECKS.md`
that name that route or surface (Grep). When unsure, run that suite without `--only`. Drop
`--skip-slow` when `MP-TIMEOUT-01` is in the set. The run writes a new run directory and moves the
`latest` pointer, so always pass `--run <runId>` to `report.mjs`.
Exit 0 → go on. Exit 1 → read the `## FAIL` sections of the regression digest (its path is on the last
output line). A FAIL line is a regression unless the same check, rule and selector also FAIL in the
audited `<runDir>/digest.md` (Grep the selector): those belong to other open findings. Regressions →
resume the engine (SendMessage to its agent id) with those lines, once; still regressing → restore
the cluster's files and record `blocked: regression`.

**c. Review** the uncommitted diff (`git diff`): `code-reviewer` (model `sonnet`; `fable` when the
diff touches auth/tokens, the multiplayer protocol, settings/CACHES or the admin API) and, in the
same message, `motion-reviewer` (model `opus`) when the diff touches `src/motion/**` or
`src/components/motion/**`, adds or changes a `framer-motion` import, or adds CSS
`transition` / `animation` / `@keyframes`. Prompt: "Review the uncommitted diff (`git diff`). It
fixes UI-check findings <ids> in <runDir>/findings.json; each finding's `fix.rules` lists the
constraint rules that apply. There is no pipeline brief." A blocker or major → resume the engine
with it (it re-verifies), at most 2 review rounds; a blocker left → restore and record `blocked: review`.

**d. Mark.** `node scripts/ui-check/verify.mjs <ids the engine fixed> --mark --keep-stack`. Only PASS
findings are marked fixed (findings.json and REPORT.md of their run are rewritten). A FAIL → resume
the engine once; still failing → that finding is `blocked`. If no finding of the cluster passes,
restore its files.

**e. Commit** the cluster: `git add <touched files>`, then
`git commit -m "ui-fix: <short summary> (<ids>)"`: one plain line, no trailer or AI attribution.

## 3. check-bug: you rule, engines never edit `scripts/ui-check/**`
- **The check or detector is wrong** (a spec or `lib/` under `scripts/ui-check`): fix it with a
  selftest that shows the bug first (`npm run ui:selftest`), run `node scripts/ui-check/catalog.mjs`,
  commit it on its own (`ui-check: <what>`), then re-dispatch the engine for that finding.
- **The finding is wrong** (the app follows the rules; the judge misread): add
  `{ "fingerprint": "<its fingerprint>", "reason": "false positive (ui-fix <date>): <why>" }` to
  `scripts/ui-check/accepted.json`, a bullet to `scripts/ui-check/notes/<suite>.md`, run
  `node scripts/ui-check/report.mjs --run <runId>` (no `--validate`) so findings.json and REPORT.md
  drop it, commit `accepted.json` and the notes file, and list it for the owner.
- **The defect is real but its acceptance is wrong:** leave it open and list it for the owner as
  "needs re-judging" (the next ui-check run finds it again).

## 4. Stack
The first verify starts the dev stack; every call passes `--keep-stack`. The one exception:
`backend-engine` stops it after editing `backend/` or `multiplayer_server/` (Django and the relay run
without autoreload) and the next call starts it again. When all clusters are done, and also after
any failure: `node scripts/ui-check/run.mjs --stop`.

## 5. Ship (project CLAUDE.md "Shipping")
Only when at least one cluster was committed:
1. Once: `npm run lint` and `npx next typegen && npx tsc --noEmit`; when `backend/` changed, from
   `backend/`: `venv/Scripts/python manage.py test users trivia` (Windows). A failure → resume the
   engine that touched the file, re-verify its findings, commit.
2. `git push -u origin fix/ui-check-<runId>`, then `gh pr create --base dev` with a title
   `ui-fix: <runId> (<n> findings)` and a body listing finding · title · status (no AI attribution).
3. `gh pr checks <n> --watch`; a failing check → fix, push, watch again.
4. `gh pr merge <n> --merge --delete-branch`. **Stop at dev.** Never promote to `main` unless the
   owner explicitly asks in this conversation.

## 6. Report to the owner
A table finding · title · status (fixed, or blocked / check-bug / false positive / needs re-judging
with the reason) · commit; the PR link and that it is merged to dev; the absolute path of each
touched run's `REPORT.md`; confirmation that the stack is stopped.
