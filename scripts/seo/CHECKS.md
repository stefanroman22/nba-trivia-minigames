# SEO indexing check catalogue

The IX checks of `scripts/seo/audit.mjs`: deterministic, no browser, GET/HEAD only, with a Googlebot-like mobile user
agent, over `/robots.txt`, `/sitemap.xml`, every sitemap URL, the home page and the expected-noindex pages (`/admin`,
`/profile`, `/credits`, `/coming-soon`). Design: `docs/superpowers/specs/2026-10-25-seo-agent-design.md` §4. `step` is
the step of `docs/seo/indexing-guide.md` §4 the check proves; `files` is where the signal is set.

| id | what | pass rule | step | files |
|---|---|---|---|---|
| IX-01 | robots.txt | 200, parses, `User-agent: *` allows every sitemap URL, disallows `/admin`, names the sitemap URL; no `noindex`/`crawl-delay` lines | 1 | `src/app/robots.ts` |
| IX-02 | status | every sitemap URL answers 200 over HTTPS; `http://` and `https://www.` variants redirect to it in one hop (301/308); an unknown slug returns 404, not 200 | 3 | `src/app/[game]/page.tsx` (`dynamicParams = false`); the redirects are the Vercel domain settings |
| IX-03 | noindex | no sitemap URL carries `<meta name="robots" content="…noindex…">` or an `X-Robots-Tag: noindex`; every URL of the expected-noindex list (`/admin`, `/profile`, `/credits`, `/coming-soon`) does, and is absent from the sitemap | 2 | `src/app/admin/page.tsx`, `src/app/profile/page.tsx`, `src/app/credits/page.tsx`, `src/app/coming-soon/page.tsx`, `src/app/sitemap.ts` |
| IX-04 | canonical | exactly one `<link rel="canonical">`, absolute, equal to the sitemap URL; `?ref=x` variants keep it | 4 | `src/app/[game]/page.tsx`, `src/app/page.tsx`, `src/app/layout.tsx` (`metadataBase`, no canonical) |
| IX-05 | title | present, unique across the site, 10–70 characters, not the bare site name | 6 | `src/app/layout.tsx` (title template), `src/app/[game]/page.tsx`, `src/app/page.tsx` |
| IX-06 | description | present, unique, 50–160 characters | 6 | `src/app/layout.tsx`, `src/app/[game]/page.tsx`, `src/app/page.tsx` |
| IX-07 | heading | one visible `<h1>` in the server HTML | 5 | `src/app/[game]/page.tsx`, `src/app/page.tsx` |
| IX-08 | content in HTML | the server HTML (no JavaScript run) holds ≥ 300 characters of text outside `<nav>`/`<footer>`/`<script>` and ≥ 1 internal `<a href>` | 5 | `src/app/[game]/page.tsx`, `src/app/page.tsx` |
| IX-09 | structured data | every `application/ld+json` block parses, has `@context` and `@type`, and its `url` equals the canonical; the game markup has no `aggregateRating`/`review` | 7 | `src/app/[game]/page.tsx`, `src/app/page.tsx` |
| IX-10 | sitemap | XML parses, absolute URLs, every URL canonical and 200, no `priority`/`changefreq`, `lastmod` (where present) is ISO and not in the future and not equal on every URL | 8 | `src/app/sitemap.ts` |
| IX-11 | internal links | every sitemap URL is linked (`<a href>`) from the home page or from another sitemap URL (orphan check) | 9 | `src/app/page.tsx`, `src/app/layout.tsx` (footer) |
| IX-12 | share and icons | `og:title`, `og:description`, `og:image` present; the `og:image` URL answers 200 with an image type; `/favicon.ico` and the manifest answer 200 | 6 | `src/app/opengraph-image.tsx`, `src/app/[game]/opengraph-image.tsx`, `src/app/layout.tsx`, `src/app/manifest.ts` |

## On-page (phase 2)

The OP checks of `scripts/seo/onpage.mjs` (`lib/onpage-checks.mjs`): deterministic, GET only, over the home page and
every sitemap URL, with the keyword map `scripts/seo/keyword-map.json`. Game pages = sitemap URLs except `/`,
`/privacy`, `/terms`; home = `/`. OP-07 applies to every sitemap URL, the others to the home page and the game pages
("game pages:" rules to the game pages only). "Shared" text and links are those present on every game page (the game
menu, the header and footer); a link is its target plus its anchor text. Run:
`node scripts/seo/onpage.mjs [--site <url>] [--run-dir <dir>] [--analytics <gsc-analytics-pq.json>] [--psi]`.

| id | area | pass rule |
|---|---|---|
| OP-01 | keyword map | the page has an entry in `scripts/seo/keyword-map.json`, and every word of its primary query (lowercased, ignoring "the", "a") appears in the title and in the H1 |
| OP-02 | title | 30–60 characters; the primary query's words start within the first 40 characters; ends with ` \| Swish Quest` (home: starts with `Swish Quest`) |
| OP-03 | description | 110–160 characters; unique; contains at least one non-stopword of the primary query |
| OP-04 | headings | exactly one H1; game pages: ≥ 2 H2 |
| OP-05 | content | game pages: ≥ 150 unique visible words (text of `<main>` minus every sentence that occurs on all game pages, i.e. the shared menu) and an H2 matching /how to play/i |
| OP-06 | internal links | game pages: ≥ 2 links to other game pages that are not in the shared link set (links present on every page), each anchor ≥ 3 words and not generic ("click here", "play", "more") |
| OP-07 | URL | lowercase, hyphen-separated, no underscores, no query string. Informational: existing URLs are never renamed (decision `none`) |
| OP-08 | images | every `<img>` has non-empty alt; game pages have ≥ 1 `<img>` besides the logo (the game artwork) |
| OP-09 | structured data | game pages: a BreadcrumbList with ≥ 2 ListItems and a VideoGame node; no `aggregateRating`/`review` |
| OP-10 | page experience | HTML ≤ 250 KB; with PageSpeed data (`--psi`, env `PSI_API_KEY`): mobile lab LCP ≤ 2500 ms, TBT ≤ 200 ms, CLS ≤ 0.1, field p75 LCP/INP/CLS when present (INP ≤ 200 ms). No PSI data → a Coverage gaps line, not a failure |
| OP-11 | measurement | from `gsc-analytics-pq.json` (page × query, 28 days) when present: per page, flags `low-ctr` (≥ 100 impressions, CTR < 2 %), `striking` (position 8–20, ≥ 50 impressions), `mismatch` (top query by impressions shares no non-stopword with the primary query). Never a card itself; the flags and numbers go to the private `queries-summary.md` only |
