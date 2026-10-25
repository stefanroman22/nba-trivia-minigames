# SEO agent

The SEO agent keeps swishquest.com indexed. Scripts measure: a deterministic audit of the live site (the IX checks,
GET/HEAD only), the Search Console pull and the per-URL ledger. The agent judges: it reads only their digests and
summaries and decides, for every failure or verdict that is not `PASS`, on a card, an owner action, a resubmit the run
does itself, or a reasoned wait. Cards carry code changes: the agent never edits `src/`, it files Notion cards that the
team pipeline builds, and clicks only the owner can do go to `docs/seo/owner-actions.md`.

Design: `docs/superpowers/specs/2026-10-25-seo-agent-design.md`. Catalogue: `scripts/seo/CHECKS.md`. The owner's study
the playbook follows: `docs/seo/indexing-guide.md`. Config: `scripts/seo/config.json`.

## Where things are

| Part | Where | Role |
|---|---|---|
| `seo` agent | `.claude/agents/seo.md` (model `fable`, effort high) | judges the audit digest and the Search Console data, decides, plans, writes cards and the owner list. Never edits `src/`. |
| `seo` skill | `.claude/skills/seo/SKILL.md` | hub: the areas (indexing now; queries, performance later), the state rules, token rules, which area skill to load. |
| `seo-indexing` skill | `.claude/skills/seo-indexing/SKILL.md` + `references/` | the 11-step playbook (one section per step: what, how, verify, Google likes / dislikes), the IX check catalogue, the card template, the owner-actions template. References are read per step, not whole. |
| scripts | `scripts/seo/` | measure and move data: audit, Search Console pull, ledger, Drive export, IndexNow, Notion push, the run orchestrator, the one-time auth. Node 22, `node --test`, no new npm dependencies (fetch + OAuth token refresh by hand). |
| knowledge base | `docs/seo/` | `indexing-guide.md` (the owner's study, markdown), `owner-actions.md` (what only the owner can click, kept current by the run), `README.md` (how the system runs, like `docs/logic-check/README.md`). |
| state | branch `checks-state`, `seo/ledger.json` | the per-URL ledger, written through `check-core/lib/state-store.mjs`. |
| workflows | `.github/workflows/seo-audit.yml`, `seo-weekly.yml` | post-deploy audit on every push to `main`; the weekly run. |

## How it runs

| trigger | what | why |
|---|---|---|
| push to `main` (`seo-audit.yml`) | wait until the two Vercel commit statuses (`Vercel – nba-minigames`, `Vercel – backend`) are `success` (poll `gh api …/commits/<sha>/statuses`, 15 min, as the `ship` skill); `audit.mjs --baseline <store's last results>`; on exit 3 (regression) one Slack line to `#agent-frontend` that starts `seo: production regression` and names the IX ids and URLs, and a **P0 card, Target `dev`** through `notion-push.mjs --priority P0` (the pipeline lets only check cards ship to `main`; an indexing regression is never a minutes-matter emergency because Google re-crawls over days, so the owner promotes dev as usual); the new results become the baseline on the store. No agent, ~2 min, no tokens. | the only thing worth checking after every deploy is "did we break something that was fine"; Search Console moves on a scale of days. |
| Monday 06:00 Europe/Paris (`seo-weekly.yml`, crons `0 4 * * 1` and `0 5 * * 1`, the second skipped when the store says this week ran) | `scripts/seo/run.mjs`: full audit, Search Console pull, ledger, agent, cards, IndexNow, Drive export, Slack. ubuntu-latest, ~10 min, `claude` through `CLAUDE_CODE_OAUTH_TOKEN` as `checks-weekly.yml` (preflight; without it, no judgement and the line says so). | Google's Search Console data is final with a 2–3 day lag; Monday morning gives the owner the week's list. |
| on demand | `/seo` (hub) or `/seo indexing` locally: the same `run.mjs` steps with `--notion dry` unless asked, the agent in this session instead of `claude -p`; `node scripts/seo/audit.mjs --site http://localhost:5173` for a dev build. | look now. |

Both workflows are `workflow_dispatch`-able; their knobs are under "The two workflows" below. GitHub runs schedules
and `push: main` workflows only from `main`: both files are inert until dev is promoted (as `checks-weekly.yml`).

## The weekly run, step by step

`node scripts/seo/run.mjs [--dry-run] [--gsc on|off] [--notion live|dry] [--slack on|off] [--agents on|off]
[--agent-model fable] [--agent-timeout-sec 1800] [--holder <id>] [--state-branch checks-state] [--no-state]`
(header of `scripts/seo/run.mjs`). One run, in this order:

| # | step | writes | skipped when |
|---|---|---|---|
| 0 | lock `<home>/seo/run.lock`, then the SEO lease `seo/lease.json` on the store (90 min) | the lease | another live run (lock) or holder (lease): exit 0 |
| 1 | pull the store's ledger | `ledger-previous.json` | `--no-state`: the home's ledger only |
| 2 | full audit of the site with the previous run's baseline | `digest.md`, `results.json`, `baseline.json` | never |
| 3 | Search Console: inspections of the audited URLs, the sitemaps, Search Analytics | `gsc.json`, `gsc-analytics.json`, `gsc-summary.md` (counts only) | `--gsc off`, or no Google credentials (then the owner action "Set up Search Console access" is filed) |
| 4 | ledger merge (audit + inspections) | `ledger-summary.md` | never |
| 5 | the `seo` agent (`claude -p --model <agent-model>`, killed after `--agent-timeout-sec`) | `findings.json`, `REPORT.md`, `docs/seo/owner-actions.md` (copied into the run dir; committed and pushed to `dev` when it changed) | `--agents off` or a failed preflight: a placeholder `REPORT.md`, the Slack line says `judgement needed` |
| 6 | Notion cards from `findings.json` (deduped by Source) → decisions into the ledger | cards, comments | no `findings.json`; `--notion dry` reads Notion and writes nothing |
| 7 | IndexNow for the URLs whose audit result changed | `indexnow.json` | no `indexNowKey`, or its key file not live |
| 8 | Drive export (ledger CSV, Search Analytics CSV, `REPORT.md`) | Drive files (copies in the run dir) | no `driveFolderId` or no credentials |
| 9 | the history entry (`ok` or `failed`), push the store | `seo/ledger.json` on `checks-state` | `--dry-run` |
| 10 | one Slack line to `#agent-frontend`, release the lease | the line | `--dry-run` / `--slack off`: printed as `dry: <line>` |

`--dry-run` measures everything and keeps it on the machine: no lease or ledger push, no card, no ping, no upload, no
commit, no Slack. A step that fails is reported as `failed: <step>` on the Slack line and the run goes on.

## Exit codes

| script | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| `run.mjs` | the run did its job (findings are not failures), or skipped (lock / lease) | an infra failure in a step | bad arguments | |
| `audit.mjs` | every check passed | a check failed | infra: site unreachable, bad arguments | a regression against the baseline |
| `ledger.mjs` | ok | a store or file error | bad arguments (also a `--run` without `results.json`) | |
| `notion-push.mjs` | done (`--validate-only`: `findings: valid (<n>)`) | a finding failed, or no `findings.json` | `findings.json` invalid, bad arguments | |
| `indexnow.mjs` | pinged, skipped or dry | the ping failed or was refused | bad arguments | |
| `export.mjs` | uploaded, dry or skipped | an upload or auth failed | bad arguments, no `REPORT.md` | |

## How to read a run

The run dir is `<home>/seo/runs/<runId>/` (`<home>` = `%LOCALAPPDATA%\nba-ui-check` on the owner's PC, `.ui-check/` in
a checkout elsewhere, so `.ui-check/seo/runs/` on GitHub's runner); the log is `<home>/seo/logs/run-<ts>.log`. The
console's second line names both: `seo-run: run <runId> · site <site> · <runDir>`.

1. `REPORT.md`: start here. The agent's summary, what it decided for every non-pass and why.
2. `owner-actions.md` (or `docs/seo/owner-actions.md` in the repo): what only you can click.
3. `digest.md`: the audit's failing IX checks with evidence, `## Regressions`, `## Coverage gaps`.
4. `gsc-summary.md` and `ledger-summary.md`: counts by verdict and coverage state, the data ages, what changed since
   the previous inspection, the URLs with failing IX checks.
5. The log: every step's line, the agent's exit, push results. Search Analytics numbers are never in any of these;
   they are only in the Drive export (`SEO/Indexing/exports/`).

On GitHub: the job's artifact `seo-weekly-<run id>-<attempt>` holds the log, `digest.md`, `REPORT.md`,
`ledger-summary.md` and `owner-actions.md` (never `gsc.json`, `gsc-analytics.json` or the exports: the repo is public);
`seo-audit-<run id>-<attempt>` holds `digest.md` and `results.json`, and the job summary shows the digest.

## The owner loop

1. Open `docs/seo/owner-actions.md` on `dev` (or the run artifact's copy, when the push was rejected). It lists "Do
   now" (e.g. "Request indexing" for a URL in Search Console, with the click path) and "Setup (once)".
2. Do the clicks.
3. Report each "Request indexing" click: `node scripts/seo/ledger.mjs requested <url>` (default note
   `URL Inspection → Request indexing`; `--note "…"` for another action). It pulls, appends to the URL's `requests[]`
   and pushes the store; the next run then waits 14 days before it asks for that URL again. In a Claude session, say
   you clicked and it runs the command for you.
4. Monday's run rewrites the file: done items disappear, new ones appear. Ticking boxes is only your own note.

## The two workflows

| | `seo-audit.yml` (post-deploy) | `seo-weekly.yml` (weekly) |
|---|---|---|
| triggers | `push` to `main`; `workflow_dispatch` | crons `0 4 * * 1` and `0 5 * * 1` (UTC; the second only a backup); `workflow_dispatch` |
| knobs (`workflow_dispatch`) | `site` (default `https://swishquest.com`), `slack` `on`/`off`, `notion` `live`/`dry` | `gsc` `on`/`off`, `notion` `live`/`dry`, `slack` `on`/`off`, `agents` `on`/`off`, `dry_run` (boolean), `agent_model` (default `fable`) |
| gate | waits for the two Vercel statuses of the pushed commit (30 s polls, 15 min); `failure`/`error` or a timeout → a `::warning::` and no audit | `ledger.mjs weekly-status --github-output` on a scheduled trigger: `done` (an `ok` run since Monday 00:00 Paris) or `busy` (another holder's lease) → skipped; a dispatch always runs |
| job | dev checkout (tooling), node 22, `npm ci`; `ledger.mjs baseline` → `audit.mjs --findings`; exit 3 → `notion-push.mjs --priority P0 --regressions-only` and the line `seo: production regression · <ids> · <urls>`; always `ledger.mjs record-audit`; exit 2 fails the job | dev checkout, node 22, `npm ci`, the Claude Code preflight (`claude -p --model <agent_model>`; a failure means `--agents off`), `run.mjs --holder cloud-<run id> --agent-model <agent_model> …knobs` |
| secrets | `NOTION_TOKEN`, `SLACK_BOT_TOKEN`; `CHECKS_STATE_TOKEN` and `GH_TOKEN` = the job's `github.token` | `GOOGLE_SEO_CLIENT_ID`, `GOOGLE_SEO_CLIENT_SECRET`, `GOOGLE_SEO_REFRESH_TOKEN`, `NOTION_TOKEN`, `SLACK_BOT_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`; `CHECKS_STATE_TOKEN` = `github.token` |
| permissions | `contents: write` (the `checks-state` branch) | `contents: write` (`checks-state` and the owner-actions commit to `dev`) |
| artifact (14 days) | `digest.md`, `results.json` | the log, `digest.md`, `REPORT.md`, `ledger-summary.md`, `owner-actions.md` |

**Inert until promoted.** GitHub runs `schedule` and `push: main` workflows only from the default branch's copy of the
file, so neither workflow does anything until the next dev → main promotion. The first live test after it: a
`workflow_dispatch` of each (Actions → the workflow → Run workflow, branch `main`); `seo-weekly` first with
`dry_run` on, then with the defaults.

The weekly run's owner-actions commit is a plain push to `dev` with the job's `github.token`. It is not force, and a
push made with that token starts no other workflow. If `dev` ever gets branch protection that rejects it, every week's
push fails: the run logs `owner actions: push rejected, file left in the run artifact` and carries on, and the file is
then only in the artifact.

## Owner setup

Once; it blocks the Search Console and Drive parts, the audit works without it.

1. Google Cloud: a project, enable **Search Console API** and **Google Drive API**, an OAuth client of type
   **Desktop app**, consent screen **published to Production** (a Testing app's refresh token dies after 7 days) with
   the owner as the only user.
2. `node scripts/seo/auth.mjs` locally, sign in as the Search Console owner account.
3. `gh secret set` the three Google secrets from the file it wrote, and keep `NOTION_TOKEN`, `SLACK_BOT_TOKEN`,
   `CLAUDE_CODE_OAUTH_TOKEN` as they are (the IndexNow key is committed config).
4. Create the Drive folder `SEO/Indexing/exports` and put its id in `scripts/seo/config.json` (the token is the
   owner's, so My Drive works; a service account could not write there since April 2025, which is why the design uses
   the owner's OAuth token).
5. Later, optional: Bing Webmaster Tools API key (`BING_WEBMASTER_KEY`) for URL submission beyond IndexNow.

The run degrades on purpose: no Google secrets → `--gsc off` behaviour and an owner action "set up Search Console
access"; key file not live → IndexNow skipped and a card to deploy it (once).

## Troubleshooting

| symptom | cause | fix |
|---|---|---|
| `gsc: skipped (no Google credentials)`, owner action "Set up Search Console access", nothing in Drive | the three `GOOGLE_SEO_*` secrets are not set (or, locally, `auth.mjs` was never run) | Owner setup above. The audit, ledger, cards and IndexNow work without them. |
| `gsc:` errors `429` (or `403`) on the inspections, some URLs not inspected | the URL Inspection quota (2,000 a day, 600 a minute per property; `inspectBudget` 200 per run): the client stops at the first 429/403 and the rest of the URLs get `budget` | nothing; the ledger keeps their last inspection and the next run inspects again. A 403 on the first inspection, week after week, instead means the signed-in account is not an owner/user of `sc-domain:swishquest.com`: re-run `auth.mjs` with the right account. A refresh token that stops working after 7 days means the consent screen is still in Testing: publish it to Production and re-run `auth.mjs`. |
| `seo-run: skipped, another run holds the SEO lease (seo/lease.json)`, or the gate says `seo-weekly busy` | another run (the cloud job, a PC run, a session) holds the lease; a killed run leaves it until its `until` (90 min after it started) | wait for the other run, or for the lease to expire; never delete `seo/lease.json` by hand while a run is live. A second local run on the same machine prints `seo-run already running (pid …)` (the lock file) and exits 0. |
| `export:` fails with `403` (or `404`) | the Drive folder in `config.json` `driveFolderId` was not created by, or is not shared with edit rights to, the account that ran `auth.mjs` (the token can write only where that account can) | create `SEO/Indexing/exports` while signed in as that account (or share the folder with it as editor) and put that folder's id in `config.json`. |
| `indexnow: 403 key invalid` (or `indexnow: skipped (key file … not live)`) | the key file `https://swishquest.com/<indexNowKey>.txt` is missing, not deployed yet, or its body is not exactly the key | deploy the key file (the run files a card for it once) and promote; the ping resumes on the next run. |
| `owner actions: push rejected, file left in the run artifact` | the push to `dev` was refused: branch protection on `dev`, or `dev` moved during the run | read `owner-actions.md` from the run artifact this week; for good, allow the Actions token to push `dev` (or drop the protection rule). `the tooling checkout is not at origin/dev` means the same: nothing was committed. |
| `judgement needed` on the Slack line | the agent did not run: `agents` off, the Claude preflight failed (`CLAUDE_CODE_OAUTH_TOKEN` expired), or the agent timed out | renew the token (`claude setup-token`, `gh secret set CLAUDE_CODE_OAUTH_TOKEN`), or judge the run in a session (`.claude/skills/seo/SKILL.md` §3). |
| the post-deploy job ends with `Vercel … SEO audit skipped` | a deploy of that commit failed, or did not finish within 15 min | fix the deploy; then run `seo-audit.yml` by hand (`workflow_dispatch`) once production is green. |
