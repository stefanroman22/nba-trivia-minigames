# NBA Wordle (`wordle`) — record-based, not written

Guess a 5-letter player surname. Solo: one word per Paris day (`pick_daily_wordle`, 23:00 UTC). Online: a
random word.

## Can the writer add questions? No.

The candidates are every player surname that folds to exactly 5 ASCII letters (about 528); the daily pick
is uniform random with a 180-day no-repeat rule (`trivia/utils/wordle_daily.py`). There is no curated list
to edit. Tell Stefan at step 0 and stop; choosing words would be a code change.

## Answers

Any 5 letters count as a guess; the solution matches exactly (uppercased). Candidates are deduplicated by
exact case only ("DuVal" and "Duval" are both candidates).
