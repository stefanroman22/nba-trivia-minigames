# Fan Favorites (fan-favorites)

The player sees "On {survey_date}, we asked 100 NBA fans to name..." plus the prompt, then types
answers. A listed answer reveals "+{count} fans said it"; anything else costs one of 3 hearts.

## Where it lives

- Source: `backend/trivia/data_static/fan_favorites_seed.json` (`{"game","version","note","questions":[...]}`)
- Loaded by `trivia/utils/fan_favorites.py:load_seed` (maps `id` to `qid`), stored in
  `trivia_fanfavoritesquestion`, exported to `trivia/data/fan-favorites.json`.
- Rendered by `src/Game Renderers/FanFavorites.tsx`; matching in `src/utils/answerMatch.ts`.

## Shape

```json
{"id": "ff-041", "prompt": "Name a player who won 3 or more NBA MVP awards",
 "survey_date": "2026-07-01", "category": "player",
 "answers": [{"answer": "Michael Jordan", "count": 28, "aliases": ["jordan", "mj"]}]}
```

## Hard rules (code or tests enforce these)

- `id` ≤ 20 chars, unique, next free `ff-NNN`. `prompt` ≤ 200 chars.
- `category` is one of `player`, `team`, `season`, `coach`; it picks the autocomplete list, so a
  player prompt with category `team` makes the right answer untypeable.
- At least 6 answers, `count` in descending order, counts sum to exactly 100.
- `tests/test_fan_favorites.py` pins the question count (40 today). Adding boards means updating
  that number in the same change.

## Content rules

- **The answer list is the full set of accepted answers.** Any valid answer you leave out costs a
  correct player a heart. So pick prompts whose full valid set you can list from a source, and list
  all of it. Closed sets of 6-15 answers work best ("Name a franchise that moved cities").
  Open-ended prompts with 40+ valid answers ("Name a Slam Dunk Contest winner") cannot be complete
  at a fair size; narrow them ("...in the 2010s").
- **Counts are editorial estimates, not a survey.** No survey was run; real guess counts replace
  the estimates after 500 correct guesses. Estimate how often a typical fan would think of each
  answer first: the household name gets the biggest share, the deep cut gets 1-3. Never describe
  the counts as real survey results in docs, commit messages or replies.
- Aliases: surname, common nickname, accent-free form, and for teams the city alone and the
  nickname alone. Matching lowercases, strips accents and removes `' . , -`, so do not add aliases
  that differ only in those. Make sure no alias of one answer equals another answer's alias. Drop a bare surname alias when a
  more famous non-answer shares it ("johnson" on a 1990s #1 picks board credits a Magic guess).
- Mix categories and eras across the board set, not just players from the last decade.

## Known issues to fix when touching these boards

Spot-checked 2026-10-01, not yet confirmed against a source: ff-004 (#1 picks since 2010) lacks
John Wall, Anthony Bennett, Markelle Fultz, Deandre Ayton, Paolo Banchero, Zaccharie Risacher and the 2026 pick AJ Dybantsa;
ff-014 (multiple DPOYs) lacks Dennis Rodman; ff-017 (15+ All-Stars) lacks Kevin Durant; ff-019
(20+ seasons) lacks Kareem Abdul-Jabbar; ff-021 lacks Tyler Herro; ff-023 needs the 2026 champion
checked. ff-013 (any Slam Dunk winner) and ff-032 (any Canadian NBA player) are open-ended and cannot be complete; narrow or replace them.
Verify each against Basketball-Reference before editing.

## Validate

From `backend/`:
```
DATABASE_URL="" python manage.py test trivia.tests.test_fan_favorites
python manage.py seed_fan_favorites      # needs DATABASE_URL, updates the live table
python manage.py build_pools_from_db     # re-exports fan-favorites.json
```
