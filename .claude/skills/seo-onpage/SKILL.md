---
name: seo-onpage
description: The SEO on-page playbook of nba-minigames (swishquest.com), phase 2 of the seo agent (opt-in, --areas indexing,onpage). The OP-01..OP-11 checks from keyword map to Search Console query data (what, how in this repo, verify, what Google likes), the decision rules, and the OP findings with paste-ready copy, the REPORT.md On-page section. Load after the seo hub and seo-indexing skills.
---

# SEO on-page playbook (phase 2)

Phase 1 (`seo-indexing`) makes a page eligible; this makes it rank and get clicked. It runs only on a run with
`--areas indexing,onpage`, after `seo-indexing` has done its output in the same session: you add OP findings to its
`findings.json` and an `## On-page` section to its `REPORT.md`. One section per OP check of `scripts/seo/CHECKS.md`
("On-page (phase 2)"), each the area of the same number in `docs/seo/onpage-guide.md` §6 (read the guide's area for
its examples; this file does not repeat them). References, read per check, never whole: `references/onpage-rules.md`
(Google's rules, sources, thresholds), `references/copy-examples.md` (the copy rules, before/after copy),
`references/queries-rules.md` (OP-11: flags → action, the 28-day rule, privacy). The hub `seo` holds the read budget.

## Inputs
1. `<runDir>/onpage-summary.md`: line 1 `# seo-onpage: run <runId> · site <site> · <n> urls · <f> failing checks`, one
   `## FAIL OP-nn <area>` per failing check (`- <url>: <evidence>` lines), `## Coverage gaps`. Missing = the on-page
   step failed: no OP finding; one `REPORT.md` Coverage gaps line `on-page not measured (onpage-summary.md missing)`.
2. The per-URL slice of `onpage.json` (public page signals, no Search Console data), all URLs or one path:
   ```
   node -e 'const fs=require("fs"),p=require("path"),[d,only]=process.argv.slice(1);const j=JSON.parse(fs.readFileSync(p.join(d,"onpage.json"),"utf8"));for(const e of Object.values(j.urls)){if(only&&e.path!=="/"+only.split("/").pop())continue;const s=e.summary;if(!s){console.log(e.path+" | not checked ("+e.status+")");continue}console.log([e.path,e.kind,"title "+JSON.stringify(s.title),"description "+(s.description||"").length+" "+JSON.stringify(s.description),"h1 "+JSON.stringify(s.h1),"h2 "+JSON.stringify(s.h2),"unique words "+s.uniqueWords,"img alts "+JSON.stringify(s.images.map((i)=>i.alt)),"ld "+s.jsonLdTypes.join(","),Math.round(s.htmlBytes/1024)+" KB"].join(" | "))}' "<runDir>" [/<path>]
   ```
3. `<runDir>/queries-summary.md`: **PRIVATE** (first line). Only with Search Console access; `references/queries-rules.md`
   says how to read it and where its contents may go (only into card `current`/`howToFix`).
4. `scripts/seo/keyword-map.json`: `{ "<path>": { "primary", "related" } }`, the page's target query (whole file).
5. `<runDir>/findings.json` (phase 1's, written earlier in this session) and `docs/seo/onpage-guide.md`, the area in hand.
   Where docs/seo/onpage-guide.md and references/copy-examples.md differ, copy-examples.md wins (it is checked against the code).
6. For copy: the game's entry (Grep `id: "<slug>"` in `src/utils/GameUtils.tsx`, Read about 30 lines), its scoring
   (Grep the game in `src/utils/gameScoring.ts`), its renderer in `src/Game Renderers/` only when those two leave a
   rule open. Never an image file: the builder writes the alt from the artwork (`references/copy-examples.md`).

## Where the signals are set
| signal | file · line pattern |
|---|---|
| game title | `src/app/[game]/page.tsx` `generateMetadata`: `title: entry.name` + the template `` `%s \| ${SITE_NAME}` `` in `src/app/layout.tsx`; `openGraph`/`twitter` `title` = `` `${entry.name} \| ${SITE_NAME}` `` |
| game H1 | `src/views/Trivia/MiniGame.tsx`: `<h1 className="font-display" …>{game?.name}</h1>` in `.stage-title` |
| game description | `seoDescription: "…"` per game in `src/utils/GameUtils.tsx`; `entry.seoDescription ?? entry.description` in `[game]/page.tsx` |
| game body | `MiniGame.tsx` `<main className="page game-page">`: the idle card (`{game?.name}`, `{game?.description}`, chips), the rail (`<button>`s, not links). The rules (`rules`, `instruction`) are only in the "How to play" modal, not in the server HTML |
| artwork | `game.backgroundImage` (CSS `url('…')`, files in `src/assets/Games Backrounds/`) as the `.idle-thumb` background (`src/styles/MiniGame.css`); `backgroundUrl()` in `GameUtils.tsx` gives the path |
| links | footer `src/components/SiteFooter.tsx` `<Link href={g.urlPath}>{g.name}</Link>` (on every page: shared); home grid `src/views/Landpage.tsx` `href={game.urlPath}` |
| JSON-LD | `const gameJsonLd = {` in `[game]/page.tsx` (`"@type": ["VideoGame", "WebApplication"]`); `src/components/JsonLd.tsx` renders a block |
| home | `SITE_TITLE`, `SITE_DESCRIPTION` in `src/configurations/site.ts`; `<motion.h1 className="font-display hero-h1"` in `Landpage.tsx`; `homeJsonLd` in `src/app/page.tsx` |

`name` is the game's name everywhere (rail, home cards, footer, JSON-LD, `llms.txt`, share images): a card never
renames it. Title and H1 copy goes into new optional `Game` fields (`src/types/types.tsx`, next to `seoDescription`):
`seoTitle` (the title before ` | Swish Quest`) and `seoHeading` (the H1), each falling back to `name`; the how-to-play
text and the related links into fields of the entry too, rendered by one section in `MiniGame.tsx` inside `<main>`.

## The checks
Each: **What** (the rule), **How** (where it is done here), **Verify** (the OP id; `onpage.mjs` reruns it), **Likes /
dislikes** (Google's, short; `references/onpage-rules.md` has the rest). A card's `howToFix` is the How, made concrete
with copy for every failing URL (`references/copy-examples.md`).

### OP-01 Keyword map (area 1)
- What: one primary query per page from what people type; its words in the title and the H1.
- How: the map is `scripts/seo/keyword-map.json`; the copy goes into `seoTitle`/`seoHeading` (home: `SITE_TITLE`, the hero H1).
- Verify: OP-01. Likes: one page per query, the purpose obvious from it. Dislikes: two pages on one query, keyword lists.

### OP-02 Title (area 2)
- What: the query first, the page described, the brand last, 30-60 characters.
- How: `seoTitle` read by `generateMetadata` (title, `openGraph.title`, `twitter.title`); home `SITE_TITLE`.
- Verify: OP-02. Likes: specific, accurate, brand once at the end. Dislikes: clever names nobody searches, stuffing.

### OP-03 Description (area 3)
- What: unique, specific, 110-160 characters, with a word of the query. Passes everywhere today: keep the pattern.
- How: `seoDescription` per game; home `SITE_DESCRIPTION`.
- Verify: OP-03. Likes: what the page does plus one concrete detail. Dislikes: keyword lists, one text on every page.

### OP-04 Headings (area 4)
- What: exactly one H1 with the query; game pages ≥ 2 H2 for real sections.
- How: the H1 in `.stage-title` (`seoHeading ?? name`); the H2s come with the OP-05 section (how to play, scoring,
  tips, more games); home: one H1 in `Landpage.tsx`.
- Verify: OP-04. Likes: H2s that describe sections. Dislikes: several H1s, a slogan as the only H1, styling headings.

### OP-05 Content (area 5)
- What: ≥ 150 words of the game's own visible text and an H2 "How to play …": how to play, scoring, an example, a tip.
- How: a section under `.game-grid` in `<main>` of `MiniGame.tsx`, its text per game in the entry, in the server HTML
  (not a modal, not a tab). Every sentence from `rules`, `instruction` and `gameScoring.ts`.
- Verify: OP-05 (shared sentences do not count). Likes: accurate first-hand help. Dislikes: filler, one paragraph everywhere.

### OP-06 Internal links (area 6)
- What: ≥ 2 links per game page to related games, anchors ≥ 3 words that say what the target is.
- How: a "More NBA … games" block in the OP-05 section, `next/link` to `urlPath`, anchors from the copy-examples table
  (never the bare `name`: the footer's identical link is shared and does not count).
- Verify: OP-06. Likes: contextual descriptive links. Dislikes: "click here", only a shared menu, `onClick` "links".

### OP-07 URL (area 7)
- What: lowercase, hyphenated, no underscore, no query string. Existing URLs are never renamed.
- How: `urlPath` of a new game in `GameUtils.tsx` (`/nba-grid`, not `/nbagrid`).
- Verify: OP-07. Always `none`: a rename costs redirects and signals.

### OP-08 Images (area 8)
- What: the game artwork is a real `<img>` with descriptive alt, width and height; every `<img>` has alt.
- How: render `backgroundUrl(game.backgroundImage)` as an `<img>` in the idle card instead of the `.idle-thumb`
  background; width/height from the static import, the alt written by the builder from what the artwork shows.
- Verify: OP-08. Likes: alt that describes the image in context. Dislikes: missing or stuffed alt, CSS-only images.

### OP-09 Structured data (area 9)
- What: a BreadcrumbList (home → game) next to the VideoGame node; no ratings or reviews.
- How: a second `<JsonLd data={breadcrumbJsonLd} />` in `[game]/page.tsx` (copy-examples has the object); no
  top-level `url` on it (IX-09).
- Verify: OP-09, then IX-09 (`audit.mjs --only IX-09`). Likes: markup that matches the page. Dislikes: invented ratings.

### OP-10 Page experience (area 10)
- What: HTML ≤ 250 KB; mobile LCP ≤ 2.5 s, INP ≤ 200 ms (lab TBT ≤ 200 ms), CLS ≤ 0.1.
- How: measure first (`onpage.mjs --psi` with `PSI_API_KEY`). A game page's HTML was 399 KB on 25 Oct 2026: 236 KB of
  inline RSC payload (`self.__next_f` scripts) and 148 KB of inline `<style>`; find what fills it before trimming.
- Verify: OP-10. Likes: fast, stable pages on mobile. Dislikes: heavy HTML, layout shifts, slow taps.

### OP-11 Measurement (area 11)
- What: every 28 days, the page × query data says which page to rewrite or strengthen.
- How: `<runDir>/queries-summary.md` (PRIVATE) → `references/queries-rules.md`.
- Verify: no failure of its own; its flags feed the other cards (rule 3). Never a card.

## Decide
The rules (binding, the same text as the agent file):
1. An OP failure on a game page or the home page → `card`, one finding per OP id grouping its URLs, except OP-07 and
   OP-11 (`none`; OP-11 flags feed rule 3) and the PageSpeed part of OP-10 without PSI data (Coverage gaps); an OP-10
   HTML-size failure is a card.
2. At most 5 OP cards per run, in this order: OP-05, OP-02, OP-01, OP-04, OP-06, OP-08, OP-09, OP-03, OP-10; the rest
   `wait` 7 days ("card budget").
3. With query data (it never changes a card's `urls` or `fingerprint`; a flagged page outside them → the OP-11 `none`
   finding): `low-ctr` → a proposed rewrite in the OP-02/OP-03 card; `striking` → content in the OP-05/OP-06 card;
   `mismatch` → in the OP-01 card, a keyword-map retarget or a section answering the query. Query strings and numbers
   go only into the card body (`current`/`howToFix`), never into REPORT.md, owner-actions.md or the agent's return.
4. Every card's `howToFix` gives exact copy ready to paste: the proposed title, H1, description, the how-to-play /
   scoring / tips section text, the related-game links, the BreadcrumbList JSON-LD — written from the real game rules
   (read the game's entry and renderer; never invent rules, points or features) and from the keyword map. Copy rules are
   in `references/copy-examples.md`.
5. A page whose open card already covers the check gets nothing new (notion-push dedupes; do not work around it).

How to apply them, in this order:
- **A. The summary.** Each `## FAIL OP-nn` section is one finding for that id, its URLs sorted (home and game pages
  only; `/privacy` and `/terms` never fail anything but OP-07).
- **B. OP-10.** An HTML-size failure (`## FAIL OP-10` with or without PSI data) is an OP-10 finding like any other
  (rule 1). "Without PSI data" = `## Coverage gaps` has `OP-10 PageSpeed lab and field data not checked`: then only the
  PageSpeed part is not judged; one `REPORT.md` Coverage gaps line `OP-10 PageSpeed part not judged without PageSpeed
  data`. With PSI data for some pages, the OP-10 finding covers every OP-10 URL of the summary.
- **C. OP-07** → `none`, severity `minor`, `current` the evidence lines. OP-11 → `references/queries-rules.md` "OP-11
  finding".
- **D. The budget.** Walk the rule-2 order over the ids of A-B: the first 5 → `card`; the rest → `wait`, `recheckAfter`
  = run date + 7 days, `current` ending in `; card budget`. The 5 include cards that will dedupe onto open cards (rule
  5): an intended throttle, the pipeline works the top 5 checks until they are fixed, then the next ones get cards.
- **E. Query data** (only with `queries-summary.md`): `references/queries-rules.md` "Flag → action", into the cards of D.
- **F. Copy.** For every card, per URL, the copy of rule 4 that its check needs (OP-01/02: title and H1; OP-03:
  description; OP-04/05: the section with its H2s; OP-06: the links; OP-08: the `<img>`, its size and alt as copy-examples says; OP-09: the object).
  When OP-01, OP-02 and OP-04 are all cards, give the same title and H1 in each (the builder applies them once).
- **G. Guide rule 5.** Same OP check as an open card = the same fingerprint (`OP-nn|onpage`, whatever its URLs): notion-push
  comments on the open card and files nothing. Never vary `check` or the fingerprint to get a second card.

Run date = the runId's `YYYYMMDD`. Severity: `major` for OP-01, OP-02, OP-05; `minor` for every other OP finding.

## Producing the run's output
### findings.json (additions; `seo-indexing` "Producing the run's output" holds the base contract)
Keep every finding already in the file; add the OP findings after them in OP id order, ids numbered after the highest
`NNN`, skipping a `fingerprint` already present. An OP finding is a phase-1 finding with these values:
- `check` `OP-01`…`OP-11` · `current` the summary's evidence lines joined with `; ` (plus the query data of rule 3, cards
  only) · `expected` the OP pass rule of `CHECKS.md` · `fingerprint` `<OP-nn>|onpage` exactly (one card per OP check:
  the URLs are in `urls` and the card body, never in the fingerprint; IX findings keep `<check>|<urls>`).
- `card` (never OP-07, OP-11): `files` from "Where the signals are set" (with a note, e.g. `src/types/types.tsx (Game:
  seoTitle, seoHeading)`), `howToFix` (rule 4; one paragraph, copy rule 9; end with `Acceptance: onpage.mjs shows no ##
  FAIL OP-nn for these URLs.`), `acceptance` `{ "audit": "node scripts/seo/onpage.mjs --site <site>", "qa": [ … ] }`.
- `qa`: one for each of the first 5 failing URLs in sorted order, `route` its path; `[]` for OP-10. Selectors: OP-01
  `h1` (`contains every word of "<primary>"`), OP-02 `title` (`"<proposed title> | Swish Quest"`), OP-03
  `meta[name=description]` (`content 110-160 characters, unique`), OP-04 `main h2` (`≥ 2, visible in the server
  HTML`), OP-05 `main h2` (`one reads "How to play …"; ≥ 150 words of the game's own text`), OP-06 `main a[href]` (`≥ 2
  links to other games with the anchors of the card`), OP-08 `main img` (`the game artwork, a descriptive non-empty
  alt, width and height`), OP-09 `script[type="application/ld+json"]` (`a BreadcrumbList with 2 ListItems; VideoGame;
  no aggregateRating`).
- `wait`: `recheckAfter` (rule D); no `files`, `howToFix`, `acceptance`, and never query data.

### REPORT.md (the file `seo-indexing` wrote: add, never change its sections)
Write the whole file again with its text plus yours, the way `seo-indexing` wrote it (Write tool, or its Bash heredoc
where a guard refuses a file named REPORT).
- Each OP finding gets a line in `## Decisions` (same format; card ref `card: [seo] <OP-nn> <area> on <n> page(s)`;
  OP-11 lists the count of pages, never paths with flags).
- A new section before `## Coverage gaps`, counts only:
  ```
  ## On-page
  - <n> urls, <f> failing checks (onpage-summary.md) · cards <a> · wait <b> (card budget) · none <c>
  - query data: <yes, k page(s) flagged | no (<why>)> · PageSpeed data: <yes | no>
  ```
- `## Coverage gaps`: add the summary's gap lines and B's OP-10 line. `## Summary`: one line on on-page.
- Never a query, a number of Search Analytics or a flag per page in `REPORT.md`.

### owner-actions.md
Phase 2 has no owner action: leave the file as `seo-indexing` wrote it.

### Validate and return
Run the validator of `seo-indexing` again after adding the OP findings (`findings: valid (<n>)`). The return adds one
line: `onpage: cards <a> · wait <b> · none <c>` (counts only).
