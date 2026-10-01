# Name the NBA Club (name-logo)

Shows a team logo, "Which franchise is this?". 5 rounds of 10 points.

## Where it lives

- Pool `backend/trivia/data/name-logo.json`: the 30 current teams (`team_id`, `full_name`,
  `abbreviation`, `logo`), from the `Team` table.
- Renderer `src/Game Renderers/NameLogo.tsx`; matching is against `full_name` only, no aliases.

## What "writing content" means here

- The set is fixed at 30 teams; there is nothing to add.
- Players type "Lakers" or "LA Clippers" and miss because there are no aliases. If asked to improve
  this game, the fix is accepting nickname and city aliases in the matcher, not editing names.
- Use official current names ("Los Angeles Clippers" is the legal name; "LA Clippers" is branding,
  so accept both as answers).

## Validate

```
DATABASE_URL="" python manage.py test trivia.tests.test_build_static
```
