# check-core

Modules shared by the checkers (`scripts/ui-check/` and Logic Check, `scripts/logic-check/`). `scripts/ui-check/lib/{home,stack,accounts,findings}.mjs`
re-export these files, so every existing import keeps working. Design: `docs/superpowers/specs/2026-10-15-checks-prod-logic-design.md` §3–§4.

| file | what |
|---|---|
| `lib/home.mjs` | `ROOT` (the checkout these scripts run from), `uicHome()` (where runs, stack.json, accounts.json, logs live) |
| `lib/ports.mjs` | `PORT_SETS` (prod 8200/4200/5374, dev 8000/4000/5173), `parsePorts("django=…,socket=…,web=…")`, `formatPorts`, `portsKey`, `activePorts()` (UI_CHECK_PORTS or the mode's set) |
| `lib/checkout.mjs` | `worktreeRoot()`, `ensureCheckout(ref, {fetch})`, `removeCheckout(ref)`: a worktree `<worktreeRoot>/check-<ref>` of `origin/<ref>` (or a sha → `check-<sha7>`), `npm ci` only when `package-lock.json` changed (stamp `node_modules/.check-lock-stamp`), `backend/.venv` and `multiplayer_server/node_modules` as junctions to the main checkout's. `'.'` = the main checkout, untouched |
| `lib/checkout.mjs` (ui-fix) | `ensureFixWorktree(runId, target)` / `removeFixWorktree(runId)`: the branch worktree `<worktreeRoot>/fix-ui-check-<runId>` on `fix/ui-check-<runId>` cut from `origin/<target>` (reused as is when it exists, same junctions and `npm ci` rule). CLI: `node scripts/check-core/lib/checkout.mjs fix <runId> <main\|dev>` (JSON) · `remove-fix <runId>`. Test: `node --test scripts/check-core/checkout.test.mjs` |
| `lib/stack.mjs` | `ensureStack(mode, {repo, ports, keepStack})`, `stopStack({only, ports})`, `readStack({ports})`, `readStackFile()`, `codeState(mode, {repo, ports})`, `appRepo()`, `venvPython(repo)` … — the local stack; stack.json keeps one entry per port set |
| `lib/accounts.mjs` + `lib/mint_tokens.py` | test accounts, minted in the app repo's local sqlite only. One registry (spec §4): `ROLES` (`ui.host` testuser1, `ui.joiner` testuser2, `ui.solo` testuser3 + the `testuser3w<n>` pool, `logic.actor` testuser4, `logic.peer` testuser5, `logic.admin` testuser6), `userForRole(role, parallelIndex)`, `isTestUsername` (`uic<digits>` / `lgc<digits>` throwaways), `ensureAdmin(user)` (mint op `promote_admin` = the app's `promote_admin` command), `sweepAccounts({scope: 'ui'\|'logic'\|'all'})` |
| `lib/services.mjs` | services taxonomy (`SERVICES` + `games.<id>`), `parseServices(checksMd)` (the `services` column of a CHECKS.md, required on every row), `servicesOf(checkId, maps)` (families by most literal characters), `checksForServices(services, maps)`, `overlapErrors(src, {checker})` (the §5 no-overlap lint `catalog.mjs` runs). Test: `services.test.mjs` |
| `lib/channel.mjs` | `<home>/channel.json` `{blocks, deferred, resolved}`: `block()` (idempotent per service + LC id), `blockedServices()`, `blockFor(service)`, `defer()`, `resolve({isDone, isOnMain})` → `{resolved, catchUp: {ui, logic}, errors}` (lookups injected). CLI `node scripts/check-core/lib/channel.mjs show`. Test: `channel.test.mjs` |
| `lib/retain.mjs` | `retain({home, keepRuns, openRunIds, notesMax, notesDays, channelDays, cardsDays, dryRun})`: last N runs per checker + open-card runs, notes archive, channel and ledger pruning (§7). CLI `node scripts/check-core/lib/retain.mjs [--dry-run] [--keep 5]`. Test: `retain.test.mjs` |
| `lib/slack-line.mjs` | `postLine(text, {channel, dryRun})`: one line through `scripts/slack.mjs post-text`, never throws |
| `lib/api-assert.mjs` | API acceptance assertions (§6): validation, `describeApiAssertion`, `evaluateApi`, `runApiAssertion` (node fetch). Test: `api-assert.test.mjs`; verify-core wiring: `verify-api.test.mjs` |
| `lib/findings.mjs` | findings schema/DSL validation (browser and API assertions, `{id}` UI and `{lc}` Logic check criteria), merge, ids, REPORT.md |
| `lib/clusters.mjs` | `planClusters(findings, {checksMd, perfIds})` → `[{engine, prod, items, keys}]`; CLI `node scripts/check-core/lib/clusters.mjs [run\|-] [sev] [owners] [suites] [ids]` prints the ui-fix plan |
| `lib/card-body.mjs` | `fpKey(fp)` (12-hex Source key), `cardMeta`, `renderBody` (markdown-lite card body), `attachmentDoc` (the attached findings.json) |
| `lib/cards-ledger.mjs` | `<home>/notion-cards.json`: fingerprint → card decision mirror (Notion is the truth) |
| `notion-push.mjs` | `--run <id> --checker ui\|logic [--target main\|dev] [--dry-run] [--severities …\|all]`: one Notion card per cluster, deduped by Source (§3.4); logic cards: `[logic-check]` title, "Fixing a Logic-check finding" protocol; every card (both checkers) verifies with `verify.mjs <id> --from <attached findings.json> --mode dev`; tests in `notion-push.test.mjs` |

Env read by the stack and the Playwright children: `UI_CHECK_MODE` (prod|dev), `UI_CHECK_REPO` (app checkout, default `ROOT`),
`UI_CHECK_PORTS` (`django=…,socket=…,web=…`, default the mode's set), `UI_CHECK_BASE` (Playwright baseURL override),
`UI_CHECK_HOME` (artifact root).

Never junction the root `node_modules` into a worktree on Windows: removing the worktree follows the link. `removeCheckout`
unlinks its two junctions before `git worktree remove`.
