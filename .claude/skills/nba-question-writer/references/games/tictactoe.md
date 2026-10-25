# NBA Tic-Tac-Toe (tictactoe)

A 3x3 board: team criteria on the rows, one criterion per column ("CLAIM THREE IN A ROW"). A cell is claimed by
naming a player who fits both its row and its column. Played solo and PvP. One of the most wanted games: the owner
is optimizing it by difficulty (2026-10-25, `docs/superpowers/specs/2026-10-25-tictactoe-difficulty-design.md`).

## Where it lives

- Generator: `backend/trivia/questions/games/tictactoe.py` (the factory's award boards) and
  `backend/trivia/questions/games/tictactoe_difficulty.py` (the difficulty rules, the pair library and the easy, medium
  and hard board generators); matcher `backend/trivia/games/tictactoe.py:player_matches` (contract #3, mirrored in
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
| `era` | `1990s` … `2020s` | "Played in the 2010s" | 2010s / 2020s easy; 1990s / 2000s medium; earlier hard. On a team row the cell needs a stint WITH that team in the decade (`tictactoe.pair_matches`; the contract's era alone is any stint, which let Kyrie Irving answer "Celtics × 2020s") |
| `teammate` | a star's person_id (STARS: Jordan, Kobe, LeBron, Shaq, Duncan, Curry, Durant, Magic) | "Played w/ Kobe" | medium (the owner's favourite). At least one season on the same franchise as the star, the row team being any of the player's teams; the star himself never counts. Tic-Tac-Toe only, resolved at publish time (`tictactoe.teammates`), not in contract #3. Only top-of-the-top stars: never add a star whose teammates a fan can't name |
| `award` | `ring`, `mvp`, `allstar` (1+ selection) | "NBA Champion", "Won MVP", "All-Star" | medium (famous honours) |
| `award` | `fmvp`, `dpoy`, `roty`, `smoy`, `allnba`, `allstar5plus` | "Finals MVP" | hard (needs NBA history); Sixth Man the hardest (players don't know what qualifies) |
| `draft` | `pick1` | "No. 1 pick" | medium (first overall picks are famous) |
| `draft` | `undrafted`, `lottery`, `top5`, `round2`, `decade-1990s` | "Lottery pick" | hard (draft facts casual players don't know) |
| `stat` | `ppg20`, `rpg10`, `apg8`, `20kpts`, `25kpts`, `seasons15plus` (career, no single-season stats exist) | "8+ APG career" | hard (the owner: stats are hard) |
| `college` | a school | | hard |

Each criterion must mean exactly what the matcher checks. "Lottery pick" matches any pick 1-14 in any year (the
lottery began in 1985); a hybrid G-F counts as Guard and as Forward. Flag a label a fan can dispute instead of
shipping it.

## Questions that exist (2026-10-25)

- 380 published factory boards (ttt-0001 …): all 3 teams × 3 award/draft columns, all **hard** (the owner's review;
  the rule labels the rest). Columns used: Rookie of the Year 205, All-NBA 189, NBA Champion 182, Lottery pick 177,
  Sixth Man 145, Undrafted 116, MVP 50, Finals MVP 46, DPOY 30.
- Easy boards from the easy rules (`created_by = "easy-rules"`): 1,200 generated locally, about 67,000 possible.
- Medium boards (`created_by = "medium-rules"`): 1,200 generated locally; hard career-stat boards
  (`created_by = "hard-rules"`): 220, so the hard total is about 600 (easy 40% / medium 40% / hard 20%, the spec's mix).
- List them: `Question.objects.filter(game="tictactoe")`, labels via `.select_related("label")`; or the admin panel.

## Difficulty patterns (the owner's, 2026-10-25)

A board's band is its hardest column's tier (`tictactoe_difficulty.column_tier`); then every cell must pass that
band's pair rule.

**Hard:** Finals MVP, DPOY, Rookie of the Year, All-NBA, 5x All-Star, Sixth Man; any draft fact but the No. 1 pick;
a college; a career-stat threshold; a decade before the 1990s. 8 of the 380 published boards no longer even
materialize on today's player data (e.g. Sacramento Kings × Sixth Man: 2 valid players). Hard boards built by the
rules carry at least one career-stat column; each cell needs only the publisher's 3-400 answers.

**Easy:** broad categories everyone knows AND general answers (many well-known players fit, not only many players):
- rows: the 30 current franchises;
- columns: Guard / Forward / Center; From USA / International; Played in the 2010s / 2020s;
- every pair: at least 8 valid answers and at least 2 well-known ones (fame band KNOWN or better, `trivia.questions.fame`),
  at most 400 (the publisher cap; old franchises × From USA exceed it);
- every board: at most 2 position columns, 1 origin column, 1 decade column; no repeated criteria set; teams spread
  evenly over the boards.
- One named country fails the pair rule for almost every team (France 1 team, Canada / Germany / Serbia / Lithuania 0):
  Trail Blazers × "From Germany" has no well-known answer. Do not build easy boards on named countries.

**Medium** (the owner's brief, 2026-10-25: a bit more niche than easy, far less than hard; criteria chosen by us):
- columns: Played w/ <star> (the eight STARS), NBA Champion, Won MVP, All-Star, No. 1 pick, Played in the 1990s / 2000s;
- every board: at least two medium columns, the third medium or easy; at most two teammate, two award, one decade,
  one draft column;
- every pair: at least 5 valid answers and at least 1 well-known one (at most 400).
- Not medium: single-season or career stats ("+10 assists per game" is hard, and the data holds career averages only).

## Writing and generating

- Labels sit in a tiny cell: 1-3 words, abbreviations allowed ("Defensive POY").
- Boards by band: `python manage.py tictactoe_difficulty --generate-easy N --generate-medium N --generate-hard N
  [--status pending|active] [--seed S] [--dry-run]` (pending by default: the Checker sees them before players). Rule
  labels for unreviewed boards:
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
