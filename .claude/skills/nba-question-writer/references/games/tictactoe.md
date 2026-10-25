# NBA Tic-Tac-Toe (tictactoe)

A 3x3 board: team criteria on the rows, one criterion per column ("CLAIM THREE IN A ROW"). A cell is claimed by
naming a player who fits both its row and its column. Played solo and PvP. One of the most wanted games: the owner
is optimizing it by difficulty (2026-10-25, `docs/superpowers/specs/2026-10-25-tictactoe-difficulty-design.md`).

## Where it lives

- Generator: `backend/trivia/questions/games/tictactoe.py` (the factory's award boards) and
  `backend/trivia/questions/games/tictactoe_difficulty.py` (the difficulty rules, the pair library and the easy-board
  generator); matcher `backend/trivia/games/tictactoe.py:player_matches` (contract #3, mirrored in
  `src/utils/criteria.ts` and three more Python copies; `trivia.tests.test_criteria_mirror` keeps them in lockstep);
  renderer `src/Game Renderers/TicTacToe.tsx` (shows the labels only; answers are checked against the board's `valid`
  ids, so a criterion needs no renderer change).
- Definition `{"rows": [3 team criteria], "cols": [3 criteria]}`; the publisher materializes `valid` player ids per
  cell (most famous first: the first unused one is revealed on time-up). Every cell needs 3-400 valid players.
- Difficulty labels: `trivia.models.QuestionLabel` (one per board: easy / medium / hard, `source` owner or rule,
  `reason`). No label = hard. The owner labels in the admin panel (Admin → Games → NBA Tic-Tac-Toe → View questions);
  an owner label always wins over a rule's and no rule ever overwrites it.
- `data_static/tictactoe_seed.json` is legacy (multiplayer fallback only).

## A board is nine pairs

Each cell is a pair: row criterion × column criterion. Difficulty lives in the pairs: a board is only as easy as its
hardest cell. Judge and build boards pair by pair (`pair_library`), never by the board's look.

## Criteria that exist

| Type | Values | Label style | Difficulty |
|---|---|---|---|
| `team` (rows) | franchise abbr, modern name | "Miami Heat" | the 30 current franchises are easy; defunct ones are not |
| `position` | `guard` (G, G-F), `forward` (F, G-F, F-C), `center` (C, F-C) | "Guard" | easy (broad). The data has no point / shooting guard split: never write "Point Guard". Standard (owner, 2026-10-25): the NBA's official listing plus any position Basketball-Reference's player page adds, a hybrid counting for both (Tatum G-F is a guard and a forward); gaps are fixed with sourced `position` DataCorrections (migration 0018: Bosh, Ibaka, Mobley F-C, 52 missing filled), never by editing players_curated.json |
| `country` | `USA`, `INTL` (any other listed country), or one country name: the country the NBA lists, not the birthplace (Kyrie Irving is USA) | "From USA", "International", "From France" | USA / INTL easy; one named country is almost never easy (see below) |
| `era` | `1990s` … `2020s` | "Played in the 2010s" | 2010s / 2020s easy; older decades need history. On a team row the cell needs a stint WITH that team in the decade (`tictactoe.pair_matches`; the contract's era alone is any stint, which let Kyrie Irving answer "Celtics × 2020s") |
| `award` | `mvp`, `fmvp`, `dpoy`, `roty`, `smoy`, `ring`, `allnba`, `allstar5plus` | "Finals MVP" | hard (needs NBA history); Sixth Man the hardest (players don't know what qualifies) |
| `draft` | `undrafted`, `lottery`, `top5`, `round2`, `decade-1990s` | "Lottery pick" | hard (draft facts casual players don't know) |
| `college`, `stat` | a school / `20kpts`, `ppg20`, … | | hard |

Each criterion must mean exactly what the matcher checks. "Lottery pick" matches any pick 1-14 in any year (the
lottery began in 1985); a hybrid G-F counts as Guard and as Forward. Flag a label a fan can dispute instead of
shipping it.

## Questions that exist (2026-10-25)

- 380 published factory boards (ttt-0001 …): all 3 teams × 3 award/draft columns, all **hard** (the owner's review;
  the rule labels the rest). Columns used: Rookie of the Year 205, All-NBA 189, NBA Champion 182, Lottery pick 177,
  Sixth Man 145, Undrafted 116, MVP 50, Finals MVP 46, DPOY 30.
- Easy boards from the easy rules (`created_by = "easy-rules"`): 1,200 generated locally, about 67,000 possible.
- List them: `Question.objects.filter(game="tictactoe")`, labels via `.select_related("label")`; or the admin panel.

## Difficulty patterns (the owner's, 2026-10-25)

**Hard:** any award, draft, college or stat column. 8 of the 380 published boards no longer even materialize on
today's player data (e.g. Sacramento Kings × Sixth Man: 2 valid players).

**Easy:** broad categories everyone knows AND general answers (many well-known players fit, not only many players):
- rows: the 30 current franchises;
- columns: Guard / Forward / Center; From USA / International; Played in the 2010s / 2020s;
- every pair: at least 8 valid answers and at least 2 well-known ones (fame band KNOWN or better, `trivia.questions.fame`),
  at most 400 (the publisher cap; old franchises × From USA exceed it);
- every board: at most 2 position columns, 1 origin column, 1 decade column; no repeated criteria set; teams spread
  evenly over the boards.
- One named country fails the pair rule for almost every team (France 1 team, Canada / Germany / Serbia / Lithuania 0):
  Trail Blazers × "From Germany" has no well-known answer. Do not build easy boards on named countries.

**Medium:** not defined yet (the owner will give input after labeling easy boards). Do not invent it.

## Writing and generating

- Labels sit in a tiny cell: 1-3 words, abbreviations allowed ("Defensive POY").
- Easy boards: `python manage.py tictactoe_difficulty --generate-easy N [--status pending|active] [--seed S] [--dry-run]`
  (pending by default: the Checker sees them before players). Rule labels for unreviewed boards:
  `python manage.py tictactoe_difficulty --label-rules [--dry-run]`. Never hand-write a board the rules reject.
- A cell with 3 valid answers in a 5,000-player pool is legal but nasty; easy boards need at least 8.

Answers: a typed name resolves to every player of that name (`buildNameLookup` / the relay's `nameLookup`
`toIds`), and the game keeps the one who fits the cell, so namesakes (the two Eddie Johnsons) are all reachable; a
name typed without its Jr. / II suffix finds the suffixed player after any exact match ("Gary Payton" stays Gary
Payton). A nickname a fan types needs a hand-written alias on the row ("Steve Smith" for Steven Smith). The rules
and the panel read the dataset with the active DataCorrections overlaid, exactly as the publisher does.

Known issue: team rows use the modern franchise, so a relocated franchise's old players count (Gary Payton fits
Oklahoma City Thunder through the Seattle years; same for Vancouver → Memphis, New Jersey → Brooklyn).

## Validate

```
DATABASE_URL="" python manage.py test trivia.tests.test_tictactoe_difficulty trivia.tests.test_criteria_mirror trivia.tests.test_admin_questions
DATABASE_URL="" python manage.py test trivia.tests.test_questions_tictactoe trivia.tests.test_tictactoe
DATABASE_URL="" python trivia/games/validate_tictactoe_seed.py
```
