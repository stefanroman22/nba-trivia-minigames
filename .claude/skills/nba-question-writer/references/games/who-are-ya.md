# Who Are Ya (`who-are-ya`)

The player guesses a mystery player; each guess shows clue chips comparing it with the mystery: team, position,
age, jersey number, draft. An unknown name ("Not in our player pool") costs no guess.

## At a glance

| | |
|---|---|
| One question | one player: `{"person_id": N}` |
| Written by | the question writer picks the player |
| Categories | none |
| Difficulty | not served (internal score only). Adding levels: `references/flow-difficulty.md` |
| Capacity | eligible players (1,038 on the 2026-10 dataset: fame band DEEP or better, at least one team) minus used ones; `capacity` lists the best-known unused |
| Minimum live | 30 (spec) |
| Code | `backend/trivia/questions/games/who_are_ya.py`, spec `specs/who-are-ya.json`, renderer `src/Game Renderers/WhoAreYa.tsx` |

## Rules the code enforces

- Fame band DEEP or better and at least one team.
- Interest (`clues / 5`) at least 0.3: at least two clues that differ from the pool's most common value, so
  the chips can narrow the search.

## Patterns

- Players a fan can reach by narrowing: a distinctive jersey, a draft spot, a clear position and team.
- The clues shown are position, age (birth year), jersey, draft and teams: check those facts (fact-checking
  guide). Height and country are not shown.

## Ask before writing

1. How many players.
2. Any era / team / fame preference: if it is not a plain filter, ask for example players.

## Every valid answer accepted

When a typed name belongs to several players, the game takes the mystery if he is one of them
(`pickGuessId`), so a namesake is no problem. Nicknames fans type go in `typed_forms`; a rejected one
needs a player alias.

## Duplicates

One player is one question, ever.

## Make it live

Payload `add`: `{"definition": {"person_id": N}}`; publish `games=who-are-ya`.
