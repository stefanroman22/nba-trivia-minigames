# SEO Agent (phase 1: indexing) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An `seo` agent plus `scripts/seo/` that audit every public page of swishquest.com for indexability after each production deploy, pull Search Console data weekly into a per-URL ledger, export it to Drive, file code fixes as Notion cards and tell the owner what only they can click.

**Architecture:** Scripts measure (fetch-only audit, Search Console and Drive through the owner's OAuth token, ledger on the `checks-state` branch through `check-core/lib/state-store.mjs`); the `seo` agent (Fable) judges the summaries and writes decisions; ordinary Notion cards carry code changes to the team pipeline; two GitHub workflows run it (post-deploy audit, Monday weekly run).

**Tech Stack:** Node 22 ESM, `node --test`, global `fetch`, no new npm dependencies; `scripts/notion.mjs`, `scripts/check-core/lib/{home,state-store,state-merge,slack-line,card-body}.mjs`; GitHub Actions ubuntu-latest; Claude Code agent + skills.

**Spec:** `docs/superpowers/specs/2026-10-25-seo-agent-design.md`

## Global Constraints

- Node 22, ESM `.mjs`, `node --test` test files named `*.test.mjs` next to the code; no new entries in `package.json` `dependencies`.
- Live site traffic is GET/HEAD only; user agent `Mozilla/5.0 (Linux; Android 10) ... (compatible; swishquest-seo-audit/1.0)`; at most 4 requests in flight; 15 s timeout per request.
- Never print or log a token, a client secret or Search Analytics numbers (clicks, impressions, queries); the repo, the `checks-state` branch, the run logs and the artifacts are public.
- The ledger (`seo/ledger.json`) holds coverage and audit state only; Search Analytics goes to Drive exports only.
- Cards: Source `seo-check fp:<12-hex> run:<runId>`, Target `dev`, no file attachment, findings in the body.
- Property `sc-domain:swishquest.com`; site `https://swishquest.com`; `runId` = `YYYYMMDD-HHmm-seo`; run dir `<uicHome()>/seo/runs/<runId>/`.
- Expected-noindex pages: `/admin`, `/profile`, `/credits`, `/coming-soon` (noindex and absent from the sitemap).
- Agents never edit `src/`; the `seo` agent's writes are limited to the run dir, `findings.json`, and `docs/seo/owner-actions.md`.

## Review Focus

1. A sitemap URL that redirects (301 to another sitemap URL): IX-02 must fail that URL and IX-10 must name it; the audit must not follow the redirect and audit the target twice. Test in Task 3.
2. `robots.txt` on a preview host (`Disallow: /`): the audit with `--site <preview>` must not report IX-01 as a failure but must still run the HTML checks. Test in Task 3.
3. A Search Console inspection that returns HTTP 429 or 403 mid-run: the run keeps the previous `gsc` block for that URL, records `gsc.error`, and the quota guard stops further calls; no exception kills the run. Test in Task 4.
4. Two writers of the ledger (weekly run and a `/seo` session) touching different URLs: both changes survive the store merge; same URL, the newer `inspectedAt` wins. Test in Task 5.
5. A card for a finding whose earlier card is Done with a Commit not yet on `origin/main`: no new card and no "seen again" comment on a Done card. Test in Task 6.

---

### Task 1: Knowledge base, config and catalogue

**Files:**
- Create: `docs/seo/indexing-guide.md`, `docs/seo/README.md`, `scripts/seo/CHECKS.md`, `scripts/seo/config.json`
- Modify: `package.json` (scripts), `docs/SEO-OWNER-TODO.md` (one pointer line at the top)

**Interfaces:**
- Produces: `scripts/seo/config.json` = `{ "site": "https://swishquest.com", "property": "sc-domain:swishquest.com", "expectedNoindex": ["/admin","/profile","/credits","/coming-soon"], "driveFolderId": null, "indexNowKey": null, "slackChannel": "agent-frontend", "inspectBudget": 200 }` (read by every script through `lib/config.mjs` of Task 2).

- [ ] **Step 1: Write `docs/seo/indexing-guide.md`** from the owner's guide (its text is the string literals of `C:\Users\stefa\AppData\Local\Temp\claude\c--Users-stefa-OneDrive-Desktop-nba-projects\a221acc0-2e46-4484-8d95-84a0d02ad57c\scratchpad\seo\build2.py`; the Drive file `SEO/Indexing/Page Indexing.docx` is the same content): sections 1–3 (what indexing is, the inverted index, why it matters, the overall system with the five stages), section 4 "Steps to get a page indexed" with the 11 steps, each with What / How / swishquest.com example / Google likes / Google does not like, and the Sources list. Plain markdown, code blocks for the files, no images.
- [ ] **Step 2: Write `scripts/seo/CHECKS.md`**: a table with columns `id | what | pass rule | step | files` for IX-01 … IX-12 copied from the spec §4, `step` = the guide's step number, `files` = the `src/app/…` file that sets the signal (`robots.ts`, `sitemap.ts`, `[game]/page.tsx`, `layout.tsx`, `page.tsx`, `opengraph-image.tsx`, `manifest.ts`).
- [ ] **Step 3: Write `scripts/seo/config.json`** with the values in Interfaces.
- [ ] **Step 4: Add `"test:seo": "node --test scripts/seo/"` and `"seo:audit": "node scripts/seo/audit.mjs"` to `package.json` scripts; add at the top of `docs/SEO-OWNER-TODO.md`: `> Superseded by docs/seo/owner-actions.md (written by the SEO run) from 2026-10-25; kept for the history of the move.`**
- [ ] **Step 5: Write `docs/seo/README.md`** (skeleton to be completed in Task 10): title, one paragraph (scripts measure, the agent judges, cards carry code changes), the file table from spec §2, "How it runs" with the three triggers from spec §7, "Owner setup" copied from spec §9.
- [ ] **Step 6: Run `npm run test:seo`**. Expected: `node --test` finds no test files yet and exits 0 (or prints "no test files" — either is fine for this task).
- [ ] **Step 7: Commit**

```bash
git add docs/seo scripts/seo/CHECKS.md scripts/seo/config.json package.json docs/SEO-OWNER-TODO.md
git commit -m "seo: knowledge base, check catalogue and config"
```

### Task 2: HTML signal checks (pure functions)

**Files:**
- Create: `scripts/seo/lib/config.mjs`, `scripts/seo/lib/html-checks.mjs`, `scripts/seo/lib/html-checks.test.mjs`, `scripts/seo/fixtures/page-ok.html`, `scripts/seo/fixtures/page-bad.html`

**Interfaces:**
- Produces: `loadConfig(): Config` (reads `scripts/seo/config.json`, env `SEO_SITE` overrides `site`).
- Produces: `extractSignals(html: string, { url: string }): Signals` where `Signals = { title, description, canonical: string[], robotsMeta: string[], h1Count, textLength, internalLinks: string[] (absolute, same host), jsonLd: { ok: boolean, blocks: object[], errors: string[] }, og: { title, description, image }, viewport: boolean }`.
- Produces: `checkPage(signals: Signals, ctx: { url, sitemapUrl, expectNoindex: boolean, xRobotsTag: string|null, siteTitles: Map<string,string[]>, siteDescriptions: Map<string,string[]> }): Failure[]` with `Failure = { id: 'IX-03'|'IX-04'|'IX-05'|'IX-06'|'IX-07'|'IX-08'|'IX-09'|'IX-12', url, evidence: string }` (one per failing check per URL; "Failure" is the audit's unit, "Finding" (Task 6) is the agent's; IX-12 here covers the presence of the three `og:` tags; the fetch of `og:image`/favicon/manifest is Task 3).

- [ ] **Step 1: Write fixtures.** `page-ok.html`: a full page modelled on `https://swishquest.com/wordle` (title `NBA Wordle | Swish Quest`, description 120 chars, one canonical `https://swishquest.com/wordle`, no robots meta, one `<h1>`, 400+ chars of text in `<main>`, 3 internal `<a href>`, one valid JSON-LD with `"url": "https://swishquest.com/wordle"`, the three `og:` tags, viewport meta). `page-bad.html`: two canonicals (one relative), `<meta name="robots" content="noindex">`, no `<h1>`, 80 chars of text, JSON-LD with a trailing comma, title `Swish Quest`, no description, JSON-LD with `aggregateRating`.
- [ ] **Step 2: Write the failing tests** in `html-checks.test.mjs`:

```js
test('extractSignals reads the ok page', …)   // title, canonical.length === 1, h1Count === 1, textLength >= 300, internalLinks.length === 3, jsonLd.ok
test('checkPage: ok page has no findings', …) // []
test('checkPage: bad page fails IX-03 IX-04 IX-05 IX-06 IX-07 IX-08 IX-09', …) // ids sorted equal
test('IX-03 passes on an expected-noindex page that carries noindex, fails when it does not', …)
test('IX-03 fails on X-Robots-Tag: noindex even with no meta', …)
test('IX-04 fails when canonical differs from sitemapUrl, passes with ?ref=x in url', …)
test('IX-05 fails a duplicate title across two URLs (siteTitles has 2 urls for the title)', …)
test('IX-09 fails jsonLd whose url is not the canonical, and a VideoGame block with aggregateRating', …)
test('IX-12 fails when og:image is missing', …)
```

- [ ] **Step 3: Run `node --test scripts/seo/lib/html-checks.test.mjs`**. Expected: FAIL, module not found.
- [ ] **Step 4: Implement `lib/config.mjs` and `lib/html-checks.mjs`.** Parsing with regexes over the string is enough (no DOM): `<title>`, `<meta name=… content=…>` in either attribute order, `<link rel="canonical" href>`, `<script type="application/ld+json">…</script>` (decode `<`), `<a href>` resolved with `new URL(href, url)` and filtered to the site host, text = the body with `<script>`, `<style>`, `<nav>`, `<header>`, `<footer>`, tags and entities stripped, whitespace collapsed. Title rule: 10–70 chars and not equal (case-insensitive, trimmed) to `Swish Quest`; description 50–160.
- [ ] **Step 5: Run the tests.** Expected: all PASS.
- [ ] **Step 6: Commit** `git commit -m "seo: html signal checks"`.

### Task 3: The audit (fetch, sitemap, robots, status, links, digest, baseline)

**Files:**
- Create: `scripts/seo/lib/fetcher.mjs`, `scripts/seo/lib/robots.mjs`, `scripts/seo/lib/sitemap.mjs`, `scripts/seo/lib/digest.mjs`, `scripts/seo/audit.mjs`, `scripts/seo/audit.test.mjs`, `scripts/seo/fixtures/site/` (a static fake site: `robots.txt`, `sitemap.xml`, `index.html`, `wordle.html`, `orphan.html`, `admin.html`, `old.html` that the test server answers with a 301 to `/wordle`)

**Interfaces:**
- Consumes: `extractSignals`, `checkPage`, `loadConfig` (Task 2).
- Produces: `fetcher({ ua, concurrency: 4, timeoutMs: 15000, redirect: 'manual' })` → `{ get(url): Promise<{ status, headers, body, location }>, head(url) }`.
- Produces: `parseRobots(text): { groups: [{ agents: string[], allow: string[], disallow: string[] }], sitemaps: string[], unsupported: string[] }`, `robotsAllows(robots, url, agent = '*'): boolean` (longest-match rule).
- Produces: `parseSitemap(xml): { urls: [{ loc, lastmod }], errors: string[], hasPriorityOrChangefreq: boolean }`.
- Produces: `runAudit({ site, config, fetcher, baseline = null }): Promise<AuditResult>` with `AuditResult = { runId, site, urls: { [url]: { status, failures: Failure[] } }, siteFailures: Failure[] (IX-01, IX-10, IX-11, IX-02 variants), regressions: Failure[], counts: { urls, pass, fail } }`.
- Produces: `Baseline = { [url]: string[] /* failing ids, [] when clean */ }`; `toBaseline(result): Baseline`; `regressionsAgainst(result, baseline): Failure[]` (an id absent from `baseline[url]` and present now; a URL absent from the baseline is never a regression).
- Produces: `writeDigest(result, runDir): { digestPath, resultsPath, baselinePath }` (`digest.md` format from spec §4; `results.json` = the `AuditResult`; `baseline.json` = `toBaseline(result)`), and `writeRegressionFindings(result, runDir)` → `<runDir>/findings.json` in Task 6's shape with one `decision: 'card'` finding per regressed check id (urls grouped), used by the post-deploy workflow; CLI `node scripts/seo/audit.mjs [--site <url>] [--only IX-04,IX-10] [--url <u>] [--baseline <baseline.json>] [--findings] [--run-dir <dir>] [--json]`, exit 0 / 1 (a check failed) / 2 (infra) / 3 (a regression against the baseline).

- [ ] **Step 1: Write the fake site fixtures.** `sitemap.xml` lists `/`, `/wordle`, `/orphan`, `/old`; `index.html` links `/wordle` only; `admin.html` has noindex; `robots.txt` = the live file with the host swapped.
- [ ] **Step 2: Write the failing tests** in `audit.test.mjs` with a `node:http` server that serves the fixtures (`/old` → 301 `/wordle`; `http://` and `www.` variants are out of reach on localhost, so `--site` with a `localhost` host skips the IX-02 variant checks, asserted by a test):

```js
test('parseRobots: live file → sitemap line, Disallow /admin, allows /wordle, disallows /admin', …)
test('parseRobots flags noindex and crawl-delay lines as unsupported', …)
test('parseSitemap: urls, lastmod, errors on a relative loc, hasPriorityOrChangefreq', …)
test('runAudit on the fake site: IX-11 names /orphan, IX-02 and IX-10 name /old (301), IX-03 passes for /admin, exit code 1', …)
test('runAudit with Disallow: / on a non-production host reports no IX-01 and still checks HTML', …)  // serve a second robots.txt
test('runAudit --baseline: a page that passed IX-03 before and fails now is in regressions; exit 3; a url missing from the baseline is not a regression', …)
test('--findings writes findings.json with one card finding per regressed id, urls grouped, valid per Task 6 validateFindings (stub the import until Task 6 lands)', …)
test('runAudit never follows a redirect: the url map has /old with status 301 and no second entry for /wordle', …)
test('writeDigest: header line "seo-audit: run <id> · site <site> · <n> urls · <f> failing checks", one "## FAIL IX-nn" per failing id, "## Regressions" only with --baseline', …)
```

- [ ] **Step 3: Run `node --test scripts/seo/audit.test.mjs`**. Expected: FAIL, modules missing.
- [ ] **Step 4: Implement the four libs and `audit.mjs`.** `runAudit` order: robots → sitemap → fetch every sitemap URL and the expected-noindex pages (concurrency 4) → per-page `checkPage` → IX-01 (skipped with a `## Coverage gaps` line when robots disallows everything and the host is not the configured site) → IX-02 (status 200 per sitemap URL; `http://` and `https://www.` variants only when the host is the configured production host; a random slug `/__seo-audit-404-<ts>` must answer 404) → IX-10 → IX-11 (link graph from the fetched pages) → IX-12 fetches (HEAD on `og:image`, `/favicon.ico`, `/manifest.webmanifest` or the `<link rel="manifest">` href). `runId` from the clock. `--baseline` compares per (url, id). Exit codes as in Interfaces.
- [ ] **Step 5: Run the tests.** Expected: PASS.
- [ ] **Step 6: Run the real thing:** `node scripts/seo/audit.mjs --site https://swishquest.com`. Expected: exit 0 or 1; read only the digest header and the `## FAIL` headers; note every failing id in the commit message (they are the first cards the weekly run will file, not bugs of the audit). If a failure is an audit bug (for example IX-08 on a page that clearly has text), fix the check.
- [ ] **Step 7: Commit** `git commit -m "seo: audit script (IX-01..IX-12), digest and baseline"`.

### Task 4: Search Console client and the one-time auth

**Files:**
- Create: `scripts/seo/lib/google-auth.mjs`, `scripts/seo/lib/gsc-client.mjs`, `scripts/seo/gsc.mjs`, `scripts/seo/auth.mjs`, `scripts/seo/gsc.test.mjs`

**Interfaces:**
- Produces: `tokenSource({ clientId, clientSecret, refreshToken, fetch }): { access(): Promise<string> }` (POST `https://oauth2.googleapis.com/token`, cached until 60 s before expiry; throws `Error('google auth: <status>')` without the body).
- Produces: `gscClient({ token, property, fetch, budget = 200 }): { inspect(url): Promise<Inspection>, sitemaps(): Promise<[{ path, lastSubmitted, lastDownloaded, errors, warnings, isPending }]>, submitSitemap(feedpath): Promise<void>, analytics({ days = 28, dimensions = ['page'] }): Promise<[{ keys, clicks, impressions, ctr, position }]>, used(): number }` where `Inspection = { verdict, coverageState, indexingState, pageFetchState, robotsTxtState, lastCrawlTime, googleCanonical, userCanonical, crawledAs, richResults: { verdict, items: number, errors: number }, inspectedAt, link }` or `{ error: '429'|'403'|'<status>', inspectedAt }`; after the first 429/403 or when `used() >= budget` every further `inspect` resolves to `{ error: 'budget' }` without a request.
- Produces: `credentialsFromEnv(): { clientId, clientSecret, refreshToken } | null` (env `GOOGLE_SEO_CLIENT_ID/SECRET/REFRESH_TOKEN`, else the local file `%LOCALAPPDATA%\nba-seo\google-oauth.json` / `~/.config/nba-seo/google-oauth.json`).
- CLI `node scripts/seo/gsc.mjs inspect <url>|sitemaps|submit-sitemap|analytics [--days 28] --out <file>` (prints a count line only, never values).

- [ ] **Step 1: Write the failing tests** with an injected `fetch` fake that records requests and answers from fixtures (the `inspectionResult` JSON shape of the API: `indexStatusResult.{verdict, coverageState, …}`, `richResultsResult.{verdict, detectedItems[]}`):

```js
test('tokenSource posts grant_type=refresh_token once and caches the access token', …)
test('inspect maps indexStatusResult and richResultsResult to the Inspection shape', …)
test('inspect: a 429 marks that url error and every later call resolves { error: "budget" } with no request', …)
test('inspect stops at budget (budget 2 → third call makes no request)', …)
test('analytics posts startDate/endDate (days back, two-day lag), dimensions, rowLimit 25000, dataState final', …)
test('credentialsFromEnv prefers env over the file and returns null when neither exists', …)
test('no secret in a thrown error message (token 401 → message is "google auth: 401")', …)
```

- [ ] **Step 2: Run `node --test scripts/seo/gsc.test.mjs`**. Expected: FAIL.
- [ ] **Step 3: Implement the two libs and `gsc.mjs`.** Endpoints: `POST https://searchconsole.googleapis.com/v1/urlInspection/index:inspect` body `{ inspectionUrl, siteUrl: property, languageCode: 'en-US' }`; `GET …/webmasters/v3/sites/{encodeURIComponent(property)}/sitemaps`; `PUT …/sitemaps/{encodeURIComponent(feedpath)}`; `POST …/webmasters/v3/sites/{property}/searchAnalytics/query`. `analytics` end date = today − 2 days, start = end − days.
- [ ] **Step 4: Implement `auth.mjs`** (installed-app flow): read `GOOGLE_SEO_CLIENT_ID`/`SECRET` from env or prompt the owner to paste them into the terminal (never a command-line argument); start `node:http` on `127.0.0.1:0`; open `https://accounts.google.com/o/oauth2/v2/auth?…&scope=https://www.googleapis.com/auth/webmasters%20https://www.googleapis.com/auth/drive&access_type=offline&prompt=consent&redirect_uri=http://127.0.0.1:<port>`; exchange the code; write `{ clientId, clientSecret, refreshToken }` with mode `0600` to the credentials file; print the three `gh secret set GOOGLE_SEO_… --repo stefanroman22/nba-trivia-minigames < <tmpfile>` commands, with the values written to three temp files it names (not echoed). No test beyond a `buildAuthUrl()` unit test (scope, access_type, prompt present).
- [ ] **Step 5: Run the tests.** Expected: PASS.
- [ ] **Step 6: Commit** `git commit -m "seo: search console client, quota guard and one-time auth"`.

### Task 5: The ledger and the state store

**Files:**
- Create: `scripts/seo/lib/ledger.mjs`, `scripts/seo/lib/store.mjs`, `scripts/seo/ledger.mjs`, `scripts/seo/ledger.test.mjs`
- Modify: `scripts/check-core/lib/state-merge.mjs` (add `mergeSeoLedger`), `scripts/check-core/lib/state-store.mjs` (`JSON_FILES` + `mergeJsonFiles` + the `sync()` local-write loop), `scripts/check-core/state-merge.test.mjs` (one test), `scripts/check-core/README.md` (one row)

**Interfaces:**
- Produces: `emptyLedger(): Ledger` (shape from spec §6), `applyAudit(ledger, auditResult): Ledger`, `applyInspections(ledger, { [url]: Inspection }): Ledger` (an `{ error }` inspection keeps the old `gsc` block and sets `gsc.error`), `applyDecisions(ledger, findings: Finding[] /* Task 6 shape */, runId)`, `markRequested(ledger, url, note)`, `summary(ledger): string` (`ledger-summary.md`: data ages, counts by `coverageState`, URLs whose verdict changed since the previous entry, URLs failing any IX check), `toCsv(ledger): string`.
- Produces: `mergeSeoLedger(base, local, remote): Ledger` = `urls` by `merge3Map` with per-URL conflict → the entry with the newer `gsc.inspectedAt` (else `audit.runId`); `dataAsOf` per key → the newest ISO; `history` by `merge3List(…, 'runId')` capped at 52.
- Produces: `store.mjs`: `seoStore({ token }) → git` (`storeGit` from state-store), `pullLedger(git, home): Ledger`, `pushLedger(git, home, ledger, message)`, `lease(git, { holder, action: 'acquire'|'release', ttlMin = 90 }): { status: 'free'|'busy'|'released', holder }` on `seo/lease.json` through `update()`.
- Produces: `weeklyStatus(ledger, leaseDoc, { now }): 'free'|'busy'|'done'` (`done` = `history` has a `status: 'ok'` run started since Monday 00:00 Europe/Paris; reuse `weekly-slot.mjs` helpers for the Paris clock).
- CLI `node scripts/seo/ledger.mjs summary | csv | requested <url> [--note "…"] | baseline --out <file> (Task 3's `Baseline` shape from `urls[url].audit.fail`) | record-audit --run <runId> (`applyAudit` from `<runDir>/results.json`, then push the store) | weekly-status [--github-output]` (reads/writes `<uicHome()>/seo/ledger.json`; `requested` and `record-audit` push the store unless `--no-state`).

- [ ] **Step 1: Write the failing tests** in `ledger.test.mjs` (pure functions) and one case in `state-merge.test.mjs`:

```js
test('applyAudit records pass/fail ids per url and dataAsOf.audit', …)
test('applyInspections: an error inspection keeps the previous gsc block and sets gsc.error', …)
test('markRequested appends and the same note twice in one day is appended once', …)
test('summary names urls whose verdict changed and the data ages', …)
test('toCsv has one row per url with the columns url,inSitemap,auditFail,verdict,coverageState,lastCrawlTime,googleCanonical,requestedAt,decision', …)
test('mergeSeoLedger: different urls from two writers both survive; same url → newer inspectedAt wins; history union by runId', …)
test('weeklyStatus: done when history has an ok run since Monday 00:00 Paris, busy on a live lease, else free', …)
test('baseline from a ledger: { url: fail[] } for every url with an audit block', …)
```

- [ ] **Step 2: Run both test files.** Expected: FAIL.
- [ ] **Step 3: Implement.** In `state-store.mjs`: `JSON_FILES` gets `'seo/ledger.json'`; `mergeJsonFiles` calls `mergeSeoLedger` for it (store and local the same value; skip when all three are undefined); the `sync()` write loop already handles sub-paths through `writeAtomic`. Add the README row.
- [ ] **Step 4: Run `node --test scripts/seo/ scripts/check-core/state-merge.test.mjs scripts/check-core/state-store.test.mjs`.** Expected: PASS (the store test's local bare repo must still pass with the new file absent).
- [ ] **Step 5: Commit** `git commit -m "seo: per-url ledger on checks-state"`.

### Task 6: Findings contract and the Notion push

**Files:**
- Create: `scripts/seo/lib/findings.mjs`, `scripts/seo/lib/card-body.mjs`, `scripts/seo/notion-push.mjs`, `scripts/seo/notion-push.test.mjs`

**Interfaces:**
- Produces: the findings document `<runDir>/findings.json` = `{ runId, findings: [ { id: 'SEO-<runId>-NNN', check: 'IX-04', severity: 'blocker'|'major'|'minor', urls: string[], current: string, expected: string, files: string[], howToFix: string, acceptance: { audit: 'node scripts/seo/audit.mjs --only IX-04 --site <site>', qa: [{ route, selector, expect }] }, fingerprint: 'IX-04|<sorted urls>', regression?: true, decision: 'card'|'owner'|'wait'|'none', owner?: { action: string, clickPath: string }, recheckAfter?: iso } ] }`; `validateFindings(doc): string[]` (errors), `readFindings(runDir)`.
- Produces: `renderCard(finding, { runId, site }): { title: '[seo] IX-04 canonical on 2 page(s)', category: 'frontend'|'CI/CD', priority: 'P0'|'P1'|'P2', difficulty: 'standard', source: 'seo-check fp:<fpKey> run:<runId>', body: markdown (Current, Expected, Files, How to fix, Acceptance, QA assertions as a ```json block, the finding as a trailing ```json block) }` (`fpKey` from `check-core/lib/card-body.mjs`; priority from spec §8).
- Produces: `pushFindings(doc, client, { dryRun, priorityOverride, regressionsOnly }): [{ action: 'card'|'skip'|'regression', id, cardId|null, why }]` with the same `decide()` table as `check-core/notion-push.mjs` and a `client` of the same shape (`findCards`, `listComments`, `comment`, `createCard` (no attachments), `isShipped`); CLI `node scripts/seo/notion-push.mjs --run <runId> [--dry-run] [--priority P0] [--regressions-only]` (validates `findings.json` first: errors → exit 2 with one line per error; `--regressions-only` keeps findings whose `regression: true`) printing `card <id> <title>` / `skip <key> <why>` / `regression <old> → <new>` lines.

- [ ] **Step 1: Write the failing tests** with a fake client (as `check-core/notion-push.test.mjs` does):

```js
test('validateFindings rejects a finding without urls, with an unknown check id, or with decision card but no files', …)
test('renderCard: title, P0 for IX-02 on a sitemap url, P2 for IX-12, source prefix seo-check, no attachment field', …)
test('pushFindings: open card → comment once per run, no card', …)
test('pushFindings: Done card with Commit not on main → skip, no comment', …)
test('pushFindings: Done card with Commit on main → regression card', …)
test('pushFindings: decision owner/wait/none → no card', …)
test('createCard is called with --target dev always', …)
```

- [ ] **Step 2: Run `node --test scripts/seo/notion-push.test.mjs`**. Expected: FAIL.
- [ ] **Step 3: Implement.** `cliClient` mirrors `check-core/notion-push.mjs`'s but never passes `--attach`.
- [ ] **Step 4: Run the tests.** Expected: PASS. Then `node scripts/seo/notion-push.mjs --run <a Task 3 run id> --dry-run` after writing a hand-made `findings.json` with one `card` finding: prints one `card DRY …` line.
- [ ] **Step 5: Commit** `git commit -m "seo: findings contract and notion push"`.

### Task 7: IndexNow and the Drive export

**Files:**
- Create: `scripts/seo/lib/indexnow.mjs`, `scripts/seo/indexnow.mjs`, `scripts/seo/lib/drive.mjs`, `scripts/seo/export.mjs`, `scripts/seo/indexnow.test.mjs`, `scripts/seo/export.test.mjs`

**Interfaces:**
- Produces: `keyFileLive({ site, key, fetcher }): Promise<boolean>` (GET `<site>/<key>.txt` is 200 and its trimmed body equals the key); `pingIndexNow({ site, key, urls, fetch }): Promise<{ status, count }>` (POST `https://api.indexnow.org/indexnow` JSON `{ host, key, urlList }`, at most 10,000 URLs); `changedUrls(ledger, previousLedger): string[]` (a URL whose `audit.fail` set or sitemap `lastmod` changed).
- Produces: `driveUpload({ token, folderId, name, mimeType, body, fetch }): Promise<{ id, name }>` (multipart `POST https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart` with `parents: [folderId]`; same name on the same day → `PATCH` the existing file found by `GET /drive/v3/files?q=name='…' and '<folderId>' in parents and trashed=false`).
- CLI `node scripts/seo/export.mjs --run <runId> [--dry-run]` writes `ledger-<YYYY-MM-DD>.csv`, `gsc-analytics-<date>.csv` (from `<runDir>/gsc-analytics.json`, when present), `REPORT-<date>.md`; prints `export: 3 files → <folderId>` only.

- [ ] **Step 1: Write the failing tests** (injected `fetch`/`fetcher` fakes): key file live/not live/body mismatch; ping body shape and 10,000 cap; `changedUrls` on two ledgers; `driveUpload` creates on first call and patches on the second; `export.mjs --dry-run` writes the three files to the run dir and makes no request.
- [ ] **Step 2: Run the two test files.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "seo: indexnow ping and drive export"`.

### Task 8: The weekly orchestrator

**Files:**
- Create: `scripts/seo/run.mjs`, `scripts/seo/run.test.mjs`, `scripts/seo/lib/slack.mjs`

**Interfaces:**
- Consumes: Tasks 3–7.
- Produces: CLI `node scripts/seo/run.mjs [--dry-run] [--site <url>] [--gsc on|off] [--notion live|dry] [--slack on|off] [--agents on|off] [--agent-model fable] [--agent-timeout-sec 1800] [--holder <id>] [--state-branch checks-state] [--no-state] [--home <dir>]`; `parseArgs(argv)`; `runWeekly(opts, deps)` where `deps` = `{ audit, gsc, ledgerStore, notionPush, indexnow, exportDrive, runAgent, postLine, now }` so the test injects fakes; order from spec §5; exit 0 run done or skipped (lease busy), 1 infra, 2 bad arguments.
- Produces: `seoLine(state): string` (one Slack line: `seo: run <id> · <n> urls · indexed <i> · not indexed <k> · audit fails <f> · cards <c> new/<s> seen · owner actions <o> · drive <ok|skipped> · <duration>` plus `· judgement needed` when the agent did not run).
- The agent step: copy `check-run.mjs`'s `claude -p` invocation (its flags, the prompt on stdin, the process-group kill and the watchdog) with `--model <agent-model>`; prompt text = `Load the seo skill, then the seo-indexing skill. Run dir: <runDir>. Site: <site>. Write <runDir>/findings.json and docs/seo/owner-actions.md per the skill. Return ≤ 10 lines.`; every `GOOGLE_SEO_*`, `NOTION_TOKEN`, `SLACK_BOT_TOKEN`, `CHECKS_STATE_TOKEN` removed from the child's env.
- After the agent step, `deps.commitOwnerActions({ runId })`: when `docs/seo/owner-actions.md` differs from HEAD and the run is not `--dry-run`, `git commit -m "seo: owner actions <runId>"` on the tooling checkout and `git push origin HEAD:dev` (plain push, never force; a rejection is logged as `owner actions: push rejected, file left in the run artifact` and does not fail the run; in CI the token comes through the same `http.extraheader` env trick `state-store.mjs` uses, so it never reaches a config file).

- [ ] **Step 1: Write the failing tests:** `parseArgs` defaults and `--gsc off`; `runWeekly` with fakes runs the steps in order and records them; `--gsc off` skips `gsc` and adds the owner action `set up Search Console access` to `findings.json` when no credentials; lease busy → exit 0 and no steps; the agent fake throwing → run continues, line says `judgement needed`; the env passed to `runAgent` has none of the four secret names; `commitOwnerActions` is called only when the file changed and not on `--dry-run`, and its rejection does not fail the run; `seoLine` format.
- [ ] **Step 2: Run `node --test scripts/seo/run.test.mjs`**. Expected: FAIL.
- [ ] **Step 3: Implement `run.mjs` and `lib/slack.mjs`** (`postLine` from `check-core/lib/slack-line.mjs`, channel from config).
- [ ] **Step 4: Run the tests.** Expected: PASS. Then a real dry run: `node scripts/seo/run.mjs --dry-run --gsc off --notion dry --slack off --agents off --no-state`. Expected: exit 0, a run dir with `digest.md`, `ledger-summary.md`, `REPORT.md` (placeholder "judgement needed" section), console tail ends with the Slack line prefixed `dry:`.
- [ ] **Step 5: Commit** `git commit -m "seo: weekly run orchestrator"`.

### Task 9: The agent and the skills

**Files:**
- Create: `.claude/agents/seo.md`, `.claude/skills/seo/SKILL.md`, `.claude/skills/seo-indexing/SKILL.md`, `.claude/skills/seo-indexing/references/google-rules.md`, `references/gsc-fields.md`, `references/nextjs-patterns.md`, `references/card-template.md`, `references/owner-actions-template.md`

**Interfaces:**
- Consumes: the findings contract (Task 6), `ledger-summary.md`, `gsc-summary.md`, `digest.md` (Tasks 3–5), `CHECKS.md` (Task 1).
- Produces: the agent writes `<runDir>/findings.json` (valid per `validateFindings`), `<runDir>/REPORT.md` (`## Summary`, `## Decisions` (one line per finding: id, decision, ref), `## Owner actions`, `## Wait` with re-check dates, `## Coverage gaps`), and `docs/seo/owner-actions.md` from the template.

- [ ] **Step 1: Write `.claude/agents/seo.md`** (frontmatter `name: seo`, `description: SEO agent of nba-minigames. Phase 1: indexing. Judges the audit digest and Search Console data of a run, decides card / owner action / wait per finding, writes findings.json, REPORT.md and docs/seo/owner-actions.md. Never edits product code. Dispatched by scripts/seo/run.mjs (claude -p) or by the /seo skill.`, `model: fable`, `effort: high`, `color: green`). Body ≤ 60 lines: mandate, the read budget (digest header + `## FAIL` sections, `ledger-summary.md`, `gsc-summary.md`, `CHECKS.md`; never `results.json`, `gsc.json`, the ledger, an export), the writes it may make, the decision rules (an IX failure on a sitemap URL → `card`; a Search Console verdict ≠ PASS with a passing audit → `owner` Request indexing, max 10 per run, oldest `lastCrawlTime` first, never a URL with a `requests[]` entry younger than 14 days → `wait` instead; `coverageState` "Discovered - currently not indexed" on a site younger than 60 days → `wait` 14 days; `Crawled - currently not indexed` → `card` only when an IX-05/06/08 finding exists, else `wait` 28 days with the note "content/links"; everything else `none`), and "Load the `seo` skill first".
- [ ] **Step 2: Write `.claude/skills/seo/SKILL.md`** (frontmatter `name: seo`, `description: SEO hub for nba-minigames: which area skill to load (indexing now), the ledger and export rules, the read budget. Use for "/seo", "SEO check", "indexing", "is page X indexed", "Search Console".`). Body: the areas table, how to run locally (`node scripts/seo/run.mjs --notion dry --slack off --agents off` then do the agent's job in this session, or `--agents on` to delegate), the state rules from spec §6, how the owner reports a click (`node scripts/seo/ledger.mjs requested <url>`), the token rules.
- [ ] **Step 3: Write `.claude/skills/seo-indexing/SKILL.md`**: the 11 sections per spec §3 with What / How (exact file and command in this repo) / Verify (IX ids + the `Inspection` field) / Google likes / does not like, and at the end "Producing the run's output" (the findings contract, the REPORT.md sections, the owner-actions rewrite). ≤ 250 lines; everything optional goes to the references.
- [ ] **Step 4: Write the five references.** `google-rules.md`: the rules per step with the source URLs from the guide's Sources. `gsc-fields.md`: the `Inspection` enums (verdict PASS/PARTIAL/FAIL/NEUTRAL; indexingState INDEXING_ALLOWED/BLOCKED_BY_META_TAG/BLOCKED_BY_HTTP_HEADER/BLOCKED_BY_ROBOTS_TXT; pageFetchState SUCCESSFUL/SOFT_404/BLOCKED_ROBOTS_TXT/NOT_FOUND/ACCESS_DENIED/SERVER_ERROR/REDIRECT_ERROR/ACCESS_FORBIDDEN/BLOCKED_4XX/INTERNAL_CRAWL_ERROR/INVALID_URL; crawledAs DESKTOP/MOBILE) and the Pages-report `coverageState` strings → action table from the guide §4 step 11. `nextjs-patterns.md`: for each signal the file and line pattern (`src/app/robots.ts`, `sitemap.ts`, `layout.tsx` metadata, `[game]/page.tsx` `generateMetadata` + JSON-LD, `page.tsx` home JSON-LD, `components/JsonLd.tsx`, `configurations/site.ts`, `utils/GameUtils.tsx` `visibleGames`/`urlPath`/`seoDescription`). `card-template.md`: the body layout from spec §8 with placeholders. `owner-actions-template.md`: the file layout (header with run id and date, `## Do now` checkbox list with `OA-<runId>-<n>`, click path, URL, reason, "then run: node scripts/seo/ledger.mjs requested <url>", `## Setup (once)` from spec §9 shown only while the Google credentials are missing).
- [ ] **Step 5: Verify by a local session run:** `node scripts/seo/run.mjs --dry-run --gsc off --notion dry --slack off --agents off --no-state`, then in this session dispatch `subagent_type: "seo"` with the prompt from Task 8's agent step on that run dir. Expected: `node scripts/seo/notion-push.mjs --run <runId> --dry-run` exits 0 (the findings validate) and prints only `card DRY` / `skip` lines; `REPORT.md` has the five sections; `docs/seo/owner-actions.md` lists the Google setup under `## Setup (once)`.
- [ ] **Step 6: Commit** `git commit -m "seo: agent, hub skill and indexing playbook"`.

### Task 10: Workflows, docs, end-to-end

**Files:**
- Create: `.github/workflows/seo-audit.yml`, `.github/workflows/seo-weekly.yml`, `docs/seo/owner-actions.md` (the first version, from Task 9's run)
- Modify: `docs/seo/README.md` (complete), `.claude/skills/seo/SKILL.md` (link the README), `docs/team/PIPELINE.md` (one paragraph under §15: SEO cards are ordinary cards, Source `seo-check`, never attachments)

- [ ] **Step 1: Write `seo-audit.yml`:** `on: push: branches: [main]` + `workflow_dispatch` (`site`, `slack on|off`, `notion live|dry`); job `audit` (ubuntu-latest, 25 min, `contents: write` for the state branch, `concurrency: seo-audit`): checkout dev (tooling, `fetch-depth: 0`), node 22, `npm ci`; step "Wait for Vercel" = a bash loop over `gh api repos/${{ github.repository }}/commits/${{ github.sha }}/statuses --jq '.[] | "\(.context)|\(.state)"'` every 30 s up to 15 min until the newest state of both `Vercel – nba-minigames` and `Vercel – backend` is `success` (a `failure`/`error` → the job ends with `::warning::` and skips the audit; `GH_TOKEN: ${{ github.token }}`); step "Baseline from the store" = `node scripts/seo/ledger.mjs baseline --out $RUNNER_TEMP/baseline.json` (an empty `{}` when the ledger has no audit yet); step "Audit" = `node scripts/seo/audit.mjs --site https://swishquest.com --baseline $RUNNER_TEMP/baseline.json --findings`, exit 3 → `node scripts/seo/notion-push.mjs --run <runId> --priority P0 --regressions-only` and the Slack line `seo: production regression · <ids> · <urls>` through `lib/slack.mjs`; always: `node scripts/seo/ledger.mjs record-audit --run <runId>` (pushes the store with `CHECKS_STATE_TOKEN`), upload `digest.md` and `results.json` as an artifact (14 days).
- [ ] **Step 2: Write `seo-weekly.yml`:** `on: schedule: ["0 4 * * 1", "0 5 * * 1"]` + `workflow_dispatch` (`gsc`, `notion`, `slack`, `agents`, `dry_run`, `agent_model` default `fable`); gate step `node scripts/seo/ledger.mjs weekly-status` (Task 5: `history` has a run with `status: ok` since Monday 00:00 Paris → skip; the lease busy → skip); job as `checks-weekly.yml`'s install minus Python/Chromium/relay; Claude preflight step copied verbatim (`npm install -g @anthropic-ai/claude-code@2.1.285`, `echo OK | claude -p --model <agent_model>`); run `node scripts/seo/run.mjs --holder cloud-${{ github.run_id }} --agent-model <agent_model> …knobs`; secrets `GOOGLE_SEO_CLIENT_ID/SECRET/REFRESH_TOKEN`, `NOTION_TOKEN`, `SLACK_BOT_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, `CHECKS_STATE_TOKEN: ${{ github.token }}`; artifact = `digest.md`, `REPORT.md`, `ledger-summary.md`, the log (no `gsc.json`, no exports).
- [ ] **Step 3: Validate both files:** `python -c "import yaml,sys;[yaml.safe_load(open(f)) for f in sys.argv[1:]]" .github/workflows/seo-audit.yml .github/workflows/seo-weekly.yml` (PyYAML is in the Django venv; else `py -3.11 -m pip install pyyaml`). Expected: no output, exit 0. The workflows stay inert until the next dev→main promotion (GitHub runs `schedule` and `push: main` only from `main`); the first live test is a `workflow_dispatch` of each after that promotion. Record this in the README.
- [ ] **Step 4: Complete `docs/seo/README.md`:** the run order of `run.mjs`, the exit codes, "How to read a run" (which files to open), the owner loop (`owner-actions.md` → click → `ledger.mjs requested`), the two workflows and their knobs, the "inert until promoted" note, troubleshooting (no credentials, 429, lease busy, Drive 403 = folder not shared/created by the owner's account, IndexNow 403 = key file missing). Add the PIPELINE.md paragraph.
- [ ] **Step 5: End-to-end dry run of everything:** `npm run test:seo && node --test scripts/check-core/state-merge.test.mjs scripts/check-core/state-store.test.mjs` → PASS; `node scripts/seo/run.mjs --dry-run --gsc off --notion dry --slack off --agents on --agent-model fable --no-state` → exit 0, `findings.json` valid, Slack dry line printed; `node scripts/seo/audit.mjs --site https://swishquest.com --baseline <the previous run's results.json>` → exit 0 or 1, never 3.
- [ ] **Step 6: Commit** `git commit -m "seo: post-deploy audit and weekly workflows, docs"`.

### Task 11: Ship to dev and hand over

- [ ] **Step 1:** `git log --oneline origin/dev..HEAD` lists the Task 1–10 commits; `npm run test:seo` green.
- [ ] **Step 2:** Push to `dev` per the project's git rules (the owner's standing grant; branch `feat/seo-agent-indexing`, PR to dev, merge). Production is never automatic: the workflows go live with the next dev→main promotion.
- [ ] **Step 3:** Write the hand-over in the final message: the owner setup list from `docs/seo/owner-actions.md` `## Setup (once)` (Google Cloud project + OAuth client + consent screen in Production, `node scripts/seo/auth.mjs`, the three `gh secret set`, the Drive folder id into `config.json`; the IndexNow key file is committed and goes live with the next promotion), and the first audit's failing IX ids from Task 3 step 6.
