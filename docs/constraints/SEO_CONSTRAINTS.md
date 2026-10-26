# SEO Constraints (what search engines see)

**Scope:** every change that can alter what a crawler gets from swishquest.com: a new page or game, page
metadata, the sitemap, robots, share images, structured data and the game catalogue's SEO fields. The files
are the SEO paths in `scripts/seo/lib/seo-paths.mjs` (`src/app/**/page.tsx`, `src/app/**/layout.tsx`,
`src/app/sitemap.ts`, `src/app/robots.ts`, `src/app/manifest.ts`, the `opengraph-image.tsx` /
`twitter-image.tsx` files, `src/configurations/site.ts`, `src/utils/GameUtils.tsx`,
`src/components/JsonLd.tsx`, `src/views/Trivia/MiniGame.tsx`, `scripts/seo/config.json`,
`scripts/seo/keyword-map.json`). How a new game is routed is `UI_SHELL_CONSTRAINTS.md` UI-2; not repeated here.

**Background, not repeated here:** `docs/seo/indexing-guide.md` (why each indexing step matters, steps 1–11)
and `docs/seo/onpage-guide.md` (the eleven on-page areas). The checks that prove each rule are catalogued in
`scripts/seo/CHECKS.md` (IX = indexing, `scripts/seo/audit.mjs`; OP = on-page, `scripts/seo/onpage.mjs`).

**Reference implementations:**

| Concern | Reference |
|---|---|
| Root metadata (`metadataBase`, title template, no canonical) | `src/app/layout.tsx` |
| Home page metadata + JSON-LD | `src/app/page.tsx` |
| Per-game metadata, static params, game JSON-LD | `src/app/[game]/page.tsx` |
| A noindex page | `src/app/admin/page.tsx`, `src/app/credits/page.tsx` |
| A plain indexable page | `src/app/privacy/page.tsx` |
| Sitemap / robots | `src/app/sitemap.ts`, `src/app/robots.ts` |
| Site name, URL, default title and description | `src/configurations/site.ts` |
| Game catalogue (`urlPath`, `seoDescription`, `hidden`) | `src/utils/GameUtils.tsx` |
| Expected noindex list, keyword map | `scripts/seo/config.json` (`expectedNoindex`), `scripts/seo/keyword-map.json` |

Rules SEO-1 to SEO-8 block: `npm run check:seo` (part of `npm run lint`) and the built-page audit in QA and
`dev-ci` fail on them. SEO-9 is reported as a warning.

---

## Rule SEO-1: Every public page is in the sitemap or is noindex and listed in `expectedNoindex` — no third state

Why: a page in neither list is either invisible to Google or indexed by accident.

- Do: a new game is a visible catalogue entry in `src/utils/GameUtils.tsx`; `src/app/sitemap.ts` builds the
  game URLs from `visibleGames`, so nothing else is needed. Any other new indexable page adds its path to the
  list in `src/app/sitemap.ts`.
- Do: a page that must stay out of the index sets `robots: { index: false }` in its metadata (SEO-3) and its
  path goes into `expectedNoindex` in `scripts/seo/config.json`.
- Don't: ship a `page.tsx` that is neither; don't list a path in `expectedNoindex` that is not a noindex route.

Checked by: `check:seo`; IX-03, IX-10.

## Rule SEO-2: Every indexable page sets its own `title`, `description` and `alternates.canonical`; the root layout never sets a canonical

Why: a missing description lets Google pick a snippet; an inherited canonical points every page at `/`.

- Do: export `metadata` (or `generateMetadata`) with all three, the canonical as a path (`metadataBase` in
  `src/app/layout.tsx` makes it absolute), as `src/app/privacy/page.tsx` and `src/app/[game]/page.tsx` do.
- Do: keep the title short; the layout's template appends ` | Swish Quest`.
- Don't: add `alternates` or `canonical` to `src/app/layout.tsx`; don't reuse another page's title or
  description.

Checked by: `check:seo`; IX-04, IX-05, IX-06.

## Rule SEO-3: Private or thin pages are noindex and out of the sitemap; robots.txt never hides a linked page

