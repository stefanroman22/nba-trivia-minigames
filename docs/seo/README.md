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
| scripts | `scripts/seo/` | measure and move data: audit, Search Console pull, ledger, IndexNow, Notion push, the run orchestrator, the one-time auth. Node 22, `node --test`, no new npm dependencies (fetch + OAuth token refresh by hand). |
| knowledge base | `docs/seo/` | `indexing-guide.md` (the owner's study, markdown), `owner-actions.md` (what only the owner can click, kept current by the run), `README.md` (how the system runs, like `docs/logic-check/README.md`). |
| state | branch `checks-state`, `seo/ledger.json` | the per-URL ledger, written through `check-core/lib/state-store.mjs`. |
| workflows | `.github/workflows/seo-audit.yml`, `seo-weekly.yml` | post-deploy audit on every push to `main`; the weekly run. |

## How it runs

| trigger | what | why |
|---|---|---|
| push to `main` (`seo-audit.yml`) | wait until the two Vercel commit statuses (`Vercel – nba-minigames`, `Vercel – backend`) are `success` (poll `gh api …/commits/<sha>/statuses`, 15 min, as the `ship` skill); `audit.mjs --baseline <store's last results>`; on exit 3 (regression) one Slack line to `#agent-frontend` that starts `seo: production regression` and names the IX ids and URLs, and a **P0 card, Target `dev`** through `notion-push.mjs --priority P0` (the pipeline lets only check cards ship to `main`; an indexing regression is never a minutes-matter emergency because Google re-crawls over days, so the owner promotes dev as usual); the new results become the baseline on the store. No agent, ~2 min, no tokens. | the only thing worth checking after every deploy is "did we break something that was fine"; Search Console moves on a scale of days. |
| Monday 06:00 Europe/Paris (`seo-weekly.yml`, crons `0 4 * * 1` and `0 5 * * 1`, the second skipped when the store says this week ran) | `scripts/seo/run.mjs`: full audit, Search Console pull, ledger, agent, cards, IndexNow, Slack. ubuntu-latest, ~10 min, `claude` through `CLAUDE_CODE_OAUTH_TOKEN` as `checks-weekly.yml` (preflight; without it, no judgement and the line says so). | Google's Search Console data is final with a 2–3 day lag; Monday morning gives the owner the week's list. |
| on demand | `/seo` (hub) or `/seo indexing` locally: the same `run.mjs` steps with `--notion dry` unless asked, the agent in this session instead of `claude -p`; `node scripts/seo/audit.mjs --site http://localhost:5173` for a dev build. | look now. |

Both workflows are `workflow_dispatch`-able; their knobs are under "The two workflows" below. GitHub runs schedules
and `push: main` workflows only from `main`: both files are inert until dev is promoted (as `checks-weekly.yml`).

## Before dev

The audits above run after a deploy to `main`. The same rules are checked earlier, before work lands on `dev`, in three
layers (design `docs/superpowers/specs/2026-10-26-seo-dev-gate-design.md`). The files that trigger them are one list,
`scripts/seo/lib/seo-paths.mjs` (pages, layouts, sitemap, robots, manifest, share images, `site.ts`, `GameUtils.tsx`,
`JsonLd.tsx`, `MiniGame.tsx`, `scripts/seo/config.json`, `keyword-map.json`).

| layer | what | where it runs | blocks |
|---|---|---|---|
| 1. rules | `docs/constraints/SEO_CONSTRAINTS.md` (`SEO-1` … `SEO-9`, each naming the check that proves it) | quoted in the team brief when a plan file is an SEO path; read by humans | no |
| 2. static check | `npm run check:seo` (`scripts/check-seo.mjs`, part of `npm run lint`): the source only, no build | pipeline gate 1 (verify: `npm run lint` for frontend changes, `check:seo` alone for an SEO-only config change); `dev-ci` lint job | yes |
| 3. built-page check | `audit.mjs` (IX) and `onpage.mjs` (OP) against the locally served production build, judged as swishquest.com | pipeline gate 2 (QA, `scripts/team/lib/seo-gate.mjs`, before the browser starts); `dev-ci` job `seo-pages` (push and PR to `dev`) | IX failures only; OP results are warnings |

Commands, locally (a production build: `npm run build`, then `next start -p 5400`; without `--run-dir` the files go
to `<home>/seo/runs/<runId>/`, `seo-pages` passes `--run-dir seo-gate/audit` and `seo-gate/onpage`):

```
npm run check:seo
node scripts/seo/audit.mjs  --site http://localhost:5400 --as https://swishquest.com
node scripts/seo/onpage.mjs --site http://localhost:5400 --as https://swishquest.com
```

**`--as <origin>`.** A local build names `https://swishquest.com` in its canonicals, sitemap and `og:image`. With
`--as`, every URL on that origin is read on `--site` and compared modulo the origin, so nothing leaves the local
server. The `X-Robots-Tag` response header is not judged: `next.config.ts` sends `X-Robots-Tag: noindex` to every host
that is not swishquest.com (previews stay out of Google), so a local build always carries it; the digest lists it
under Coverage gaps, and the post-deploy audit judges the header on production. The page's `<meta name="robots">` is
still judged. On a local host IX-01 (robots.txt disallows everything off production) and the IX-02 `http`/`www`
variants are skipped as well.

**What blocks.** `check:seo` violations (`SEO-n <file>: …`) fail gate 1 and the lint job. IX failures fail gate 2,
one QA failure per id (`seo IX-nn: <evidence>`, up to three evidence lines), and fail `seo-pages` (any non-zero audit
exit). In QA a transient result (a request that failed after retries), an infra exit (2) or a timeout is a note, and
a diff touching no SEO path, or a build served by `next dev`, runs no audit. OP failures never block: QA lists them as
`seo warning OP-nn …` notes, `seo-pages` as warnings in the job summary. The QA verdict notes carry one line
`seo: IX pass|FAIL … · on-page <n> warning(s)`; `seo-pages` uploads `digest.md` and `onpage-summary.md` (7 days) and is
not a promotion prerequisite.

## The weekly run, step by step

`node scripts/seo/run.mjs [--dry-run] [--gsc on|off] [--notion live|dry] [--slack on|off] [--agents on|off]
[--agent-model fable] [--agent-timeout-sec 1800] [--holder <id>] [--state-branch checks-state] [--no-state]
[--areas indexing|indexing,onpage]` (header of `scripts/seo/run.mjs`). One run, in this order (step 3b only with
`--areas indexing,onpage`, see "Phase 2: on-page" below):

| # | step | writes | skipped when |
|---|---|---|---|
| 0 | lock `<home>/seo/run.lock`, then the SEO lease `seo/lease.json` on the store (90 min) | the lease | another live run (lock) or holder (lease): exit 0 |
| 1 | pull the store's ledger | `ledger-previous.json` | `--no-state`: the home's ledger only |
| 2 | full audit of the site with the previous run's baseline | `digest.md`, `results.json`, `baseline.json` | never |
| 3 | Search Console: inspections of the audited URLs, the sitemaps | `gsc.json`, `gsc-summary.md` (counts only); with `--areas indexing,onpage` also `gsc-analytics-pq.json` (page × query, private) | `--gsc off`, or no Google credentials (then the owner action "Set up Search Console access" is filed) |
| 3b | on-page checks (`onpage.mjs`) in the run dir; with `--areas indexing,onpage` step 3 also pulls Search Analytics page × query | `onpage.json`, `onpage-summary.md`; `gsc-analytics-pq.json` and `queries-summary.md` (private) | without `--areas indexing,onpage` (the default) |
| 4 | ledger merge (audit + inspections) | `ledger-summary.md` | never |
| 5 | the `seo` agent (`claude -p --model <agent-model>`, killed after `--agent-timeout-sec`) | `findings.json`, `REPORT.md`, `docs/seo/owner-actions.md` (copied into the run dir; committed and pushed to `dev` when it changed) | `--agents off` or a failed preflight: a placeholder `REPORT.md`, the Slack line says `judgement needed` |
| 6 | Notion cards from `findings.json` (deduped by Source) → decisions into the ledger | cards, comments | no `findings.json`; `--notion dry` reads Notion and writes nothing |
| 7 | IndexNow for the URLs whose audit result changed | `indexnow.json` | no `indexNowKey`, or its key file not live |
| 8 | the history entry (`ok` or `failed`), push the store | `seo/ledger.json` on `checks-state` | `--dry-run` |
| 9 | one Slack line to `#agent-frontend`, release the lease | the line | `--dry-run` / `--slack off`: printed as `dry: <line>` |

`--dry-run` measures everything and keeps it on the machine: no lease or ledger push, no card, no ping, no commit,
no Slack. A step that fails is reported as `failed: <step>` on the Slack line and the run goes on.

## Exit codes

| script | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| `run.mjs` | the run did its job (findings are not failures), or skipped (lock / lease) | an infra failure in a step | bad arguments | |
| `audit.mjs` | every check passed | a check failed | infra: site unreachable, bad arguments | a regression against the baseline |
| `onpage.mjs` | every OP check passed | an OP check failed | infra: sitemap unreachable, bad arguments, an unreadable `--analytics` file | |
| `ledger.mjs` | ok | a store or file error | bad arguments (also a `--run` without `results.json`) | |
| `notion-push.mjs` | done (`--validate-only`: `findings: valid (<n>)`) | a finding failed, or no `findings.json` | `findings.json` invalid, bad arguments | |
| `indexnow.mjs` | pinged, skipped or dry | the ping failed or was refused | bad arguments | |

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
   the agent never stores them except phase 2's private run-dir files `gsc-analytics-pq.json`/`queries-summary.md`
   and Notion card bodies.

On GitHub: the job's artifact `seo-weekly-<run id>-<attempt>` holds the log, `digest.md`, `REPORT.md`,
`ledger-summary.md`, `owner-actions.md` and, with phase 2, `onpage-summary.md` (never `gsc.json`,
`gsc-analytics-pq.json` or `queries-summary.md`: the repo is public);
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
| knobs (`workflow_dispatch`) | `site` (default `https://swishquest.com`), `slack` `on`/`off`, `notion` `live`/`dry` | `gsc` `on`/`off`, `notion` `live`/`dry`, `slack` `on`/`off`, `agents` `on`/`off`, `dry_run` (boolean), `agent_model` (default `fable`), `areas` `indexing`/`indexing,onpage` (default `indexing`; the schedule passes none) |
| gate | waits for the two Vercel statuses of the pushed commit (30 s polls, 15 min); `failure`/`error` or a timeout → a `::warning::` and no audit | `ledger.mjs weekly-status --github-output` on a scheduled trigger: `done` (an `ok` run since Monday 00:00 Paris) or `busy` (another holder's lease) → skipped; a dispatch always runs |
| job | dev checkout (tooling), node 22, `npm ci`; `ledger.mjs baseline` → `audit.mjs --findings`; exit 3 → `notion-push.mjs --priority P0 --regressions-only` and the line `seo: production regression · <ids> · <urls>`; always `ledger.mjs record-audit`; the card, the line and the record only for the default `site` (a dispatch on another origin is an audit and its artifact alone); exit 2 fails the job | dev checkout, node 22, `npm ci`, the Claude Code preflight (`claude -p --model <agent_model>`; a failure means `--agents off`), `run.mjs --holder cloud-<run id> --agent-model <agent_model> …knobs` |
| secrets | `NOTION_TOKEN`, `SLACK_BOT_TOKEN`; `CHECKS_STATE_TOKEN` and `GH_TOKEN` = the job's `github.token` | `GOOGLE_SEO_CLIENT_ID`, `GOOGLE_SEO_CLIENT_SECRET`, `GOOGLE_SEO_REFRESH_TOKEN`, `NOTION_TOKEN`, `SLACK_BOT_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, `PSI_API_KEY` (optional, phase 2); `CHECKS_STATE_TOKEN` = `github.token` |
| permissions | `contents: write` (the `checks-state` branch) | `contents: write` (`checks-state` and the owner-actions commit to `dev`) |
| artifact (14 days) | `digest.md`, `results.json` | the log, `digest.md`, `REPORT.md`, `ledger-summary.md`, `owner-actions.md`, `onpage-summary.md` (phase 2) |

**Inert until promoted.** GitHub runs `schedule` and `push: main` workflows only from the default branch's copy of the
file, so neither workflow does anything until the next dev → main promotion. The first live test after it: a
`workflow_dispatch` of each (Actions → the workflow → Run workflow, branch `main`); `seo-weekly` first with
`dry_run` on, then with the defaults.

The weekly run's owner-actions commit is a plain push to `dev` with the job's `github.token`. It is not force, and a
push made with that token starts no other workflow. If `dev` ever gets branch protection that rejects it, every week's
push fails: the run logs `owner actions: push rejected, file left in the run artifact` and carries on, and the file is
then only in the artifact.

## Phase 2: on-page

Phase 1 gets the pages indexed; phase 2 makes them rank and get clicked. `scripts/seo/onpage.mjs` measures, GET only,
the home page and every sitemap URL against the keyword map `scripts/seo/keyword-map.json`: the keyword map (title and
H1 carry the page's primary query), the title, the description, the headings, the unique content and a how-to-play
section, the internal links between games, the URL shape, the images and their alt text, the structured data
(BreadcrumbList, VideoGame), page experience (HTML size, PageSpeed Insights when there is a key) and, with Search
Analytics page × query data, per-page query flags (`low-ctr`, `striking`, `mismatch`). The checks are the OP table
in `scripts/seo/CHECKS.md` ("On-page (phase 2)"); the agent's rules for them are the `seo-onpage` skill.

- On its own: `node scripts/seo/onpage.mjs --site https://swishquest.com [--run-dir <dir>] [--analytics <gsc-analytics-pq.json>] [--psi]`
  → `onpage.json`, `onpage-summary.md` (header `# seo-onpage: run … · <f> failing checks`, one `## FAIL OP-nn` per
  failing check, `## Coverage gaps`) and, with `--analytics`, `queries-summary.md`. Exit 0 all pass, 1 a check
  failed, 2 infra.
- In the weekly run: `node scripts/seo/run.mjs --areas indexing,onpage` (opt-in; the default `--areas indexing` is
  phase 1 exactly as before; `--areas onpage` alone is refused with exit 2: phase 2 runs on top of phase 1). The Search
  Console step then also pulls page × query (28 days) into `gsc-analytics-pq.json`, the on-page step runs after it in
  the same run dir, the agent loads `seo`, `seo-indexing` and `seo-onpage`, and the Slack line gets `· onpage fails <n>`
  (the failing OP checks that can be a card: never OP-07 or OP-11).
- On GitHub: `seo-weekly.yml` → Run workflow → `areas` `indexing,onpage`. The schedule passes no `--areas` (phase 1
  only) until the owner changes it.
- Cards: an OP finding is a card like an IX one (Target `dev`, category `frontend`), one per OP check (fingerprint
  `OP-nn|onpage`, the URLs in the body), P1 for OP-01, OP-02 and OP-05, P2 for the others; an OP check failing again
  after its card was Done is ordinary work, never the P0 of an IX regression. OP-07 (URL, existing URLs are never renamed) and OP-11 (measurement) are never a card.
- **Privacy.** Query strings and Search Analytics numbers (clicks, impressions, CTR, positions) live only in
  `gsc-analytics-pq.json` and `queries-summary.md` (first line `PRIVATE: …`) in the run dir, and in Notion card bodies.
  They never reach the console, the log, the Slack line, `REPORT.md`, `owner-actions.md`, the store or ledger or the
  workflow artifact (`onpage-summary.md`, uploaded, holds counts and page evidence only).
- `PSI_API_KEY` (optional; a free Google Cloud API key with the PageSpeed Insights API enabled, as a repo secret or a
  local env var): with it the on-page step passes `--psi` and OP-10 checks the mobile lab and field numbers of the
  home page and up to 3 game pages; without it, or on a 429/403, OP-10 checks the HTML size only and `onpage-summary.md`
  says so under Coverage gaps. The agent's env never gets the key.

## Owner setup

Once; it blocks the Search Console part, the audit works without it.

1. Google Cloud: a project, enable **Search Console API**, an OAuth client of type
   **Desktop app**, consent screen **published to Production** (a Testing app's refresh token dies after 7 days) with
   the owner as the only user.
2. `node scripts/seo/auth.mjs` locally, sign in as the Search Console owner account.
3. `gh secret set` the three Google secrets from the file it wrote, and keep `NOTION_TOKEN`, `SLACK_BOT_TOKEN`,
   `CLAUDE_CODE_OAUTH_TOKEN` as they are (the IndexNow key is committed config).
4. Later, optional: Bing Webmaster Tools API key (`BING_WEBMASTER_KEY`) for URL submission beyond IndexNow.

The run degrades on purpose: no Google secrets → `--gsc off` behaviour and an owner action "set up Search Console
access"; the IndexNow key file not live → IndexNow skipped. The key (`indexNowKey` in `scripts/seo/config.json`) is
public by protocol and committed with its key file `public/<indexNowKey>.txt`; the file goes live with the next
production deploy, and until then every run prints `indexnow: skipped (key file … not live)`.

## Troubleshooting

| symptom | cause | fix |
|---|---|---|
| `gsc: skipped (no Google credentials)`, owner action "Set up Search Console access" | the three `GOOGLE_SEO_*` secrets are not set (or, locally, `auth.mjs` was never run) | Owner setup above. The audit, ledger, cards and IndexNow work without them. |
| `gsc:` errors `429` (or `403`) on the inspections, some URLs not inspected | the URL Inspection quota (2,000 a day, 600 a minute per property; `inspectBudget` 200 per run): the client stops at the first 429/403 and the rest of the URLs get `budget` | nothing; the ledger keeps their last inspection and the next run inspects again. A 403 on the first inspection, week after week, instead means the signed-in account is not an owner/user of `sc-domain:swishquest.com`: re-run `auth.mjs` with the right account. A refresh token that stops working after 7 days means the consent screen is still in Testing: publish it to Production and re-run `auth.mjs`. |
| `seo-run: skipped, another run holds the SEO lease (seo/lease.json)`, or the gate says `seo-weekly busy` | another run (the cloud job, a PC run, a session) holds the lease; a killed run leaves it until its `until` (90 min after it started) | wait for the other run, or for the lease to expire; never delete `seo/lease.json` by hand while a run is live. A second local run on the same machine prints `seo-run already running (pid …)` (the lock file) and exits 0. |
| `indexnow: 403 key invalid` (or `indexnow: skipped (key file … not live)`) | the key file `https://swishquest.com/<indexNowKey>.txt` is missing, not deployed yet, or its body is not exactly the key | the file is `public/<indexNowKey>.txt` in the repo: promote dev so production serves it (or restore it, its body exactly the key); the ping resumes on the next run. |
| `owner actions: push rejected, file left in the run artifact` | the push to `dev` was refused: branch protection on `dev`, or `dev` moved again between the fast-forward and the push (a `dev` that moved during the run is fast-forwarded first) | read `owner-actions.md` from the run artifact this week; for good, allow the Actions token to push `dev` (or drop the protection rule). `the fast-forward to origin/dev failed` and `the tooling checkout is not at origin/dev` mean the same: nothing was committed. |
| `judgement needed` on the Slack line | the agent did not run: `agents` off, the Claude preflight failed (`CLAUDE_CODE_OAUTH_TOKEN` expired), or the agent timed out | renew the token (`claude setup-token`, `gh secret set CLAUDE_CODE_OAUTH_TOKEN`), or judge the run in a session (`.claude/skills/seo/SKILL.md` §3). |
| the post-deploy job ends with `Vercel … SEO audit skipped` | a deploy of that commit failed, or did not finish within 15 min | fix the deploy; then run `seo-audit.yml` by hand (`workflow_dispatch`) once production is green. |
