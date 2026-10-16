# check-core

Modules shared by the checkers (`scripts/ui-check/` today; Logic Check later). `scripts/ui-check/lib/{home,stack,accounts,findings}.mjs`
re-export these files, so every existing import keeps working. Design: `docs/superpowers/specs/2026-10-15-checks-prod-logic-design.md` §3–§4.

| file | what |
|---|---|
| `lib/home.mjs` | `ROOT` (the checkout these scripts run from), `uicHome()` (where runs, stack.json, accounts.json, logs live) |
| `lib/ports.mjs` | `PORT_SETS` (prod 8200/4200/5374, dev 8000/4000/5173), `parsePorts("django=…,socket=…,web=…")`, `formatPorts`, `portsKey`, `activePorts()` (UI_CHECK_PORTS or the mode's set) |
| `lib/checkout.mjs` | `worktreeRoot()`, `ensureCheckout(ref, {fetch})`, `removeCheckout(ref)`: a worktree `<worktreeRoot>/check-<ref>` of `origin/<ref>` (or a sha → `check-<sha7>`), `npm ci` only when `package-lock.json` changed (stamp `node_modules/.check-lock-stamp`), `backend/.venv` and `multiplayer_server/node_modules` as junctions to the main checkout's. `'.'` = the main checkout, untouched |
| `lib/checkout.mjs` (ui-fix) | `ensureFixWorktree(runId, target)` / `removeFixWorktree(runId)`: the branch worktree `<worktreeRoot>/fix-ui-check-<runId>` on `fix/ui-check-<runId>` cut from `origin/<target>` (reused as is when it exists, same junctions and `npm ci` rule). CLI: `node scripts/check-core/lib/checkout.mjs fix <runId> <main\|dev>` (JSON) · `remove-fix <runId>`. Test: `node --test scripts/check-core/checkout.test.mjs` |
| `lib/stack.mjs` | `ensureStack(mode, {repo, ports, keepStack})`, `stopStack({only, ports})`, `readStack({ports})`, `readStackFile()`, `codeState(mode, {repo, ports})`, `appRepo()`, `venvPython(repo)` … — the local stack; stack.json keeps one entry per port set |
| `lib/accounts.mjs` + `lib/mint_tokens.py` | test accounts, minted in the app repo's local sqlite only |
| `lib/findings.mjs` | findings schema/DSL validation, merge, ids, REPORT.md |
| `lib/clusters.mjs` | `planClusters(findings, {checksMd, perfIds})` → `[{engine, prod, items, keys}]`; CLI `node scripts/check-core/lib/clusters.mjs [run\|-] [sev] [owners] [suites] [ids]` prints the ui-fix plan |
| `lib/card-body.mjs` | `fpKey(fp)` (12-hex Source key), `cardMeta`, `renderBody` (markdown-lite card body), `attachmentDoc` (the attached findings.json) |
| `lib/cards-ledger.mjs` | `<home>/notion-cards.json`: fingerprint → card decision mirror (Notion is the truth) |
| `notion-push.mjs` | `--run <id> --checker ui\|logic [--target main\|dev] [--dry-run] [--severities …\|all]`: one Notion card per cluster, deduped by Source (§3.4); tests in `notion-push.test.mjs` |

Env read by the stack and the Playwright children: `UI_CHECK_MODE` (prod|dev), `UI_CHECK_REPO` (app checkout, default `ROOT`),
`UI_CHECK_PORTS` (`django=…,socket=…,web=…`, default the mode's set), `UI_CHECK_BASE` (Playwright baseURL override),
`UI_CHECK_HOME` (artifact root).

Never junction the root `node_modules` into a worktree on Windows: removing the worktree follows the link. `removeCheckout`
unlinks its two junctions before `git worktree remove`.
