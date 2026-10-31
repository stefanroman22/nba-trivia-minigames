# Fan Favorites (`fan-favorites`)

The player reads "On {survey_date}, we asked 100 NBA fans to name..." plus the prompt and types answers.
A listed answer reveals "+{count} fans said it"; anything else costs one of 3 hearts (a repeated wrong
guess costs nothing). Score: round(200 × found / total).

## At a glance

| | |
|---|---|
| One question | one board: a prompt and **every** accepted answer (6-17) |
| Written by | the question writer only (`generate()` returns nothing) |
| Categories | `player`, `team`, `coach`; the category picks the autocomplete list (players 5,234 names, the 30 current teams, coaches) and what a rule runs over |
| Difficulty | not served. Internal score only (`quality.band`, never shown). Adding levels: `references/flow-difficulty.md` |
| Capacity | no fixed maximum; a board is new when its prompt is new (dup key). Each board must land in 6-17 answers |
| Minimum live | 30 (spec) |
| Code | `backend/trivia/questions/games/fan_favorites.py`, rule language `backend/trivia/questions/rules.py`, renderer `src/Game Renderers/FanFavorites.tsx` |

## Definition

A **rule board** (preferred: the code computes the complete answer set from the dataset):

```json
{"prompt": "Name a center with 3 or more All-NBA selections who debuted in the 1990s",
 "category": "player",
 "rule": {"all": [{"position": "C"}, {"allnba": 3}, {"debut_decade": 1990}]},
 "survey_date": "2026-10-30",
 "aliases": {"Shaquille O'Neal": ["Shaq"]}}
```

An **answers board** (only when no rule can express it, e.g. coaches): `"answers": [{"answer", "count",
"aliases"}]` instead of `rule` (never both), counts descending.

Rule vocabulary (`rules.py` docstring): player `award` (mvp|fmvp|dpoy|roty|smoy|rings, `min`), `allstar` N,
`allnba` N, `career` (pts|reb|ast|ppg|rpg|apg|seasons, `min`), `draft` (`pick_max`, `round`, `year_from`,
`year_to`; or `undrafted`), `country`, `international`, `stint` (team abbr), `debut_decade`, `seasons`,
`position` (G|F|C), `playoff_team`; team `champion` / `finals` (`year_from`, `year_to`, `min`),
`playoff_team`; combinators `all`, `any`, `not`. `rules.describe(rule)` reads it back in English: compare
that sentence with the prompt word for word.

## Rules the code enforces

- 6 to 17 answers; no duplicate answers; prompt not empty; `survey_date` a date string (use today).
- `rule` xor `answers`; a `coach` board needs `answers`; extra `aliases` only on a rule board, keyed by
  an answer's exact name.
- Interest (`recognizable`: share of answers that are well known) at least 0.3.

## Patterns that make a good board

- **Closed, finished sets** a fan can list from memory or a page: an award's winners in a range, a
  draft's top picks, a franchise's champions, "current franchise that never won a title". Never a set
  that moves during the season (running career totals) unless the prompt dates it.
- **Size:** 6-9 answers feels fair; 10-17 only when most are famous.
- **Prompt wording = the rule exactly:** inclusive years ("from 2010 to 2019"), "or more", "NBA",
  "regular season", "current franchise". Under 15 words, no dashes (`references/writing-style.md`).
- **Mix** categories and eras across a batch, not only the last decade (`references/what-players-want.md`).
- Bad: "Name a great shooter" (opinion, no closed set). Good: "Name a player who won the Sixth Man award
  more than once".

## Ask before writing

1. How many boards, and which category (player / team / coach), unless he said.
2. A theme or era? If it is not one of the categories ("tough ones", "90s nostalgia"), ask for examples.
3. A level? The game serves none: ask whether to set difficulty up first or write without one.

## Every valid answer accepted

- **Complete:** list the full set from a source (fact-checking guide) and compare with the board's answers
  both ways. The rule runs on the dataset: a missing answer means a missing fact (correct the data or drop
  the board), an extra one means a wrong fact.
- **Spellings:** each answer gets the folded full name, the name with hyphens as spaces, curated player
  aliases, the surname and the name without its suffix when no other answer shares them (teams: nickname,
  city when unique, abbreviation). `check` replays these plus `typed_forms`; add what fans type (nicknames,
  former names, "Sixers") and fix rejections with the board's `aliases`.
- A surname or city two answers share is left out on purpose; never alias it back. Watch for a famous
  non-answer whose surname is an alias (a "johnson" alias credits a Magic Johnson guess).

## Duplicates

The dup key is the prompt, folded and stripped of punctuation: a reworded prompt with the same answers
passes the code but is still a duplicate for us. Compare the answer set with live boards (from the export)
and drop a board that mostly repeats one.

## Counts

Rule boards get estimated counts from fame (summing to 100, `"estimated": true`); live standings replace
them after 500 correct guesses. Never call the counts a real survey.

## Make it live

Payload `add`: `{"definition": {...rule board...}}`; then publish `games=fan-favorites`.
