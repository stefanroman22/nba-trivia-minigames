---
name: seo-indexing
description: The SEO indexing playbook of nba-minigames (swishquest.com), phase 1 of the seo agent. The 11 steps from robots.txt to Search Console (what, how in this repo, verify by IX check and Inspection field, what Google likes), the decision rules, and how a run's findings.json, REPORT.md and docs/seo/owner-actions.md are written. Load after the seo hub skill.
---

# SEO indexing playbook

One section per step of `docs/seo/indexing-guide.md` §4 (read the guide's step for the examples; this file does not
repeat them). The references are read per step, never whole: `references/google-rules.md` (rules and sources),
`references/gsc-fields.md` (Inspection enums, Pages-report statuses), `references/nextjs-patterns.md` (where each
signal is set), `references/card-template.md`, `references/owner-actions-template.md`. The hub skill `seo` holds the
config (site, live date, expected-noindex list) and the read budget.

## Inputs
1. `<runDir>/digest.md`: line 1 `# seo-audit: run <runId> · site <site> · <n> urls · <k> failing checks`, then one
   `## FAIL IX-nn <what>` per failing check (`- <url>: <evidence>` lines), `## Regressions` (only when the run had a
   baseline), `## Coverage gaps`.
2. `<runDir>/gsc-summary.md` (missing = Search Console did not run) and `<runDir>/ledger-summary.md` (`- gsc: never`
   = Search Console never ran for this ledger).
3. The per-URL Search Console slice: every inspected URL whose verdict is not `PASS`, with the fields the rules need,
   coverage only (Bash tool, from the repo root):
   ```
   node -e 'const fs=require("fs"),p=require("path"),d=process.argv[1],j=(f)=>{try{return JSON.parse(fs.readFileSync(p.join(d,f),"utf8"))}catch{return null}};const g=j("gsc.json");if(!g){console.log("no gsc.json: Search Console did not run");process.exit(0)}const prev=(j("ledger-previous.json")||{}).urls||{},b=j("baseline.json")||{};let n=0;for(const [u,i] of Object.entries(g).sort(([a],[c])=>a.localeCompare(c))){if(i.error){console.log(u+" | error "+i.error);continue}if(i.verdict==="PASS"){n++;continue}const r=((prev[u]||{}).requests||[]).map((q)=>q.at).sort().at(-1)||"never";console.log([u,i.verdict,i.coverageState||"-",i.indexingState||"-",i.pageFetchState||"-","crawl "+(i.lastCrawlTime||"never"),"canonical "+(i.googleCanonical&&i.googleCanonical!==i.userCanonical?"google "+i.googleCanonical:"same"),"requested "+r,"ix "+((b[u]||[]).join(",")||"pass")].join(" | "))}console.log(n+" url(s) PASS (not listed)")' "<runDir>"
   ```
   Row: `url | verdict | coverageState | indexingState | pageFetchState | crawl <lastCrawlTime> | canonical … |
   requested <latest requests[] at> | ix <this run's failing IX ids>`.
4. `<runDir>/findings.json` when it exists (the run files "Set up Search Console access" there without credentials).

## The 11 steps
Each step: **What** (the rule), **How** (where it is done here), **Verify** (IX ids, then the Inspection field),
**Likes / dislikes** (Google's, short; the guide's table has the rest). A card's `howToFix` is the step's How, made
concrete for the failing URLs; its `files` come from `CHECKS.md` plus `references/nextjs-patterns.md`.

### 1. Let crawlers in with robots.txt
- What: robots.txt allows every page to be indexed and the CSS/JS it needs; it blocks only `/admin`; it names the sitemap.
- How: `src/app/robots.ts` (production rules; every non-production build disallows `/`). Check: `curl -s https://swishquest.com/robots.txt`.
- Verify: IX-01. Inspection `robotsTxtState` = `ALLOWED`, `pageFetchState` ≠ `BLOCKED_ROBOTS_TXT`.
- Likes: a short file, a full `Sitemap:` URL. Dislikes: blocked CSS/JS; robots.txt used to hide a page; `noindex` or `crawl-delay` lines.

