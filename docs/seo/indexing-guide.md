# Page Indexing

## 1. What indexing is

**Search engine indexing** is the process in which a search engine analyses a web page and stores it in its **index**:
a database of every page it has decided to keep. A page in the index has been seen, evaluated and remembered, so it can
be shown in search results. A page that is not indexed cannot rank and cannot receive search traffic, however well it
is built.

Crawling and indexing are **two separate steps**. Crawling means fetching the page; indexing means storing it. A page
can be crawled and still be left out of the index, for example when Google judges it a duplicate or not useful enough.

### 1.1 The index

The index works like the catalogue of a very large library. It does not store pages for people to read; it stores what
the search engine needs to find them: the text, title, headings, links, language, canonical URL and signals such as
freshness and mobile usability. Because this information is prepared in advance, a search can be answered in a fraction
of a second without visiting any website live.

### 1.2 The inverted index

A normal list is organised by document: each page lists the words it contains. Search engines turn this around. An
**inverted index** stores, for every word, the list of pages that contain it. To answer a query, the engine looks up
each word and keeps the pages that appear in every list, instead of reading billions of pages one by one. The
simplified example below uses Swish Quest pages.

| Word       | Pages that contain it                                               |
|------------|---------------------------------------------------------------------|
| **nba**    | /, /wordle, /guess-mvps, /career-path, /who-are-ya, /name-logo, ... |
| **player** | /wordle, /career-path, /who-are-ya                                  |
| **wordle** | /wordle                                                             |
| **logo**   | /name-logo                                                          |

A search for **nba player wordle** looks up the three lists and keeps the page found in all of them: `/wordle`. Real
indexes also store where each word appears and how important it is, which feeds ranking.

## 2. Why indexing matters and how it helps

Indexing is the gate to search. If a page is not indexed it has **zero chance** of ranking or receiving organic
traffic, so it is the first thing to get right before any other SEO work can pay off. Once a page is indexed, it helps
in several ways:

- **Every indexed page is its own entry point.** Each Swish Quest game page can rank for its own searches, such as
  "nba wordle" or "guess the nba mvp", instead of the homepage competing for all of them.
- **The traffic is free and compounding.** An indexed, well-ranked page keeps bringing visitors without paid promotion.
- **It unlocks richer results.** Titles, descriptions and structured data are read during indexing and decide how
  attractive the result looks. AI answer features in Google and Bing also draw mainly on the same index.
- **Changes reach searchers sooner.** A site that is crawled and indexed efficiently has new and updated content
  reflected in results faster.
- **It exposes problems.** Search Console's indexing report shows broken pages, accidental blocks and duplicates that
  usually hurt visitors too.

> **Key point.** Indexing makes a page **eligible** to appear. Ranking decides **where** it appears, and the title,
> description and rich results decide **how** it appears.

## 3. The overall system

Google describes three stages: crawling, indexing and serving. In practice the address must first be **discovered**,
and pages that depend on JavaScript must be **rendered** before they are indexed. Figure 1 shows the full chain; each
part is explained below.

The five stages: discover, crawl, render, index, serve.

### 3.1 Discovery

A search engine can only crawl a URL it knows about. It finds new URLs through **links** from pages it already knows
(your own internal links and links from other sites), through **XML sitemaps**, through **manual submission** in Google
Search Console or Bing Webmaster Tools, and, for Bing and several other engines, through **IndexNow** notifications.
Links matter most: Google's John Mueller has said that "backlinks are the best way to get Google to index content".

### 3.2 The crawler

A **crawler** is a program that fetches pages the way a browser does. Google's is **Googlebot**; Bing's is
**Bingbot**. Since 2024 Google crawls and indexes every site with its smartphone crawler (**mobile-first indexing**),
so the mobile version of a page is the one that counts. For each URL in its queue the crawler:

- reads the site's **robots.txt** file to check that it is allowed to fetch the URL;
- requests the page and records the **HTTP status code** (200 found, 3xx redirect, 404 missing, 5xx server error);
- extracts the links in the HTML and adds new URLs to the queue.

Crawling is rationed by a **crawl budget**: how fast and reliably the server answers (crawl capacity) and how much
Google wants the content (crawl demand). Small sites rarely hit the limit, but server errors, slow responses and
endless URL variants waste it.

### 3.3 Rendering

Every page that returns 200 joins a **render queue**, where Google runs it in an up-to-date headless Chromium browser
to see the final content, including anything added by JavaScript. Rendering can happen some time after the first
fetch, and many other crawlers, including several AI assistants, do not run JavaScript at all. Content that is already
in the HTML sent by the server is therefore the safest.

