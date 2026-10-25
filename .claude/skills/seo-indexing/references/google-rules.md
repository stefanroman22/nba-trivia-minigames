# Google's rules per step

Read the section of the step you are on. Each rule is from `docs/seo/indexing-guide.md` and its Sources; the URL after
each section is where to check it. The audit's thresholds (IX pass rules) are in `scripts/seo/CHECKS.md`.

## 1. robots.txt
- The file lives at the domain root; groups by `User-agent`, `Allow`/`Disallow` paths, one `Sitemap:` line with the
  full URL.
- robots.txt controls crawling, not indexing: a blocked URL can still be indexed without its content when other pages
  link to it. Never use it to hide a page; use noindex.
- Do not block CSS, JavaScript or images a page needs to render.
- Google does not support `noindex` or `crawl-delay` lines in robots.txt.
- Source: https://developers.google.com/search/docs/crawling-indexing/robots/intro

## 2. noindex
- A robots meta tag (`<meta name="robots" content="noindex">`) in the `<head>`, or an `X-Robots-Tag: noindex` header
  for non-HTML files.
- The rule must be in the HTML the server sends: once Google sees noindex it may skip rendering, so a noindex removed
  by JavaScript may never be read.
- noindex behind a robots.txt Disallow is never seen; for a page other sites link to, remove the Disallow.
- Sources: https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics ·
  https://developers.google.com/search/docs/fundamentals/how-search-works

## 3. Status codes and one URL
- The crawler records the status: 200 found, 3xx redirect, 404 missing, 5xx server error. Frequent 5xx or timeouts
  make Google slow down crawling (crawl capacity).
- One permanent redirect (301/308) per old URL; no chains, no HTTPS-to-HTTP.
- A single-page app that answers 200 for a missing page makes a soft 404; return a real 404 (or 410).
- Sources: https://developers.google.com/search/docs/fundamentals/how-search-works ·
  https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics

## 4. Canonical
- `<link rel="canonical" href="…">` with an absolute URL in the `<head>`, self-referencing on every indexable page.
- The canonical is a strong hint, not a command; Google follows it when redirects, the sitemap and internal links
  agree.
- Never choose between duplicates with noindex or robots.txt; redirect retired duplicates.
- A canonical changed by JavaScript after load is a conflicting signal.
- Source: https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls

## 5. Content, rendering and links
- Google renders pages in an up-to-date headless Chromium, but later than the fetch, and many crawlers (several AI
  assistants) never run JavaScript: content in the server HTML is the safe choice.
- Use real URLs per page (History API), not `#fragment` routes.
- Google follows `<a href>` links only; `onclick` handlers and links without `href` are not followed. Anchor text and
  image `alt` describe the target.
- Since 2024 every site is indexed mobile-first: the mobile version is the one that counts.
- Sources: https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics ·
  https://developers.google.com/search/docs/crawling-indexing/links-crawlable

## 6. Title and description
- A unique, descriptive title per page; the brand at the end after a separator. Vague, duplicate or keyword-stuffed
  titles, or a title that does not match the content, get rewritten.
- The meta description is not a ranking factor but is often shown as the snippet.
- Source: https://developers.google.com/search/docs/appearance/title-link

## 7. Structured data
- Not needed for indexing; needed for rich results. JSON-LD must match what is visible on the page.
- The software-app rich result needs genuine ratings or reviews; invented ones break the rules (so the game markup
  carries none).
- Markup never forces a rich result; Google retired How-to (2023) and, reportedly, FAQ rich results (2026).
- Sources: https://developers.google.com/search/docs/fundamentals/how-search-works ·
  https://www.techwyse.com/news/ai-search/google-faq-rich-results-deprecated-2026

## 8. Sitemap
- Canonical URLs that answer 200, absolute; no redirecting, 404, noindex or parameter URLs.
- `lastmod` is used only when it is consistently and verifiably accurate: never the build time on every URL.
- `priority` and `changefreq` are ignored.
- Up to 50,000 URLs or 50 MB per file; a sitemap index above that.
- A sitemap is a hint: it helps discovery, it does not force indexing.
- Source: https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap

## 9. Links
- Every important page linked from at least one indexed page, a few clicks from home; orphan pages are found late or
  never. Backlinks are "the best way to get Google to index content" (John Mueller).
- New pages take about 20 hours to be found on average; some never are.
- Bought links, link exchanges and spam directories are against the rules; likes and shares are not a ranking factor.
- Sources: https://developers.google.com/search/docs/crawling-indexing/links-crawlable ·
  https://ppc.land/google-says-new-pages-take-about-20-hours-to-be-found-some-never-are/ ·
  https://seranking.com/blog/search-engine-indexing/

## 10. Submitting
- Verify the property, submit `sitemap.xml` in Search Console → Sitemaps; request indexing (URL Inspection → Request
  indexing) once for a new or significantly changed page: the daily quota is small and unpublished (about 10 a day
  was hit on 2026-10-09, `docs/SEO-OWNER-TODO.md`).
- The Indexing API is only for job postings and livestream events; the old sitemap ping URL was retired in 2023.
- Bing: import the site from Search Console in Bing Webmaster Tools; IndexNow notifies Bing, Yandex, Naver and Seznam
  (Google does not use it). The key file must be public at `https://<host>/<key>.txt`.
- Sources: https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap ·
  https://www.indexnow.org/documentation

## 11. Checking the result
- URL Inspection is the definitive answer for one URL ("URL is on Google"); `site:` is approximate; the Pages report
  lists every known URL with its reason (the statuses: `gsc-fields.md`).
- Crawling and indexing are separate: a crawled page can be left out as a duplicate or as not useful enough; core
  updates can change that for a whole site.
- Sources: https://developers.google.com/search/docs/fundamentals/how-search-works ·
  https://seranking.com/blog/search-engine-indexing/
