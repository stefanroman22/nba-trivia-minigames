# Fill in the Starting 5 (starting-five)

Shows a real game (teams, date, final score); the player names the winning team's five starters,
each in the right slot. 3 lives, 100 points.

## Where it lives

- Pool `backend/trivia/data/starting-five.json` (games since 2010-10: `game_id`, `game_date`,
  teams, `final_score`, `winning_team`, `starting_5` of `{name, position}`), from nba_api box scores.
- Rules in `backend/trivia/data_pipeline/starting_five.py`: lineup is exactly 2 G, 2 F, 1 C.
  Names are rewritten to the `all-players.json` spelling (accent fold plus `NAME_ALIASES`).
- Renderer `src/Game Renderers/StartingFive.tsx`; a guess must match name and slot.

## What "writing content" means here

- Never type lineups. Fix fetch or name mapping instead.
- `position` is the box-score start slot, which can differ from the player's real position
  (a big man listed G). If that makes a game unfair, drop it rather than relabel.
- Every starter name must be producible by autocomplete. A lineup with a name the autocomplete
  cannot produce is unwinnable; add the mapping to `NAME_ALIASES` or drop the game.
- Prefer memorable games (playoffs, big rivalries, famous teams) over random midseason games.

## Validate

```
DATABASE_URL="" python manage.py test trivia.tests.test_starting_five trivia.tests.test_build_static
```