### 3.4 Indexing

Google then analyses the rendered page and decides whether and how to store it:

- **Parsing:** it reads the text, headings, title, links, images and structured data, and works out the topic and
  language.
- **Canonicalisation:** it groups pages with the same or very similar content and picks one **canonical** URL to
  represent the group; the others become alternates.
- **Quality evaluation:** thin, duplicated or spammy pages may be crawled but left out. Core algorithm updates can
  change these decisions for a whole site.
- **Storage:** the canonical page and its signals go into the inverted index.

### 3.5 Serving

When someone searches, Google looks the words up in the index, ranks the matching pages by relevance and quality, and
decides how to present each one: a title link and snippet, a rich result, an image, or a source in an AI-generated
answer.

## 4. Steps to get a page indexed

The steps below take a page from invisible to indexed. Steps 1 to 5 make the page **indexable**, steps 6 and 7 improve
**how it appears**, and steps 8 to 11 **tell search engines** about it and check the result. Each step gives what to
do, how to do it, a real example from swishquest.com (a Next.js site) and what Google rewards or dislikes.

### Step 1. Let crawlers in with robots.txt

**What to do.** Make sure robots.txt allows the pages you want indexed, and the CSS and JavaScript they need. Block
only areas with no search value.

**How.** robots.txt is a plain text file at the root of the domain. Each group names a crawler (`User-agent`) and the
paths it may or may not fetch; a `Sitemap` line points to the sitemap. In Next.js the file is generated from
`src/app/robots.ts`.

**Live file: https://swishquest.com/robots.txt**

```text
User-Agent: *
Allow: /
Disallow: /admin

Sitemap: https://swishquest.com/sitemap.xml
```

**Source: src/app/robots.ts (simplified)**

```ts
export default function robots(): MetadataRoute.Robots {
  // Preview and local builds block everything
  if (process.env.VERCEL_ENV !== "production") {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/admin"] },
    sitemap: "https://swishquest.com/sitemap.xml",
  };
}
```

Preview deployments block all crawling, so preview URLs never compete with the real domain.

| Google likes                                             | Google does not like                                                                                                |
|----------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------|
| A short file that blocks only areas with no search value | Blocking CSS, JavaScript or images the page needs to render                                                         |
| Using robots.txt to control what is crawled              | Using robots.txt to hide a page: a blocked URL can still be indexed, without its content, if other pages link to it |
| A `Sitemap:` line with the full sitemap URL              | `noindex` or `crawl-delay` lines in robots.txt: Google does not support them                                        |

### Step 2. Allow indexing, and use noindex on purpose

**What to do.** Pages that should rank must not carry a `noindex` rule. Pages with no search value, such as admin,
profile, login or thank-you pages, should carry one.

**How.** Add a robots meta tag in the page `<head>`, or send an `X-Robots-Tag` HTTP header for files without a head,
such as PDFs. In Next.js, set `robots` in the page metadata.

**Keep a page out of the index**

```html
<!-- In the HTML <head> -->
<meta name="robots" content="noindex">

# As an HTTP response header (for PDFs and other files)
X-Robots-Tag: noindex
```

**Source: src/app/admin/page.tsx and src/app/profile/page.tsx**

```ts
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};
```

> **Lesson from Swish Quest.** `/admin` is both disallowed in robots.txt and marked noindex. Because crawlers never
> fetch it, they never see the noindex. That is harmless here because nothing links to `/admin`, but for a page that
> other sites link to, the right fix is to **remove the Disallow** so the noindex can be read.

| Google likes                                    | Google does not like                                                                       |
|-------------------------------------------------|--------------------------------------------------------------------------------------------|
| noindex on pages with no search value           | noindex on a page you want ranked, often left over from a staging site                     |
| noindex in the original HTML sent by the server | Adding or removing noindex with JavaScript: Google may skip rendering once it sees noindex |
| X-Robots-Tag for PDFs and other non-HTML files  | noindex combined with a robots.txt block, so the rule is never seen                        |

### Step 3. Serve one clean URL with the right status code

**What to do.** The preferred version of each page returns **200 over HTTPS**. Every other version redirects to it
permanently in a single hop, and pages that do not exist return **404**.

**How.** Set the redirects at the host (on Vercel: the domain settings) and check them with `curl -I <url>` or the
Network tab of the browser's developer tools.

