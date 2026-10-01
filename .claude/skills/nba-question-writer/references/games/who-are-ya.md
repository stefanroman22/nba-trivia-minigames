# Who Are Ya? (who-are-ya)

Mystery player with a blurred photo. Each guess reveals how close the guessed player is on
attributes (team, position, height, age, country, draft, jersey). 8 guesses.

## Where it lives

- Generator: `backend/trivia/questions/games/who_are_ya.py`; renderer `src/Game Renderers/WhoAreYa.tsx`.
- A question is `{"person_id": N}`. TARGET is every eligible player; MINIMUM 30.
- Eligible: fame tier 1-2 and at least one team stint.

## What "writing content" means here

The clues are the player's attributes, so every attribute shown must be right:
- `draft.team_abbr` is the team that made the pick, not the team after a draft-night trade.
- Jersey is his most associated number, and position matches his main role.
- Only famous players belong here. A deep cut makes 8 guesses feel unfair, so keep tier 1-2
  accurate rather than widening it.
- Fix wrong facts by regenerating player data, never by hand edits.

## Validate

```
DATABASE_URL="" python manage.py test trivia.tests.test_who_are_ya trivia.tests.test_questions_mystery trivia.tests.test_curated_players
```
