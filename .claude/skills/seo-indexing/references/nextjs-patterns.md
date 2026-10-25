# Where each signal is set (Next.js 16 App Router, `src/app/`)

For a card's `files` and `howToFix`: the file, the line pattern to Grep for, what the audit sees. Confirm the line with
Grep before you name it (the code moves); never name a line you did not see.

## Crawling and status
| signal (IX) | file | line pattern | note |
|---|---|---|---|
| robots.txt (IX-01) | `src/app/robots.ts` | `if (process.env.VERCEL_ENV !== "production")` → `disallow: "/"`; production `rules: { userAgent: "*", allow: "/", disallow: ["/admin"] }`, `sitemap: \`${SITE_URL}/sitemap.xml\`` | previews and local builds block everything on purpose; audit them with `--site` (HTML signals only) |
| unknown slug → 404 (IX-02) | `src/app/[game]/page.tsx` | `export const dynamicParams = false;` and `generateStaticParams()` over `gameSlugs()` | `src/app/not-found.tsx` renders `NoPageFound` with a real 404 |
| http / www → https apex (IX-02) | Vercel domain settings (owner, not code) | - | no file to change: the card's `howToFix` says "owner: Vercel → Domains", its `files` `vercel.json` (where a code redirect would go) |
| old hosts → swishquest.com (IX-02) | `vercel.json` | `"redirects"` entries with `"has": [{ "type": "host", … }]`, `"statusCode": 301` | keep at least a year (`docs/SEO-OWNER-TODO.md`) |

## Indexing rules
| signal (IX) | file | line pattern | note |
|---|---|---|---|
| noindex pages (IX-03) | `src/app/admin/page.tsx`, `src/app/profile/page.tsx`, `src/app/coming-soon/page.tsx` | `robots: { index: false, follow: false }` | `/admin` is also disallowed in robots.txt |
| | `src/app/credits/page.tsx` | `robots: { index: false }` (with `alternates: { canonical: "/credits" }`) | |
| no noindex on indexable pages (IX-03) | `src/app/layout.tsx` | must have no `robots:` key in `metadata` | a layout-level robots rule is inherited by every page |
| sitemap (IX-10, IX-03) | `src/app/sitemap.ts` | `visibleGames.filter((g) => g.id !== "coming-soon").map((g) => ({ url: \`${SITE_URL}${g.urlPath}\` }))`; legal `lastModified: LEGAL.updatedIso`; home `{ url: \`${SITE_URL}/\` }` | `LEGAL.updatedIso` is in `src/configurations/legal.ts`; no `changeFrequency`/`priority` |

## Canonical, title, description
| signal (IX) | file | line pattern | note |
|---|---|---|---|
| absolute base (IX-04) | `src/app/layout.tsx` | `metadataBase: new URL(SITE_URL)` | no `alternates` here (the comment says why) |
| game canonical (IX-04) | `src/app/[game]/page.tsx` `generateMetadata` | `alternates: { canonical: entry.urlPath }` | `entry = games.find((g) => g.urlPath === \`/${game}\`)` |
| home canonical (IX-04) | `src/app/page.tsx` | `alternates: { canonical: "/" }` | |
| legal canonicals (IX-04) | `src/app/privacy/page.tsx`, `src/app/terms/page.tsx` | `alternates: { canonical: "/privacy" }` / `"/terms"` | |
| title template (IX-05) | `src/app/layout.tsx` | `title: { default: SITE_TITLE, template: \`%s \| ${SITE_NAME}\` }` | |
| game title (IX-05) | `src/app/[game]/page.tsx` `generateMetadata` | `title: entry.name` | the name is `name` in `src/utils/GameUtils.tsx` |
| home title, site description (IX-05, IX-06) | `src/configurations/site.ts` | `SITE_TITLE = "…"`, `SITE_DESCRIPTION = "…"`, `SITE_NAME = "Swish Quest"` | used by `layout.tsx`, `page.tsx`, `manifest.ts` |
| game description (IX-06) | `src/app/[game]/page.tsx` | `const description = entry.seoDescription ?? entry.description;` | the text is `seoDescription: "…"` per game in `src/utils/GameUtils.tsx` (a game without one falls back to its short `description`) |
| legal titles and descriptions (IX-05, IX-06) | `src/app/privacy/page.tsx`, `src/app/terms/page.tsx` | `title: "Privacy Policy"`, `description: \`…\`` | |