Why: admin, profile, account, credits, coming-soon, thank-you and internal search pages add nothing to search
results; a robots.txt block hides the noindex tag, so a linked URL can still be indexed.

- Do: `robots: { index: false }` in the page's metadata (`src/app/admin/page.tsx`,
  `src/app/profile/page.tsx`, `src/app/credits/page.tsx`, `src/app/coming-soon/page.tsx`), path in
  `expectedNoindex`, path not in `src/app/sitemap.ts`.
- Don't: add a `disallow` to `src/app/robots.ts` to drop a page from the index. `/admin` is the only
  disallowed path and stays so.

Checked by: `check:seo`; IX-01, IX-03.

## Rule SEO-4: A game's `seoDescription` is 50–160 characters (aim for 110–160), unique, specific and written for people

Why: it is the game page's meta description and JSON-LD description, the snippet a searcher reads.

- Do: say what the player does and what makes this game different, in one or two plain sentences
  (`src/utils/GameUtils.tsx`, for example the `series-winner` entry).
- Don't: copy another game's sentence, stuff keywords, or leave it out (the short `description` is then used).

Checked by: `check:seo`; IX-06, OP-03.

## Rule SEO-5: URLs are lowercase, hyphen-separated, without underscores or query strings; an existing URL is never renamed

Why: a rename needs a 301 and loses the signals the old URL earned.

- Do: a game's `urlPath` in `src/utils/GameUtils.tsx` and a new route directory under `src/app/` match
  `^/[a-z0-9]+(-[a-z0-9]+)*$`.
- Don't: change the `urlPath` of a live game or move a live page; don't put state in a query string that
  should be its own page.

Checked by: `check:seo`; OP-07.

## Rule SEO-6: Content and links are in the server HTML, links are real `<a href>`, one `<h1>` per page

Why: the first crawl reads the HTML without running JavaScript; a link Google cannot see is a page it may never
find.

- Do: render the page's text and links on the server (static or server rendering); navigate with `<a href>`
  (Next.js `Link`), as the game menu and `src/components/SiteFooter.tsx` do; one `<h1>` (the game name in
  `src/views/Trivia/MiniGame.tsx`).
- Don't: load the main text only after hydration, navigate with `onClick` on a `div` or `button`, or add a
  second `<h1>`.

Checked by: IX-07, IX-08, IX-11.

## Rule SEO-7: Structured data matches the visible page, its `url` is the canonical, and nothing is invented

Why: markup that disagrees with the page, or fake ratings, is a manual-action risk.

- Do: render JSON-LD with `src/components/JsonLd.tsx`, the `url` built from `SITE_URL` + the canonical path,
  as `src/app/[game]/page.tsx` does.
- Don't: add `aggregateRating`, `review` or any fact the page does not show.

Checked by: IX-09.

## Rule SEO-8: Every indexable page has a share preview: `og:title`, `og:description`, `og:image`, and the image loads

Why: links shared in chats and social posts show the preview; a broken image looks like a broken site.

- Do: rely on the file conventions (`src/app/opengraph-image.tsx`, `src/app/[game]/opengraph-image.tsx`,
  `src/app/twitter-image.tsx`). A child `openGraph` replaces the layout's wholesale, so a page that sets one
  repeats the shared fields and the image (`src/app/privacy/page.tsx`).
- Don't: set `openGraph` without `images` on a page that has no `opengraph-image.tsx` next to it.

Checked by: IX-12.

## Rule SEO-9: A new game meets the phase-2 on-page checks

Should, not blocking: OP results are warnings until the owner decides otherwise.

Why: phase-2 on-page quality is what ranks a game page above other NBA trivia sites.

- Do: give a new game a primary search in `scripts/seo/keyword-map.json` and build its title and `<h1>` on
  it; a visible how-to-play section; links to related games with descriptive anchors; the artwork as an
  `<img>` with alt text; a `BreadcrumbList` next to the game JSON-LD in `src/app/[game]/page.tsx`.
- Don't: treat an OP warning as a reason to rename a live URL (SEO-5).

Checked by: OP-01 to OP-09 (warnings in QA and `dev-ci`).
