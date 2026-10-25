# Tic-Tac-Toe difficulty: hard rule and easy boards — design

Date: 2026-10-25. Owner request: Tic-Tac-Toe is one of the most wanted games. After labeling the published boards up to
ttt-0057 (all hard), (1) find what makes them hard and label every board he has not reviewed with the same insight,
and (2) build a system that generates easy boards — many more easy than hard. Medium is out of scope for now.
Code: `backend/trivia/questions/games/tictactoe_difficulty.py`, command `manage.py tictactoe_difficulty`.

## 1. A board is nine pairs

Every cell is a pair: its row criterion × its column criterion. Difficulty lives in the pairs, not the board: a board
is only as easy as its hardest cell, so a player who meets one cell they cannot answer meets a hard board. The rules
therefore judge pairs, and easy boards are composed from a **pair library** (every current team × every easy-candidate
column, scored once per player dataset) instead of drawing random boards and hoping. The served unit stays the board
(`Question`): the game, the publisher, the play stats and the labels are all per board, and a 360-pair library costs
milliseconds to compute, so it is not stored. Persist pair scores only when cell-level labels arrive (medium work).

## 2. Hard — the owner's pattern

All 380 published boards share one shape: 3 teams × 3 columns drawn from nine award / draft criteria (Rookie of the
Year 205 boards, All-NBA 189, NBA Champion 182, Lottery pick 177, Sixth Man 145, Undrafted 116, MVP 50, Finals MVP 46,
DPOY 30). Each asks for NBA history or a rule the casual player does not know:

| Column kind | Why it is hard |
|---|---|
| Any award (MVP, Finals MVP, DPOY, ROY, All-NBA, champion, 5x All-Star) | needs NBA history |
| Sixth Man | the hardest: most players don't know what qualifies |
| Draft facts (lottery pick, undrafted, top-5, second round, draft decade) | facts casual players never learn |
| College, career-stat thresholds | same |

**Rule:** a board with any such column is hard; the reason names each column (and how many cells have fewer than two
well-known answers). Applied to every board without an owner label: 378 hard, the owner's own labels untouched
(`QuestionLabel.source` = `rule`, `reason` set; an owner label always wins and is never overwritten).

## 3. Easy — the owner's criteria, made measurable

Easy = broad categories everyone knows **and** general answers: many well-known players fit, not only many players.

| Part | Rule | Evidence (live dataset, 2026-10-25) |
|---|---|---|
| Rows | the 30 current franchises | defunct franchises are unknown to casual fans |
| Columns | Guard / Forward / Center; From USA / International; Played in the 2010s / 2020s | each is easy with 30 teams (USA with 17: older franchises exceed the 400-answer cap) |
| Named countries | allowed only where every pair passes | France, Canada, Germany, Serbia, Lithuania pass with 0–1 teams: one country is **not** an easy column in this data (Trail Blazers × Germany has no well-known answer) |
| Every pair | ≥ 8 valid answers and ≥ 2 well-known (fame band KNOWN or better) | fame: `trivia.questions.fame` |
| Every board | ≤ 2 position columns, ≤ 1 origin column, ≤ 1 decade column; no repeated criteria set; teams spread evenly | |

A team × decade cell needs a stint with that team in the decade (`tictactoe.pair_matches`): the contract's era criterion alone checks the whole career, which accepted Kyrie Irving for "Celtics × Played in the 2020s" (the independent audit of 2026-10-25 found 28% of era-cell answers were like that). "International" is the country the NBA lists for the player, not his birthplace.

Position comes from the dataset's codes G, F, C, G-F, F-C (no point / shooting guard split exists), so the criterion
is `position` guard / forward / center, a hybrid counting for both its positions — added to all five copies of the
criteria contract (`src/utils/criteria.ts` and the four Python mirrors; `test_criteria_mirror`).

**Capacity:** 67,020 distinct easy boards satisfy the rules. The first generation made 1,200 (3.2× the 380 hard
boards): every team on 119–121 boards, every column on 450–600. The question factory's own difficulty formula, which
is independent of these rules, also rates all 1,200 easy.

## 4. Running it

```
python manage.py tictactoe_difficulty --label-rules [--dry-run]
python manage.py tictactoe_difficulty --generate-easy 1000 [--status pending|active] [--seed N] [--dry-run]
```

Generated boards are `created_by = "easy-rules"`, status `pending` by default (the factory's Checker sees them
before players do), labeled easy by rule. The admin labeler shows rule labels as a faint thumb with their reason;
confirming or changing one makes it the owner's.

## 5. Not done yet

- Production: the local database holds the 1,200 boards and the rule labels; on production the command runs after
  this code is promoted (pending boards → Checker → published).
- Serving by difficulty: the game deals a random board from every published one; with more easy than hard, players
  will mostly meet easy boards. A difficulty choice (or a mix per session) is the next product decision.
- Medium: the "neither" band of `classify`, after the owner labels easy boards and gives more input.
