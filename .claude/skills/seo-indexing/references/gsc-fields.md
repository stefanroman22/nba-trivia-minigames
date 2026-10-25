# Search Console fields

The URL Inspection API (`urlInspection/index:inspect`) returns an `inspectionResult`; `scripts/seo/lib/gsc-client.mjs`
keeps these fields per URL (`gsc.json`, the ledger's `gsc` block): `verdict`, `coverageState`, `indexingState`,
`pageFetchState`, `robotsTxtState`, `lastCrawlTime`, `googleCanonical`, `userCanonical`, `crawledAs`, `richResults`
(`{ verdict, items, errors }`), `inspectedAt`, `link`. An inspection that failed is `{ error }` (`429`, `403`, another
HTTP status, `network`, or `budget`: the run's 200-inspection cap, no request made). Read them through the playbook's
slice command, never `gsc.json` whole.

## Enums
| field | values | meaning |
|---|---|---|
| `verdict` | `PASS` | the URL is on Google (indexed) |
| | `PARTIAL` | indexed with issues (reserved by the API; treat as not `PASS`) |
| | `FAIL` | an error keeps the URL out of the index |
| | `NEUTRAL` | not indexed, for a reason that is not an error (excluded, unknown, discovered, crawled) |
| | `VERDICT_UNSPECIFIED` | no answer; treat as not `PASS` |
| `indexingState` | `INDEXING_ALLOWED` | no noindex seen |
| | `BLOCKED_BY_META_TAG` | `<meta name="robots" content="noindex">` (right only on the expected-noindex list) |
| | `BLOCKED_BY_HTTP_HEADER` | `X-Robots-Tag: noindex` |
| | `BLOCKED_BY_ROBOTS_TXT` | robots.txt blocks it, so a noindex cannot be read |
| | `INDEXING_STATE_UNSPECIFIED` | unknown |
| `pageFetchState` | `SUCCESSFUL` | fetched |
| | `SOFT_404` | answered 200 but looks empty or like an error (step 3) |
| | `BLOCKED_ROBOTS_TXT` | robots.txt disallows it (step 1) |
| | `NOT_FOUND` | 404 |
| | `ACCESS_DENIED` | 401 |
| | `SERVER_ERROR` | 5xx |
| | `REDIRECT_ERROR` | a redirect loop, chain or bad target |
| | `ACCESS_FORBIDDEN` | 403 |
| | `BLOCKED_4XX` | another 4xx |
| | `INTERNAL_CRAWL_ERROR` | Google's side; re-check later |
| | `INVALID_URL` | the URL cannot be crawled as written |
| | `PAGE_FETCH_STATE_UNSPECIFIED` | not fetched yet (often with "Discovered" or "URL is unknown to Google") |
| `robotsTxtState` | `ALLOWED` / `DISALLOWED` / `ROBOTS_TXT_STATE_UNSPECIFIED` | robots.txt's answer for this URL |
| `crawledAs` | `MOBILE` / `DESKTOP` / `CRAWLING_USER_AGENT_UNSPECIFIED` | the crawler of the last crawl; mobile-first means `MOBILE` |
| `googleCanonical` vs `userCanonical` | URLs | Google's pick vs the page's `<link rel="canonical">`; they must be equal (step 4) |
| `lastCrawlTime` | ISO time or null | null = never crawled; the Request-indexing order sorts null first |
| `richResults.verdict` | `PASS` / `PARTIAL` / `FAIL` / null | the detected rich results; `errors` counts ERROR-severity issues (step 7) |

## Pages-report statuses (`coverageState`) → action
The guide's §4 step 11 table, plus the strings the API returns most. "The audit passes → decision" is the playbook's
"Decide" (the binding rules) for a URL with no IX failure; when the URL fails an IX check, its card covers it.

| `coverageState` | what it means | what to do (step) | the audit passes → decision | the IX check that fails when the cause is in code |
|---|---|---|---|---|
| Submitted and indexed | in the index, from the sitemap | nothing | none (`PASS`, not in the slice) | - |
| Indexed, not submitted in sitemap | in the index, not in the sitemap | list it in `sitemap.ts` if it should rank (8) | none (`PASS`, not in the slice) | IX-10 |
| Discovered - currently not indexed | known, not crawled yet | add internal links; on a new site, give it time (9) | wait 14 days while the site is young, else owner Request indexing | IX-11 |
| Crawled - currently not indexed | fetched, not stored | make the page more useful and distinct (5, 6) | wait 28 days "content/links" | IX-05, IX-06, IX-08 (then: card) |
| Excluded by 'noindex' tag | the page asks to be left out | remove noindex if it should rank (2) | none on the expected-noindex list, else owner Request indexing | IX-03 |
| Blocked by robots.txt | the crawler may not fetch it | change robots.txt if it should be crawled (1) | none on the expected-noindex list, else owner Request indexing | IX-01 |
| Duplicate, Google chose different canonical than user | Google picked another URL | align canonical, links and sitemap (4) | owner Request indexing | IX-04 |
| Duplicate without user-selected canonical | no canonical, Google grouped it | add the canonical (4) | owner Request indexing | IX-04 |
| Alternate page with proper canonical tag | a variant pointing at its canonical | nothing | none (the audit lists no variants) | - |
| Soft 404 | looks empty or like an error but returns 200 | return a real 404 or add content (3) | owner Request indexing | IX-02, IX-08 |
| Not found (404) | answered 404 when crawled | restore the page or drop it from the sitemap (3, 8) | owner Request indexing (it answers 200 now) | IX-02, IX-10 |
| Server error (5xx) | 5xx when crawled | fix the server (3) | owner Request indexing (it answers 200 now) | IX-02 |
| Redirect error / Page with redirect | a bad redirect, or a redirecting URL | the sitemap lists only the target (3, 8) | owner Request indexing | IX-02, IX-10 |
| URL is unknown to Google | never seen | the sitemap and links (8, 9) | owner Request indexing | IX-10, IX-11 |

The decision column applies the rules in order: a URL with a `requests[]` entry younger than 14 days waits whatever
its status, and only 10 Request-indexing actions go out per run (oldest `lastCrawlTime` first).