| Request                                    | Response                             | Why it is right                      |
|--------------------------------------------|--------------------------------------|--------------------------------------|
| **http://swishquest.com/wordle**           | 308 to https://swishquest.com/wordle | HTTP is upgraded to HTTPS in one hop |
| **https://www.swishquest.com/wordle**      | 308 to https://swishquest.com/wordle | www is folded into the bare domain   |
| **https://swishquest.com/wordle**          | 200 OK                               | The canonical page                   |
| **https://swishquest.com/not-a-real-page** | 404 Not Found                        | Missing pages are reported honestly  |

*Real responses from swishquest.com, checked on 25 October 2026.*

Game routes use `dynamicParams = false`, so an unknown game slug returns a real 404 instead of an empty page.

| Google likes                                    | Google does not like                                                           |
|-------------------------------------------------|--------------------------------------------------------------------------------|
| One permanent redirect (301 or 308) per old URL | Redirect chains (A to B to C) and HTTPS-to-HTTP redirects                      |
| A real 404 or 410 for missing pages             | Soft 404s: an empty or error page that returns 200, common in single-page apps |
| Fast, stable responses                          | Frequent 5xx errors or timeouts, which make Google slow down crawling          |

### Step 4. Declare the canonical URL

**What to do.** Give every indexable page a **self-referencing canonical**, so variants such as tracking parameters
consolidate onto one URL.

**How.** Add `<link rel="canonical" href="...">` with an absolute URL in the `<head>`. In Next.js, set
`alternates.canonical` per page; `metadataBase` turns the path into an absolute URL.

**In the HTML of https://swishquest.com/wordle?ref=twitter**

```html
<link rel="canonical" href="https://swishquest.com/wordle"/>
```

**Source: src/app/[game]/page.tsx (simplified)**

```ts
export async function generateMetadata({ params }) {
  const { game } = await params;
  const entry = games.find((g) => g.urlPath === `/${game}`);
  return {
    title: entry.name,
    description: entry.seoDescription,
    alternates: { canonical: entry.urlPath },
  };
}
```

The canonical is set on each page, not in the root layout. A canonical in the layout would be inherited by every page
and point the whole site at the homepage, a classic and costly mistake.

| Google likes                                                             | Google does not like                                                                    |
|--------------------------------------------------------------------------|-----------------------------------------------------------------------------------------|
| Absolute canonical URLs that match redirects, sitemap and internal links | Conflicting signals, such as a sitemap listing one URL and the canonical naming another |
| A canonical in the server HTML                                           | A canonical changed by JavaScript after load                                            |
| Redirects for retired duplicates                                         | Using noindex or robots.txt to choose between duplicates                                |

Google treats the canonical as a **strong hint, not a command**; consistent signals make it follow your choice.

### Step 5. Put the content and links in the HTML

**What to do.** Make sure the main text, headings and links are in the HTML the server sends, and that every link is a
real `<a href>`.

**How.** Use server-side rendering or static generation. Check with **View page source** (not the inspector, which
shows the page after JavaScript) or with Search Console's URL Inspection, View crawled page.

**Source: src/app/[game]/page.tsx: every game page is built as static HTML**

```ts
export const dynamicParams = false;   // unknown slugs return 404

export function generateStaticParams() {
  return gameSlugs().map((game) => ({ game }));
}
```

**Links Google can and cannot follow**

```html
<a href="/wordle">Play NBA Wordle</a>       followed, clear anchor text
<a href="/wordle"><img src="w.png" alt=""></a> followed, but says nothing
<span onclick="go('/wordle')">Play</span>   not a link, never followed
<a href="#/wordle">Play</a>                 fragment, not a separate page
```

In Next.js, `<Link href="/wordle">` renders a real `<a href>`, so it is crawlable.

| Google likes                                         | Google does not like                                                     |
|------------------------------------------------------|--------------------------------------------------------------------------|
| Server-rendered or static HTML with the full content | Content that appears only after a click, a scroll or a login             |
| Real URLs per page, using the History API            | `#fragment` routes for different content                                 |
| Descriptive anchor text and image alt text           | "Click here", empty anchors and links without `href`                     |
| The same content on mobile and desktop               | Content missing from the mobile version, which is the one Google indexes |

### Step 6. Write a clear title and description

**What to do.** Give each page a **unique, descriptive title** and a meta description that tells a person what they
will find.

**How.** In Next.js the root layout sets a title template (`%s | Swish Quest`) and each page fills in its own title and
description.

