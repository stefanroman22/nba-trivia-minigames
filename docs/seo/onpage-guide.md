# On-page optimisation

Sections 5 and 6 of the owner's guide `Page-Indexing.docx` (Drive): the knowledge base of phase 2 of the SEO agent. Phase 1
(indexing) is `docs/seo/indexing-guide.md`; the checks are the OP table of `scripts/seo/CHECKS.md`, the agent's rules
the `seo-onpage` skill.

## 5. Phase 2: on-page optimisation

Phase 1 makes a page **eligible**. Phase 2 makes it **win**: each indexed page targets one main search, matches what
people want when they type it, and gives the best answer on the results page. It runs as a loop, page by page:

| Step                     | What happens                                                                                              |
|--------------------------|-----------------------------------------------------------------------------------------------------------|
| **1. Choose the search** | Pick one primary query per page (plus 2 to 4 related ones) from what people really type                   |
| **2. Optimise the page** | Title, heading, text, links, images, structured data and speed all serve that query                       |
| **3. Measure**           | Search Console shows, per page and query, impressions, clicks, CTR and average position                   |
| **4. Adjust**            | Low CTR: rewrite title and description. Position 8 to 20: strengthen content and links. Re-check after 28 days |

The table below is the audit of swishquest.com on 25 October 2026 against the eleven areas of Phase 2. Section 6
explains each area with a before and after example.

| Area                          | Good looks like                                              | Swish Quest today                                                                                  | Priority |
|-------------------------------|--------------------------------------------------------------|----------------------------------------------------------------------------------------------------|----------|
| **1. Keyword and intent map** | One primary query per page, matching the searcher's goal     | None defined; several game names differ from what people search                                    | High     |
| **2. Title**                  | Query first, brand last, under 60 characters                 | 24 to 37 characters; e.g. "Career Path Challenge" while people search "nba career path quiz"       | High     |
| **3. Meta description**       | Unique, specific, about 120 to 155 characters                | Good on every page (129 to 156 characters, unique)                                                 | Low      |
| **4. Headings**               | One H1 with the query; H2 per section                        | H1 = game name; no H2 on any game page                                                             | Medium   |
| **5. Content**                | Unique, visible text: how to play, rules, scoring, tips      | About 10 unique words per game page; the rest (about 150 words) is the shared game menu            | High     |
| **6. Internal links**         | Contextual links to related games with descriptive anchors   | Only the shared menu (15 identical links on every page)                                            | Medium   |
| **7. URLs**                   | Short, lowercase, hyphenated, descriptive                    | Good; keep as they are                                                                             | Low      |
| **8. Images**                 | Real `<img>` with descriptive alt text and file names        | Game artwork is not an `<img>`; only the logo is, so the art is invisible to image search          | Medium   |
| **9. Structured data**        | VideoGame plus BreadcrumbList                                | VideoGame present; no breadcrumbs                                                                  | Low      |
| **10. Page experience**       | LCP under 2.5 s, INP under 200 ms, CLS under 0.1 on mobile   | Last lab run (August, before Next.js) LCP 2.6 s mobile; game pages ship 399 KB of HTML             | Medium   |
| **11. Measurement loop**      | Search Console query data reviewed every 28 days             | Not connected yet (Phase 1 owner setup)                                                            | High     |

*Table 3. Phase 2 audit of swishquest.com, 25 October 2026.*

## 6. The eleven areas, with examples

### Area 1. Keyword and intent map

**What to do.** Give every page one primary query and a few related ones, chosen from what people really type, and
check the intent: someone searching "nba career path quiz" wants to play now, not read an article. **How.** Start from
Google autocomplete and the "People also ask" box; once Search Console is connected, use its real impressions per
query.

| Page               | Primary query          | Related queries (autocomplete, 25 Oct 2026)                       |
|--------------------|------------------------|-------------------------------------------------------------------|
| **/**              | nba trivia games       | nba games online free to play, nba trivia quiz                    |
| **/wordle**        | nba wordle             | nba wordle unlimited, nba wordle today, nba wordle game           |
| **/career-path**   | nba career path quiz   | nba career path game, guess the nba player by career path         |
| **/who-are-ya**    | who are ya nba         | guess the nba player, who are ya nba player                       |
| **/tictactoe**     | nba tic tac toe        | nba tic tac toe online, nba tic tac toe multiplayer, nba grid     |
| **/name-logo**     | guess the nba logo     | nba logo quiz, guess the nba logo game                            |
| **/guess-mvps**    | nba mvp quiz           | nba mvp quiz by year, nba mvp trivia                              |
| **/contexto**      | nba contexto           | nba contexto game                                                 |
| **/starting-five** | nba starting five quiz | guess the nba starting five                                       |

