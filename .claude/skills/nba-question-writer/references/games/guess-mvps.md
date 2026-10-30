# Guess the MVP (`guess-mvps`, pool `mvps`) — record-based, not written

One round = one award season: "Who was the Sixth Man of the Year in 2025-26?" over five awards (MVP,
Finals MVP, DPOY, ROY, 6MOY). 20 points.

## Can the writer add questions? No.

The pool is the real award history (291 rows live, 2026-10: ROY 74, MVP 71, FMVP 58, DPOY 44, 6MOY 44). It
grows by 5 a season when the data refresh brings the new winners. Tell Stefan this at step 0 and stop.
The only hand input is `backend/trivia/utils/nba_mvps.csv` (MVP rows) and data corrections for a wrong
award year; then `sync_nba_data --datasets mvps` and a publish `games=mvps`.

## Answers

`matchAnswer` against every co-winner's full name, **no aliases**: "Lew Alcindor", nicknames and suffix
differences are wrong answers today (a code gap; the autocomplete comes from `/trivia/all-players/`, the
database's player names). Report a complaint about it as a code fix, not content.