**In the HTML of https://swishquest.com/wordle**

```html
<title>NBA Wordle | Swish Quest</title>
<meta name="description" content="NBA Wordle: guess the mystery NBA
  player's name in five tries with Wordle-style green and yellow
  letter hints. A new puzzle every day, free to play."/>
```

| Google likes                                                       | Google does not like                                            |
|--------------------------------------------------------------------|-----------------------------------------------------------------|
| Short, specific titles with the brand at the end after a separator | Vague titles ("Home", "Game") and the same title on many pages  |
| A description written for people, unique per page                  | Keyword stuffing in titles or descriptions                      |
| A visible main heading that matches the title                      | A title that does not match the content: Google will rewrite it |

The meta description is not a ranking factor, but Google often shows it as the snippet, so it affects how many people
click.

### Step 7. Add structured data

**What to do.** Describe the page in schema.org vocabulary so Google understands what it is. Structured data is not
needed for indexing, but it is required for rich results.

**How.** Add a JSON-LD script to the page. Validate it with Google's Rich Results Test.

**JSON-LD on each game page (simplified)**

```json
{
  "@context": "https://schema.org",
  "@type": ["VideoGame", "WebApplication"],
  "name": "NBA Wordle",
  "url": "https://swishquest.com/wordle",
  "genre": "Trivia",
  "applicationCategory": "GameApplication",
  "operatingSystem": "Any",
  "isAccessibleForFree": true,
  "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" }
}
```

The homepage adds `WebSite`, `Organization` and an `ItemList` of all games. The game markup deliberately has **no
ratings**: Google's software-app rich result needs genuine ratings or reviews, and invented ones break its rules.

| Google likes                                     | Google does not like                                                                                                         |
|--------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------|
| JSON-LD that matches what is visible on the page | Markup for content that is not on the page, or invented ratings and reviews                                                  |
| Testing every change with the Rich Results Test  | Expecting markup to force a rich result: Google decides, and has retired some types (How-to in 2023, FAQ reportedly in 2026) |

### Step 8. Publish an XML sitemap

**What to do.** List every canonical, indexable URL in an XML sitemap. It is most useful for new sites with few links
and for pages that are hard to reach.

**How.** Serve it at `/sitemap.xml`, reference it in robots.txt and submit it in Search Console. In Next.js it is
generated from `src/app/sitemap.ts`.

**Live file (excerpt): https://swishquest.com/sitemap.xml**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://swishquest.com/</loc></url>
  <url><loc>https://swishquest.com/wordle</loc></url>
  <url><loc>https://swishquest.com/guess-mvps</loc></url>
  <url>
    <loc>https://swishquest.com/privacy</loc>
    <lastmod>2026-10-20</lastmod>
  </url>
</urlset>
```

**Source: src/app/sitemap.ts (simplified)**

```ts
export default function sitemap(): MetadataRoute.Sitemap {
  const games = visibleGames.map((g) => ({ url: `${SITE_URL}${g.urlPath}` }));
  const legal = ["/privacy", "/terms"].map((path) => ({
    url: `${SITE_URL}${path}`,
    lastModified: LEGAL.updatedIso,   // only where the date is really known
  }));
  return [{ url: `${SITE_URL}/` }, ...games, ...legal];
}
```

A sitemap is a **hint**: it helps Google find pages but does not force them into the index. It also cannot set
priorities, because Google ignores the `priority` and `changefreq` fields.

| Google likes                                                         | Google does not like                                                   |
|----------------------------------------------------------------------|------------------------------------------------------------------------|
| Only canonical URLs that return 200, written as absolute URLs        | Redirecting, 404, noindex or parameter URLs in the sitemap             |
| An accurate lastmod for real content changes                         | lastmod set to the build time on every URL: Google learns to ignore it |
| Up to 50,000 URLs or 50 MB per file, with a sitemap index above that | Relying on `priority` and `changefreq`, which are ignored              |

### Step 9. Link to the page, inside and outside the site

**What to do.** Link every important page from at least one page that is already indexed, using descriptive anchor
text, and earn links from other relevant sites.

**How.** On Swish Quest the homepage links to every game, and the footer links to the privacy and terms pages. Outside
the site, links from basketball communities, creators and press articles help both discovery and ranking.

**Example pattern (anchor texts are illustrative)**

```html
<!-- Homepage game card -->
<a href="/guess-mvps">Guess the NBA MVPs</a>