## Content, headings, links
| signal (IX) | file | line pattern | note |
|---|---|---|---|
| game `<h1>` and text (IX-07, IX-08) | `src/views/Trivia/MiniGame.tsx` | `<h1 className="font-display" …>{game?.name}</h1>`; the idle card's `<p …>{game?.description}</p>` | rendered by `src/app/[game]/page.tsx` → `<MiniGame />` |
| home `<h1>` (IX-07) | `src/views/Landpage.tsx` | `<motion.h1 className="font-display hero-h1" …>` | |
| legal `<h1>` (IX-07) | `src/components/LegalPage.tsx` | `<h1 …>{title}</h1>` | |
| home links to every game (IX-11, IX-08) | `src/views/Landpage.tsx` | `href={game.urlPath}` | |
| footer links (IX-11) | `src/components/SiteFooter.tsx` | `<Link href={g.urlPath}>{g.name}</Link>` per visible game; `<Link href={item.href}>` for the legal pages | in `layout.tsx` as `<SiteFooter />`, so on every page |
| which games exist | `src/utils/GameUtils.tsx` | `export const games: Game[] = [`; per game `urlPath: "/…"`, `hidden: true`; `export const visibleGames: Game[] = games.filter((g) => !g.hidden);` | a hidden game is in no sitemap, no static param, no link (it 404s) |

## Structured data, share, icons
| signal (IX) | file | line pattern | note |
|---|---|---|---|
| game JSON-LD (IX-09) | `src/app/[game]/page.tsx` | `const gameJsonLd = {`, `"@type": ["VideoGame", "WebApplication"]`, `url: \`${SITE_URL}${entry.urlPath}\`` | no `aggregateRating`/`review`, ever |
| home JSON-LD (IX-09) | `src/app/page.tsx` | `const homeJsonLd = {`, `"@graph"` with `WebSite`, `Organization`, `ItemList` | ids `WEBSITE_ID`, `ORG_ID`, `LOGO_URL` from `site.ts` |
| the script tag (IX-09) | `src/components/JsonLd.tsx` | `<script type="application/ld+json" dangerouslySetInnerHTML=…` with `<` escaped | |
| share tags (IX-12) | `src/app/layout.tsx` (`openGraph`, `twitter`), `src/app/[game]/page.tsx` and `src/app/page.tsx` (`openGraph: { … url … }`) | `openGraph: { type: "website", siteName: SITE_NAME, …` | a child `openGraph` replaces the layout's wholesale |
| share images (IX-12) | `src/app/opengraph-image.tsx`, `src/app/twitter-image.tsx`, `src/app/[game]/opengraph-image.tsx`, `src/app/[game]/twitter-image.tsx` | `export const alt =`, `size`, `contentType` | file conventions, no metadata key |
| icons, manifest (IX-12) | `src/app/favicon.ico`, `src/app/icon.png`, `src/app/apple-icon.png`, `src/app/manifest.ts` | `export default function manifest()` (served at `/manifest.webmanifest`) | the manifest's icons are in `public/` |
| site verification | `src/app/layout.tsx`, `src/configurations/site.ts` | `verification: { google: GOOGLE_SITE_VERIFICATION }` | never remove it (it un-verifies the property) |

## The site URL
`src/configurations/site.ts`: `export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://swishquest.com")…`.
Every absolute URL (canonical through `metadataBase`, sitemap, robots, JSON-LD) comes from it; `NEXT_PUBLIC_SITE_URL`
overrides it for local QA only.
