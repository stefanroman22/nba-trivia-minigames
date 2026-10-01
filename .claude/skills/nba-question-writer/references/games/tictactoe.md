# NBA Tic-Tac-Toe (tictactoe)

A 3x3 board, team criteria on the rows and award/draft criteria on the columns ("CLAIM THREE IN A
ROW"). A cell is claimed by naming a player who fits both. Played PvP.

## Where it lives

- Generator: `backend/trivia/questions/games/tictactoe.py`; matcher `backend/trivia/games/tictactoe.py:player_matches`;
  renderer `src/Game Renderers/TicTacToe.tsx`.
- Definition `{"rows": [3 team criteria], "cols": [3 criteria]}`, stored with `valid` player ids per cell.
- TARGET 120 boards, MINIMUM 12. Every cell needs 3-400 valid players.
- Column criteria (`AWARD_COLUMNS`): Won MVP, Finals MVP, Defensive POY, Rookie of the Year,
  Sixth Man, NBA Champion, All-NBA, Undrafted, Lottery pick. Rows are teams with enough players.
- `data_static/tictactoe_seed.json` is legacy (multiplayer fallback only).

## What "writing content" means here

You write criteria labels and tune generation:
- Labels sit in a tiny cell: 1-3 words, abbreviations allowed ("Defensive POY").
- A good board mixes one easy column (NBA Champion) with one hard one (Sixth Man), so both
  players can claim cells but the last cell is a fight.
- A cell with 3 valid answers in a 5,000-player pool is legal but nasty; prefer at least 5.
- Each criterion must mean exactly what the matcher checks. Today "Lottery pick" matches any pick
  1-14 in any year, but the lottery began in 1985, so a 1975 #10 pick counts though no lottery
  existed. Flag mismatches like this instead of shipping a label a fan can dispute.

Known issue: team rows take the first historical name in the data, so a "Seattle SuperSonics"
row accepts Shai Gilgeous-Alexander (same for Vancouver, New Jersey, Washington Bullets).

## Validate

```
DATABASE_URL="" python manage.py test trivia.tests.test_questions_tictactoe trivia.tests.test_tictactoe
DATABASE_URL="" python trivia/games/validate_tictactoe_seed.py
```
