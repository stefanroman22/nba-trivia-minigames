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

A guess counts when it matches a starter of the card's position family (PG/SG any guard, SF/PF any
forward). Known gaps (code): the position is the box score's start slot, so a guard listed F that night is
wrong on a guard card; the autocomplete list (database names) can spell a name differently from the
lineup's.
