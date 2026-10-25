# Copy rules and examples

For a card's `howToFix` (decision rule 4): the exact text a builder pastes. Read the rules first, then the example for
the check in hand. The examples use the real rules of the games on 25 October 2026; re-read the game's entry before you
reuse one, because a rule may have changed.

## The copy rules
1. **Truthful.** Every rule, number and feature comes from the code: the game's entry in `src/utils/GameUtils.tsx`
   (`rules`, `instruction`, `intro`, `seoDescription`, `maxPoints`, `roundsLabel`), the scoring functions in
   `src/utils/gameScoring.ts` (the source of truth when they disagree with an entry's prose), and the game's renderer
   in `src/Game Renderers/` (mapped in `RenderGame.tsx`). Never invent a mode, a rule, a number, a reward, a
   leaderboard or a claim ("the best", "thousands of players"). The idle chip "5 rounds" is a default
   (`roundsLabel ?? "5 rounds"`), not a rule: never copy it into text.
2. **Player-first.** Write what a player needs: what you see, what you do, how you score, one tip. Plain sentences, second
   person, present tense. No marketing voice, no filler, no text aimed at Google.
3. **The query leads.** The page's primary query (`scripts/seo/keyword-map.json`) starts the title (within the first
   40 characters) and is in the H1, every word of it ("the", "a" may be dropped). Related queries may appear once each
   where they read naturally (an H2, the description), never as a list.
4. **Brand last.** Titles end with ` | Swish Quest`, added by the template `%s | Swish Quest` in `src/app/layout.tsx`:
   the copy you propose for a game's title is the part before it (≤ 46 characters, so the whole stays ≤ 60). The home
   title starts with `Swish Quest` instead (`SITE_TITLE` in `src/configurations/site.ts`).
5. **No stuffing.** A word of the query once in the title and once in the H1; no repeated "NBA" chains, no keyword
   lists, no alt text written for search.
6. **No superlatives.** No "best", "ultimate", "#1", "most fun", "hardest".
7. **Spelling as the site.** The visible copy in `src/` is American English ("favorite", "center", "color"): keep it.
   Game names keep their own spelling and punctuation (`Who Are Ya?`, `LeContexto`, `NBA Tic-Tac-Toe`).
8. **Unique per page.** No sentence that appears on every game page: shared sentences are removed before OP-05 counts
   words, and shared links (same target and anchor) do not count for OP-06.
9. **One paragraph in the card.** `howToFix` becomes one paragraph in Notion (newlines collapse). Write the
   implementation in one or two sentences, then one labelled segment per page ending in ` ·`, `"/wordle": seoTitle
   "…"; seoHeading "…" ·`, every pasteable text in double quotes, and close with the acceptance sentence.

## Titles (OP-01, OP-02)
| page | today | proposed (before ` \| Swish Quest`) | chars with brand |
|---|---|---|---|
| /wordle | NBA Wordle | NBA Wordle: Guess the Player in Five Tries | 56 |
| /career-path | Career Path Challenge | NBA Career Path Quiz: Guess the Player | 52 |
| /who-are-ya | Who Are Ya? | Who Are Ya? NBA Mystery Player Quiz | 49 |
| /tictactoe | NBA Tic-Tac-Toe | NBA Tic-Tac-Toe: Player Grid Trivia | 49 |
| /name-logo | Name the NBA Club | Guess the NBA Logo: Team Logo Quiz | 48 |
| /guess-mvps | Guess the MVP | NBA MVP Quiz: Name the MVP by Season | 50 |
| /contexto | LeContexto | NBA Contexto: Guess the Secret Player | 51 |
| /starting-five | Fill in the Starting 5 | NBA Starting Five Quiz: Name the Lineup | 53 |
| /series-winner | Guess the Series Winner | NBA Playoff Series Quiz: Pick the Winner | 54 |
| /fan-favorites | Fan Favorites | NBA Fan Favorites Quiz: Guess the Top Answers | 59 |
| /who-would-win | Who Would Win? | Who Would Win? NBA Dream Matchups Across Eras | 59 |

"Name Every MVP" would overclaim (a game is five seasons): the guide (area 2) and this table use "Name the MVP by Season".
Count the characters with `node -e 'console.log("<title> | Swish Quest".length)'` before you propose one.

## H1 (OP-01, OP-04)
The H1 states the topic with every word of the primary query; the game's brand name may stay in it.
| page | today | proposed |
|---|---|---|
| / | Test your hoops IQ. Play one. Then play them all. | Test your hoops IQ with free NBA trivia games |
| /career-path | Career Path Challenge | NBA Career Path Quiz |
| /who-are-ya | Who Are Ya? | Who Are Ya? Guess the NBA Player |
| /name-logo | Name the NBA Club | Guess the NBA Logo |
| /guess-mvps | Guess the MVP | NBA MVP Quiz |
| /contexto | LeContexto | LeContexto: NBA Contexto |
| /starting-five | Fill in the Starting 5 | NBA Starting Five Quiz |
| /series-winner | Guess the Series Winner | NBA Playoff Series Quiz |
| /fan-favorites | Fan Favorites | NBA Fan Favorites Quiz |
| /who-would-win | Who Would Win? | Who Would Win? NBA Dream Matchups |

## Description (OP-03)
Today every game passes (unique, 129-156 characters): keep the pattern for new games. What a good one does: what the
page does, one concrete detail from the rules, free.
- Before (a bare short `description`, used when `seoDescription` is missing): "Nine squares. Every one needs a name."
- After (the pattern of the live ones): "NBA Wordle: guess the mystery NBA player's name in five tries with Wordle-style
  green and yellow letter hints. A new puzzle every day, free to play." (148 characters, live on /wordle)

