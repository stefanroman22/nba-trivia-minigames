# NBA Wordle (wordle)

Guess a player's 5-letter last name in 5 tries ("GUESS THE PLAYER'S LAST NAME"). One word per day.

## Where it lives

- Daily pick: `backend/trivia/wordle_daily.py` (no repeat within 180 days, day boundary Europe/Paris),
  from last names in the `Player` table; `text_utils.wordle_word` strips accents and keeps exactly
  5 ASCII letters. Picked nightly by `pick_daily_wordle` (GitHub Actions).
- Multiplayer pool `backend/trivia/data/wordle.json`, deduped case-insensitively.
- Renderer `src/Game Renderers/Wordle.tsx`; guesses are only checked for length 5.

## What "writing content" means here

- The word should belong to a player a fan could name: favour well-known players. A 5-letter name
  of a forgotten 1950s player makes the day feel unwinnable even if solved by letters.
- Names that collapse to the same word ("DuVal" and "Duval") count once.
- Skip surnames that are also common English words only if it makes the puzzle trivial; otherwise
  they are fine.

## Validate

```
DATABASE_URL="" python manage.py test trivia.tests.test_build_static
```