### 2. Allow indexing, use noindex on purpose
- What: no sitemap URL carries noindex; every expected-noindex page does, and stays out of the sitemap.
- How: `metadata.robots` in `src/app/admin|profile|credits|coming-soon/page.tsx`; never in `layout.tsx`.
- Verify: IX-03. Inspection `indexingState` = `INDEXING_ALLOWED` on sitemap URLs (`BLOCKED_BY_META_TAG` on the noindex list is right).
- Likes: noindex in the server HTML on pages with no search value. Dislikes: a leftover noindex on a page to rank;
  noindex set by JavaScript; noindex behind a robots.txt block (never read).

### 3. Serve one clean URL with the right status code
- What: each page answers 200 over HTTPS; `http://` and `www.` redirect to it in one permanent hop; unknown slugs 404.
- How: `dynamicParams = false` in `src/app/[game]/page.tsx`, `src/app/not-found.tsx`; the http/www redirects are
  Vercel domain settings (owner), the old-host 301s `vercel.json`. Check: `curl -sI <url>`.
- Verify: IX-02. Inspection `pageFetchState` = `SUCCESSFUL` (not `SOFT_404`, `NOT_FOUND`, `SERVER_ERROR`, `REDIRECT_ERROR`).
- Likes: one 301/308 per old URL, a real 404/410, fast stable answers. Dislikes: redirect chains, soft 404s, 5xx.

### 4. Declare the canonical URL
- What: every indexable page has one absolute self-referencing canonical that matches the sitemap and the links.
- How: `alternates.canonical` per page (`[game]/page.tsx` `generateMetadata`, `page.tsx`, `privacy`, `terms`);
  `metadataBase` in `layout.tsx`, which must never set a canonical itself.
- Verify: IX-04. Inspection `googleCanonical` = `userCanonical` = the sitemap URL (the slice prints `canonical google …` when not).
- Likes: consistent signals (canonical, sitemap, redirects, links). Dislikes: a layout-level canonical; a canonical changed by JavaScript.

### 5. Put the content and links in the HTML
- What: the main text, one `<h1>` and real `<a href>` links are in the HTML the server sends.
- How: static generation (`generateStaticParams` in `[game]/page.tsx`); the visible text comes from
  `src/views/Trivia/MiniGame.tsx` and `src/views/Landpage.tsx`; links are `next/link`. Check: View page source, not the inspector.
- Verify: IX-07, IX-08. Inspection `crawledAs` = `MOBILE`; `coverageState` not "Crawled - currently not indexed" or "Soft 404".
- Likes: server HTML with the full content, descriptive anchors. Dislikes: content behind a click or login, `#` routes,
  links without `href`, content missing on mobile.

### 6. Write a clear title and description
- What: a unique, descriptive title (brand last, after `|`) and a unique description written for people.
- How: the template `%s | Swish Quest` in `layout.tsx`; per game `name` and `seoDescription` in `src/utils/GameUtils.tsx`;
  the home's in `src/configurations/site.ts`. Share tags and images: `opengraph-image.tsx`, `twitter-image.tsx`, `manifest.ts`.
- Verify: IX-05, IX-06; IX-12 for the share card and icons. No Inspection field: a rewritten title shows only in results.
- Likes: short specific titles, an `<h1>` that matches. Dislikes: vague or duplicate titles, keyword stuffing.

### 7. Add structured data
- What: JSON-LD that matches the visible page; no invented ratings or reviews.
- How: `gameJsonLd` in `[game]/page.tsx` (`VideoGame` + `WebApplication`), `homeJsonLd` in `page.tsx` (`WebSite`,
  `Organization`, `ItemList`), rendered by `src/components/JsonLd.tsx`.
