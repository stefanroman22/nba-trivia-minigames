# Career Path (career-path)

The player sees a mystery player's team cards one at a time ("TRACE THE CAREER") and names him.
Fewer cards used scores more.

## Where it lives

- Generator: `backend/trivia/questions/games/career_path.py`; renderer `src/Game Renderers/CareerPath.tsx`.
- A question is just `{"person_id": N}`; the cards come from that player's `teams` stints in
  `players_curated.json`. There is no question text to write.
- TARGET 500 active questions, MINIMUM 50 (publish aborts below it). 3-7 stints per player;
  fame tier 2-3 weighted 3x so journeymen appear more than superstars.

## What "writing content" means here

You improve the player rows and the selection rules, not prompts:
- Stints must be in order, non-overlapping, and split same-season trades into separate stints.
- Franchise names follow the season (a 2007 Seattle stint says Seattle SuperSonics).
- The best rounds have a recognisable but non-obvious path: 4-6 stints with one memorable stop.
  A 3-stint path of only small markets is too hard; a single-franchise legend is ineligible.
- Never hand-edit facts in `players_curated.json`; regenerate per `docs/games/DATA_REQUIREMENTS.md`.

## Validate

```
DATABASE_URL="" python manage.py test trivia.tests.test_career_path trivia.tests.test_questions_runner trivia.tests.test_curated_players
python manage.py maintain_questions --games career-path --dry-run   # needs Supabase env vars
```