| Google likes                                                  | Google does not like                                                                     |
|---------------------------------------------------------------|------------------------------------------------------------------------------------------|
| One page per query; the page's purpose obvious from the query | Two pages chasing the same query; picking queries only because they are popular; keyword lists |

### Area 2. Title

**What to do.** Put the primary query at the start, describe the page, keep the brand at the end, stay under about 60
characters so it is not cut. Titles are set per game in `src/app/[game]/page.tsx` from the game entry.

| Page             | Today                               | Better                                               |
|------------------|-------------------------------------|------------------------------------------------------|
| **/career-path** | Career Path Challenge \| Swish Quest | NBA Career Path Quiz: Guess the Player \| Swish Quest |
| **/name-logo**   | Name the NBA Club \| Swish Quest     | Guess the NBA Logo: Team Logo Quiz \| Swish Quest     |
| **/guess-mvps**  | Guess the MVP \| Swish Quest         | NBA MVP Quiz: Name Every MVP \| Swish Quest           |
| **/contexto**    | LeContexto \| Swish Quest            | NBA Contexto: Guess the Hidden Player \| Swish Quest  |

| Google likes                                                | Google does not like                                                                              |
|-------------------------------------------------------------|---------------------------------------------------------------------------------------------------|
| Specific, accurate, query near the start, brand once at the end | Clever names nobody searches; the same title on many pages; stuffing ("NBA Quiz NBA Trivia NBA Game") |

### Area 3. Meta description

**What to do.** One unique, specific summary per page that makes a person want to click; Google often shows it as the
snippet. Swish Quest already does this well; keep the pattern for new games.

**Good example, live on /wordle**

```text
NBA Wordle: guess the mystery NBA player's name in five tries with Wordle-style
green and yellow letter hints. A new puzzle every day, free to play.
```

| Google likes                                                                  | Google does not like                                     |
|-------------------------------------------------------------------------------|----------------------------------------------------------|
| What the page does, a concrete detail (five tries, daily), free to play       | Keyword lists; the same text on every page; a bare name  |

### Area 4. Headings

**What to do.** One visible H1 that states the page's topic with the primary query, then H2s for the sections a player
looks for. It helps people scan and tells Google how the page is organised.

**Better structure for /career-path**

```html
<h1>NBA Career Path Quiz</h1>
  [game]
<h2>How to play</h2>
<h2>Scoring</h2>
<h2>Tips</h2>
<h2>More NBA guessing games</h2>
```

| Google likes                                                   | Google does not like                                                                                              |
|----------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------|
| One H1 matching the title's topic; H2s that describe real sections | Several H1s; headings used only for styling; a slogan as the only H1 (the homepage H1 is "Test your hoops IQ") |

### Area 5. Content

**What to do.** Add a short, visible section under each game, written for players: how to play, the rules, how points
work, one example round, a tip. This is the main gap today: a game page has about ten words of its own, so Google sees
twelve near-identical pages. Google sets **no word-count target**; 150 to 300 genuinely useful words per game is
usually enough. Keep it visible, not hidden behind tabs.

**Example section for /wordle**

```html
<h2>How to play NBA Wordle</h2>
<p>Guess today's mystery NBA player in five tries. After each guess the letters turn
green (right letter, right spot) or yellow (in the name, wrong spot).</p>
<h2>Scoring</h2>
<p>Five rounds, up to 100 points each: the fewer guesses you need, the more you score.</p>
<h2>Tip</h2>
<p>Start with a short, common surname such as "Paul" or "Rose" to test vowels.</p>
```

| Google likes                                                                                   | Google does not like                                                                                  |
|------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------|
| Original, accurate help that a player would actually read; first-hand detail about the game    | Text written for Google ("best NBA game NBA trivia free"); the same paragraph on every page; AI filler |

