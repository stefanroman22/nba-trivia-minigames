# Tic-Tac-Toe difficulty (owner guideline, 2026-10-25)

Served to players: the solo idle screen has an Easy / Medium / Hard switch (default Medium). The rules are
code: `backend/trivia/questions/games/tictactoe_difficulty.py` (`column_tier`, `classify`). A board is as
hard as its hardest column, then every cell must pass that band's cell rule. `question_writer check`
runs `classify` on every proposal and fails a board whose level differs from the one asked for. No label =
hard. To change what a level means, change that module (a code change) and this file together, from
Stefan's examples.

## Easy

**In Stefan's words:** broad categories everyone knows, and answers that are general (many well-known
players fit), not only many.

**Signals:**
- rows: current franchises only (a casual fan knows today's 30 teams);
- columns only from: Guard / Forward / Center; From USA / International (the country the NBA lists, not
  the birthplace), or one named country where a famous player fits every row (Spurs x France); Played in
  the 2010s / 2020s;
- every cell: 8 to 400 valid players, at least 2 of them well known (fame band KNOWN or better);
- at most two position columns, one origin column, one decade column.

**Clear example:** Lakers / Celtics / Warriors x Guard / International / Played in the 2010s.

## Medium

**In Stefan's words:** a bit more niche than easy, far less than hard; a fan who follows the NBA knows it
without looking anything up. "Played with" only for the top of the top.

**Signals:**
- columns from: Played w/ Jordan, Kobe, LeBron, Shaq, Duncan, Curry, Durant or Magic (any season together,
  on any team; the star himself does not count); NBA Champion; Won MVP; All-Star (at least once); No. 1
  pick; Played in the 1990s / 2000s (with that row's team);
- at least two medium columns (the third may be easy);
- every cell: 5 to 400 valid players, at least one well known;
- at most two teammate, two award, one decade and one draft column.

**Clear example:** Bulls / Lakers / Spurs x Played w/ Jordan / Played in the 1990s / NBA Champion.

## Hard

**In Stefan's words (from his review of the published boards, all hard):** a column that asks for NBA
history or a rule casual players don't know.

**Signals:** any column that is not easy or medium: Finals MVP, DPOY, Rookie of the Year, All-NBA,
5x All-Star, Sixth Man (most players don't know what qualifies), any draft fact but the No. 1 pick
(lottery, undrafted, top-5), a college, a career-stat threshold (20+ PPG, 10+ RPG, 8+ APG, 20K points,
15+ seasons), a decade before the 1990s. Cells need only 3 to 400 valid players.

## Rule that holds for every level

A season belongs to the decade it starts in (2009-10 is the 2000s), for this and every game.