- Verify: IX-09. Inspection `richResults.verdict` and its error count (the ledger keeps them; the owner's Rich Results Test confirms).
- Likes: markup that matches the page, tested. Dislikes: markup for content not shown, `aggregateRating` without real reviews.

### 8. Publish an XML sitemap
- What: every canonical indexable URL, absolute, 200; `lastmod` only where the date is real; no `priority`/`changefreq`.
- How: `src/app/sitemap.ts` (home, `visibleGames` minus `coming-soon`, `/privacy` and `/terms` with `LEGAL.updatedIso`).
- Verify: IX-10. `gsc-summary.md` `sitemaps:` line (errors 0, pending 0); `coverageState` "Submitted and indexed", not
  "Indexed, not submitted in sitemap".
- Likes: only 200 canonical URLs, an accurate `lastmod`. Dislikes: redirecting, 404, noindex or parameter URLs; build-time `lastmod` on every URL.

### 9. Link to the page, inside and outside the site
- What: every sitemap URL is linked from the home page or another indexed page, with descriptive anchor text.
- How: the home grid in `src/views/Landpage.tsx` and the footer `src/components/SiteFooter.tsx` link every visible game
  and the legal pages. Outside links are the owner's (no card).
- Verify: IX-11. Inspection: a URL that stays "Discovered - currently not indexed" past the new-site window is short of links.
- Likes: important pages a few clicks from home, natural links. Dislikes: orphan pages, bought links.

### 10. Submit the site to Google and Bing
- What: the property verified, the sitemap submitted, one indexing request per new or changed page, Bing set up.
- How: the owner clicks (no API for "Request indexing"): `owner` findings into `docs/seo/owner-actions.md`; the owner
  reports each click with `node scripts/seo/ledger.mjs requested <url>`. The run itself pings IndexNow (Bing and others)
  for the URLs whose audit changed (`scripts/seo/indexnow.mjs`) and lists the sitemaps; nothing for you to file.
- Verify: no IX id. The ledger's `requests[]` (the slice's `requested`), `gsc-summary.md` `sitemaps:` (≥ 1 listed).
- Likes: one request per new page, a sitemap with status Success. Dislikes: requesting an unchanged page again, the Indexing API for ordinary pages.

### 11. Check the result and fix what is reported
- What: every sitemap URL reads `PASS` / "Submitted and indexed"; everything else gets a decision (next section).
- How: this run's slice and `ledger-summary.md` (`## Changed since the previous inspection`); the owner's
  `site:swishquest.com` is a rough cross-check only.
- Verify: all IX ids pass; Inspection `verdict` = `PASS`. The status → action table is `references/gsc-fields.md`.
- Likes: problems fixed at the cause (steps 1-9). Dislikes: re-requesting instead of fixing.

## Decide
Run date = the runId's `YYYYMMDD`. Young site = run date before the hub's live date + 60 days. Sitemap URL = an
audited URL not on the expected-noindex list (the home page is one; site-wide failures are reported on it).

**A. The digest.** For each `## FAIL IX-nn` section:
- its sitemap URLs → one `card` finding for that IX id, URLs sorted; `regression: true` when `## Regressions` names
  the id. Severity `blocker` for IX-01…IX-04, `major` for IX-05…IX-11, `minor` for IX-12.