### Area 6. Internal links

**What to do.** Under each game, link two or three related games with descriptive anchor text, and make the homepage
cards say what each game is. Links tell Google which pages belong together and pass authority to them.

**Example "More games like this" block**

```html
<h2>More NBA guessing games</h2>
<a href="/who-are-ya">Who Are Ya: guess the NBA player from clues</a>
<a href="/career-path">NBA Career Path Quiz: name the player from his teams</a>
```

| Google likes                                         | Google does not like                                                              |
|------------------------------------------------------|-----------------------------------------------------------------------------------|
| Contextual links with words that describe the target | "Click here"; only a shared menu; links hidden in JavaScript click handlers        |

### Area 7. URLs

**What to do.** Keep URLs short, lowercase and hyphenated. **Do not rename existing URLs**: a rename needs 301
redirects and temporarily loses signals. Use the rule for new games only (for example `/nba-grid`, not `/nbagrid`).

### Area 8. Images

**What to do.** Render the game artwork as a real `<img>` (Google does not index CSS background images), with
descriptive alt text, a descriptive file name, explicit width and height, and WebP or AVIF.

**Example**

```html
<img src="/games/nba-wordle-board.webp" width="640" height="360"
     alt="NBA Wordle board with green and yellow letter tiles">
```

| Google likes                                                | Google does not like                                          |
|-------------------------------------------------------------|---------------------------------------------------------------|
| Alt text that describes the image in context; compressed files | Missing alt; alt stuffed with keywords; text baked into images |

### Area 9. Structured data

**What to do.** Keep the VideoGame markup (no invented ratings) and add **BreadcrumbList**, which can show the trail
Swish Quest > Games > NBA Wordle in desktop results.

**BreadcrumbList for /wordle**

```json
{ "@context": "https://schema.org", "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Swish Quest", "item": "https://swishquest.com/" },
    { "@type": "ListItem", "position": 2, "name": "NBA Wordle" } ] }
```

### Area 10. Page experience

**What to do.** Meet Google's Core Web Vitals on mobile, measured at the 75th percentile of real visits: **LCP** (main
content visible) under 2.5 s, **INP** (response to a tap) under 200 ms, **CLS** (layout shift) under 0.1. **How.**
Measure the production site with PageSpeed Insights and, once there is traffic, the Core Web Vitals report in Search
Console. The last stored lab run is from August (before Next.js) with a mobile LCP of 2.6 s, so re-measure first; then
trim the 399 KB of HTML each game page ships and check the response time of game taps.

### Area 11. Measurement loop

**What to do.** Every 28 days, read Search Console's Performance report by page and query, then act on what it shows.

| Signal in Search Console                 | Action                                                   |
|------------------------------------------|----------------------------------------------------------|
| **Many impressions, CTR under about 2%** | Rewrite the title and description (areas 2 and 3)        |
| **Average position 8 to 20**             | Strengthen content and internal links (areas 5 and 6)    |
| **Ranking for an unexpected query**      | Add a section that answers it, or give it its own page   |
| **Clicks falling after a change**        | Compare the before and after dates; revert if needed     |

> **Automation.** The SEO agent will take this over as its Phase 2 skill: it reads the query data weekly, proposes the
> title, heading and content changes as Notion cards, and re-checks each change after 28 days. It needs the Search
> Console access from the Phase 1 owner setup.

## Sources

- Google Search Central, [Crawlable links](https://developers.google.com/search/docs/crawling-indexing/links-crawlable) and [Title links](https://developers.google.com/search/docs/appearance/title-link)
- Google Search Central, [Creating helpful, people-first content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content)
- Google Search Central, [Snippets and meta descriptions](https://developers.google.com/search/docs/appearance/snippet)
- Google Search Central, [Image SEO best practices](https://developers.google.com/search/docs/appearance/google-images)
- Google Search Central, [Core Web Vitals](https://developers.google.com/search/docs/appearance/core-web-vitals)
- Google Search Central, [URL structure](https://developers.google.com/search/docs/crawling-indexing/url-structure) and [Breadcrumb structured data](https://developers.google.com/search/docs/appearance/structured-data/breadcrumb)
- Google autocomplete suggestions for the game keywords, collected 25 October 2026
