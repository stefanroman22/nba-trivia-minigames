# Starting Five (`starting-five`) — record-based, not written

One round = one game's winning starting lineup (2 guards, 2 forwards, 1 center); the player names each
starter. 60 points per player, 300 at most.

## Can the writer add questions? Not by hand.

Lineups come from real box scores, sampled per season by `sync_nba_data` (the monthly refresh samples 20
games for each of the last 2 seasons). 553 live (2010-10-30 to 2026-05-09); the ceiling is every box score
since 1996 with a 2-2-1 lineup. More rounds = sampling more games (`sync_nba_data` with more `--max-games`
or seasons, from a residential IP or the relay), then a publish `games=starting-five`. That is a data job,
not writing: tell Stefan at step 0 and ask whether he wants it.

## Answers

Any starter of the game not found yet is right on any card (`src/utils/startingFive.ts placeGuess`): on a
card of his own position family he fills it, otherwise he goes to the card the reveal gives him. Names
compare with `sameName` (spaces and a trailing Jr/Sr/II-V forgiven). Remaining gap: the autocomplete list
(database names) can spell a name differently from the lineup's.