<!-- Suggestion at the end of a game -->
<p>Enjoyed it? Try the <a href="/career-path">NBA career path quiz</a>.</p>
```

| Google likes                                          | Google does not like                                                                    |
|-------------------------------------------------------|-----------------------------------------------------------------------------------------|
| Important pages a few clicks from the homepage        | Orphan pages that nothing links to                                                      |
| Natural links from relevant sites                     | Bought links, link exchanges and spam directories                                       |
| Social sharing that brings visitors and natural links | Expecting likes and shares to raise rankings: Google says they are not a ranking factor |

### Step 10. Submit the site to Google and Bing

**What to do.** Verify the site in Google Search Console and Bing Webmaster Tools, submit the sitemap, and request
indexing for important new pages.

**How.** In Search Console: add the property and verify it, open **Sitemaps**, enter `sitemap.xml` and press Submit.
For a single page, paste its URL into the **URL Inspection** bar at the top; if it is not indexed yet, press **Request
indexing**. In Bing Webmaster Tools, import the site from Search Console, then submit the sitemap or individual URLs.

**Verification tag generated by Next.js (src/app/layout.tsx)**

```ts
export const metadata: Metadata = {
  verification: { google: GOOGLE_SITE_VERIFICATION },
};
// renders: <meta name="google-site-verification" content="..."/>
```

**IndexNow for Bing and others (example)**

```text
1. Host the key file:  https://swishquest.com/<your-key>.txt
2. Notify a change:    https://api.indexnow.org/indexnow
                         ?url=https://swishquest.com/wordle&key=<your-key>
```

| Google likes                                                 | Google does not like                                                                         |
|--------------------------------------------------------------|----------------------------------------------------------------------------------------------|
| One indexing request for a new or significantly changed page | Requesting the same unchanged page again and again; the daily quota is small and unpublished |
| A submitted sitemap with status Success                      | Using the Indexing API for ordinary pages: it is only for job postings and livestream events |
| Bing set up as well, with IndexNow for fast updates          | The old sitemap ping URL, which Google retired in 2023                                       |

### Step 11. Check the result and fix what is reported

**What to do.** Confirm the page is indexed, and work through anything Search Console reports.

**How.** URL Inspection gives the definitive answer for one page ("URL is on Google"). The `site:` search gives a
quick, approximate list. The **Pages** report under Indexing lists every known URL with the reason it is or is not
indexed.

**Quick checks in Google Search**

```text
site:swishquest.com          approximate list of indexed pages
site:swishquest.com/wordle   is this one page indexed?
```

| Status in the Pages report                      | What it means                                | What to do                                         |
|-------------------------------------------------|----------------------------------------------|----------------------------------------------------|
| **Discovered, currently not indexed**           | Known but not crawled yet                    | Add internal links; on a new site, give it time    |
| **Crawled, currently not indexed**              | Fetched but not stored                       | Make the page more useful and distinct             |
| **Excluded by 'noindex' tag**                   | The page asks to be left out                 | Remove noindex if it should rank (step 2)          |
| **Blocked by robots.txt**                       | The crawler may not fetch it                 | Change robots.txt if it should be crawled (step 1) |
| **Duplicate, Google chose different canonical** | Google picked another URL                    | Align canonical, links and sitemap (step 4)        |
| **Soft 404**                                    | Looks empty or like an error but returns 200 | Return a real 404 or add content (step 3)          |

## Sources

- Google Search Central, [In-depth guide to how Google Search works](https://developers.google.com/search/docs/fundamentals/how-search-works)
- Google Search Central, [Introduction to robots.txt](https://developers.google.com/search/docs/crawling-indexing/robots/intro)
- Google Search Central, [Build and submit a sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
- Google Search Central, [How to specify a canonical URL](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)
- Google Search Central, [JavaScript SEO basics](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics)
- Google Search Central, [Crawlable links and anchor text](https://developers.google.com/search/docs/crawling-indexing/links-crawlable)
- Google Search Central, [Influencing title links](https://developers.google.com/search/docs/appearance/title-link)
- SE Ranking, [Your comprehensive SEO guide to search engine indexing](https://seranking.com/blog/search-engine-indexing/)
- PPC Land, [Google says new pages take about 20 hours to be found](https://ppc.land/google-says-new-pages-take-about-20-hours-to-be-found-some-never-are/)
- TechWyse, [Google ends FAQ rich results for all sites](https://www.techwyse.com/news/ai-search/google-faq-rich-results-deprecated-2026)
- IndexNow, [Protocol documentation](https://www.indexnow.org/documentation)