## How-to-play section (OP-04, OP-05)
Two or more H2s, the first matching /how to play/i, 150-300 words of the game's own text in total. Example for
/career-path, from its entry (`rules`, `instruction`) and `careerPathScore` in `gameScoring.ts`:
```html
<h2>How to play the NBA Career Path Quiz</h2>
<p>A mystery NBA player's career is shown one team card at a time. The first card reveals his first stint: the years,
the team, the games he played (GP) and his points per game (PPG). Type the player you think it is. Each wrong guess
flips the next card of his career, and you get as many guesses as he had teams, so a player who moved often gives you
more chances than one who stayed with a single franchise.</p>
<h2>Scoring</h2>
<p>A correct answer is worth 200 points, minus 40 for each wrong guess before it, and never less than 40 once you name
him. Run out of guesses and the round scores 0.</p>
<h2>Tips</h2>
<p>Read the years and the scoring together: a long first stint with a high points-per-game average narrows the field
quickly, while a run of short stints points to a player who changed teams often. Guess as soon as you have a strong
name, because every miss costs 40 points.</p>
```
The guide's /wordle example (area 5) was written from the code: "Solve it on the first try for 500 points; each wrong
attempt costs 100." (`wordlePoints` in `gameScoring.ts`: `WORDLE_SOLO_PER_GUESS` 100, five attempts, `WORDLE_MAX_GUESSES`,
at a five-letter last name, `WORD_LENGTH` in `Wordle.tsx`). An earlier draft said "Five rounds, up to 100 points each",
which was wrong: this is why rule 1 sends you to the code. Those numbers are the solo scoring; online play scores
`WORDLE_ONLINE_PER_GUESS` (40) per remaining attempt, so 200 for a first-try solve. Page copy describes the solo scoring
only; never mix the two.

## Related-games block (OP-06)
Two or three links per game page under an H2, to games a player of this one would like (same kind of puzzle first),
anchors of ≥ 3 words that say what the target is. Never the bare game name: the footer already links every game by its
`name`, so that link is in the shared set and does not count.
```html
<h2>More NBA guessing games</h2>
<a href="/who-are-ya">Who Are Ya? Guess the NBA player from hints</a>
<a href="/contexto">LeContexto: find the secret NBA player by similarity</a>
```
Anchors to reuse (one per target, so every page links a game the same way):
| target | anchor |
|---|---|
| /wordle | NBA Wordle: guess the player's last name |
| /career-path | NBA Career Path Quiz: name the player from his teams |
| /who-are-ya | Who Are Ya? Guess the NBA player from hints |
| /contexto | LeContexto: find the secret NBA player by similarity |
| /tictactoe | NBA Tic-Tac-Toe: name players who fit the grid |
| /name-logo | Guess the NBA Logo: name the team behind it |
| /guess-mvps | NBA MVP Quiz: name each season's MVP |
| /starting-five | NBA Starting Five Quiz: name a real lineup |
| /series-winner | NBA Playoff Series Quiz: pick the series winner |
| /fan-favorites | NBA Fan Favorites Quiz: guess what 100 fans said |
| /who-would-win | Who Would Win? Vote on NBA dream matchups |

Groups: player-guessing (/wordle, /who-are-ya, /career-path, /contexto), history (/guess-mvps, /series-winner,
/starting-five, /name-logo), community (/fan-favorites, /who-would-win), grid (/tictactoe with /starting-five and
/career-path).

## BreadcrumbList (OP-09)
A second JSON-LD block next to `gameJsonLd` in `src/app/[game]/page.tsx`, rendered by `<JsonLd data={…} />`. Two
items: the home page, then the game (its H1 text, no `item` on the last one). Never a top-level `url` key on it: IX-09
requires every node's `url` to equal the canonical.
```ts
const breadcrumbJsonLd = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: SITE_NAME, item: `${SITE_URL}/` },
    { "@type": "ListItem", position: 2, name: entry.seoHeading ?? entry.name },
  ],
};
```
Live result for /wordle: `{"@type":"ListItem","position":1,"name":"Swish Quest","item":"https://swishquest.com/"}`,
`{"@type":"ListItem","position":2,"name":"NBA Wordle"}`. The guide's three-level trail ("Swish Quest > Games > NBA
Wordle") needs a games page, which the site does not have: two levels, never an invented middle URL.

## Image alt (OP-08)
The artwork is `game.backgroundImage` (a CSS `url('…')`; `backgroundUrl()` in `GameUtils.tsx` gives the path), drawn
as the `.idle-thumb` background in `MiniGame.tsx`. Render it as `<img src={backgroundUrl(game.backgroundImage)}
alt="…" width height>` in the idle card. Never open the image files or read pixel sizes yourself: the `howToFix` tells
the builder to take `width` and `height` from the static image import's `.width`/`.height` (Next.js static import,
e.g. `thumb_career_path` imported from `src/assets/Games Backrounds/` in `GameUtils.tsx`), and to write a descriptive
alt from what the artwork shows, in context, ≤ 125 characters, no "image of":
- Before: `<div class="idle-thumb" style="background-image:url(…/thumb_career_path.jpg)">` (no image for Google)
- After: `<img src={thumb_career_path.src} width={thumb_career_path.width} height={thumb_career_path.height} alt="<what the artwork shows>, NBA Career Path Quiz">`
The files are JPEG: do not promise WebP.
