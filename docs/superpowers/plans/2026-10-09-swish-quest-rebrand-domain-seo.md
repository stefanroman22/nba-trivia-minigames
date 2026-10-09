# Swish Quest: rebrand, move to swishquest.com, full SEO

Date: 2026-10-09. Sources: a code audit of this repo and a research briefing built on Google Search Central,
RFC 9309, llmstxt.org, Next.js and Vercel docs (links inline). Goal: the site lives at **https://swishquest.com**
under the name **Swish Quest**, every old URL hands its signals over, and the site is fully optimised for Google,
Bing and AI assistants.

## Decisions (defaults chosen; change any before work starts)

| # | Decision | Default | Why |
|---|---|---|---|
| D1 | Main address | `https://swishquest.com` (no www); `www` redirects to it | Vercel DNS supports the bare domain fully; one canonical host |
| D2 | AI crawlers | Allow all (search, user-fetch and training bots) | We want to be cited; blocking `Google-Extended` would also drop Gemini grounding |
| D4 | Navbar wordmark | "SWISH QUEST" with tagline "NBA TRIVIA GAMES" | Matches the title and the search keyword |
| D5 | Social profiles for `sameAs` | None yet; add when created | Never invent profiles |
| D6 | Share image | Generated 1200x630 card per page (brand + page title on the site's dark/orange theme) | No design asset exists; generated cards stay in sync with names |

## What the audit found

- One constant (`src/configurations/site.ts` `SITE_NAME`) feeds every title, Open Graph tag and JSON-LD block.
  `SITE_URL` falls back to the vercel.app host unless `NEXT_PUBLIC_SITE_URL` is set.
- `public/robots.txt` and `public/llms.txt` hard-code the old host; `llms.txt` uses the old brand and misses `/who-would-win`.
- No redirects anywhere: the vercel.app host stays a full duplicate of the site.
- **Crawlers cannot follow links to the games:** home tiles, the game rail and the nav are `<button>`s with `onClick`,
  so games are found only through the sitemap.
- No footer is mounted: `/privacy` and `/terms` are linked only inside the login modal.
- No favicon set (only a webp), no apple-icon, no web manifest, no 1200x630 share image (`summary` card with a small webp).
- Game descriptions are 30-60 characters; game pages have little indexable text (rules live in a modal).
- Legal pages inherit the layout's `og:title`; no `og:url` per page.
- The API host (`backend-kappa-one-42.vercel.app`) has no robots rules or noindex header.
- `swishquest` is not a reserved username.

## Phase 1: code (one PR, no visible change to the address yet)

**Brand**
1. `site.ts`: `SITE_NAME = "Swish Quest"`, `SITE_URL = "https://swishquest.com"` (hard-coded; `NEXT_PUBLIC_SITE_URL` may
   override for local QA). Do not rely on `VERCEL_PROJECT_PRODUCTION_URL` (it changes if a shorter domain is ever added).
2. Navbar desktop and mobile wordmark and logo alt (D4). Reserve `swishquest`, `swish_quest`, `swish` in `reserved.json`.
3. A real site footer mounted on every page: game links, Privacy, Terms, "Swish Quest", the NBA
   non-affiliation line. Replaces the dead `Footer.tsx`.

**Metadata** (Next.js Metadata API)
4. Root layout: `metadataBase`, title default "Swish Quest: Free NBA Trivia Games", template "%s | Swish Quest",
   `applicationName`, a 150-160 character description, `openGraph.siteName/locale/type`, `twitter.card = summary_large_image`.
   **No canonical in the root layout** (children would inherit `/`).
5. Every page sets its own `alternates.canonical` and `openGraph.url/title/description` (Open Graph objects replace,
   not merge, so `siteName` is repeated). Pages: home, each game, privacy, terms.
6. Game descriptions rewritten to 120-160 characters, unique, keyword-led ("Guess the mystery NBA player in 8 tries...").
7. `/admin`, `/coming-soon`: `robots: { index: false, follow: false }` plus an `X-Robots-Tag: noindex` header.
8. `verification.google` meta (token from Search Console, Phase 2 step 1).

**Crawling files**
9. `app/robots.ts` replaces `public/robots.txt`. Production: `User-agent: *`, `Allow: /`, `Disallow: /admin`, absolute
   `Sitemap: https://swishquest.com/sitemap.xml`. Any non-production build (`VERCEL_ENV !== "production"`): `Disallow: /`.
   No per-bot groups (D2). Format per [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309) and
   [Google's robots spec](https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt).
10. `app/sitemap.ts`: absolute `https://swishquest.com` URLs; drop `changefreq`/`priority` (Google ignores them);
    `lastModified` only where it is genuinely known (legal pages from `LEGAL.updated`; games from a per-game `updated`
    field), never "now" on every build ([Google sitemaps](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)).
11. `llms.txt` generated from `visibleGames` by a route handler so it can never drift: H1 "Swish Quest", blockquote
    summary, one line of context, `## Games` (all 11 with descriptions), `## About`,
    `## Optional` (privacy, terms), per [llmstxt.org](https://llmstxt.org/). Expectation set honestly: Google says it
    does not use such files and log studies show little bot traffic; it costs nothing and helps coding agents.
12. Host guard header: any request whose host is not `swishquest.com` (vercel.app aliases, per-deployment URLs) gets
    `X-Robots-Tag: noindex` (Vercel only noindexes preview deployments, not the production vercel.app alias).
13. API host: `robots.txt` with `Disallow: /` and `X-Robots-Tag: noindex` on every API response.

**Rich results and share cards**
14. JSON-LD, rendered safely (`<` escaped): home = `WebSite {name "Swish Quest", alternateName ["SwishQuest","swishquest.com"], url}`
    + `Organization {name, url, logo (512px PNG), sameAs when D5 exists}`; each game =
    `["VideoGame","WebApplication"]` with `applicationCategory GameApplication`, `genre Trivia`, `isAccessibleForFree`,
    `inLanguage en`, free `Offer`, `publisher {"@id": org}`. No ratings (never invented). No FAQ markup (FAQ rich
    results ended 2026-05-07) and no `SearchAction` (sitelinks search box retired 2024).
15. `app/opengraph-image.tsx` (home) and one per game, 1200x630 PNG via `ImageResponse` (D6); `twitter-image` reuses them.
16. Icons: `app/favicon.ico` (48px), `app/icon.png` (512), `app/apple-icon.png` (180), `app/manifest.ts`
    (name, short_name, theme colour, 192 and 512 icons), all built from the existing logo.

**Indexable content and links**
17. Game tiles, the game rail and the nav become real links (`<a href>` via `next/link`) with the same look and motion.
18. Each game page gets a short server-rendered "How to play" section (3-5 sentences from the existing rules) below
    the game, and links to the other games. One `<h1>` per page (drop the repeated `<h2>`).
19. Image `alt` text kept meaningful where the image carries information; decorative images stay `alt=""`.

**Other places the address lives**
20. Docs (`DEPLOYMENT.md`, `CREDENTIALS.md`, the promote-to-prod skill), multiplayer `CORS_ORIGINS` example,
    `README` title. Remove leftover scaffold files (`public/vite.svg`, `src/assets/react.svg`).

**Checks before merge**: `npm run lint`, `tsc`, backend tests, a build, and a local inspection of `/robots.txt`,
`/sitemap.xml`, `/llms.txt`, `/manifest.webmanifest`, every page's `<title>`, canonical, `og:*` and JSON-LD; Lighthouse
SEO and accessibility on home and one game page (target 100 SEO).

## Phase 2: cutover (ordered; each step verified before the next)

1. **Search Console, before any redirect**: add a *Domain* property `swishquest.com` (TXT record added in Vercel DNS)
   and a *URL-prefix* property `https://nba-minigames.vercel.app/` (HTML tag via `verification.google`, deployed in
   Phase 1). Both under the owner's Google account.
2. **Promote Phase 1** to production. The site still answers on vercel.app.
3. **Attach domains in Vercel**: `swishquest.com` (production) and `www.swishquest.com` with "redirect to
   swishquest.com" (permanent). Verify HTTPS on both.
4. **Redirect the old host**: `vercel.json` rule matching host `nba-minigames.vercel.app` -> `https://swishquest.com/:path*`,
   301, path-preserving ([Vercel KB](https://vercel.com/kb/guide/avoiding-duplicate-content-with-vercel-app-urls)).
   Deployed only after step 3 works. Kept permanently ([Google: at least a year](https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes)).
   Note: browser storage is per address, so anyone signed in on the old address signs in once more on the new one.
5. **Google sign-in consent screen**: home page, privacy and terms links -> `https://swishquest.com/...`; add
   `swishquest.com` to authorized domains (origins were already added on 2026-10-08).
6. **Search Console**: submit `https://swishquest.com/sitemap.xml`; run **Change of Address** from the vercel.app
   property to swishquest.com (works for host-level properties; vercel.app is on the Public Suffix List); request
   indexing for home and the games.
7. **Bing Webmaster Tools**: import from Search Console. Optional: IndexNow key for Bing (Google does not use IndexNow).
8. Multiplayer host (when deployed): `CORS_ORIGINS=https://swishquest.com,https://www.swishquest.com`.

## Phase 3: verify and monitor

- Immediately: `curl -I` old host -> one 301 hop to the same path on swishquest.com; `www` -> one hop; production
  `robots.txt`, `sitemap.xml`, `llms.txt` correct; no `X-Robots-Tag` on swishquest.com; noindex on vercel.app aliases
  and the API; Rich Results Test and Schema validator clean; PageSpeed Insights mobile; share preview in Slack/X/LinkedIn.
- Weeks 1-8: Search Console Pages report (old URLs move to "Page with redirect"), site name shows "Swish Quest"
  (days to weeks), favicon updates (days to weeks), Core Web Vitals report (LCP < 2.5 s, INP < 200 ms, CLS < 0.1).

## Status (2026-10-09)

- Phase 1 and Phase 2 steps 1-6 done and live (PRs #44-#47). The `/:path*` host redirect did not match the bare
  root, so `/` has its own rule per old host; the old home now 301s in one hop. Change of Address is active
  ("This site is currently moving", started 2026-10-09). Sitemap submitted (first fetch pending).
- Phase 3: curl checks pass; Lighthouse (local, mobile) SEO 100 on home and `/wordle`.
- Left: request indexing (URL inspection errored on the brand-new property; retry later), Bing import (owner
  sign-in), Rich Results Test, share-preview check, multiplayer `CORS_ORIGINS` when deployed, weeks 1-8 monitoring.

## Out of scope here

NBA logo/headshot replacement (owner: later), trademark clearance for "Swish Quest", paid tools.
