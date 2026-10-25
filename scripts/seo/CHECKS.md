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
