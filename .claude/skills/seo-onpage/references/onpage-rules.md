# Google's rules per OP check

Read the section of the check you are on. Each rule is from `docs/seo/onpage-guide.md` (sections 5-6) and its Sources;
the URL after each section is where to check it. The pass rules (thresholds) are the OP table of
`scripts/seo/CHECKS.md`; the numbers there are this repo's, Google sets most of them only loosely ("about 60
characters", "no word-count target"), so a card cites the threshold as ours and the guidance as Google's.

## OP-01 Keyword and intent map (area 1)
- One page per query: the page's purpose is obvious from its primary query; two pages never chase the same query.
- Check the intent: "nba career path quiz" is a person who wants to play now, not read an article; a game page answers
  it by being the game, with the help text under it.
- Choose queries from what people really type: Google autocomplete and "People also ask" first, Search Console's real
  impressions per query once it is connected (OP-11). Never pick a query only because it is popular; no keyword lists.
- Threshold (ours): every word of the primary query (lowercased, "the" and "a" ignored) in the title and in the H1.
- Sources: https://developers.google.com/search/docs/fundamentals/creating-helpful-content · the autocomplete
  suggestions of 25 October 2026 (the guide's area 1 table = `scripts/seo/keyword-map.json`)

## OP-02 Title (area 2)
- Specific and accurate; the primary query near the start; the brand once, at the end, after a separator.
- Stay under about 60 characters so the result is not cut; Google rewrites vague, duplicate, stuffed or mismatched
  titles (the title link may then come from the H1 or anchors instead).
- Dislikes: clever names nobody searches, the same title on many pages, stuffing ("NBA Quiz NBA Trivia NBA Game").
- Threshold (ours): 30-60 characters; the query's words start within the first 40; ends with ` | Swish Quest` (home:
  starts with `Swish Quest`).
- Source: https://developers.google.com/search/docs/appearance/title-link

## OP-03 Meta description (area 3)
- One unique, specific summary per page, written to make a person click: what the page does, a concrete detail
  (five tries, daily), free to play. Google often shows it as the snippet; it is not a ranking factor.
- Dislikes: keyword lists, the same text on every page, a bare name.
- Swish Quest already does this well (129-156 characters, unique, 25 Oct 2026): keep the pattern for new games.
- Threshold (ours): 110-160 characters; unique; at least one non-stopword of the primary query.
- Source: https://developers.google.com/search/docs/appearance/snippet

## OP-04 Headings (area 4)
- One visible H1 that states the page's topic with the primary query; H2s for the sections a player looks for (how to
  play, scoring, tips, more games). It helps people scan and tells Google how the page is organised.
- Dislikes: several H1s, headings used only for styling, a slogan as the only H1 (the home H1 "Test your hoops IQ").
- Threshold (ours): exactly one H1; game pages ≥ 2 H2.
- Sources: https://developers.google.com/search/docs/appearance/title-link (the H1 is a source of title links) ·
  https://developers.google.com/search/docs/fundamentals/creating-helpful-content

## OP-05 Content (area 5)
- A short visible section under each game, written for players: how to play, the rules, how points work, one example
  round, a tip. Original, accurate help a player would read; first-hand detail about the game.
- Google sets no word-count target; 150-300 genuinely useful words per game is usually enough. Visible, not behind a
  tab or a modal (the "How to play" modal's text is not in the server HTML).
- Dislikes: text written for Google ("best NBA game NBA trivia free"), the same paragraph on every page, AI filler.
- Today's gap: about 10 unique words per game page; the rest is the shared game menu, so Google sees near-identical
  pages (the "Crawled - currently not indexed" risk of phase 1).
- Threshold (ours): ≥ 150 unique visible words in `<main>` after removing the sentences every game page shares, and
  an H2 matching /how to play/i.
- Source: https://developers.google.com/search/docs/fundamentals/creating-helpful-content

## OP-06 Internal links (area 6)
- Under each game, two or three related games with descriptive anchor text; homepage cards that say what each game is.
  Links tell Google which pages belong together and pass authority to them.
- Google follows `<a href>` only; anchor text describes the target. Dislikes: "click here", only a shared menu, links
  hidden in JavaScript click handlers (the game rail is `<button>`s: it is not a link for Google).
- Threshold (ours): ≥ 2 links to other game pages outside the shared link set (a link = target + anchor text, so the
  footer's `<Link>{g.name}</Link>` never counts), each anchor ≥ 3 words, not generic.
- Source: https://developers.google.com/search/docs/crawling-indexing/links-crawlable

## OP-07 URLs (area 7)
- Short, lowercase, hyphenated, descriptive. **Never rename an existing URL**: a rename needs 301 redirects and loses
  signals for a while. The rule is for new games only (`/nba-grid`, not `/nbagrid`).
- Threshold (ours): lowercase, hyphen-separated, no underscores, no query string. Informational: decision `none`.
- Source: https://developers.google.com/search/docs/crawling-indexing/url-structure

## OP-08 Images (area 8)
- Render the game artwork as a real `<img>`: Google does not index CSS background images (the artwork today is the
  `.idle-thumb` background in `MiniGame.tsx`).
- Descriptive alt text that describes the image in context; a descriptive file name; explicit width and height;
  compressed files (WebP or AVIF where the pipeline makes them).
- Dislikes: missing alt, alt stuffed with keywords, text baked into images.
- Threshold (ours): every `<img>` has a non-empty alt; game pages ≥ 1 `<img>` besides the logo.
- Source: https://developers.google.com/search/docs/appearance/google-images

## OP-09 Structured data (area 9)
- Keep the VideoGame markup (co-typed `WebApplication`), never with invented ratings or reviews.
- Add BreadcrumbList: it can show the trail "Swish Quest > Games > NBA Wordle" in desktop results. ListItems in
  order from position 1; every item but the last has `item` (an absolute URL); names match what the page shows.
- Markup must match the visible page; it never forces a rich result.
- Threshold (ours): game pages have a BreadcrumbList with ≥ 2 ListItems and a VideoGame node; no
  `aggregateRating`/`review` anywhere.
- Source: https://developers.google.com/search/docs/appearance/structured-data/breadcrumb

## OP-10 Page experience (area 10)
- Core Web Vitals on mobile at the 75th percentile of real visits: LCP (main content visible) under 2.5 s, INP
  (response to a tap) under 200 ms, CLS (layout shift) under 0.1.
- Measure production with PageSpeed Insights, and the Core Web Vitals report in Search Console once there is traffic.
  The last lab run (August, before Next.js) had a mobile LCP of 2.6 s: re-measure first, then trim the HTML (399 KB per
  game page on 25 Oct 2026) and check the response time of game taps.
- Threshold (ours): HTML ≤ 250 KB; with PageSpeed data, lab LCP ≤ 2500 ms, TBT ≤ 200 ms (the lab stand-in for INP),
  CLS ≤ 0.1, and field p75 LCP/INP/CLS when present (INP ≤ 200 ms). No PageSpeed data → a Coverage gaps line.
- Source: https://developers.google.com/search/docs/appearance/core-web-vitals

## OP-11 Measurement loop (area 11)
- Every 28 days, read the Performance report by page and query and act on it: the flag → action table is
  `queries-rules.md`.
- Thresholds (ours): `low-ctr` ≥ 100 impressions and CTR < 2 %; `striking` position 8-20 with ≥ 50 impressions;
  `mismatch` the top query by impressions shares no non-stopword with the primary query. Never a card itself.
- Source: https://developers.google.com/search/docs/fundamentals/creating-helpful-content (the guide's area 11; the
  report itself is Search Console → Performance → Search results)
