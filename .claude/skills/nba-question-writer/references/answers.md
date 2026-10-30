# Every valid answer accepted

The most important rule (owner, 2026-10-30): a player who types a correct answer must get it. Two
things can break it: the question's answer set is **incomplete** (a valid answer is missing), or a
valid answer is there but **the way the player types it is not matched**. `question_writer check`
proves the second; you prove the first against a source.

## How each game matches what a player types

All matching first normalizes both sides like `src/utils/answerMatch.ts` `normalizeAnswer`: lowercase,
accents removed, `' ’ . , -` deleted (a hyphen is deleted, not turned into a space), spaces collapsed.
`check` replays exactly this in Python.

| Game | Matching | Accepts | Typical misses |
|---|---|---|---|
| Tic-Tac-Toe | `buildNameLookup` (`src/utils/questions.ts`): name **without spaces**, full name + aliases, suffix fallback, every namesake (`toIds`), the one in the cell wins | anyone in the cell's `valid` list | a nickname that is no alias; a player missing from the dataset |
| Who Are Ya, Contexto | `buildNameLookup`, but the **first** namesake only (`toId`) | the mystery / secret player | the mystery is the 2nd of two namesakes (typing his exact name is judged wrong) |
| Career Path | `matchAnswer` against the player's full name + aliases: **exact** after normalizing, no space removal, no suffix fallback | the player | "Karl Anthony Towns", "Tim Hardaway" for Jr., "A C Green" without an alias |
| Fan Favorites | `matchAnswer` against the board's answers and their aliases, first match wins | each answer | a nickname / former name; a short team name the board lacks; one answer's alias crediting another |
| Who Would Win | a vote, no typed answer | | |
| Connections (hidden) | tile picks, no typed answer | | |
| Pool games (MVP, Series, Starting Five, Logo, Wordle) | see each game guide; not written by the writer | | |

## What `check` replays

For each answer (each player in each Tic-Tac-Toe cell, the mystery player, each Fan Favorites answer):
the full name; every alias; the name without its Jr./Sr./II-V suffix; a hyphen typed as a space; an
apostrophe typed as a space; initials typed with spaces ("A C Green"); a middle initial left out
("Charles Jones" for Charles R. Jones); for teams, the nickname and the
common short forms (Sixers, Cavs, Mavs, Wolves, Blazers, LA Clippers, OKC, ...); plus every spelling you
list in the proposal's `typed_forms` (nicknames and former names you know fans use: "Shaq", "KD",
"Lew Alcindor", "The Answer"). Each must be accepted **for the right answer**. It also flags a
Who Are Ya / Contexto player who shares his name with another player.

Add to `typed_forms` what fans really type for the famous answers of every question. When in doubt
about a nickname being common, include it: an extra accepted spelling costs nothing.

## Fixing a rejected spelling

| Where | Fix |
|---|---|
| Fan Favorites rule board | the board's `"aliases": {"<answer>": ["<spelling>", ...]}` (merged into that answer). Hyphen and suffix spellings are now generated automatically. |
| Fan Favorites answers-list board (coach boards) | add the spelling to that answer's `aliases` |
| A player in Tic-Tac-Toe, Career Path, Who Are Ya, Contexto | an alias for the player: the apply payload's `"aliases": [{"person_id", "add": [...], "reason"}]` (an active data correction; it feeds the shared names list of every game) |
| Who Are Ya / Contexto namesake | pick another player: an alias cannot fix the first-namesake rule |
| Two answers on one Fan Favorites board share a spelling (surname, city) | the code leaves it out on purpose; the check reports which answer it credits. Fine for surnames and cities; never add it back as an alias |

Run `check` again after every fix until no rejected spelling is left.

## Proving the set is complete

- **Fan Favorites:** a rule board's answers come from the dataset. List the full set from a source
  (an award's winners, a draft's picks, a franchise's history) and compare both ways: a missing valid
  answer means the dataset lacks a fact (fix it as a data correction, or don't ship the board); an
  extra answer means the dataset is wrong.
- **Tic-Tac-Toe:** each cell's `valid` list is every player in the dataset who meets both criteria. Spot
  check the famous answers of each cell against a source, and every player you know fits a cell must be
  in it.
- **Player games:** the answer is one player; make sure the clues shown are right (game guide).

## Known gaps in the games themselves (not fixable by the writer)

These need a code change; mention them to Stefan when a question runs into one:

- Career Path matches exactly (no space removal, no suffix fallback): until fixed, give such players
  aliases ("Tim Hardaway" for Tim Hardaway Jr.).
- Who Are Ya and Contexto take the first namesake (32 shared full names in the dataset).
- Name the Logo accepts only the full team name ("Lakers", "Sixers" are wrong answers there).
- Guess the MVP accepts only the dataset's full names, no aliases ("Lew Alcindor" fails).
- Starting Five judges the box-score start slot (a guard listed F on that night is wrong on a guard card).
