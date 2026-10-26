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

Position standard (owner, 2026-10-25): the NBA's official listing plus any position Basketball-Reference's player
page adds; a hybrid counts for both (Tatum, NBA G-F, is a guard and a forward). Migration 0018 seeds 55 sourced
`position` DataCorrections: Bosh and Ibaka F → F-C, Mobley C → F-C, and the 52 players who had none. The rules and
the admin panel read the dataset with every active correction overlaid (`publish_v3.curated_dataset`), so they agree
with what is published (Eddie Johnson's 1989 Sixth Man included).

Position comes from the dataset's codes G, F, C, G-F, F-C (no point / shooting guard split exists), so the criterion
is `position` guard / forward / center, a hybrid counting for both its positions — added to all five copies of the
criteria contract (`src/utils/criteria.ts` and the four Python mirrors; `test_criteria_mirror`).

**Capacity:** 67,020 distinct easy boards satisfy the rules. The first generation made 1,200 (3.2× the 380 hard
boards): every team on 119–121 boards, every column on 450–600. The question factory's own difficulty formula, which
is independent of these rules, also rates all 1,200 easy.

## 4. Medium, and more hard (owner brief, 2026-10-25)

The owner: medium is a bit more niche than easy but far less than hard; we choose the criteria. His examples:
"Played with Kobe" (more of these, only the top-of-the-top stars), Played in the 90s / 2000s, NBA ring, MVP. Stats
("+10 assists per game") are hard, not medium.

Every column now has a tier (`column_tier`) and a board's band is its hardest column's:

| Tier | Columns |
|---|---|
| easy | Guard / Forward / Center; From USA / International; Played in the 2010s / 2020s |
| medium | Played w/ Jordan, Kobe, LeBron, Shaq, Duncan, Curry, Durant, Magic; NBA Champion; Won MVP; All-Star (1+); No. 1 pick; Played in the 1990s / 2000s |
| hard | everything else: Finals MVP, DPOY, ROY, All-NBA, 5x All-Star, Sixth Man; other draft facts; college; career stats; decades before 1990 |

Why these: a fan who follows the NBA knows each without looking anything up: a superstar's famous teammates, who
won a title or an MVP, who was an All-Star or a No. 1 pick, which teams a player was on in a decade they watched.
Measured on the live data, each passes the medium pair rule for 21–30 of the 30 teams (Played w/ Magic 21, No. 1
pick 22), except Won MVP: 6 teams, so it appears only on boards of teams that had MVPs.

- **Teammate** (`teammate`, value = the star's person_id): at least one season on the same franchise as the star;
  the row team is any of the player's teams ("Timberwolves × Played w/ Kobe" is a Kobe teammate who also played for
  Minnesota). It is resolved at publish time from the stints (`tictactoe.teammates`) into the board's `valid` ids, so
  it is Tic-Tac-Toe only and not part of contract #3. Stints are per season, so a player traded away mid-season
  before the star arrived still counts (rare; accepted).
- **New contract values** `allstar` (allstar_count ≥ 1) and `pick1` (pick = 1, never a territorial pick 0), added to
  all five copies of the criteria contract with `test_criteria_mirror` cases.
- **Medium pair rule:** ≥ 5 valid answers and ≥ 1 well-known (KNOWN+), ≤ 400. **Medium board:** ≥ 2 medium columns,
  the third medium or easy; ≤ 2 teammate, ≤ 2 award, ≤ 1 decade, ≤ 1 draft column.
- **Hard (little focus):** new boards with at least one career-stat column (20+ PPG, 10+ RPG, 8+ APG career, 20K
  points, 15+ seasons) beside the hard awards and draft facts; cells need only the publisher's 3–400 answers. The
  data has career averages only, so single-season stats ("+10 APG in a season") are not possible yet.

Local generation: 1,200 medium and 220 hard, for 1,200 easy / 1,200 medium / about 600 hard, the spec's 40/40/20
mix. Re-running `--label-rules` keeps the 380 factory boards hard (none has two medium columns without a hard one)
and rewrites their reasons without NBA Champion / MVP, which are medium now.

## 5. Answer coverage audit and fixes (2026-10-25)

An independent audit recomputed every cell of the 1,420 medium and hard boards with its own matcher: 0 missing and
0 wrong answers in the code. What it found was in the data and the names; the owner's decisions:

- **One year rule** for every criterion in this game: a season belongs to the decade it starts in (the 2010s begin
  with 2010-11; 2009-10 is the 2000s). Decades, team × decade cells, "Played w/" and "current franchise" all read
  seasons from `tictactoe._seasons`. Then extended to every game (owner, 2026-10-26): the contract's `era` in
  `criteria.ts` and its four Python mirrors (Grid, Heatmap, Bingo, the legacy Tic-Tac-Toe seed) and Who Would Win's
  decade sides ("'90s Bulls" = 1990-91 .. 1999-00) read decades the same way. Three Heatmap boards that leaned on
  the old calendar edge (hm-board-1, 5, 10) were rebuilt with heatmap_gen's own build_board; manifest 2026-10-26.yr.
- **Teammates:** sharing a season on one franchise counts, even when the player left before the star arrived
  mid-season (owner: "if Jordan still played the half season, it counts").
- **Missing players:** 334 rows had no stints because PlayerCareerStats answers `{}` for them. The league's game
  finder (official stats.nba.com) still has their games, so their stints and career come from those games
  (`season_rows_from_games`; the pipeline now falls back to it), as sourced DataCorrections (migration 0019).
  Corey Williams (no commonplayerinfo at all) gets his bio from Wikipedia, which matches the NBA's game counts.
- **Averages:** a career average counts only the games of the seasons that recorded the stat (rebounds from
  1950-51): George Mikan 13.4 rpg, not 9.5. Fixed in `build_career` and as corrections for the pre-1951 players.
- **Names:** lookups compare names without spaces and punctuation ("Shaquille O Neal", "Karl Anthony Towns", "A C
  Green"), a typed suffix the name lacks falls back ("Mike Conley Jr"), the suggestion list ignores accents and
  punctuation, and common nicknames / former names are alias corrections ("Shaq", "Ron Artest", "Enes Kanter").
- Not changed: "Lottery pick" keeps counting picks 1-14 before 1985, and stats are NBA-only (no ABA), as the
  official NBA statistics are.

## 6. Running it

```
python manage.py tictactoe_difficulty --label-rules [--dry-run]
python manage.py tictactoe_difficulty --generate-easy 1000 --generate-medium 1000 --generate-hard 200 \
    [--status pending|active] [--seed N] [--dry-run]
```

Generated boards are `created_by = "<band>-rules"`, status `pending` by default (the factory's Checker sees them
before players do), labeled with their band by rule. The admin labeler shows rule labels as a faint thumb with their reason;
confirming or changing one makes it the owner's.

## 7. Not done yet

- Production: the local database holds the generated boards and the rule labels; on production the command runs after
  this code is promoted (pending boards → Checker → published).
- Serving by difficulty: the game deals a random board from every published one; with more easy than hard, players
  will mostly meet easy boards. A difficulty choice (or a mix per session) is the next product decision.
- Medium tuning: after the owner labels medium boards (which stars, which honours feel too easy or too hard).
