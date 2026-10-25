# SEO agent, phase 1: indexing — design

Date: 2026-10-25. Owner request: an SEO agent for this repo that, given the site as built, makes sure every page can be
indexed and stays indexable; keeps a log of which pages are indexed and when the data was last refreshed; pulls its own
data from Search Console; plans what to do next; and grows later into search-query work. Indexing is phase 1.
Background the owner studied: the "Page Indexing" guide written on 2026-10-25 (Drive `SEO/Indexing/Page Indexing.docx`);
the plan's first task brings it into the repo as `docs/seo/indexing-guide.md`, which this design's step catalogue follows.

## 1. Intent

Indexing is the gate: a page Google does not index cannot rank. swishquest.com already does most things right
(`robots.ts`, `sitemap.ts`, per-page canonicals, static game pages, JSON-LD), but nothing checks that this stays true
after every deploy, nothing records what Google actually indexed, and the manual Search Console chores in
`docs/SEO-OWNER-TODO.md` have no owner but the owner. The agent closes those three gaps.

**Goals**
- Every public page passes a fixed, numbered indexability audit (IX-01 … IX-12, §4) after every production deploy.
- A per-URL ledger says, with timestamps: what the audit found, what Google's index says (coverage, last crawl,
  canonical), when indexing was last requested, and when each data source was last refreshed.
- A weekly run refreshes Search Console data, updates the ledger, exports it to Drive `SEO/Indexing/`, files the code
  fixes it needs as Notion cards for the team pipeline, and posts one Slack line.
- The agent's reasoning is a skill with exact steps (what / how / verify) so a session can run it by hand (`/seo`).
- Phase 2 (search-query optimisation from Search Analytics) plugs in as a sibling skill without changing the agent.

**Non-goals (phase 1)**: writing new pages or content; ranking work; Core Web Vitals; automating the Search Console
"Request indexing" button (no API exists; the agent produces the list, the owner clicks); Bing Webmaster API (IndexNow
covers Bing; the API is a later option).

**Anti-goals**: the agent never edits product code (cards do); never requests indexing for an unchanged page twice;
never writes a secret, a token or Search Analytics numbers to a log, a console or a public branch (the repo and its
branches, run logs and artifacts are world-readable); never runs a write against swishquest.com (GET/HEAD only, as the
checkers).

## 2. Shape

