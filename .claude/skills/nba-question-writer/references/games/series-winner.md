# Guess the Series Winner (series-winner)

Two teams from a real playoff series, eyebrow "{round} · {season}", title "Who won the series?".
5 rounds of 10 points.

## Where it lives

- Pool `backend/trivia/data/playoff.json` (every series since 1946-47: `season`, `team_a`, `team_b`,
  wins, `winner`, `round`, `total_games`, logos), built from the `PlayoffSeries` table (nba_api).
- Renderer `src/Game Renderers/PlayOffSeries.tsx`; the answer is an exact match on `winner`.

## What "writing content" means here

- Data comes from nba_api, never typed. Fix errors at the source fetch (`data_pipeline/sources.py`).
- `round` labels must be ones a player understands. Odd formats (the 1953-54 round robin) break
  the bracket logic; exclude them rather than guess a label.
- Team names follow the season ("Seattle SuperSonics" in 1979), and `winner` must equal one of the
  two team strings exactly or the round cannot be won.
- Coin-flip rounds are weak. Lopsided upsets and famous series are the fun ones; if you add weighting,
  favour series a fan might remember.

## Validate

```
DATABASE_URL="" python manage.py test trivia.tests.test_build_static
python manage.py build_pools_from_db
```