- its other URLs (expected-noindex pages) → one `none` finding for that IX id (the rules file no card for them; say so
  in `REPORT.md`'s Summary so the owner sees it).

**B. The slice**, row by row; the first rule that matches wins:
1. `error …` → no finding; one `## Coverage gaps` line in `REPORT.md` (`<url>: inspection error <code>`).
2. An expected-noindex URL → `none` (one `GSC` finding for all of them, "kept out of the index on purpose").
3. `ix` lists IX ids (its card from A exists): "Crawled - currently not indexed" with no IX-05/06/08 among them →
   `wait` 28 days, note "content/links"; anything else → no extra finding, the card covers the URL (add
   `Search Console: <verdict> · <coverageState>` to that card's `current`).
4. "Discovered - currently not indexed" on a young site → `wait` 14 days.
5. "Crawled - currently not indexed" → `wait` 28 days, note "content/links".
6. `requested` younger than 14 days → `wait`, recheck the request date + 14 days.
7. Otherwise → a Request indexing candidate. Sort the candidates by `crawl` (`never` first, then oldest); the first 10
   → `owner`; the rest → `wait` 7 days, note "over the 10-per-run request cap".

One `GSC` finding per URL for B.3-7 (each owner action and each re-check date is per URL). Severity: `owner` `major`,
`wait` and `none` `minor`. Nothing else is filed: a `PASS` URL with a passing audit needs no finding.

## Producing the run's output
### findings.json (`scripts/seo/lib/findings.mjs` `validateFindings`)
`{ "runId": "<runId>", "findings": [ … ] }`, A's findings first (by IX id), then B's in the slice's order. When the
file exists: keep every finding in it unchanged, add yours after
it, skip one whose `fingerprint` is already there, and number new ids after the highest `NNN`. Every finding:
- `id` `SEO-<runId>-NNN` (3 digits) · `check` `IX-01`…`IX-12` or `GSC` · `severity` `blocker|major|minor`
- `urls` absolute, non-empty · `current` (the digest's evidence lines joined with `; `, or the slice row's fields
  except `ix`) · `expected` (the `CHECKS.md` pass rule; for `GSC` `verdict PASS, coverageState "Submitted and
  indexed"`, or `out of the index: on the expected-noindex list` for B.2)
- `fingerprint` `<check>|<urls sorted, joined by ",">` exactly · `decision` `card|owner|wait|none`
- `card` (never with `GSC`): `files` (≥ 1), `howToFix`, `acceptance` `{ "audit": "node scripts/seo/audit.mjs --only
  IX-nn --site <site>", "qa": [ … ] }` (`qa` may be `[]`; selectors in `references/card-template.md`).
- `owner`: `owner` `{ "action": "Request indexing", "clickPath": "Search Console → property swishquest.com → URL
  inspection → paste <url> → REQUEST INDEXING" }`.
- `wait`: `recheckAfter` `YYYY-MM-DD`; put the note ("content/links", the cap) at the end of `current`.
- Search Console not set up (no `gsc-summary.md` and `- gsc: never`) and no finding with owner action "Set up Search
  Console access": add it exactly as the run does: `check` `GSC`, `severity` `major`, `urls` `["<site>/"]`, `current`
  `the weekly run has no Search Console access (no Google credentials): coverage and indexing are not measured`,
  `expected` `the run reads URL Inspection and Search Analytics of the property every week`, `decision` `owner`,
  `owner` `{ "action": "Set up Search Console access", "clickPath": "docs/seo/README.md → Owner setup" }`.
Write it with the Write tool, 2-space JSON. Nothing to add and the file exists → leave it as it is.

### REPORT.md (`<runDir>/REPORT.md`, overwrite the run's placeholder)
Write tool; where a guard refuses a file named REPORT (a dispatched subagent), a Bash heredoc
(`cat > "<runDir>/REPORT.md" <<'EOF'`) writes the same text.
```
# SEO run <runId>

Site: <site> · audit <n> urls, <k> failing checks · Search Console <m inspected, data as of <date> | not run (<why>)>

## Summary
<3-6 lines: indexable or not, regressions, what changed since the previous inspection, what the owner must do>

## Decisions
- <finding id> · <check> · <decision> · <ref> · <url(s) or path(s)>

## Owner actions
- OA-<runId>-<n> <action> · <url>        (or "- none")

## Wait
- <url> · <reason> · recheck <YYYY-MM-DD>   (or "- none")

## Coverage gaps
- <the digest's lines; inspection errors; "Search Console not measured" when it did not run>   (or "- none")
```
`ref`: card → `card: [seo] <IX-nn> <what> on <n> page(s)` (notion-push files it after you); owner → its `OA` id;
wait → `recheck <date>`; none → the reason in three words. `<why>`: "no Google credentials" when the setup
finding is in the findings, else "--gsc off or the pull failed". `<n>`, `<k>`: the digest header; `<m>`, `<date>`:
`gsc-summary.md`. Counts and states only, never a Search Analytics value.

### docs/seo/owner-actions.md
Rewrite the whole file from `references/owner-actions-template.md`. Number the `owner` findings in `findings.json`
order: `OA-<runId>-1`, `-2`, … ; the setup finding goes under `## Setup (once)` (shown only while it is in the
findings), every other one under `## Do now`.

### Validate
`node scripts/seo/notion-push.mjs --run <runId> --dry-run` (or `--run-dir <runDir>`): exit 0, only `card DRY …` and
`skip …` lines plus their indented detail and the summary line. Exit 2: fix every `invalid findings.json` line, again.
Exit 1 with `error <key> notion.mjs find-cards failed: NOTION_TOKEN missing` as the only error lines is a pass too: the
weekly agent's env holds no Notion token by design, the dedupe lookup of a `card` finding needs one, and an invalid
file exits 2 before any Notion call. Any other `error` line: report it in your return.