| Part | Where | Role |
|---|---|---|
| `seo` agent | `.claude/agents/seo.md` (model `fable`, effort high) | judges the audit digest and the Search Console data, decides, plans, writes cards and the owner list. Never edits `src/`. |
| `seo` skill | `.claude/skills/seo/SKILL.md` | hub: the areas (indexing now; queries, performance later), the state rules, token rules, which area skill to load. |
| `seo-indexing` skill | `.claude/skills/seo-indexing/SKILL.md` + `references/` | the 11-step playbook (one section per step: what, how, verify, Google likes / dislikes), the IX check catalogue, the card template, the owner-actions template. References are read per step, not whole. |
| scripts | `scripts/seo/` (§5) | measure and move data: audit, Search Console pull, ledger, Drive export, IndexNow, Notion push, the run orchestrator, the one-time auth. Node 22, `node --test`, no new npm dependencies (fetch + OAuth token refresh by hand). |
| knowledge base | `docs/seo/` | `indexing-guide.md` (the owner's study, markdown), `owner-actions.md` (what only the owner can click, kept current by the run), `README.md` (how the system runs, like `docs/logic-check/README.md`). |
| state | branch `checks-state`, `seo/ledger.json` | the per-URL ledger (§6), written through `check-core/lib/state-store.mjs`. |
| workflows | `.github/workflows/seo-audit.yml`, `seo-weekly.yml` | post-deploy audit on every push to `main`; the weekly run (§7). |

Same split as UI check and Logic Check: **scripts measure, the agent judges**, Notion cards carry code changes to the
team pipeline, Slack gets one line. The agent reads only digests and summaries (token rules as the `ui-check` skill).

## 3. The agent and the skills

**`seo.md`** is short. It states the mandate, the token rules, the boundary (no product code; cards instead), and the
three things it produces: a decision digest (`<uicHome>/seo/runs/<runId>/REPORT.md`; `uicHome()` from
`check-core/lib/home.mjs`, so the runs sit next to the checkers' and are already git-ignored), Notion cards,
`docs/seo/owner-actions.md`.
It loads the `seo` hub skill first, then the area skill the task names. In the weekly run it is driven by `claude -p`
with the run's prompt on stdin (as the checks' triage); locally it is dispatched by the `/seo` skill or called by name.

**`seo` hub skill**: a page. Areas table (`seo-indexing` live; `seo-queries`, `seo-performance` reserved), the ledger
and export rules (§6), the model rule (judgement runs on `fable`; nothing the agent does needs a cheaper tier because
the scripts do the bulk work), and the read budget: `digest.md` header + `## FAIL` sections, `ledger-summary.md`,
`gsc-summary.md`, never `results.json`, never the full ledger, never an export.

**`seo-indexing` skill**: the playbook. One section per step, in the order of `docs/seo/indexing-guide.md` §4:
1 robots.txt · 2 noindex on purpose · 3 one clean URL and status code · 4 canonical · 5 content and links in the HTML ·
6 title and description · 7 structured data · 8 sitemap · 9 internal and external links · 10 submit to Google and Bing ·
11 check the result and fix what is reported. Each section: **What** (the rule), **How** (the exact command or file in
this repo: `src/app/robots.ts`, `src/app/sitemap.ts`, `src/app/[game]/page.tsx`, …), **Verify** (the IX check ids that
prove it, and the Search Console field that confirms it), **Google likes / does not like** (from the guide). The
references hold what a step needs only sometimes: `references/google-rules.md` (robots, sitemap, canonical, JavaScript,
title rules with the source URLs), `references/gsc-fields.md` (the `UrlInspectionResult` enums and the Pages-report
statuses → action), `references/nextjs-patterns.md` (where each signal is set in this codebase), `references/card-template.md`,
`references/owner-actions-template.md`.

The playbook's output contract per run: for every IX failure or Search Console verdict that is not `PASS`, either a
card (code change), an owner action (a click only the owner can do), an IndexNow/sitemap resubmit the run does itself,
or an explicit "wait" with the reason and a re-check date, written to `REPORT.md` and mirrored into the ledger.

## 4. The audit: IX checks (deterministic, no browser, GET/HEAD only)

`scripts/seo/audit.mjs` fetches `/robots.txt`, `/sitemap.xml`, every sitemap URL, the home page and the pages of the
expected-noindex list, with a Googlebot-like mobile user agent, and runs:

| id | check | pass |
|---|---|---|
| IX-01 | robots.txt | 200, parses, `User-agent: *` allows every sitemap URL, disallows `/admin`, names the sitemap URL; no `noindex`/`crawl-delay` lines |
| IX-02 | status | every sitemap URL answers 200 over HTTPS; `http://` and `https://www.` variants redirect to it in one hop (301/308); an unknown slug returns 404, not 200 |
| IX-03 | noindex | no sitemap URL carries `<meta name="robots" content="…noindex…">` or an `X-Robots-Tag: noindex`; every URL of the expected-noindex list (`/admin`, `/profile`, `/credits`, `/coming-soon`) does, and is absent from the sitemap |
| IX-04 | canonical | exactly one `<link rel="canonical">`, absolute, equal to the sitemap URL; `?ref=x` variants keep it |
| IX-05 | title | present, unique across the site, 10–70 characters, not the bare site name |
| IX-06 | description | present, unique, 50–160 characters |
| IX-07 | heading | one visible `<h1>` in the server HTML |
| IX-08 | content in HTML | the server HTML (no JavaScript run) holds ≥ 300 characters of text outside `<nav>`/`<footer>`/`<script>` and ≥ 1 internal `<a href>` |
| IX-09 | structured data | every `application/ld+json` block parses, has `@context` and `@type`, and its `url` equals the canonical; the game markup has no `aggregateRating`/`review` |
| IX-10 | sitemap | XML parses, absolute URLs, every URL canonical and 200, no `priority`/`changefreq`, `lastmod` (where present) is ISO and not in the future and not equal on every URL |
| IX-11 | internal links | every sitemap URL is linked (`<a href>`) from the home page or from another sitemap URL (orphan check) |
| IX-12 | share and icons | `og:title`, `og:description`, `og:image` present; the `og:image` URL answers 200 with an image type; `/favicon.ico` and the manifest answer 200 |

Catalogue in `scripts/seo/CHECKS.md` (id, what, pass rule, which playbook step, which files set the signal). Output in
`<uicHome>/seo/runs/<runId>/` (`runId` = `YYYYMMDD-HHmm-seo`): `results.json` (per URL per check), `digest.md` (header: site, run, counts; one `## FAIL IX-nn`
section per failing check with the URLs and the evidence line; `## Coverage gaps`). Exit 0 all pass, 1 a check failed,
2 infra. `--baseline <results.json>` adds a `## Regressions` section (a check that passed in the baseline and fails
now) and exit 3 when there is one: that is what the post-deploy workflow alerts on. `--only IX-04` and `--url <u>`
subset; `--site <url>` for another host (dev previews block crawling by design, so the audit expects `Disallow: /`
there and only checks the HTML signals).

## 5. Scripts

| file | what |
|---|---|
| `audit.mjs` | §4. Pure fetch; the HTML checks are functions over a string, unit-tested on fixtures in `scripts/seo/fixtures/`. |
| `gsc.mjs` | Search Console through fetch: `token` (refresh → access token, cached in memory), `sitemaps list|submit`, `inspect <url>` (`urlInspection/index:inspect`, property `sc-domain:swishquest.com`), `analytics --days 28 --dimensions page` (`searchanalytics/query`). Quota guard: at most 200 inspections per run (the property allows 2,000/day, 600/min). Writes `gsc.json` to the run dir; prints a 10-line `gsc-summary.md`. |
| `ledger.mjs` | §6: merge a run's audit + Search Console results into `seo/ledger.json` on the store; print `ledger-summary.md` (counts by coverage state, URLs whose state changed, data ages). |
| `indexnow.mjs` | the key file check (`https://swishquest.com/<key>.txt` answers 200 with the key) and the batch POST to `https://api.indexnow.org/indexnow` for the URLs whose audit result or `lastmod` changed since the last run (Bing, Yandex, Naver, Seznam share it; Google does not use it). The key is **public by protocol** (the file must be fetchable by anyone), so it is plain config: `scripts/seo/config.json` `indexNowKey` and the file `public/<key>.txt`, both committed; no secret. Until the file is live the run skips the ping and files the card once. |
| `notion-push.mjs` | the agent's findings (`findings.json` in the run dir, §3 contract) → ordinary team cards through `scripts/notion.mjs create-card`, deduped by Source `seo-check fp:<12-hex> run:<runId>` with `find-cards --source-fp` (same decision table as `check-core/notion-push.mjs`: open → comment "seen again"; Done with Commit on main → Regression card; Done without Commit → skip). Category `frontend` (or `CI/CD` for workflow cards), Priority from severity, Target always `dev`. **Not** a check card: `isCheckCard` must stay false (Source prefix `seo-check`) **and the card gets no file attachment** (QA's `verifyPlan` treats any `findings.json` attachment as a check card and would run the UI verifier on it): the findings go into the body (§8). The pipeline then runs classify → plan → build → QA → review → ship as for any owner card. |
| `export.mjs` | Drive: `ledger-<date>.csv`, `gsc-analytics-<date>.csv`, `REPORT-<date>.md` into the folder `SEO/Indexing/exports/` (folder id in `scripts/seo/config.json`), multipart upload through the Drive API with the same OAuth token. Search Analytics numbers exist only here and in the owner's Slack line's totals. |
| `run.mjs` | the weekly orchestrator (cross-platform, as `check-run.mjs`): lock + store lease (`seo/lease.json` on the store, written with `state-store.update()`; the checks' `acquireLease` is hard-wired to `weekly.json`) → pull the store → audit `--baseline` last run → gsc pull → ledger merge → `claude -p` with the `seo` agent on the summaries (`--model` from `--agent-model`, default `fable`; watchdog 30 min; `--agents off` skips it and the Slack line says "judgement needed") → notion-push → indexnow → export → push the store → Slack line → release. `--dry-run`, `--notion live|dry`, `--slack on|off`, `--gsc on|off` (off = audit only, no credentials needed). |
| `auth.mjs` | one-time, local, run by the owner: OAuth 2.0 installed-app flow with a loopback redirect, scopes `webmasters` and `drive`; prints nothing secret; writes the refresh token to `%LOCALAPPDATA%\nba-seo\google-oauth.json` and prints the three `gh secret set … < file` commands to run. |

Env: `GOOGLE_SEO_CLIENT_ID`, `GOOGLE_SEO_CLIENT_SECRET`, `GOOGLE_SEO_REFRESH_TOKEN` (Actions secrets; locally from the
auth file), `NOTION_TOKEN`, `SLACK_BOT_TOKEN`, `CHECKS_STATE_TOKEN` (as the checks). `run.mjs` removes every secret
from the env before it starts `claude`.

## 6. State: the ledger and the exports

`seo/ledger.json` on `checks-state` (through `state-store.mjs`: add `seo/ledger.json` to its file list with a
`merge3Map` by URL, so the weekly run, a PC run and a `/seo` session never clobber each other):

```
{ "dataAsOf": { "audit": iso, "gsc": iso, "indexnow": iso },
  "urls": { "https://swishquest.com/wordle": {
      "inSitemap": true, "expectNoindex": false,
      "audit":   { "runId": "20261027-0600-seo", "pass": ["IX-01", …], "fail": [] },
      "gsc":     { "verdict": "PASS", "coverageState": "Submitted and indexed", "indexingState": "INDEXING_ALLOWED",
                   "pageFetchState": "SUCCESSFUL", "robotsTxtState": "ALLOWED", "lastCrawlTime": iso,
                   "googleCanonical": "…", "userCanonical": "…", "crawledAs": "MOBILE", "inspectedAt": iso },
      "requests": [ { "at": iso, "by": "owner", "note": "URL Inspection → Request indexing" } ],
      "indexnow": { "lastPingAt": iso, "status": 200 },
      "decision": { "runId": "…", "kind": "card|owner|wait|none", "ref": "<card url | action id>", "recheckAfter": iso } } },
  "history": [ { "runId": "…", "at": iso, "indexed": 14, "notIndexed": 1, "failedChecks": 0, "cards": 1 } ] }
```

Rules: the public branch holds coverage, not clicks (no Search Analytics in the ledger); `requests[]` is appended by the
owner through `node scripts/seo/ledger.mjs requested <url>` (or the `/seo` skill when the owner says they clicked) so
the agent never asks for the same unchanged page twice; `history` keeps 52 runs. Exports (Drive) are the full picture:
the ledger as CSV, Search Analytics by page for the last 28 days, `REPORT.md`. `docs/seo/owner-actions.md` is
rewritten by every run from the `owner` decisions (checkbox list with the exact click path, the run id and the URL),
and committed to dev by the run only when it changed (the run's tooling checkout is dev; the commit is
`seo: owner actions <runId>`), so the owner reads one file, on GitHub or locally.

## 7. When it runs

| trigger | what | why |
|---|---|---|
| push to `main` (`seo-audit.yml`) | wait until the two Vercel commit statuses (`Vercel – nba-minigames`, `Vercel – backend`) are `success` (poll `gh api …/commits/<sha>/statuses`, 15 min, as the `ship` skill); `audit.mjs --baseline <store's last results>`; on exit 3 (regression) one Slack line to `#agent-frontend` that starts `seo: production regression` and names the IX ids and URLs, and a **P0 card, Target `dev`** through `notion-push.mjs --priority P0` (the pipeline lets only check cards ship to `main`; an indexing regression is never a minutes-matter emergency because Google re-crawls over days, so the owner promotes dev as usual); the new results become the baseline on the store. No agent, ~2 min, no tokens. | the only thing worth checking after every deploy is "did we break something that was fine"; Search Console moves on a scale of days. |
| Monday 06:00 Europe/Paris (`seo-weekly.yml`, crons `0 4 * * 1` and `0 5 * * 1`, the second skipped when the store says this week ran) | `scripts/seo/run.mjs` (§5): full audit, Search Console pull, ledger, agent, cards, IndexNow, Drive export, Slack. ubuntu-latest, ~10 min, `claude` through `CLAUDE_CODE_OAUTH_TOKEN` as `checks-weekly.yml` (preflight; without it, no judgement and the line says so). | Google's Search Console data is final with a 2–3 day lag; Monday morning gives the owner the week's list. |
| on demand | `/seo` (hub) or `/seo indexing` locally: the same `run.mjs` steps with `--notion dry` unless asked, the agent in this session instead of `claude -p`; `node scripts/seo/audit.mjs --site http://localhost:5173` for a dev build. | look now. |

Both workflows are `workflow_dispatch`-able with the same knobs as the checks (`notion`, `slack`, `agents`, `gsc`,
`dry_run`). GitHub runs schedules only from `main`: the weekly file is inert until dev is promoted (as `checks-weekly.yml`).

## 8. Card and owner-action contracts

A card (from `references/card-template.md`): title `[seo] <IX-id> <what> on <n> page(s)`; body = Current (the evidence
line from the digest), Expected (the pass rule), Files (from `references/nextjs-patterns.md`), How to fix (the playbook
step's How), Acceptance (`node scripts/seo/audit.mjs --only IX-nn --site <dev preview or localhost>` passes, plus
`{route, selector, expect}` QA assertions where a selector exists, for example `link[rel=canonical]`), the findings
as a fenced JSON block at the end of the body (never as an attachment, §5), Source `seo-check fp:<key> run:<runId>`,
Target `dev`, Priority P0 for IX-01/02/03/04 failures on a sitemap URL (the page cannot be indexed) and for every
post-deploy regression, P1 for IX-05…IX-11, P2 for IX-12.

An owner action: id `OA-<runId>-<n>`, the exact click path (as `docs/SEO-OWNER-TODO.md` writes them), the URL, the
reason (the Search Console verdict), and what the owner tells the system afterwards (`ledger.mjs requested <url>`).
Phase 1 owner actions: Request indexing for a URL whose `verdict` is not `PASS` and whose audit passes (max 10 per run,
oldest `lastCrawlTime` first); Bing Webmaster Tools import; the one-time Google OAuth setup (§9).

## 9. Owner setup (once, blocks the Search Console and Drive parts; the audit works without it)

1. Google Cloud: a project, enable **Search Console API** and **Google Drive API**, an OAuth client of type
   **Desktop app**, consent screen **published to Production** (a Testing app's refresh token dies after 7 days) with
   the owner as the only user. 2. `node scripts/seo/auth.mjs` locally, sign in as the Search Console owner account.
3. `gh secret set` the three Google secrets from the file it wrote, and keep `NOTION_TOKEN`, `SLACK_BOT_TOKEN`,
`CLAUDE_CODE_OAUTH_TOKEN` as they are (the IndexNow key is committed config, §5). 4. Create the Drive folder
`SEO/Indexing/exports` and put its id in `scripts/seo/config.json` (the token is the owner's, so My Drive works; a
service account could not write there since April 2025, which is why the design uses the owner's OAuth token).
5. Later, optional: Bing Webmaster Tools API key (`BING_WEBMASTER_KEY`) for URL submission beyond IndexNow.

The run degrades on purpose: no Google secrets → `--gsc off` behaviour and an owner action "set up Search Console
access"; key file not live → IndexNow skipped and a card to deploy it (once).

## 10. Decisions and their reasons

- **Owner OAuth token, not a service account.** URL Inspection needs an Owner/Full user; Drive exports go to My Drive;
  new service accounts cannot own My Drive files. One credential, one setup, both APIs.
- **Ordinary cards, not check cards.** The check-card path hard-wires the UI verifier; SEO fixes are normal frontend
  changes whose acceptance is the audit command. Dedupe by Source stays.
- **Scripts first, agent second, Fable for the agent.** The audit and the data moves are deterministic and tested; the
  judgement (what a Search Console verdict means for a page, what to wait for, what to file) is the only token spend,
  and the owner asked for the strongest model there.
- **Post-deploy = regression only.** No agent, no tokens, alerts only on "was fine, now broken", because that is the
  one thing a deploy can change.
- **Search Analytics never on the public branch.** Coverage is public knowledge (anyone can `site:` search); clicks
  and queries are business data: Drive only.
- **Every SEO card targets `dev`.** The pipeline's `main` route is reserved for check cards (`team-run`, `ship`,
  PIPELINE.md §15) and widening it is not worth it: an indexing regression is a P0 card plus a Slack line, and the
  owner promotes dev as usual. (Builder-check question 1; this design's call.)
- **The IndexNow key is public config, not a secret.** The protocol requires the key file to be fetchable by anyone,
  so a secret would be theatre. (Builder-check question 3.)
- **No attachments on SEO cards.** QA's `verifyPlan` treats any attached `findings.json` as a check card. (Builder
  check.)
- **Reuse `check-core`** (state store, lease, Slack line, Notion CLI, checkout rules) rather than a second
  infrastructure. The SEO run is a third checker in that family in spirit, with its own store files and lease.

## 11. Left to the builder

The exact text-extraction heuristic of IX-08; the fixture HTML; the CSV columns; the Slack line wording (follow
`check-summary.mjs`); the `run.mjs` lock file name; the `nextjs-patterns.md` content (derive it from `src/app/`); the
weekly cron gate (copy `weekly-slot.mjs`'s store check, no wait-for-slot needed); which `claude -p` model alias
spells Fable on the CLI (preflight it as `checks-weekly.yml` does; fall back to `opus` with a line in the report).

## 12. Verification of the design

- `node --test scripts/seo/` green; `audit.mjs --site https://swishquest.com` exits 0 on today's site except the
  known gaps this design expects it to find (IX-10: game pages have no `lastmod` — expected, by `sitemap.ts`'s rule, so
  the check only rejects `lastmod` that is wrong, never missing; IX-11 passes if the home page links every game).
- A dry weekly run (`--notion dry --slack off --gsc off`) produces `REPORT.md`, `ledger-summary.md`, an updated
  `owner-actions.md`, and no card.
- A `--gsc on` run after the owner setup fills `gsc` for every sitemap URL and exports three files to Drive.
- A deliberate regression on a preview (`--site <preview>` with a page given `noindex`) makes `audit.mjs --baseline`
  exit 3 with IX-03 in `## Regressions`.
