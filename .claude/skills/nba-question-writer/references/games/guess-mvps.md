# Guess the MVP (guess-mvps)

Eyebrow shows a season, title "Who won MVP?". 5 rounds of 10 points.

## Where it lives

- Pool `backend/trivia/data/mvps.json` (one row per season since 1955-56: `season`, `mvp`, `team`,
  `team_logo_url`), built from the `Mvp` table by `build_pools_from_db`.
- Renderer `src/Game Renderers/GuessMvps.tsx`; autocomplete from `all-players.json`.

## What "writing content" means here

There is nothing to invent: one row per real season. The work is keeping it right.
- Add the new MVP each season once the NBA announces it, and only then.
- A repeat winner is real (Gilgeous-Alexander won 2024-25 and 2025-26). Do not "fix" it as a duplicate.
- The `mvp` spelling must equal the `all-players.json` spelling so autocomplete can produce it.
- `team` is his team that season, under that season's franchise name.

## Validate

```
DATABASE_URL="" python manage.py test trivia.tests.test_build_static
python manage.py build_pools_from_db
```
